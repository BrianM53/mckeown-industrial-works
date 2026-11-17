import type { LoopName } from '@/core/types'
import { createAmbience } from './ambience'
import { clatterBuffer } from './buffers'
import type { Synth } from './core'
import { createMusic } from './music'
import { createRadio } from './radio'
import type { LoopFn, LoopMeta, LoopVoice } from './types'

/**
 * CONTINUOUS LOOPS — one builder per LoopName. Builders start their sources
 * immediately (no stop time); the engine wraps the output in an emitter chain
 * (gain → occlusion lowpass → panner → bus), fades it in/out and calls
 * stop(t) when the emitter is culled or released.
 */
const clampRate = (r: number) => (Number.isFinite(r) ? Math.min(3, Math.max(0.25, r)) : 1)

function simple(out: AudioNode, s: Synth, setRate: LoopVoice['setRate'] = () => {}): LoopVoice {
  return { output: out, setRate, stop: (t) => s.stopAll(t) }
}

export const LOOP_LIBRARY = {
  /** Non-positional factory bed with interior room tones (see ambience.ts). */
  'ambience-factory': (s, p) => createAmbience(s, p),

  /** Generative soundtrack (see music.ts). */
  music: (s, p) => createMusic(s, p),

  /** Forklift motor: saw + sub square through a resonant lowpass, chugging AM. setRate(1 idle … 2.5 full throttle). */
  'forklift-engine': (s, p) => {
    const t = s.ctx.currentTime
    const freq = (r: number) => 36 * Math.pow(clampRate(r), 0.75)
    const cutoff = (r: number) => 260 + 420 * clampRate(r)
    const out = s.gain(1)
    const saw = s.osc('sawtooth', freq(p.rate), t)
    const sq = s.osc('square', freq(p.rate) / 2, t)
    const sqg = s.gain(0.55)
    const lp = s.lp(cutoff(p.rate), 2)
    const chug = s.gain(0.75)
    const chugLfo = s.lfo(freq(p.rate) / 3, 0.25, chug.gain, t)
    saw.connect(lp)
    sq.connect(sqg).connect(lp)
    lp.connect(chug).connect(out)
    const whine = s.osc('sine', freq(p.rate) * 9, t)
    s.chain(whine, s.gain(0.012), out)
    s.chain(s.noise('pink', t), s.bp(600, 0.8), s.gain(0.05), out)
    return simple(out, s, (r, at) => {
      const f = freq(r)
      saw.frequency.setTargetAtTime(f, at, 0.08)
      sq.frequency.setTargetAtTime(f / 2, at, 0.08)
      whine.frequency.setTargetAtTime(f * 9, at, 0.08)
      chugLfo.frequency.setTargetAtTime(f / 3, at, 0.08)
      lp.frequency.setTargetAtTime(cutoff(r), at, 0.1)
    })
  },

  /** Furnace: deep brown rumble, flickering flame band, crackles, a slow sub swell. */
  'furnace-roar': (s, p) => {
    const t = s.ctx.currentTime
    const out = s.gain(1)
    s.chain(s.noise('brown', t), s.lp(230, 0.7), s.gain(0.8), out)
    const flick = s.gain(0.32)
    s.wander(2.5, 0.16, flick.gain, t)
    const flame = s.bp(520 * clampRate(p.rate), 0.7)
    s.chain(s.noise('pink', t), flame, flick, out)
    s.chain(s.noise('crackle', t), s.bp(2300, 0.6), s.gain(0.16), out)
    const subG = s.gain(0.12)
    s.lfo(0.21, 0.05, subG.gain, t)
    s.chain(s.osc('sine', 41, t), subG, out)
    return simple(out, s, (r, at) => flame.frequency.setTargetAtTime(520 * clampRate(r), at, 0.3))
  },

  /** Giant cooling fan: two beating sines, an octave, and blade-pass "whup" on airy noise. */
  'fan-hum': (s, p) => {
    const t = s.ctx.currentTime
    const r = clampRate(p.rate)
    const out = s.gain(1)
    const lp = s.lp(2400, 0.7)
    lp.connect(out)
    const a = s.osc('sine', 98 * r, t)
    const b = s.osc('sine', 98.7 * r, t)
    const c = s.osc('triangle', 196.4 * r, t)
    s.chain(a, s.gain(0.22), lp)
    s.chain(b, s.gain(0.18), lp)
    s.chain(c, s.gain(0.05), lp)
    const whoosh = s.gain(0.55)
    const blade = s.lfo(9.3 * r, 0.2, whoosh.gain, t)
    s.chain(s.noise('pink', t), s.lp(750, 0.6), whoosh, lp)
    return simple(out, s, (rr, at) => {
      const k = clampRate(rr)
      a.frequency.setTargetAtTime(98 * k, at, 0.4)
      b.frequency.setTargetAtTime(98.7 * k, at, 0.4)
      c.frequency.setTargetAtTime(196.4 * k, at, 0.4)
      blade.frequency.setTargetAtTime(9.3 * k, at, 0.4)
    })
  },

  /** Server hall: fan noise band, air hiss, PSU hum and a faint beating coil whine. */
  'server-hum': (s) => {
    const t = s.ctx.currentTime
    const out = s.gain(1)
    s.chain(s.noise('pink', t), s.bp(1700, 0.45), s.gain(0.55), out)
    s.chain(s.noise('white', t), s.hp(6500, 0.7), s.gain(0.05), out)
    s.chain(s.noise('brown', t), s.lp(180, 0.7), s.gain(0.35), out)
    s.chain(s.harmonics([1, 0.5, 0.25], 120, t), s.gain(0.06), out)
    const coil = s.gain(0.008)
    s.osc('sine', 1210, t).connect(coil)
    s.osc('sine', 1216.5, t).connect(coil)
    coil.connect(out)
    return simple(out, s)
  },

  /** Conveyor: baked roller-clatter loop (playbackRate = conveyor speed), drive motor, belt rub. */
  'belt-clatter': (s, p) => {
    const t = s.ctx.currentTime
    const r = clampRate(p.rate)
    const jitter = s.r(0.93, 1.07)
    const out = s.gain(1)
    const buf = clatterBuffer(s.ctx)
    const src = s.buffer(buf, t, undefined, { loop: true, rate: r * jitter, offset: s.rng() * buf.duration * 0.95 })
    s.chain(src, s.hp(120, 0.7), s.gain(0.9), out)
    const motor = s.osc('sine', 100 * r, t)
    s.chain(motor, s.gain(0.03), out)
    const whine = s.osc('sine', 340 * r, t)
    s.chain(whine, s.gain(0.006), out)
    s.chain(s.noise('pink', t), s.lp(520, 0.6), s.gain(0.08), out)
    return simple(out, s, (rr, at) => {
      const k = clampRate(rr)
      src.playbackRate.setTargetAtTime(k * jitter, at, 0.3)
      motor.frequency.setTargetAtTime(100 * k, at, 0.3)
      whine.frequency.setTargetAtTime(340 * k, at, 0.3)
    })
  },

  /** Transformer: 120 Hz harmonic hum, a detuned twin for slow beating, magnetostriction buzz. */
  'transformer-hum': (s) => {
    const t = s.ctx.currentTime
    const out = s.gain(1)
    s.lfo(0.11, 0.1, out.gain, t)
    s.chain(s.harmonics([1, 0.45, 0.22, 0.12, 0.06], 120, t), s.gain(0.3), out)
    s.chain(s.harmonics([1, 0.3, 0.3, 0.05], 120.38, t), s.gain(0.2), out)
    s.chain(s.osc('square', 120, t), s.bp(900, 2.2), s.gain(0.035), out)
    return simple(out, s)
  },

  /** Rocket in flight: brown-noise rumble with flutter, mid roar, crackle, LFO'd subs. */
  'launch-rumble': (s) => {
    const t = s.ctx.currentTime
    const out = s.gain(1)
    const flutter = s.gain(0.85)
    s.wander(5, 0.22, flutter.gain, t)
    flutter.connect(out)
    s.chain(s.noise('brown', t), s.lp(200, 0.7), s.gain(0.9), flutter)
    s.chain(s.noise('pink', t), s.bp(650, 0.5), s.gain(0.25), flutter)
    s.chain(s.noise('crackle', t), s.bp(1500, 0.6), s.gain(0.22), flutter)
    const subG = s.gain(0.35)
    s.lfo(0.4, 0.1, subG.gain, t)
    s.chain(s.osc('sine', 33, t), subG, out)
    s.chain(s.osc('sine', 47, t), s.gain(0.14), out)
    return simple(out, s)
  },

  /** Faint lo-fi radio near the broadcast booth (see radio.ts). */
  'radio-music': (s, p) => createRadio(s, p),

  /** Steam vent: breathing band-passed hiss with a soft body. */
  'steam-vent': (s) => {
    const t = s.ctx.currentTime
    const out = s.gain(1)
    const g = s.gain(0.45)
    s.lfo(0.17 * s.r(0.8, 1.2), 0.12, g.gain, t)
    s.wander(1.2, 0.12, g.gain, t)
    s.chain(s.noise('white', t), s.bp(3800, 0.7), s.hp(900, 0.7), g, out)
    s.chain(s.noise('pink', t), s.bp(1150, 0.6), s.gain(0.1), out)
    return simple(out, s)
  },
} satisfies Record<LoopName, LoopFn>

