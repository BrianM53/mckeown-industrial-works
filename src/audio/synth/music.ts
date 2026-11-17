import { impulse } from './buffers'
import { burst, fmHit, mtof, thump, type Synth } from './core'
import type { LoopParams, LoopVoice } from './types'

/**
 * GENERATIVE MUSIC — a calm industrial-electronic ambient bed in D dorian at
 * 94 BPM, original and procedural. A look-ahead scheduler (setInterval 25 ms,
 * scheduling 0.12 s ahead on the AudioContext clock) places:
 *   - a warm detuned-saw pad that glides between chord voicings under a slowly
 *     moving lowpass (persistent oscillators: cheap and seamless),
 *   - a soft sine/triangle sub bass on the chord roots,
 *   - a soft kick pulse, noise hats and metallic FM pings / pipe knocks,
 *   - occasional sparse electric-piano motifs into a dotted-eighth delay,
 *   - "machine breath" filtered-noise swells at section changes.
 * An energy random walk re-plans density every 8 bars (with breakdowns), the
 * progression changes every 8 bars and motifs are generated fresh, so the
 * piece never loops audibly. Music bus only; levels stay modest.
 */
export const MUSIC_BPM = 94
const STEP = 60 / MUSIC_BPM / 4
const SWING = 0.14 * STEP
const LOOKAHEAD = 0.12
const INTERVAL_MS = 25
const PAD_LEVEL = 0.05

interface Chord {
  notes: [number, number, number, number]
  root: number
}

const CHORDS: Record<string, Chord> = {
  Dm9: { notes: [50, 53, 57, 64], root: 38 },
  Bbmaj7: { notes: [46, 53, 57, 62], root: 34 },
  Fadd9: { notes: [53, 57, 60, 67], root: 41 },
  Cadd9: { notes: [48, 55, 62, 64], root: 36 },
  Gm7: { notes: [43, 53, 58, 62], root: 43 },
  Am7: { notes: [45, 52, 55, 60], root: 33 },
  A7sus4: { notes: [45, 52, 55, 62], root: 33 },
}

const PROGRESSIONS: string[][] = [
  ['Dm9', 'Bbmaj7', 'Fadd9', 'Cadd9'],
  ['Dm9', 'Gm7', 'Bbmaj7', 'A7sus4'],
  ['Dm9', 'Am7', 'Bbmaj7', 'Cadd9'],
  ['Bbmaj7', 'Fadd9', 'Cadd9', 'Dm9'],
  ['Dm9', 'Fadd9', 'Gm7', 'Am7'],
]

/** D minor pentatonic across two octaves (motif notes). */
const SCALE = [62, 65, 67, 69, 72, 74, 77, 79, 81]

const RHYTHMS: number[][] = [
  [0, 3, 6],
  [0, 2, 4, 7],
  [0, 3, 6, 10, 12],
  [0, 4, 6, 8, 14],
  [0, 6, 8, 11, 14, 18],
  [0, 2, 8, 10, 12, 16],
]

interface Section {
  energy: number
  kick: 0 | 1 | 2
  hats: 0 | 1 | 2 | 3
  perc: number
  motif: number
  bright: number
  bass: boolean
}

/**
 * Smooth voice leading: each pad voice moves to the nearest tone of the new
 * chord (any octave inside a warm register), preferring pitch classes not yet
 * taken and gently pulled toward the middle of the register so voices never
 * drift apart or creep up over time.
 */
export function voiceLead(current: readonly number[], chordNotes: readonly number[], lo = 45, hi = 72): number[] {
  const pcs = [...new Set(chordNotes.map((n) => ((n % 12) + 12) % 12))]
  const usedPc = new Set<number>()
  const usedNote = new Set<number>()
  const center = (lo + hi) / 2
  return current.map((cur) => {
    let best = cur
    let bestCost = Number.POSITIVE_INFINITY
    for (const pc of pcs) {
      for (let n = lo + ((pc - (lo % 12) + 12) % 12); n <= hi; n += 12) {
        if (usedNote.has(n)) continue
        const cost = Math.abs(n - cur) + (usedPc.has(pc) ? 2.5 : 0) + 0.08 * Math.abs(n - center)
        if (cost < bestCost) {
          bestCost = cost
          best = n
        }
      }
    }
    usedPc.add(((best % 12) + 12) % 12)
    usedNote.add(best)
    return best
  })
}

export interface MusicVoice extends LoopVoice {
  /** Schedule every step that starts before `until` (context seconds). */
  pump(until: number): void
}

