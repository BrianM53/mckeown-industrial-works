import type { Rng } from '@/core/rng'
import type { QualityTier } from '@/core/types'
import { noiseBuffer, SMOOTH_RATE, type NoiseColor } from './buffers'

/**
 * Synth: a tiny node factory bound to one (Offline)AudioContext that tracks
 * every node it creates, so a voice / loop can be stopped and disconnected as
 * a unit. Plus envelope helpers and reusable "instruments" (thump, burst,
 * modal resonator, FM hit, pluck, spark train) that the sound library composes.
 *
 * Conventions: times are context seconds; `decay` / `release` values are
 * T60-ish (the envelope is ~−60 dB after that many seconds); every envelope
 * starts at 0 and ramps (no clicks).
 */
export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

/** Time constant for setTargetAtTime so the value is ~−60 dB after `t60` seconds. */
export const tc = (t60: number) => Math.max(0.0005, t60 / 6.91)

export class Synth {
  readonly nodes: AudioNode[] = []
  readonly sources: AudioScheduledSourceNode[] = []
  private children: Set<Synth> | null = null
  private disposed = false

  constructor(
    readonly ctx: BaseAudioContext,
    readonly rng: Rng,
    private readonly parent: Synth | null = null,
  ) {}

  get isDisposed(): boolean {
    return this.disposed
  }

