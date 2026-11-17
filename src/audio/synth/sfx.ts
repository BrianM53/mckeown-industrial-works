import type { SfxName } from '@/core/types'
import { dbToGain } from '../logic'
import { burst, fmHit, modes, mtof, pluck, spikes, tc, thump, type Synth } from './core'
import type { SfxFn, SfxMeta } from './types'

/**
 * PROCEDURAL SOUND EFFECTS — one small function per SfxName. Everything is
 * synthesized from oscillators, noise buffers, filters and envelopes (no audio
 * files, no licensing). Each function returns the absolute time at which it is
 * silent. Levels are normalized by SFX_META[name].peakDb and RAW_PEAK (see
 * sfxLevel); keep each function's own internal peak roughly ≤ 1.
 */

const max = Math.max

/** Sine (or other) glide with a percussive envelope. */
function chirp(
  s: Synth,
  out: AudioNode,
  t: number,
  o: { peak: number; f0: number; f1: number; glide: number; decay: number; type?: OscillatorType; attack?: number },
): number {
  const attack = o.attack ?? 0.004
  const end = t + attack + o.decay
  const osc = s.osc(o.type ?? 'sine', o.f0, t, end + 0.02)
  s.sweep(osc.frequency, t, o.f0, o.f1, o.glide)
  const g = s.gain(0)
  s.perc(g.gain, t, o.peak, attack, o.decay)
  osc.connect(g).connect(out)
  return end
}

/** Bandpassed noise gated by a train of tiny spikes (rattles, sparks, claps). */
function rattle(s: Synth, out: AudioNode, t: number, o: { peak: number; dur: number; rate: number; freq: number; q?: number; width?: number }): number {
  const n = s.noise('white', t, t + o.dur + 0.1)
  const f = s.bp(o.freq, o.q ?? 1.4)
  const g = s.gain(0)
  const end = spikes(s, g.gain, t, o.dur, { rate: o.rate, peak: o.peak, width: o.width ?? 0.008 })
  n.connect(f).connect(g).connect(out)
  return end
}

