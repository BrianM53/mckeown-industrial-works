import { createRng, type Rng } from '@/core/rng'

/**
 * Procedurally generated audio buffers, cached per (Offline)AudioContext:
 * seamless noise loops (white / pink / brown / crackle), reverb impulse
 * responses and the conveyor clatter pattern. No audio files anywhere.
 */
export type NoiseColor = 'white' | 'pink' | 'brown' | 'crackle'

export interface NoiseBank {
  white: AudioBuffer
  pink: AudioBuffer
  brown: AudioBuffer
  crackle: AudioBuffer
  /** Smooth random control signal (~4 Hz wander at rate 1, RMS 0.5) for flicker / flutter modulation. */
  smooth: AudioBuffer
}

export type BankKey = keyof NoiseBank

/** Base fluctuation rate (Hz) of the `smooth` control buffer at playbackRate 1. */
export const SMOOTH_RATE = 4

const NOISE_SECONDS = 2.5
const SEEDS: Record<NoiseColor, number> = { white: 0x0c0ffee, pink: 0x9a1e, brown: 0xb40e, crackle: 0xc7ac }
const noiseCache = new WeakMap<BaseAudioContext, Partial<NoiseBank>>()

/**
 * One seamless looping noise buffer (or the smooth control signal), generated
 * lazily on first use and cached per context. The engine pre-warms these in
 * idle time right after the AudioContext is created, so the Sound-button
 * click itself stays cheap.
 */
export function noiseBuffer(ctx: BaseAudioContext, key: BankKey): AudioBuffer {
  let bank = noiseCache.get(ctx)
  if (!bank) {
    bank = {}
    noiseCache.set(ctx, bank)
  }
  let buf = bank[key]
  if (!buf) {
    buf = key === 'smooth' ? smoothBuffer(ctx) : makeNoiseBuffer(ctx, key)
    bank[key] = buf
  }
  return buf
}

/** All noise buffers for this context (generates whatever is missing). */
export function noiseBank(ctx: BaseAudioContext): NoiseBank {
  return {
    white: noiseBuffer(ctx, 'white'),
    pink: noiseBuffer(ctx, 'pink'),
    brown: noiseBuffer(ctx, 'brown'),
    crackle: noiseBuffer(ctx, 'crackle'),
    smooth: noiseBuffer(ctx, 'smooth'),
  }
}

function makeNoiseBuffer(ctx: BaseAudioContext, color: NoiseColor): AudioBuffer {
  const sr = ctx.sampleRate
  const len = Math.max(1024, Math.floor(sr * NOISE_SECONDS))
  const fade = Math.floor(sr * 0.04)
  const raw = generateNoise(color, len + fade, sr, createRng(SEEDS[color]))
  const data = makeLoopable(raw, len, fade)
  if (color === 'crackle') normalizePeak(data, 0.9)
  else normalizeRms(data, 0.25)
  const buf = ctx.createBuffer(1, len, sr)
  buf.getChannelData(0).set(data)
  return buf
}

/** Catmull-Rom interpolated random control points (wrapping → seamless loop), RMS 0.5. */
function smoothBuffer(ctx: BaseAudioContext): AudioBuffer {
  const seconds = 8
  const points = seconds * SMOOTH_RATE
  let sr = 8000
  let buf: AudioBuffer
  try {
    buf = ctx.createBuffer(1, sr * seconds, sr)
  } catch {
    sr = ctx.sampleRate
    buf = ctx.createBuffer(1, Math.floor(sr * seconds), sr)
  }
  const rng = createRng(0x5300)
  const p: number[] = []
  for (let i = 0; i < points; i++) p.push(rng() * 2 - 1)
  const d = buf.getChannelData(0)
  const per = d.length / points
  for (let i = 0; i < d.length; i++) {
    const x = i / per
    const k = Math.floor(x)
    const f = x - k
    const p0 = p[(k - 1 + points) % points]
    const p1 = p[k % points]
    const p2 = p[(k + 1) % points]
    const p3 = p[(k + 2) % points]
    d[i] = 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f)
  }
  removeDc(d)
  normalizeRms(d, 0.5)
  return buf
}