  /** Random float in [a, b). */
  r(a: number, b: number): number {
    return a + (b - a) * this.rng()
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.rng() * items.length) % items.length]
  }

  private track<T extends AudioNode>(n: T): T {
    this.nodes.push(n)
    return n
  }

  /** Track a node created elsewhere so dispose() disconnects it too. */
  adopt<T extends AudioNode>(n: T): T {
    return this.track(n)
  }

  gain(value = 1): GainNode {
    const g = this.ctx.createGain()
    g.gain.value = value
    return this.track(g)
  }

  filter(type: BiquadFilterType, freq: number, q = 0.7071, gainDb = 0): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = clampFreq(freq, this.ctx.sampleRate)
    f.Q.value = q
    if (gainDb) f.gain.value = gainDb
    return this.track(f)
  }

  lp(freq: number, q = 0.7071): BiquadFilterNode {
    return this.filter('lowpass', freq, q)
  }

  hp(freq: number, q = 0.7071): BiquadFilterNode {
    return this.filter('highpass', freq, q)
  }

  bp(freq: number, q = 1): BiquadFilterNode {
    return this.filter('bandpass', freq, q)
  }

  peaking(freq: number, q: number, gainDb: number): BiquadFilterNode {
    return this.filter('peaking', freq, q, gainDb)
  }

  /** Oscillator started at t0 (and stopped at t1 when given). */
  osc(type: OscillatorType, freq: number, t0: number, t1?: number, detune = 0): OscillatorNode {
    const o = this.ctx.createOscillator()
    o.type = type
    o.frequency.value = clampFreq(freq, this.ctx.sampleRate)
    if (detune) o.detune.value = detune
    o.start(t0)
    if (t1 !== undefined) o.stop(Math.max(t1, t0 + 0.001))
    this.sources.push(o)
    return this.track(o)
  }

  /** Oscillator with custom harmonic amplitudes (index 1 = fundamental). */
  harmonics(amps: number[], freq: number, t0: number, t1?: number): OscillatorNode {
    const o = this.osc('sine', freq, t0, t1)
    const real = new Float32Array(amps.length + 1)
    const imag = new Float32Array(amps.length + 1)
    for (let i = 0; i < amps.length; i++) imag[i + 1] = amps[i]
    o.setPeriodicWave(this.ctx.createPeriodicWave(real, imag, { disableNormalization: false }))
    return o
  }

  /** Looping noise source from the context's noise bank, random start offset. */
  noise(color: NoiseColor, t0: number, t1?: number, rate = 1): AudioBufferSourceNode {
    const buf = noiseBuffer(this.ctx, color)
    return this.buffer(buf, t0, t1, { loop: true, rate, offset: this.rng() * Math.max(0, buf.duration - 0.05) })
  }

  buffer(buf: AudioBuffer, t0: number, t1?: number, o: { loop?: boolean; rate?: number; offset?: number } = {}): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.loop = o.loop ?? false
    if (o.rate !== undefined) src.playbackRate.value = o.rate
    src.start(t0, o.offset ?? 0)
    if (t1 !== undefined) src.stop(Math.max(t1, t0 + 0.001))
    this.sources.push(src)
    return this.track(src)
  }

  /** Stereo pan (−1..1). Falls back to a plain gain where StereoPannerNode is missing. */
  pan(value: number): AudioNode {
    const c = this.ctx as BaseAudioContext & { createStereoPanner?: () => StereoPannerNode }
    if (typeof c.createStereoPanner !== 'function') return this.gain(1)
    const p = c.createStereoPanner()
    p.pan.value = Math.max(-1, Math.min(1, value))
    return this.track(p)
  }

  shaper(curve: Float32Array): WaveShaperNode {
    const w = this.ctx.createWaveShaper()
    w.curve = curve as Float32Array<ArrayBuffer>
    w.oversample = 'none'
    return this.track(w)
  }

  delay(maxTime: number, time: number): DelayNode {
    const d = this.ctx.createDelay(maxTime)
    d.delayTime.value = Math.min(time, maxTime)
    return this.track(d)
  }

  /**
   * Convolution reverb. With `defer`, the (expensive, synchronous in Chrome)
   * buffer assignment happens in idle time instead of right now.
   */
  convolver(buf: AudioBuffer | (() => AudioBuffer), defer = false): ConvolverNode {
    const c = this.ctx.createConvolver()
    const assign = () => {
      if (this.disposed) return
      try {
        c.buffer = typeof buf === 'function' ? buf() : buf
      } catch {
        /* reverb is optional */
      }
    }
    if (defer) idle(assign)
    else assign()
    return this.track(c)
  }

  /** Connect nodes in series; returns the last. */
  chain(...nodes: AudioNode[]): AudioNode {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1])
    return nodes[nodes.length - 1]
  }

  /** Slow periodic modulation: osc(freq) × depth → param (added to its value). */
  lfo(freq: number, depth: number, target: AudioParam, t0: number, t1?: number, type: OscillatorType = 'sine'): OscillatorNode {
    const o = this.osc(type, freq, t0, t1)
    const g = this.gain(depth)
    o.connect(g)
    g.connect(target)
    return o
  }

  /**
   * Smooth random modulation added to `target`: fluctuates at roughly `rateHz`
   * with RMS ≈ depth/2 (peaks ≈ ±depth). Modulate a dedicated gain stage whose
   * base value stays above `depth`, never an envelope that rests at 0.
   */
  wander(rateHz: number, depth: number, target: AudioParam, t0: number, t1?: number): AudioBufferSourceNode {
    const buf = noiseBuffer(this.ctx, 'smooth')
    const src = this.buffer(buf, t0, t1, { loop: true, rate: Math.max(0.01, rateHz / SMOOTH_RATE), offset: this.rng() * buf.duration * 0.95 })
    const g = this.gain(depth)
    src.connect(g)
    g.connect(target)
    return src
  }

  // ---- envelopes ----------------------------------------------------------

  /** Percussive: linear attack to `peak`, exponential decay (T60 = decay). Returns end time. */
  perc(p: AudioParam, t: number, peak: number, attack: number, decay: number): number {
    p.setValueAtTime(0, t)
    p.linearRampToValueAtTime(peak, t + attack)
    p.setTargetAtTime(0, t + attack, tc(decay))
    return t + attack + decay
  }

  /** Attack – hold – exponential release. Returns end time. */
  ahr(p: AudioParam, t: number, peak: number, attack: number, hold: number, release: number): number {
    p.setValueAtTime(0, t)
    p.linearRampToValueAtTime(peak, t + attack)
    if (hold > 0) p.setValueAtTime(peak, t + attack + hold)
    p.setTargetAtTime(0, t + attack + hold, tc(release))
    return t + attack + hold + release
  }

  /** Exponential glide (both values > 0). */
  sweep(p: AudioParam, t: number, from: number, to: number, dur: number): void {
    p.setValueAtTime(Math.max(1e-4, from), t)
    p.exponentialRampToValueAtTime(Math.max(1e-4, to), t + Math.max(0.001, dur))
  }

  /** Linear glide. */
  ramp(p: AudioParam, t: number, from: number, to: number, dur: number): void {
    p.setValueAtTime(from, t)
    p.linearRampToValueAtTime(to, t + Math.max(0.001, dur))
  }

  // ---- lifecycle ----------------------------------------------------------

  /** Child synth (e.g. one music note) that disposes itself when `last` ends; the parent disposes it too. */
  spawn(): Synth {
    const child = new Synth(this.ctx, this.rng, this)
    if (!this.children) this.children = new Set()
    this.children.add(child)
    return child
  }

  /** Dispose this synth automatically when `src` fires 'ended'. */
  disposeOnEnd(src: AudioScheduledSourceNode): void {
    src.onended = () => this.dispose()
  }

  /** Stop every source at time t (already-stopped sources are ignored). */
  stopAll(t: number): void {
    for (const s of this.sources) {
      try {
        s.stop(t)
      } catch {
        /* not started / already stopped */
      }
    }
    if (this.children) for (const c of this.children) c.stopAll(t)
  }

  /** Disconnect everything (call after sources have stopped). Idempotent. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.children) {
      for (const c of [...this.children]) c.dispose()
      this.children.clear()
    }
    for (const s of this.sources) s.onended = null
    for (const n of this.nodes) {
      try {
        n.disconnect()
      } catch {
        /* ignore */
      }
    }
    this.nodes.length = 0
    this.sources.length = 0
    this.parent?.children?.delete(this)
  }
}