export const SFX_LIBRARY = {
  /** Tiny soft tick for HTML buttons. */
  'ui-click': (s, out, t, { rate }) =>
    max(
      chirp(s, out, t, { peak: 0.6, f0: 2300 * rate, f1: 1300 * rate, glide: 0.018, decay: 0.035, attack: 0.001 }),
      burst(s, out, t, { peak: 0.12, decay: 0.012, freq: 5200, type: 'highpass', attack: 0.0008 }),
    ),

  /** Two soft rising notes + air: a panel slides open. */
  'ui-open': (s, out, t, { rate }) => {
    const lp = s.lp(5200)
    lp.connect(out)
    return max(
      pluck(s, lp, t, { peak: 0.5, freq: mtof(76) * rate, decay: 0.16, bright: 5 }),
      pluck(s, lp, t + 0.06, { peak: 0.42, freq: mtof(83) * rate, decay: 0.24, bright: 5 }),
      burst(s, lp, t, { peak: 0.06, decay: 0.12, freq: 2800, q: 0.7, attack: 0.03 }),
    )
  },

  /** The same two notes falling: a panel closes. */
  'ui-close': (s, out, t, { rate }) => {
    const lp = s.lp(4800)
    lp.connect(out)
    return max(
      pluck(s, lp, t, { peak: 0.45, freq: mtof(83) * rate, decay: 0.12, bright: 5 }),
      pluck(s, lp, t + 0.055, { peak: 0.4, freq: mtof(76) * rate, decay: 0.2, bright: 5 }),
      burst(s, lp, t, { peak: 0.05, decay: 0.1, freq: 2200, q: 0.7, attack: 0.02 }),
    )
  },

  /** Boot on concrete: low heel thump + gritty scuff, randomized per step. */
  footstep: (s, out, t, { rate }) => {
    const v = s.r(0.85, 1.15)
    return max(
      thump(s, out, t, { peak: 0.5, f0: 95 * rate * v, f1: 55 * rate, sweep: 0.05, decay: 0.07, attack: 0.002 }),
      burst(s, out, t + 0.004, { peak: 0.55, decay: s.r(0.05, 0.08), freq: 1900 * v * rate, q: 1.1 }),
      burst(s, out, t + 0.01, { peak: 0.25, decay: 0.05, freq: 3800, type: 'highpass', color: 'crackle' }),
    )
  },

  /** Boot on a steel grate: thump + ringing inharmonic plate modes. */
  'footstep-metal': (s, out, t, { rate }) => {
    const f = s.r(360, 470) * rate
    return max(
      thump(s, out, t, { peak: 0.4, f0: 130 * rate, f1: 70 * rate, sweep: 0.05, decay: 0.06 }),
      modes(s, out, t + 0.002, {
        peak: 0.2,
        freq: f,
        ratios: [1, 2.32, 3.87, 5.6],
        amps: [1, 0.7, 0.45, 0.25],
        decays: [0.22, 0.16, 0.12, 0.08],
        strike: 0.3,
        strikeFreq: 2600,
      }),
    )
  },

  /** Friendly mechanical click + upward chirp: "you used something". */
  interact: (s, out, t, { rate }) =>
    max(
      burst(s, out, t, { peak: 0.25, decay: 0.012, freq: 2600, type: 'highpass', attack: 0.0008 }),
      chirp(s, out, t, { peak: 0.45, f0: 1100 * rate, f1: 1650 * rate, glide: 0.06, decay: 0.14 }),
      pluck(s, out, t + 0.01, { peak: 0.22, freq: 550 * rate, decay: 0.12 }),
    ),

  /** Dot-matrix-ish print run: motor spin-up, chattering head, paper feed, end click. */
  'printer-whir': (s, out, t, { rate }) => {
    const dur = 1.7
    const m = s.osc('sawtooth', 70 * rate, t, t + dur + 0.35)
    m.frequency.setValueAtTime(70 * rate, t)
    m.frequency.exponentialRampToValueAtTime(118 * rate, t + 0.3)
    m.frequency.setValueAtTime(118 * rate, t + dur - 0.2)
    m.frequency.exponentialRampToValueAtTime(80 * rate, t + dur + 0.1)
    const mf = s.lp(650, 1.5)
    const mg = s.gain(0)
    s.ahr(mg.gain, t, 0.3, 0.15, dur - 0.25, 0.25)
    m.connect(mf).connect(mg).connect(out)
    // chattering print head: bandpassed noise gated by a 26 Hz square
    const n = s.noise('white', t, t + dur + 0.35)
    const nf = s.bp(3200, 1.4)
    const gate = s.gain(0.5)
    s.lfo(26 * rate, 0.5, gate.gain, t, t + dur + 0.35, 'square')
    const ng = s.gain(0)
    s.ahr(ng.gain, t + 0.12, 0.9, 0.05, dur - 0.35, 0.12)
    n.connect(nf).connect(gate).connect(ng).connect(out)
    burst(s, out, t + 0.2, { peak: 0.12, decay: 0.3, hold: dur - 0.6, freq: 1300, q: 0.8, color: 'pink', attack: 0.1 })
    burst(s, out, t + dur, { peak: 0.5, decay: 0.03, freq: 2400, q: 2 })
    return t + dur + 0.35
  },

  /** Pneumatic wind-up, then a heavy comedic KA-CHUNK with a metal ring. */
  'print-stamp': (s, out, t, { rate }) => {
    burst(s, out, t, { peak: 0.12, decay: 0.08, hold: 0.04, freq: 4000, q: 0.8, attack: 0.02 })
    const h = t + 0.12
    return max(
      thump(s, out, h, { peak: 0.9, f0: 150 * rate, f1: 45 * rate, sweep: 0.12, decay: 0.42 }),
      burst(s, out, h, { peak: 0.45, decay: 0.012, freq: 2400, type: 'highpass', attack: 0.0006 }),
      burst(s, out, h, { peak: 0.45, decay: 0.09, freq: 1800, type: 'lowpass', color: 'pink' }),
      modes(s, out, h, { peak: 0.16, freq: 610 * rate, ratios: [1, 2.41, 3.93], decays: [0.45, 0.3, 0.2] }),
      modes(s, out, h + 0.22, { peak: 0.07, freq: 640 * rate, ratios: [1, 2.41], decays: [0.2, 0.12] }),
    )
  },

  /** Pneumatic tube: rushing band-swept air, then the capsule thunks home. */
  'tube-whoosh': (s, out, t, { rate }) => {
    const n = s.noise('pink', t, t + 1.15)
    const f = s.bp(350 * rate, 1.3)
    f.frequency.setValueAtTime(350 * rate, t)
    f.frequency.exponentialRampToValueAtTime(2300 * rate, t + 0.35)
    f.frequency.exponentialRampToValueAtTime(480 * rate, t + 0.9)
    const g = s.gain(0)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(1, t + 0.3)
    g.gain.setTargetAtTime(0, t + 0.42, tc(0.5))
    n.connect(f).connect(g).connect(out)
    const h = t + 0.86
    return max(
      t + 1.15,
      thump(s, out, h, { peak: 0.55, f0: 190 * rate, f1: 70, sweep: 0.08, decay: 0.2 }),
      modes(s, out, h, { peak: 0.08, freq: 820, ratios: [1, 2.7], decays: [0.15, 0.1] }),
    )
  },

  /** Stamping press: deep sine drop, slam noise, metal ring, hydraulic sigh. */
  'press-thump': (s, out, t, { rate }) =>
    max(
      thump(s, out, t, { peak: 1, f0: 95 * rate, f1: 36 * rate, sweep: 0.22, decay: 0.55 }),
      burst(s, out, t, { peak: 0.6, decay: 0.12, freq: 900, type: 'lowpass', color: 'pink', attack: 0.0015 }),
      modes(s, out, t, { peak: 0.13, freq: 182 * rate, ratios: [1, 2.76, 5.4], decays: [0.35, 0.22, 0.12], strike: 0.25, strikeFreq: 1800 }),
      burst(s, out, t + 0.24, { peak: 0.08, decay: 0.3, hold: 0.06, freq: 3600, q: 0.9, attack: 0.04 }),
    ),

  /** Steam release: band-passed noise envelope with a soft valve pop. */
  'steam-hiss': (s, out, t, { rate }) => {
    const hold = s.r(0.35, 0.9)
    const n = s.noise('white', t, t + hold + 0.6)
    const bp = s.bp(3300 * rate, 0.8)
    s.sweep(bp.frequency, t, 3300 * rate, 2500 * rate, hold + 0.5)
    const hp = s.hp(900)
    const g = s.gain(0)
    s.ahr(g.gain, t, 1, 0.035, hold, 0.45)
    n.connect(bp).connect(hp).connect(g).connect(out)
    burst(s, out, t, { peak: 0.2, decay: 0.45, hold, freq: 950, q: 0.7, color: 'pink', attack: 0.04 })
    thump(s, out, t, { peak: 0.15, f0: 320, f1: 150, sweep: 0.02, decay: 0.03 })
    return t + 0.035 + hold + 0.5
  },

  /** Arc welding: crackly high spark bursts over a faint 120 Hz arc buzz. */
  'weld-zap': (s, out, t, { rate }) => {
    const dur = s.r(0.35, 0.85)
    const n = s.noise('white', t, t + dur + 0.12)
    const hp = s.hp(2400)
    const bp = s.bp(5200 * rate, 0.7)
    const g = s.gain(0)
    spikes(s, g.gain, t, dur, { rate: s.r(28, 45), peak: 1, width: 0.007 })
    n.connect(hp).connect(bp).connect(g).connect(out)
    const b = s.osc('square', 120, t, t + dur + 0.12)
    const bf = s.bp(1700, 1.2)
    const bg = s.gain(0)
    s.ahr(bg.gain, t, 0.07, 0.01, dur - 0.02, 0.05)
    b.connect(bf).connect(bg).connect(out)
    burst(s, out, t, { peak: 0.3, decay: 0.05, hold: dur, freq: 3000, type: 'highpass', color: 'crackle', attack: 0.005 })
    return t + dur + 0.12
  },

  /** Generic machine clank: FM metal + plate modes + thud + click. */
  'machine-clank': (s, out, t, { rate }) => {
    const f = s.r(210, 270) * rate
    return max(
      fmHit(s, out, t, { peak: 0.35, freq: f, ratio: 2.76, index: 3.5, decay: 0.38, indexDecay: 0.1 }),
      modes(s, out, t + 0.004, { peak: 0.14, freq: f * 2.6, ratios: [1, 1.41, 2.03], decays: [0.25, 0.18, 0.12] }),
      thump(s, out, t, { peak: 0.4, f0: 135 * rate, f1: 70, sweep: 0.06, decay: 0.16 }),
      burst(s, out, t, { peak: 0.25, decay: 0.02, freq: 1500, type: 'highpass', attack: 0.0006 }),
    )
  },

  /** A boot kicks a machine: dull thud, big panel boom, loose-part rattle. */
  'machine-kick': (s, out, t, { rate }) => {
    const h = t + 0.01
    return max(
      thump(s, out, t, { peak: 0.6, f0: 165 * rate, f1: 70, sweep: 0.07, decay: 0.18 }),
      burst(s, out, t, { peak: 0.35, decay: 0.06, freq: 800, type: 'lowpass', color: 'pink' }),
      modes(s, out, h, {
        peak: 0.3,
        freq: 172 * rate,
        ratios: [1, 2.38, 4.41, 6.9],
        amps: [1, 0.7, 0.4, 0.2],
        decays: [0.8, 0.6, 0.4, 0.25],
      }),
      rattle(s, out, h + 0.03, { peak: 0.3, dur: 0.3, rate: 40, freq: 2200, width: 0.01 }),
    )
  },

  /** QC scanner: clean two-tone "boop-beep". */
  'scanner-beep': (s, out, t, { rate }) => {
    const beep = (at: number, f: number, len: number) => {
      const o = s.harmonics([1, 0, 0.12, 0, 0.04], f * rate, at, at + len + 0.05)
      const g = s.gain(0)
      s.ahr(g.gain, at, 0.5, 0.004, len, 0.03)
      o.connect(g).connect(out)
      return at + len + 0.04
    }
    beep(t, 1568, 0.075)
    return beep(t + 0.115, 2093, 0.11)
  },

  /** Original six-note station ident: bright bell + pluck, little bass walk, final C major chord. */
  'radio-jingle': (s, out, t, { rate }) => {
    const bus = s.lp(7000)
    bus.connect(out)
    const notes: [number, number, number][] = [
      [0, 67, 0.25],
      [0.13, 72, 0.25],
      [0.26, 76, 0.25],
      [0.39, 79, 0.45],
      [0.68, 81, 0.3],
      [0.84, 79, 1.2],
    ]
    let end = t
    for (const [dt, m, d] of notes) {
      const f = mtof(m) * rate
      end = max(end, fmHit(s, bus, t + dt, { peak: 0.22, freq: f, ratio: 4, index: 0.6, decay: d + 0.6, indexDecay: 0.15 }))
      end = max(end, pluck(s, bus, t + dt, { peak: 0.16, freq: f, decay: d + 0.2, bright: 4 }))
    }
    for (const m of [60, 64, 67, 72]) end = max(end, fmHit(s, bus, t + 0.84, { peak: 0.07, freq: mtof(m) * rate, ratio: 2, index: 0.4, decay: 1.6 }))
    end = max(end, pluck(s, bus, t + 0.84, { peak: 0.3, freq: mtof(36) * rate, decay: 1.2, bright: 3 }))
    pluck(s, bus, t, { peak: 0.22, freq: mtof(43) * rate, decay: 0.25, bright: 3 })
    pluck(s, bus, t + 0.26, { peak: 0.22, freq: mtof(48) * rate, decay: 0.25, bright: 3 })
    return end
  },

  /** Dial tuning: fluttering band noise, crackle and a falling heterodyne whistle. */
  'radio-static': (s, out, t, { rate }) => {
    const dur = 0.85
    const n = s.noise('white', t, t + dur + 0.3)
    const bp = s.bp(1900, 0.5)
    const g = s.gain(0)
    s.ahr(g.gain, t, 0.6, 0.02, dur, 0.2)
    const flutter = s.gain(0.7)
    s.wander(9, 0.3, flutter.gain, t, t + dur + 0.3)
    n.connect(bp).connect(g).connect(flutter).connect(out)
    burst(s, out, t, { peak: 0.45, decay: 0.15, hold: dur, freq: 1200, type: 'highpass', color: 'crackle' })
    const w = s.osc('sine', 2600 * rate, t, t + dur + 0.2)
    s.sweep(w.frequency, t + 0.05, 2600 * rate, 650 * rate, dur * 0.8)
    const wg = s.gain(0)
    s.ahr(wg.gain, t + 0.05, 0.08, 0.1, dur * 0.6, 0.15)
    w.connect(wg).connect(out)
    return t + dur + 0.3
  },

  /** Electric forklift horn: honky square + saw a major third apart, slight droop. */
  'forklift-horn': (s, out, t, { rate }) => {
    const len = 0.36
    const mix = s.gain(0.5)
    for (const [type, f] of [
      ['square', 415],
      ['sawtooth', 523],
    ] as const) {
      const o = s.osc(type, f * rate, t, t + len + 0.15)
      o.frequency.setValueAtTime(f * rate, t + len - 0.06)
      o.frequency.linearRampToValueAtTime(f * rate * 0.96, t + len + 0.05)
      o.connect(mix)
    }
    const lp = s.lp(1700, 0.9)
    const pk = s.peaking(900, 1.2, 6)
    const g = s.gain(0)
    s.ahr(g.gain, t, 0.5, 0.012, len, 0.06)
    mix.connect(lp).connect(pk).connect(g).connect(out)
    return t + len + 0.12
  },

  /** Reverse-alarm beep: ~1 kHz, one "on" of the on/off pattern (callers repeat it). */
  'forklift-beep': (s, out, t, { rate }) => {
    const len = 0.26
    const o = s.harmonics([1, 0, 0.18, 0, 0.06], 1040 * rate, t, t + len + 0.06)
    const g = s.gain(0)
    s.ahr(g.gain, t, 0.5, 0.006, len, 0.025)
    o.connect(g).connect(out)
    return t + len + 0.06
  },

  /** Forklift hits something: body thud, crunch, steel frame modes, rattle. */
  'forklift-impact': (s, out, t, { rate }) =>
    max(
      thump(s, out, t, { peak: 0.85, f0: 115 * rate, f1: 45, sweep: 0.12, decay: 0.38 }),
      burst(s, out, t, { peak: 0.5, decay: 0.15, freq: 1600, type: 'lowpass', color: 'pink' }),
      modes(s, out, t, { peak: 0.2, freq: s.r(240, 330) * rate, ratios: [1, 2.76, 5.4], decays: [0.5, 0.3, 0.18], strike: 0.25 }),
      modes(s, out, t + 0.06, { peak: 0.1, freq: s.r(500, 700) * rate, ratios: [1, 2.03, 3.3], decays: [0.3, 0.2, 0.12] }),
      rattle(s, out, t + 0.02, { peak: 0.2, dur: 0.3, rate: 35, freq: 2000 }),
    ),

  /** Key-on: relay click, chugging motor spin-up, faint electric whine. */
  'forklift-start': (s, out, t, { rate }) => {
    burst(s, out, t, { peak: 0.35, decay: 0.01, freq: 2400, type: 'highpass', attack: 0.0006 })
    const h = t + 0.08
    const len = 0.65
    const saw = s.osc('sawtooth', 35 * rate, h, h + len + 0.45)
    s.sweep(saw.frequency, h, 35 * rate, 78 * rate, len)
    const sq = s.osc('square', 70 * rate, h, h + len + 0.45)
    s.sweep(sq.frequency, h, 70 * rate, 150 * rate, len)
    const lp = s.lp(300, 1.5)
    s.sweep(lp.frequency, h, 300, 950, len)
    const sqg = s.gain(0.5)
    const chug = s.gain(0.75)
    s.lfo(9 * rate, 0.25, chug.gain, h, h + len + 0.45)
    const g = s.gain(0)
    s.ahr(g.gain, h, 0.45, 0.1, len - 0.1, 0.35)
    saw.connect(lp)
    sq.connect(sqg).connect(lp)
    lp.connect(chug).connect(g).connect(out)
    const w = s.osc('sine', 600 * rate, h, h + len + 0.4)
    s.sweep(w.frequency, h, 600 * rate, 1500 * rate, len)
    const wg = s.gain(0)
    s.ahr(wg.gain, h, 0.04, 0.1, len - 0.1, 0.3)
    w.connect(wg).connect(out)
    return h + len + 0.45
  },

  /** Wooden crate knock: hollow box modes + short noise knock. */
  'crate-bump': (s, out, t, { rate }) => {
    const f = s.r(170, 250) * rate
    return max(
      modes(s, out, t, { peak: 0.35, freq: f, ratios: [1, 1.93, 3.1], amps: [1, 0.55, 0.3], decays: [0.13, 0.09, 0.05] }),
      burst(s, out, t, { peak: 0.4, decay: 0.045, freq: 700 * rate, q: 1.4, attack: 0.001 }),
      thump(s, out, t, { peak: 0.3, f0: 125 * rate, f1: 80, sweep: 0.04, decay: 0.08 }),
    )
  },

  /** Soccer kick: soft "pomf" + leather slap. */
  'ball-kick': (s, out, t, { rate }) =>
    max(
      thump(s, out, t, { peak: 0.6, f0: 230 * rate, f1: 105 * rate, sweep: 0.05, decay: 0.1 }),
      burst(s, out, t, { peak: 0.4, decay: 0.03, freq: 1400 * rate, q: 1, attack: 0.0008 }),
    ),

  /** Ball bounce: rubbery low thump with a faint resonance. */
  'ball-bounce': (s, out, t, { rate }) =>
    max(
      thump(s, out, t, { peak: 0.5, f0: 175 * rate, f1: 118 * rate, sweep: 0.05, decay: 0.11 }),
      burst(s, out, t, { peak: 0.2, decay: 0.02, freq: 1500, type: 'lowpass', color: 'pink' }),
      thump(s, out, t, { peak: 0.06, f0: 540 * rate, f1: 500 * rate, sweep: 0.05, decay: 0.09 }),
    ),

  /** Stadium air horn: detuned saw triad (Bb–D–F) with a little vibrato. */
  'goal-horn': (s, out, t, { rate }) => {
    const len = 0.95
    const mix = s.gain(1)
    for (const m of [58, 62, 65]) {
      for (const det of [-6, 6]) {
        const o = s.osc('sawtooth', mtof(m) * rate, t, t + len + 0.4, det)
        s.lfo(5.2, mtof(m) * rate * 0.006, o.frequency, t, t + len + 0.4)
        o.connect(mix)
      }
    }
    const lp = s.lp(1800, 0.8)
    const pk = s.peaking(720, 1, 4)
    const g = s.gain(0)
    s.ahr(g.gain, t, 0.09, 0.03, len, 0.25)
    mix.connect(lp).connect(pk).connect(g).connect(out)
    return t + len + 0.35
  },

  /** Safety whistle: 2.6 kHz pea-trill sine with breath, short + long blast. */
  whistle: (s, out, t, { rate }) => {
    const f = 2600 * rate
    const end = t + 0.84
    const o = s.osc('sine', f, t, end + 0.05)
    s.lfo(31, f * 0.035, o.frequency, t, end + 0.05)
    o.frequency.setValueAtTime(f, t + 0.6)
    o.frequency.linearRampToValueAtTime(f * 0.97, t + 0.78)
    const h2 = s.osc('sine', f * 2, t, end + 0.05)
    s.lfo(31, f * 0.07, h2.frequency, t, end + 0.05)
    const h2g = s.gain(0.08)
    const breath = s.noise('white', t, end + 0.05)
    const bf = s.bp(f, 3)
    const bg = s.gain(0.25)
    const env = s.gain(0)
    const p = env.gain
    p.setValueAtTime(0, t)
    p.linearRampToValueAtTime(0.55, t + 0.015)
    p.setValueAtTime(0.55, t + 0.15)
    p.linearRampToValueAtTime(0, t + 0.175)
    p.setValueAtTime(0, t + 0.24)
    p.linearRampToValueAtTime(0.6, t + 0.257)
    p.setValueAtTime(0.6, t + 0.72)
    p.setTargetAtTime(0, t + 0.72, 0.02)
    o.connect(env)
    h2.connect(h2g).connect(env)
    breath.connect(bf).connect(bg).connect(env)
    env.connect(out)
    return end
  },

  /** Cartoon tackle: body thud, dust thump, hard-hat knocks, sliding scuff. */
  'tackle-thud': (s, out, t, { rate }) =>
    max(
      thump(s, out, t, { peak: 0.95, f0: 100 * rate, f1: 42, sweep: 0.15, decay: 0.38 }),
      burst(s, out, t, { peak: 0.55, decay: 0.13, freq: 700, type: 'lowpass', color: 'pink' }),
      modes(s, out, t + 0.02, { peak: 0.14, freq: 1150, ratios: [1, 1.6], decays: [0.08, 0.05] }),
      modes(s, out, t + 0.12, { peak: 0.08, freq: 1220, ratios: [1, 1.6], decays: [0.06, 0.04] }),
      burst(s, out, t + 0.1, { peak: 0.18, decay: 0.4, freq: 1500, q: 0.6, color: 'pink', attack: 0.05 }),
    ),

  /** Comedy spring: pitch-bent sine with a decaying wobble and a twangy overtone. */
  boing: (s, out, t, { rate }) => {
    const dur = 0.8
    const o = s.osc('sine', 150 * rate, t, t + dur + 0.05)
    o.frequency.setValueAtTime(150 * rate, t)
    o.frequency.exponentialRampToValueAtTime(430 * rate, t + 0.07)
    o.frequency.exponentialRampToValueAtTime(390 * rate, t + dur)
    const vib = s.osc('sine', 11, t, t + dur + 0.05)
    const vg = s.gain(0)
    vg.gain.setValueAtTime(95 * rate, t + 0.05)
    vg.gain.setTargetAtTime(0, t + 0.08, tc(0.65))
    vib.connect(vg)
    vg.connect(o.frequency)
    const g = s.gain(0)
    s.perc(g.gain, t, 0.55, 0.005, dur)
    o.connect(g).connect(out)
    const o2 = s.osc('triangle', 300 * rate, t, t + 0.4)
    o2.frequency.setValueAtTime(300 * rate, t)
    o2.frequency.exponentialRampToValueAtTime(860 * rate, t + 0.07)
    vg.connect(o2.frequency)
    const g2 = s.gain(0)
    s.perc(g2.gain, t, 0.12, 0.004, 0.3)
    o2.connect(g2).connect(out)
    return t + dur + 0.05
  },

  /** Clean countdown blip: softened square + sine (rate raises the pitch for the last seconds). */
  'countdown-beep': (s, out, t, { rate }) => {
    const f = 880 * rate
    const len = 0.11
    const sq = s.osc('square', f, t, t + len + 0.06)
    const lp = s.lp(3200, 0.7)
    const sqg = s.gain(0.3)
    const si = s.osc('sine', f, t, t + len + 0.06)
    const g = s.gain(0)
    s.ahr(g.gain, t, 0.55, 0.004, len, 0.035)
    sq.connect(sqg).connect(lp).connect(g)
    si.connect(g)
    g.connect(out)
    return t + len + 0.06
  },

  /** Engine light-off: igniter sparks, a flame "whoomp" sweep, sub swell, sputter. */
  ignition: (s, out, t, { rate }) => {
    for (let i = 0; i < 3; i++) burst(s, out, t + i * 0.06, { peak: 0.2, decay: 0.02, freq: 4200, q: 1.5, attack: 0.0005 })
    const h = t + 0.18
    const n = s.noise('pink', h, h + 1.9)
    const f = s.lp(150, 0.9)
    f.frequency.setValueAtTime(150, h)
    f.frequency.exponentialRampToValueAtTime(3600 * rate, h + 0.16)
    f.frequency.exponentialRampToValueAtTime(700, h + 1)
    const g = s.gain(0)
    g.gain.setValueAtTime(0, h)
    g.gain.linearRampToValueAtTime(0.85, h + 0.06)
    g.gain.setTargetAtTime(0.28, h + 0.1, 0.25)
    g.gain.setTargetAtTime(0, h + 0.9, tc(0.8))
    n.connect(f).connect(g).connect(out)
    return max(
      h + 1.9,
      thump(s, out, h, { peak: 0.8, f0: 72 * rate, f1: 34, sweep: 0.4, decay: 0.9, attack: 0.02 }),
      burst(s, out, h + 0.05, { peak: 0.35, decay: 0.4, hold: 0.8, freq: 2000, q: 0.7, color: 'crackle', attack: 0.05 }),
    )
  },

  /** Liftoff: brown + pink roar with flutter, crackle and an LFO'd sub, ~6.5 s. */
  'liftoff-roar': (s, out, t, { rate }) => {
    const a = 0.55
    const hold = 3.2
    const rel = 2.6
    const end = t + a + hold + rel
    const env = s.gain(0)
    s.ahr(env.gain, t, 1, a, hold, rel)
    env.connect(out)
    const flutter = s.gain(0.85)
    s.wander(7, 0.25, flutter.gain, t, end)
    flutter.connect(env)
    const b = s.noise('brown', t, end)
    const bl = s.lp(420 * rate, 0.6)
    const bg = s.gain(1.1)
    b.connect(bl).connect(bg).connect(flutter)
    const p = s.noise('pink', t, end)
    const pl = s.lp(1300 * rate, 0.5)
    const pg = s.gain(0.45)
    p.connect(pl).connect(pg).connect(flutter)
    const c = s.noise('crackle', t, end)
    const cf = s.bp(1700, 0.6)
    const cg = s.gain(0.4)
    c.connect(cf).connect(cg).connect(flutter)
    const sub = s.osc('sine', 40 * rate, t, end)
    const sg = s.gain(0.35)
    s.lfo(0.7, 0.12, sg.gain, t, end)
    sub.connect(sg).connect(env)
    return end
  },

  /** Big cartoon explosion: crack, swept noise body, pitch-dropping boom, crunch, debris clanks. */
  explosion: (s, out, t, { rate }) => {
    let end = max(
      burst(s, out, t, { peak: 0.5, decay: 0.05, freq: 900, type: 'highpass', attack: 0.0008 }),
      burst(s, out, t, { peak: 0.9, decay: 2.2, freq: 5200, freqTo: 220, sweep: 1.4, type: 'lowpass', color: 'pink', attack: 0.004 }),
      thump(s, out, t, { peak: 0.95, f0: 88 * rate, f1: 27, sweep: 1.1, decay: 1.7, attack: 0.006 }),
      burst(s, out, t + 0.02, { peak: 0.4, decay: 0.9, freq: 900, q: 0.6, color: 'crackle', attack: 0.01 }),
    )
    const n = 5 + Math.floor(s.rng() * 3)
    for (let i = 0; i < n; i++) {
      const at = t + s.r(0.35, 2.3)
      const k = 1 - (at - t) / 2.6
      end = max(
        end,
        modes(s, out, at, {
          peak: 0.16 * k + 0.03,
          freq: s.r(280, 1300),
          ratios: [1, s.r(2.2, 2.9), s.r(4.1, 5.6)],
          decays: [s.r(0.18, 0.45), 0.14, 0.08],
          strike: 0.08 * k,
        }),
      )
    }
    return end
  },

  /** Structural breakup: metal stress creak, tumbling clanks, rattle. */
  'breakup-clank': (s, out, t, { rate }) => {
    const cr = s.osc('sawtooth', 68 * rate, t, t + 0.62)
    s.lfo(6.5, 9, cr.frequency, t, t + 0.62)
    const cf = s.bp(620, 4)
    const cg = s.gain(0)
    s.ahr(cg.gain, t, 0.45, 0.08, 0.25, 0.2)
    cr.connect(cf).connect(cg).connect(out)
    let end = t + 0.62
    const n = 4 + Math.floor(s.rng() * 3)
    for (let i = 0; i < n; i++) {
      const at = t + 0.12 + s.r(0, 1)
      end = max(
        end,
        fmHit(s, out, at, { peak: s.r(0.12, 0.3), freq: s.r(240, 900) * rate, ratio: s.r(1.3, 3.1), index: s.r(1.5, 4), decay: s.r(0.2, 0.5), indexDecay: 0.08 }),
      )
    }
    return max(end, rattle(s, out, t + 0.1, { peak: 0.25, dur: 0.8, rate: 30, freq: 2300, width: 0.01 }))
  },

  /** Emergency whoop siren, four rising sweeps, low-passed so it never shrieks. */
  alarm: (s, out, t, { rate }) => {
    const cycles = 4
    const per = 0.5
    const end = t + cycles * per + 0.1
    const tri = s.osc('triangle', 520 * rate, t, end)
    const sq = s.osc('square', 520 * rate, t, end)
    for (let i = 0; i < cycles; i++) {
      const a = t + i * per
      for (const o of [tri, sq]) {
        o.frequency.setValueAtTime(520 * rate, a)
        o.frequency.exponentialRampToValueAtTime(990 * rate, a + 0.4)
      }
    }
    const sqg = s.gain(0.22)
    const lp = s.lp(2300, 0.7)
    const g = s.gain(0)
    const p = g.gain
    p.setValueAtTime(0, t)
    for (let i = 0; i < cycles; i++) {
      const a = t + i * per
      p.linearRampToValueAtTime(0.5, a + 0.03)
      p.setValueAtTime(0.5, a + 0.4)
      p.linearRampToValueAtTime(0.06, a + 0.48)
    }
    p.linearRampToValueAtTime(0, t + cycles * per + 0.05)
    tri.connect(lp)
    sq.connect(sqg).connect(lp)
    lp.connect(g).connect(out)
    return end
  },

  /** Blackout: breaker CHUNK, everything spins down, mains hum dies. */
  'power-down': (s, out, t, { rate }) => {
    thump(s, out, t, { peak: 0.75, f0: 120, f1: 48, sweep: 0.1, decay: 0.3 })
    burst(s, out, t, { peak: 0.35, decay: 0.06, freq: 1500, type: 'lowpass', color: 'pink' })
    modes(s, out, t, { peak: 0.1, freq: 520, ratios: [1, 2.6], decays: [0.25, 0.15], strike: 0.2 })
    const h = t + 0.05
    const dur = 1.9
    const saw = s.osc('sawtooth', 190 * rate, h, h + dur + 0.1)
    s.sweep(saw.frequency, h, 190 * rate, 24, dur)
    const si = s.osc('sine', 380 * rate, h, h + dur + 0.1)
    s.sweep(si.frequency, h, 380 * rate, 45, dur)
    const lp = s.lp(2600, 1.2)
    s.sweep(lp.frequency, h, 2600, 140, dur)
    const g = s.gain(0)
    g.gain.setValueAtTime(0, h)
    g.gain.linearRampToValueAtTime(0.4, h + 0.05)
    g.gain.setTargetAtTime(0, h + 0.4, tc(dur))
    const sg = s.gain(0.4)
    si.connect(sg).connect(lp)
    saw.connect(lp)
    lp.connect(g).connect(out)
    const hum = s.osc('sine', 120, h, h + 1.2)
    const hg = s.gain(0)
    hg.gain.setValueAtTime(0.1, h)
    hg.gain.setTargetAtTime(0, h, tc(1))
    hum.connect(hg).connect(out)
    return h + dur + 0.1
  },

  /** Power restored: breaker clunk, rising whine, fluorescent tubes tinking on, hum returns. */
  'power-up': (s, out, t, { rate }) => {
    thump(s, out, t, { peak: 0.7, f0: 125, f1: 50, sweep: 0.1, decay: 0.28 })
    burst(s, out, t, { peak: 0.3, decay: 0.05, freq: 1600, type: 'lowpass', color: 'pink' })
    const h = t + 0.1
    const dur = 1.3
    const saw = s.osc('sawtooth', 30, h, h + dur + 0.6)
    s.sweep(saw.frequency, h, 30, 230 * rate, dur)
    const lp = s.lp(180, 1.1)
    s.sweep(lp.frequency, h, 180, 2400, dur)
    const g = s.gain(0)
    s.ahr(g.gain, h, 0.32, dur * 0.8, dur * 0.2, 0.45)
    saw.connect(lp).connect(g).connect(out)
    for (let i = 0; i < 4; i++) {
      modes(s, out, h + 0.35 + i * s.r(0.12, 0.3), { peak: 0.05, freq: s.r(2400, 3600), ratios: [1, 1.5], decays: [0.04, 0.03], strike: 0.06 })
    }
    const hum = s.osc('sine', 120, h + 0.4, h + dur + 1)
    const hg = s.gain(0)
    s.ahr(hg.gain, h + 0.4, 0.09, 0.5, 0.3, 0.6)
    hum.connect(hg).connect(out)
    return h + dur + 1
  },

  /** PA "ding-dong" (E5 → C5) through a band-limited speaker with a slapback. */
  'pa-chime': (s, out, t, { rate }) => {
    const hp = s.hp(320, 0.7)
    const pk = s.peaking(2100, 0.9, 3)
    const lp = s.lp(5200, 0.7)
    s.chain(hp, pk, lp, out)
    const slap = s.delay(0.3, 0.11)
    const slapG = s.gain(0.22)
    lp.connect(slap).connect(slapG).connect(out)
    const ding = (at: number, m: number) =>
      max(
        fmHit(s, hp, at, { peak: 0.3, freq: mtof(m) * rate, ratio: 2, index: 0.9, decay: 1.7, indexDecay: 0.3 }),
        fmHit(s, hp, at, { peak: 0.07, freq: mtof(m) * rate * 3.01, ratio: 1, index: 0.2, decay: 0.6 }),
      )
    ding(t, 76)
    return ding(t + 0.55, 72) + 0.15
  },

  /** Small crowd cheer: formant-filtered noise voices, claps and a couple of whistles. */
  cheer: (s, out, t, { rate }) => {
    const dur = 1.25
    const bus = s.gain(1)
    bus.connect(out)
    for (let i = 0; i < 5; i++) {
      const n = s.noise('pink', t, t + dur + 0.95)
      const f1 = s.bp(s.r(520, 820) * rate, 4.5)
      const f2 = s.bp(s.r(1050, 1650) * rate, 5)
      const f2g = s.gain(0.6)
      const voice = s.gain(1)
      n.connect(f1).connect(voice)
      n.connect(f2).connect(f2g).connect(voice)
      const am = s.gain(0.7)
      s.lfo(s.r(3, 7), 0.3, am.gain, t, t + dur + 0.95)
      const env = s.gain(0)
      s.ahr(env.gain, t + s.r(0, 0.15), s.r(2.2, 3.2), 0.12, dur * s.r(0.5, 0.8), 0.6)
      voice.connect(am).connect(env).connect(bus)
    }
    rattle(s, bus, t + 0.08, { peak: 0.5, dur, rate: 24, freq: 1500, q: 1.1, width: 0.012 })
    const nW = 1 + Math.floor(s.rng() * 2)
    for (let i = 0; i < nW; i++) {
      const at = t + s.r(0.1, 0.6)
      const w = s.osc('sine', 2100, at, at + 0.45)
      s.sweep(w.frequency, at, 2100, 2900, 0.25)
      const wg = s.gain(0)
      s.ahr(wg.gain, at, 0.06, 0.03, 0.22, 0.12)
      w.connect(wg).connect(bus)
    }
    return t + dur + 0.95
  },

  /** Achievement: bright rising bell arpeggio (C E G C E) with a soft shimmer. */
  achievement: (s, out, t, { rate }) => {
    const bus = s.lp(6500)
    bus.connect(out)
    let end = t
    ;[72, 76, 79, 84, 88].forEach((m, i) => {
      end = max(end, fmHit(s, bus, t + i * 0.055, { peak: 0.22, freq: mtof(m) * rate, ratio: 3, index: 0.5, decay: 0.7 + i * 0.12, indexDecay: 0.15 }))
    })
    const sh = s.osc('sine', mtof(91) * rate, t + 0.25, t + 1.4)
    const shg = s.gain(0)
    s.ahr(shg.gain, t + 0.25, 0.05, 0.15, 0.3, 0.6)
    const trem = s.gain(0.7)
    s.lfo(9, 0.3, trem.gain, t, t + 1.4)
    sh.connect(trem).connect(shg).connect(bus)
    return max(end, t + 1.4)
  },

  /** Giant button: plastic clunk, click, and a satisfying low "bwomp". */
  'big-button': (s, out, t, { rate }) => {
    const o = s.osc('square', 112 * rate, t + 0.03, t + 0.45)
    s.sweep(o.frequency, t + 0.03, 112 * rate, 80 * rate, 0.3)
    const lp = s.lp(520, 1.3)
    const g = s.gain(0)
    s.perc(g.gain, t + 0.03, 0.3, 0.01, 0.32)
    o.connect(lp).connect(g).connect(out)
    return max(
      t + 0.45,
      thump(s, out, t, { peak: 0.7, f0: 155 * rate, f1: 60, sweep: 0.08, decay: 0.2 }),
      burst(s, out, t, { peak: 0.3, decay: 0.012, freq: 2600, type: 'highpass', attack: 0.0006 }),
      modes(s, out, t, { peak: 0.12, freq: 340 * rate, ratios: [1, 2.24], decays: [0.09, 0.06] }),
    )
  },
} satisfies Record<SfxName, SfxFn>