const L = (o: Partial<LoopMeta> & Pick<LoopMeta, 'level'>): LoopMeta => ({
  bus: 'sfx',
  ref: 4,
  rolloff: 1.2,
  max: 45,
  perName: 2,
  power: 0,
  fadeIn: 0.3,
  ...o,
})

export const LOOP_META = {
  'ambience-factory': L({ level: 0.45, bus: 'ambience', perName: 1, fadeIn: 1.2 }),
  music: L({ level: 1.4, bus: 'music', perName: 1, fadeIn: 0.5 }),
  'forklift-engine': L({ level: 0.28, ref: 4, max: 40, perName: 2 }),
  'furnace-roar': L({ level: 0.55, ref: 5, rolloff: 1.1, max: 42, power: 0.5 }),
  'fan-hum': L({ level: 0.5, ref: 4, max: 30, power: 0.9, fadeIn: 0.6 }),
  'server-hum': L({ level: 0.55, ref: 5, max: 32, power: 0.25, fadeIn: 0.6 }),
  'belt-clatter': L({ level: 0.7, ref: 3.5, max: 32, perName: 3, power: 1 }),
  'transformer-hum': L({ level: 0.36, ref: 3, max: 28, power: 1, fadeIn: 0.5 }),
  'launch-rumble': L({ level: 0.75, ref: 18, rolloff: 1, max: 160, perName: 1, fadeIn: 0.25 }),
  'radio-music': L({ level: 0.32, ref: 3, max: 24, perName: 1, power: 1, fadeIn: 0.5 }),
  'steam-vent': L({ level: 0.55, ref: 3, max: 26, perName: 2, power: 0.7, fadeIn: 0.6 }),
} satisfies Record<LoopName, LoopMeta>

export const LOOP_NAMES = Object.keys(LOOP_LIBRARY) as LoopName[]