type IdleWindow = { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }

/** Run `fn` when the main thread is idle (≤ ~150 ms later); setTimeout fallback. */
export function idle(fn: () => void, timeout = 150): void {
  const w = (typeof window !== 'undefined' ? window : undefined) as (Window & IdleWindow) | undefined
  if (w && typeof w.requestIdleCallback === 'function') w.requestIdleCallback(fn, { timeout })
  else setTimeout(fn, 0)
}

export function clampFreq(f: number, sr: number): number {
  if (!Number.isFinite(f)) return 440
  return Math.min(Math.max(f, 1), sr * 0.49)
}

// ---------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------

/** Pitched body hit: oscillator with an exponential pitch drop and a percussive envelope. */
export function thump(
  s: Synth,
  out: AudioNode,
  t: number,
  o: { peak: number; f0: number; f1: number; sweep: number; decay: number; attack?: number; type?: OscillatorType },
): number {
  const attack = o.attack ?? 0.003
  const end = t + attack + o.decay
  const osc = s.osc(o.type ?? 'sine', o.f0, t, end + 0.02)
  s.sweep(osc.frequency, t, o.f0, o.f1, o.sweep)
  const g = s.gain(0)
  s.perc(g.gain, t, o.peak, attack, o.decay)
  osc.connect(g).connect(out)
  return end
}

/** Filtered noise burst with attack–hold–release and an optional filter sweep. */
export function burst(
  s: Synth,
  out: AudioNode,
  t: number,
  o: {
    peak: number
    decay: number
    freq: number
    color?: NoiseColor
    type?: BiquadFilterType
    q?: number
    freqTo?: number
    sweep?: number
    attack?: number
    hold?: number
    rate?: number
  },
): number {
  const attack = o.attack ?? 0.002
  const hold = o.hold ?? 0
  const end = t + attack + hold + o.decay
  const src = s.noise(o.color ?? 'white', t, end + 0.02, o.rate)
  const f = s.filter(o.type ?? 'bandpass', o.freq, o.q ?? 1)
  if (o.freqTo !== undefined) s.sweep(f.frequency, t, o.freq, o.freqTo, o.sweep ?? attack + hold + o.decay)
  const g = s.gain(0)
  s.ahr(g.gain, t, o.peak, attack, hold, o.decay)
  src.connect(f).connect(g).connect(out)
  return end
}

/**
 * Modal resonator (struck metal / wood): decaying sine partials plus a short
 * filtered noise strike. Inharmonic `ratios` make it metallic.
 */