const D: SfxMeta = { peakDb: -10, minInterval: 0.04, maxVoices: 4, onLimit: 'steal', ref: 4, rolloff: 1.2, max: 45, reverb: 0, priority: 1 }
const m = (o: Partial<SfxMeta>): SfxMeta => ({ ...D, ...o })

/**
 * Mixing / behaviour table. peakDb = loudness target of the voice output at
 * volume 1 (before buses, distance and the master limiter).
 */
export const SFX_META = {
  'ui-click': m({ peakDb: -20, minInterval: 0.035, maxVoices: 2, priority: 0.8, ui: true }),
  'ui-open': m({ peakDb: -22, minInterval: 0.08, maxVoices: 2, ui: true }),
  'ui-close': m({ peakDb: -23, minInterval: 0.08, maxVoices: 2, ui: true }),
  footstep: m({ peakDb: -16, minInterval: 0.18, maxVoices: 3, ref: 5, rolloff: 1.4, max: 25, priority: 0.5 }),
  'footstep-metal': m({ peakDb: -15, minInterval: 0.18, maxVoices: 3, ref: 5, rolloff: 1.4, max: 25, priority: 0.5 }),
  interact: m({ peakDb: -16, minInterval: 0.08, maxVoices: 2 }),
  'printer-whir': m({ peakDb: -14, minInterval: 0.5, maxVoices: 1, onLimit: 'reject', max: 30 }),
  'print-stamp': m({ peakDb: -8, minInterval: 0.2, maxVoices: 2, ref: 5, max: 35, reverb: 0.15 }),
  'tube-whoosh': m({ peakDb: -12, minInterval: 0.3, maxVoices: 2, max: 30 }),
  'press-thump': m({ peakDb: -6, minInterval: 0.12, maxVoices: 3, ref: 5, max: 40, reverb: 0.18 }),
  'steam-hiss': m({ peakDb: -15, minInterval: 0.15, maxVoices: 4, ref: 3.5, max: 30 }),
  'weld-zap': m({ peakDb: -16, minInterval: 0.1, maxVoices: 2, max: 30 }),
  'machine-clank': m({ peakDb: -10, minInterval: 0.1, maxVoices: 4, max: 35, reverb: 0.12 }),
  'machine-kick': m({ peakDb: -8, minInterval: 0.2, maxVoices: 2, max: 35, reverb: 0.12 }),
  'scanner-beep': m({ peakDb: -20, minInterval: 0.15, maxVoices: 2, max: 28 }),
  'radio-jingle': m({ peakDb: -8, minInterval: 1.2, maxVoices: 1, onLimit: 'reject', ref: 6, max: 35, priority: 1.5 }),
  'radio-static': m({ peakDb: -16, minInterval: 0.3, maxVoices: 1, max: 25 }),
  'forklift-horn': m({ peakDb: -10, minInterval: 0.15, maxVoices: 2, ref: 8, max: 50, reverb: 0.15, priority: 1.5 }),
  'forklift-beep': m({ peakDb: -19, minInterval: 0.3, maxVoices: 2, ref: 6, max: 40 }),
  'forklift-impact': m({ peakDb: -6, minInterval: 0.1, maxVoices: 3, ref: 6, max: 40, reverb: 0.12 }),
  'forklift-start': m({ peakDb: -12, minInterval: 1, maxVoices: 1, onLimit: 'reject', ref: 5, max: 35 }),
  'crate-bump': m({ peakDb: -11, minInterval: 0.1, maxVoices: 4, max: 30 }),
  'ball-kick': m({ peakDb: -11, minInterval: 0.1, maxVoices: 2, ref: 5, max: 35 }),
  'ball-bounce': m({ peakDb: -13, minInterval: 0.1, maxVoices: 3, max: 30 }),
  'goal-horn': m({ peakDb: -9, minInterval: 1.5, maxVoices: 1, onLimit: 'reject', ref: 10, max: 60, reverb: 0.2, priority: 1.5 }),
  whistle: m({ peakDb: -13, minInterval: 0.4, maxVoices: 2, ref: 10, max: 70, reverb: 0.15, priority: 2 }),
  'tackle-thud': m({ peakDb: -5, minInterval: 0.1, maxVoices: 2, ref: 6, priority: 2 }),
  boing: m({ peakDb: -9, minInterval: 0.2, maxVoices: 2, ref: 5, max: 40 }),
  'countdown-beep': m({ peakDb: -16, minInterval: 0.3, maxVoices: 2, priority: 2 }),
  ignition: m({ peakDb: -5, minInterval: 1, maxVoices: 1, onLimit: 'reject', ref: 20, rolloff: 1, max: 160, reverb: 0.3, priority: 3 }),
  'liftoff-roar': m({ peakDb: -3, minInterval: 2, maxVoices: 1, onLimit: 'reject', ref: 25, rolloff: 1, max: 200, reverb: 0.3, priority: 3 }),
  explosion: m({ peakDb: -2, minInterval: 0.5, maxVoices: 2, ref: 30, rolloff: 1, max: 220, reverb: 0.4, priority: 3 }),
  'breakup-clank': m({ peakDb: -6, minInterval: 0.3, maxVoices: 2, ref: 25, rolloff: 1, max: 200, reverb: 0.35, priority: 2 }),
  alarm: m({ peakDb: -16, minInterval: 1.5, maxVoices: 1, onLimit: 'reject', reverb: 0.15, priority: 2.5 }),
  'power-down': m({ peakDb: -8, minInterval: 1.5, maxVoices: 1, onLimit: 'reject', priority: 2.5 }),
  'power-up': m({ peakDb: -10, minInterval: 1.5, maxVoices: 1, onLimit: 'reject', priority: 2 }),
  'pa-chime': m({ peakDb: -8, minInterval: 1.5, maxVoices: 1, onLimit: 'reject', reverb: 0.2, priority: 2.5 }),
  cheer: m({ peakDb: -10, minInterval: 1, maxVoices: 2, ref: 8, max: 60, reverb: 0.2 }),
  achievement: m({ peakDb: -11, minInterval: 0.3, maxVoices: 2, priority: 2, ui: true }),
  'big-button': m({ peakDb: -9, minInterval: 0.2, maxVoices: 2, max: 35 }),
} satisfies Record<SfxName, SfxMeta>