/** Raw noise of the given color. Pink: Paul Kellet's filter. Brown: leaky integrator. */
export function generateNoise(color: NoiseColor, n: number, sr: number, rng: Rng): Float32Array {
  const d = new Float32Array(n)
  if (color === 'white') {
    for (let i = 0; i < n; i++) d[i] = rng() * 2 - 1
  } else if (color === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
    for (let i = 0; i < n; i++) {
      const w = rng() * 2 - 1
      b0 = 0.99886 * b0 + w * 0.0555179
      b1 = 0.99332 * b1 + w * 0.0750759
      b2 = 0.969 * b2 + w * 0.153852
      b3 = 0.8665 * b3 + w * 0.3104856
      b4 = 0.55 * b4 + w * 0.5329522
      b5 = -0.7616 * b5 - w * 0.016898
      d[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362
      b6 = w * 0.115926
    }
  } else if (color === 'brown') {
    let last = 0
    for (let i = 0; i < n; i++) {
      const w = rng() * 2 - 1
      last = (last + 0.02 * w) / 1.02
      d[i] = last
    }
    removeDc(d)
  } else {
    // crackle: sparse decaying grains of noise (sparks, fire, vinyl-ish static)
    const density = 70 / sr
    let env = 0
    let k = 0
    for (let i = 0; i < n; i++) {
      env *= k
      if (rng() < density) {
        env = 0.25 + 0.75 * rng() * rng()
        const tau = (0.0004 + 0.0028 * rng()) * sr
        k = Math.exp(-1 / tau)
      }
      d[i] = env * (rng() * 2 - 1)
    }
  }
  return d
}

/**
 * Crossfade the last `fade` samples into the start so the first `length`
 * samples loop seamlessly. `src.length` must be ≥ length + fade.
 */
export function makeLoopable(src: Float32Array, length: number, fade: number): Float32Array {
  const out = src.slice(0, length)
  const f = Math.min(fade, length, src.length - length)
  for (let i = 0; i < f; i++) {
    const w = i / f
    // equal-power-ish blend keeps noise level constant across the seam
    const a = Math.sin(w * Math.PI * 0.5)
    const b = Math.cos(w * Math.PI * 0.5)
    out[i] = src[i] * a + src[length + i] * b
  }
  return out
}

function removeDc(d: Float32Array): void {
  let m = 0
  for (let i = 0; i < d.length; i++) m += d[i]
  m /= d.length || 1
  for (let i = 0; i < d.length; i++) d[i] -= m
}

export function normalizeRms(d: Float32Array, target: number): void {
  let s = 0
  for (let i = 0; i < d.length; i++) s += d[i] * d[i]
  const rms = Math.sqrt(s / (d.length || 1))
  if (rms < 1e-9) return
  const g = target / rms
  for (let i = 0; i < d.length; i++) {
    const v = d[i] * g
    d[i] = v > 1 ? 1 : v < -1 ? -1 : v
  }
}

export function normalizePeak(d: Float32Array, target: number): void {
  let p = 0
  for (let i = 0; i < d.length; i++) {
    const a = Math.abs(d[i])
    if (a > p) p = a
  }
  if (p < 1e-9) return
  const g = target / p
  for (let i = 0; i < d.length; i++) d[i] *= g
}

// ---------------------------------------------------------------------------
// Reverb impulse responses
// ---------------------------------------------------------------------------

export type ImpulseKind = 'hall' | 'yard' | 'small'

const IMPULSES: Record<ImpulseKind, { seconds: number; bright: number; dark: number; predelay: number }> = {
  /** Music: long, soft, dark tail. */
  hall: { seconds: 2.6, bright: 0.5, dark: 0.07, predelay: 0.018 },
  /** Outdoor industrial yard: shorter, brighter slap off buildings. */
  yard: { seconds: 1.3, bright: 0.68, dark: 0.12, predelay: 0.03 },
  /** Low quality tier: short and cheap. */
  small: { seconds: 0.9, bright: 0.6, dark: 0.12, predelay: 0.012 },
}

const impulseCache = new WeakMap<BaseAudioContext, Map<ImpulseKind, AudioBuffer>>()

/**
 * Stereo decorrelated noise-decay impulse response, cached per context:
 * exponential decay (−60 dB at the end, short fade-out), a one-pole lowpass
 * that closes over time (bright onset, dark tail) and a few early reflections.
 */
export function impulse(ctx: BaseAudioContext, kind: ImpulseKind): AudioBuffer {
  let m = impulseCache.get(ctx)
  if (!m) {
    m = new Map()
    impulseCache.set(ctx, m)
  }
  const hit = m.get(kind)
  if (hit) return hit
  const cfg = IMPULSES[kind]
  const sr = ctx.sampleRate
  const n = Math.max(256, Math.floor(sr * cfg.seconds))
  const pre = Math.floor(sr * cfg.predelay)
  const span = n - pre
  const decayPerSample = Math.exp(-6.91 / span)
  const fadeLen = Math.floor(span * 0.08)
  const buf = ctx.createBuffer(2, n, sr)
  for (let c = 0; c < 2; c++) {
    const rng = createRng(0x7e4b + c * 977 + kind.length * 31)
    const d = buf.getChannelData(c)
    let lp = 0
    let env = 1
    let a = cfg.bright
    for (let i = pre; i < n; i++) {
      const k = i - pre
      if ((k & 127) === 0) a = cfg.bright + (cfg.dark - cfg.bright) * Math.sqrt(k / span)
      lp += a * (rng() * 2 - 1 - lp)
      const tail = n - i
      d[i] = lp * env * (tail < fadeLen ? tail / fadeLen : 1)
      env *= decayPerSample
    }
    for (let r = 0; r < 6; r++) {
      const at = pre + Math.floor(sr * (0.004 + 0.05 * rng()))
      if (at < n) d[at] += (rng() < 0.5 ? -1 : 1) * (0.25 + 0.35 * rng()) * (1 - r / 8)
    }
  }
  m.set(kind, buf)
  return buf
}

// ---------------------------------------------------------------------------
// Conveyor clatter pattern
// ---------------------------------------------------------------------------

const clatterCache = new WeakMap<BaseAudioContext, AudioBuffer>()

/**
 * Two seconds of conveyor roller clatter: a steady 8 Hz roller tick with an
 * accent pattern, small metallic resonances, occasional item thunks and a low
 * belt rumble. Seamless loop; playbackRate follows the conveyor speed.
 */
export function clatterBuffer(ctx: BaseAudioContext): AudioBuffer {
  const hit = clatterCache.get(ctx)
  if (hit) return hit
  const sr = ctx.sampleRate
  const seconds = 2
  const n = Math.floor(sr * seconds)
  const fade = Math.floor(sr * 0.03)
  const rng = createRng(0xbe17)
  const d = new Float32Array(n + fade)

  // low belt rumble
  const rumble = generateNoise('brown', n + fade, sr, rng)
  normalizeRms(rumble, 0.05)
  for (let i = 0; i < d.length; i++) d[i] = rumble[i]

  const ticks = 16
  const accents = [1, 0.45, 0.7, 0.4, 0.9, 0.5, 0.65, 0.42]
  for (let k = 0; k < ticks; k++) {
    const start = Math.floor((k / ticks) * n + (rng() - 0.5) * sr * 0.006)
    const amp = accents[k % accents.length] * (0.75 + 0.25 * rng())
    // damped resonator excited by a short noise burst (metallic roller tick)
    const f = [1450, 1980, 2630, 3370][Math.floor(rng() * 4)] * (0.94 + 0.12 * rng())
    const r = Math.exp(-1 / (sr * (0.006 + 0.01 * rng())))
    const w = (2 * Math.PI * f) / sr
    const c1 = 2 * r * Math.cos(w)
    const c2 = -r * r
    let y1 = 0
    let y2 = 0
    const len = Math.floor(sr * 0.06)
    const burst = Math.floor(sr * 0.0025)
    for (let i = 0; i < len; i++) {
      const x = i < burst ? (rng() * 2 - 1) * (1 - i / burst) : 0
      const y = x + c1 * y1 + c2 * y2
      y2 = y1
      y1 = y
      const idx = (start + i) % (n + fade)
      d[idx] += y * 0.09 * amp
    }
    // dull wooden-ish thunk when an item rolls over a roller joint
    if (k % 4 === 0 || rng() < 0.18) {
      const tf = 150 + 60 * rng()
      const tl = Math.floor(sr * 0.09)
      const ta = 0.16 * amp * (0.6 + 0.4 * rng())
      for (let i = 0; i < tl; i++) {
        const idx = (start + Math.floor(sr * 0.004) + i) % (n + fade)
        d[idx] += ta * Math.sin((2 * Math.PI * tf * i) / sr) * Math.exp(-i / (sr * 0.018))
      }
    }
  }
  const data = makeLoopable(d, n, fade)
  normalizePeak(data, 0.8)
  const buf = ctx.createBuffer(1, n, sr)
  buf.getChannelData(0).set(data)
  clatterCache.set(ctx, buf)
  return buf
}

/** WaveShaper curve: linear up to `knee`, then tanh-saturates toward `ceiling` (odd length → exact zero). */
export function softClipCurve(knee = 0.8, ceiling = 0.97, n = 4097): Float32Array {
  const c = new Float32Array(n)
  const span = Math.max(1e-3, ceiling - knee)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    const a = Math.abs(x)
    const y = a <= knee ? a : knee + span * Math.tanh((a - knee) / span)
    c[i] = x < 0 ? -y : y
  }
  return c
}

/** Gentle saturation curve (tanh) for "radio speaker" / horn colour. */
export function driveCurve(drive: number, n = 2049): Float32Array {
  const c = new Float32Array(n)
  const norm = Math.tanh(drive)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    c[i] = Math.tanh(x * drive) / norm
  }
  return c
}