export function modes(
  s: Synth,
  out: AudioNode,
  t: number,
  o: { peak: number; freq: number; ratios: number[]; amps?: number[]; decays: number[]; strike?: number; strikeFreq?: number },
): number {
  let end = t
  for (let i = 0; i < o.ratios.length; i++) {
    const amp = (o.amps?.[i] ?? 1 / (i + 1)) * o.peak
    const dec = o.decays[i] ?? o.decays[o.decays.length - 1]
    const f = o.freq * o.ratios[i] * s.r(0.995, 1.005)
    if (f > s.ctx.sampleRate * 0.45) continue
    const e = t + 0.002 + dec
    const osc = s.osc('sine', f, t, e + 0.02)
    const g = s.gain(0)
    s.perc(g.gain, t, amp, 0.0015, dec)
    osc.connect(g).connect(out)
    if (e > end) end = e
  }
  if (o.strike) {
    const e = burst(s, out, t, { peak: o.strike, decay: 0.025, freq: o.strikeFreq ?? o.freq * 3, q: 0.9, attack: 0.0008 })
    if (e > end) end = e
  }
  return end
}

/** Two-operator FM hit: modulator (freq·ratio) with a decaying index. Bells, clanks, pings. */
export function fmHit(
  s: Synth,
  out: AudioNode,
  t: number,
  o: { peak: number; freq: number; ratio: number; index: number; decay: number; indexDecay?: number; attack?: number },
): number {
  const attack = o.attack ?? 0.002
  const end = t + attack + o.decay
  const car = s.osc('sine', o.freq, t, end + 0.02)
  const mod = s.osc('sine', o.freq * o.ratio, t, end + 0.02)
  const mg = s.gain(0)
  const dev = o.freq * o.ratio * o.index
  mg.gain.setValueAtTime(dev, t)
  mg.gain.setTargetAtTime(dev * 0.06, t + attack, tc(o.indexDecay ?? o.decay * 0.5))
  mod.connect(mg)
  mg.connect(car.frequency)
  const g = s.gain(0)
  s.perc(g.gain, t, o.peak, attack, o.decay)
  car.connect(g).connect(out)
  return end
}

/** Soft synth pluck: oscillator through a closing lowpass. */
export function pluck(
  s: Synth,
  out: AudioNode,
  t: number,
  o: { peak: number; freq: number; decay: number; type?: OscillatorType; bright?: number; attack?: number },
): number {
  const attack = o.attack ?? 0.004
  const end = t + attack + o.decay
  const osc = s.osc(o.type ?? 'triangle', o.freq, t, end + 0.02)
  const f = s.lp(Math.min(o.freq * (o.bright ?? 6), 9000), 1.2)
  s.sweep(f.frequency, t, Math.min(o.freq * (o.bright ?? 6), 9000), Math.max(o.freq * 1.2, 200), o.decay * 0.6)
  const g = s.gain(0)
  s.perc(g.gain, t, o.peak, attack, o.decay)
  osc.connect(f).connect(g).connect(out)
  return end
}

/**
 * Irregular train of tiny envelope spikes on one gain param (sparks, rattles,
 * claps). Poisson timing at `rate` spikes/s for `dur` seconds.
 */
export function spikes(s: Synth, p: AudioParam, t: number, dur: number, o: { rate: number; peak: number; width?: number }): number {
  p.setValueAtTime(0, t)
  let x = t + 0.001
  const end = t + dur
  while (x < end) {
    const a = o.peak * (0.3 + 0.7 * s.rng())
    p.setTargetAtTime(a, x, 0.0006)
    p.setTargetAtTime(0, x + 0.0025, (o.width ?? 0.006) * (0.5 + s.rng()))
    x += -Math.log(1 - s.rng() * 0.98) / o.rate
  }
  p.setTargetAtTime(0, end, 0.01)
  return end + 0.06
}

/** Panning model for the quality tier (HRTF costs more CPU). */
export function panningModelFor(q: QualityTier): PanningModelType {
  return q === 'low' ? 'equalpower' : 'HRTF'
}