/**
 * Measured raw peak (linear) of each SFX function's output at gain 1
 * (median over seeds), produced by `__MIW__.audio.measure()` in a browser
 * (OfflineAudioContext). Used to normalize every sound to its peakDb target.
 * Missing entries fall back to 1.
 */
export const RAW_PEAK: Partial<Record<SfxName, number>> = {
  'ui-click': 0.614,
  'ui-open': 0.496,
  'ui-close': 0.441,
  footstep: 0.461,
  'footstep-metal': 0.516,
  interact: 0.473,
  'printer-whir': 0.552,
  'print-stamp': 1.068,
  'tube-whoosh': 0.559,
  'press-thump': 1.171,
  'steam-hiss': 0.425,
  'weld-zap': 0.372,
  'machine-clank': 0.786,
  'machine-kick': 0.725,
  'scanner-beep': 0.5,
  'radio-jingle': 0.795,
  'radio-static': 0.47,
  'forklift-horn': 0.849,
  'forklift-beep': 0.5,
  'forklift-impact': 1.018,
  'forklift-start': 0.739,
  'crate-bump': 0.556,
  'ball-kick': 0.597,
  'ball-bounce': 0.427,
  'goal-horn': 0.507,
  whistle: 0.663,
  'tackle-thud': 1.022,
  boing: 0.57,
  'countdown-beep': 0.701,
  ignition: 0.878,
  'liftoff-roar': 1.287,
  explosion: 1.333,
  'breakup-clank': 0.32,
  alarm: 0.589,
  'power-down': 0.87,
  'power-up': 0.681,
  'pa-chime': 0.473,
  cheer: 1.09,
  achievement: 0.461,
  'big-button': 0.789,
}

/** Linear output gain that brings `name` to its peakDb target at volume 1. */
export function sfxLevel(name: SfxName): number {
  const raw = RAW_PEAK[name] ?? 1
  return dbToGain(SFX_META[name].peakDb) / Math.max(0.05, raw)
}

export const SFX_NAMES = Object.keys(SFX_LIBRARY) as SfxName[]