export function createMusic(s: Synth, p: LoopParams): MusicVoice {
  const ctx = s.ctx
  const rng = s.rng
  const t0 = ctx.currentTime + 0.05

  const out = s.gain(0)
  out.gain.setValueAtTime(0, t0)
  out.gain.setTargetAtTime(1, t0, 0.8)

  // ---- FX: convolution reverb + dotted-eighth delay -------------------------
  const verbIn = s.gain(1)
  const verbOut = s.gain(0.5)
  const irKind = p.quality === 'low' ? 'small' : 'hall'
  verbIn.connect(s.convolver(() => impulse(ctx, irKind), !p.offline)).connect(verbOut).connect(out)
  const dlyIn = s.gain(1)
  const dly = s.delay(1.5, STEP * 3)
  const fb = s.gain(0.34)
  const dlyLp = s.lp(2400, 0.6)
  const dlyOut = s.gain(0.42)
  dlyIn.connect(dly)
  dly.connect(dlyLp).connect(fb).connect(dly)
  dlyLp.connect(dlyOut).connect(out)
  const dlyVerb = s.gain(0.3)
  dlyOut.connect(dlyVerb).connect(verbIn)

  // ---- Pad: 4 voices × 2 detuned saws → moving lowpass ----------------------
  let progression = PROGRESSIONS[0]
  let chord = CHORDS[progression[0]]
  const padFilter = s.lp(620, 0.9)
  const padGain = s.gain(0)
  padGain.gain.setValueAtTime(0, t0)
  padGain.gain.setTargetAtTime(PAD_LEVEL, t0, 1.3)
  padFilter.connect(padGain)
  padGain.connect(out)
  const padSend = s.gain(0.4)
  padGain.connect(padSend).connect(verbIn)
  s.lfo(0.021, 240, padFilter.frequency, t0)
  s.lfo(0.0083, 110, padFilter.frequency, t0)
  const pad: OscillatorNode[] = []
  let padNotes: number[] = [...chord.notes]
  for (let v = 0; v < 4; v++) {
    for (const det of [-7, 7]) {
      const o = s.osc('sawtooth', mtof(chord.notes[v]), t0, undefined, det + (rng() - 0.5) * 4)
      o.connect(padFilter)
      pad.push(o)
    }
  }

  // ---- Bass: persistent sine + triangle, enveloped per note ------------------
  const bass = s.osc('sine', mtof(chord.root), t0)
  const bassTri = s.osc('triangle', mtof(chord.root), t0)
  const bassTriG = s.gain(0.16)
  const bassLp = s.lp(320, 0.8)
  const bassEnv = s.gain(0)
  bass.connect(bassLp)
  bassTri.connect(bassTriG).connect(bassLp)
  bassLp.connect(bassEnv).connect(out)

  // ---- Percussion buses -----------------------------------------------------
  const hatL = s.pan(-0.28)
  const hatR = s.pan(0.28)
  const hatBus = s.hp(6800, 0.7)
  hatL.connect(hatBus)
  hatR.connect(hatBus)
  hatBus.connect(out)
  const hatSend = s.gain(0.12)
  hatBus.connect(hatSend).connect(verbIn)

  const kickBus = s.lp(1300, 0.7)
  kickBus.connect(out)

  const percBus = s.gain(1)
  percBus.connect(out)
  const percDly = s.gain(0.35)
  const percVerb = s.gain(0.4)
  percBus.connect(percDly).connect(dlyIn)
  percBus.connect(percVerb).connect(verbIn)

  const motifBus = s.lp(5000, 0.7)
  motifBus.connect(out)
  const motifDly = s.gain(0.5)
  const motifVerb = s.gain(0.45)
  motifBus.connect(motifDly).connect(dlyIn)
  motifBus.connect(motifVerb).connect(verbIn)

  // ---- State ----------------------------------------------------------------
  let step = 0
  let nextTime = t0 + 0.05
  let section: Section = { energy: 0.12, kick: 0, hats: 0, perc: 0.1, motif: 0.5, bright: 560, bass: false }
  let flags = { extraKick: false, openHat: false, bassPush: false, drop: 0.15 }
  const motifQueue: { step: number; midi: number; vel: number }[] = []
  let lastMotif: number[] | null = null

  const hit = () => s.spawn()

  function setChord(c: Chord, t: number, swell: boolean) {
    chord = c
    padNotes = swell ? voiceLead(padNotes, c.notes) : [...c.notes]
    for (let v = 0; v < 4; v++) {
      const f = mtof(padNotes[v])
      pad[v * 2].frequency.setTargetAtTime(f, t, 0.25)
      pad[v * 2 + 1].frequency.setTargetAtTime(f, t, 0.25)
    }
    if (swell) {
      padGain.gain.setTargetAtTime(PAD_LEVEL * 0.72, t, 0.25)
      padGain.gain.setTargetAtTime(PAD_LEVEL, t + 0.7, 1.4)
    }
  }

  function newSection(bar: number, t: number) {
    let e = section.energy
    if (bar === 0) e = 0.12
    else if (bar === 8) e = 0.4
    else if (rng() < 0.14) e = 0.12 + rng() * 0.1
    else e = Math.min(0.9, Math.max(0.15, e + (rng() - 0.45) * 0.45))
    section = {
      energy: e,
      kick: e < 0.3 ? 0 : e < 0.62 ? 1 : 2,
      hats: bar === 0 ? 0 : e < 0.18 ? 0 : e < 0.42 ? 1 : e < 0.72 ? 2 : 3,
      perc: 0.08 + 0.35 * e,
      motif: 0.55 - 0.3 * e,
      bright: 520 + 650 * e,
      bass: e > 0.25 || bar >= 8,
    }
    if (bar > 0) {
      let next = progression
      for (let i = 0; i < 4 && next === progression; i++) next = PROGRESSIONS[Math.floor(rng() * PROGRESSIONS.length)]
      progression = next
    }
    padFilter.frequency.setTargetAtTime(section.bright, t, 2.5)
    if (bar > 0 && rng() < 0.55) textureSwell(t)
  }

  function onBar(bar: number, t: number) {
    if (bar % 8 === 0) newSection(bar, t)
    if (bar === 4 && section.hats === 0) section.hats = 1
    if (bar % 2 === 0) setChord(CHORDS[progression[(bar % 8) / 2]], t, bar > 0)
    flags = { extraKick: rng() < 0.3, openHat: rng() < 0.45, bassPush: rng() < 0.55, drop: 0.1 + rng() * 0.15 }
    if (bar % 4 === 0 && bar >= 4 && rng() < section.motif) planMotif(bar)
  }

  function planMotif(bar: number) {
    const base = bar * 16 + 1
    let degrees: number[]
    let rhythm: number[]
    if (lastMotif && rng() < 0.35) {
      // develop the previous idea: shift it by a scale step
      const shift = rng() < 0.5 ? -1 : 1
      degrees = lastMotif.map((d) => Math.min(SCALE.length - 1, Math.max(0, d + shift)))
      rhythm = RHYTHMS[Math.floor(rng() * RHYTHMS.length)].slice(0, degrees.length)
    } else {
      rhythm = RHYTHMS[Math.floor(rng() * RHYTHMS.length)]
      degrees = []
      let d = 2 + Math.floor(rng() * 4)
      for (let i = 0; i < rhythm.length; i++) {
        degrees.push(d)
        const r = rng()
        d += r < 0.35 ? -1 : r < 0.7 ? 1 : r < 0.85 ? -2 : 2
        d = Math.min(SCALE.length - 1, Math.max(0, d))
      }
    }
    lastMotif = degrees
    for (let i = 0; i < degrees.length && i < rhythm.length; i++) {
      motifQueue.push({ step: base + rhythm[i], midi: SCALE[degrees[i]], vel: 0.75 + rng() * 0.25 })
      // answer two bars later, a little quieter, dropping the last note
      if (i < degrees.length - 1) motifQueue.push({ step: base + 32 + rhythm[i], midi: SCALE[degrees[i]], vel: 0.55 + rng() * 0.2 })
    }
  }

  function kick(t: number, vel: number) {
    const h = hit()
    const end = thump(h, kickBus, t, { peak: 0.42 * vel, f0: 108, f1: 43, sweep: 0.1, decay: 0.36, attack: 0.002 })
    burst(h, kickBus, t, { peak: 0.04 * vel, decay: 0.006, freq: 3000, type: 'highpass', attack: 0.0005 })
    h.disposeOnEnd(h.sources[0])
    void end
  }

  function hat(t: number, vel: number, open: boolean, right: boolean) {
    const h = hit()
    const dec = open ? 0.24 : 0.045
    const src = h.noise('white', t, t + dec + 0.03)
    const g = h.gain(0)
    h.perc(g.gain, t, 0.12 * vel, 0.001, dec)
    src.connect(g).connect(right ? hatR : hatL)
    h.disposeOnEnd(src)
  }

  function ping(t: number) {
    const h = hit()
    const pn = h.pan(rng() * 1.2 - 0.6)
    pn.connect(percBus)
    fmHit(h, pn, t, { peak: 0.05, freq: [1180, 1405, 1575][Math.floor(rng() * 3)], ratio: 1.414, index: 2.6, decay: 0.45, indexDecay: 0.06 })
    h.disposeOnEnd(h.sources[0])
  }

  function knock(t: number) {
    const h = hit()
    const pn = h.pan(rng() * 0.8 - 0.4)
    pn.connect(percBus)
    fmHit(h, pn, t, { peak: 0.07, freq: rng() < 0.5 ? 300 : 337, ratio: 2.37, index: 1.8, decay: 0.22, indexDecay: 0.05 })
    h.disposeOnEnd(h.sources[0])
  }

  function bassNote(t: number, midi: number, vel: number, len: number) {
    const f = mtof(midi)
    bass.frequency.setTargetAtTime(f, t, 0.008)
    bassTri.frequency.setTargetAtTime(f, t, 0.008)
    const g = bassEnv.gain
    g.setTargetAtTime(0.3 * vel, t, 0.006)
    g.setTargetAtTime(0.19 * vel, t + 0.08, 0.15)
    g.setTargetAtTime(0, t + len, 0.07)
  }

  function motifNote(t: number, midi: number, vel: number) {
    const h = hit()
    const f = mtof(midi)
    fmHit(h, motifBus, t, { peak: 0.075 * vel, freq: f, ratio: 2, index: 1.3, decay: 1.8, indexDecay: 0.25, attack: 0.004 })
    fmHit(h, motifBus, t, { peak: 0.025 * vel, freq: f / 2, ratio: 1, index: 0.3, decay: 1.2 })
    h.disposeOnEnd(h.sources[0])
  }

  function textureSwell(t: number) {
    const h = hit()
    const dur = STEP * 32
    const n = h.noise('pink', t, t + dur + 0.1)
    const f = h.bp(300, 1.6)
    f.frequency.setValueAtTime(300, t)
    f.frequency.exponentialRampToValueAtTime(1700, t + dur * 0.55)
    f.frequency.exponentialRampToValueAtTime(450, t + dur)
    const g = h.gain(0)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.06, t + dur * 0.55)
    g.gain.linearRampToValueAtTime(0, t + dur)
    const pn = h.pan(rng() * 1.2 - 0.6)
    n.connect(f).connect(g).connect(pn)
    pn.connect(out)
    pn.connect(verbIn)
    h.disposeOnEnd(n)
  }

  function scheduleStep(i: number, t: number) {
    const st = i % 16
    const bar = Math.floor(i / 16)
    if (st === 0) onBar(bar, t)
    const tt = st % 2 === 1 ? t + SWING : t

    // kick
    let kv = 0
    if (section.kick === 1) kv = st === 0 ? 1 : st === 8 ? 0.7 : st === 10 && flags.extraKick ? 0.45 : 0
    else if (section.kick === 2) kv = st % 4 === 0 ? (st === 0 || st === 8 ? 1 : 0.72) : st === 14 && flags.extraKick ? 0.4 : 0
    if (kv > 0) kick(t, kv)

    // hats
    if (section.hats === 1 && st % 4 === 2) hat(tt, 0.55 + rng() * 0.15, false, st % 8 === 6)
    else if (section.hats >= 2 && rng() > flags.drop) {
      const accent = [0.28, 0.12, 0.6, 0.16][st % 4]
      const open = section.hats === 3 && st === 14 && flags.openHat
      hat(tt, (open ? 0.8 : accent) * (0.85 + rng() * 0.3), open, st % 2 === 1)
    }

    // metallic percussion
    if ((st === 7 || st === 13) && rng() < section.perc) ping(tt)
    if ((st === 3 || st === 11) && rng() < section.perc * 0.6) knock(tt)

    // bass
    if (section.bass) {
      if (st === 0) bassNote(t, chord.root, 1, STEP * 5)
      else if (st === 10 && flags.bassPush && section.kick >= 1) bassNote(tt, chord.root, 0.7, STEP * 3)
      else if (st === 6 && section.energy > 0.65) bassNote(t, chord.root + 12, 0.45, STEP * 1.5)
    }

    // motif notes due on this step
    for (let k = motifQueue.length - 1; k >= 0; k--) {
      const n = motifQueue[k]
      if (n.step === i) {
        motifNote(tt, n.midi, n.vel)
        motifQueue.splice(k, 1)
      } else if (n.step < i) motifQueue.splice(k, 1)
    }
  }

  function pump(until: number) {
    let guard = 0
    while (nextTime < until && guard++ < 256) {
      scheduleStep(step, nextTime)
      nextTime += STEP
      step++
    }
  }

  let timer: ReturnType<typeof setInterval> | null = null
  if (!p.offline) {
    timer = setInterval(() => {
      if (ctx.state !== 'running') return
      const now = ctx.currentTime
      // fell behind (main thread stall): resync without a burst of stale notes
      if (nextTime < now - 0.25) nextTime = now + 0.05
      pump(now + LOOKAHEAD)
    }, INTERVAL_MS)
  }

  return {
    output: out,
    setRate() {},
    pump,
    stop(t: number) {
      if (timer !== null) clearInterval(timer)
      timer = null
      s.stopAll(t)
    },
  }
}
