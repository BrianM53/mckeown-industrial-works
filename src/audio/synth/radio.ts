import { createRng } from '@/core/rng'
import { driveCurve } from './buffers'
import { burst, idle, mtof, pluck, thump, Synth } from './core'
import type { LoopParams, LoopVoice } from './types'

/**
 * RADIO BOOTH MUSIC — a short, original, upbeat 8-bar tune (F major, 116 BPM)
 * rendered once per AudioContext with an OfflineAudioContext (off the main
 * thread), then looped through a little "radio speaker" chain: band-limited,
 * gently overdriven, with crackle and a faint hum. Faint and positional near
 * the booth. While the tune renders (or where OfflineAudioContext is missing)
 * only the static plays.
 */
const BPM = 116
const BEAT = 60 / BPM
const BARS = 8
const SR = 22050

type Note = [beat: number, midi: number, beats: number]

const MELODY: Note[][] = [
  [[0, 69, 0.5], [0.5, 72, 0.5], [1.5, 74, 0.5], [2, 72, 1], [3, 69, 0.5]],
  [[0, 65, 0.5], [0.5, 69, 0.5], [1, 67, 1], [2.5, 65, 0.5], [3, 62, 1]],
  [[0, 65, 0.5], [0.5, 70, 0.5], [1, 74, 0.5], [1.5, 72, 0.5], [2, 70, 1], [3, 69, 0.5], [3.5, 67, 0.5]],
  [[0, 67, 1.5], [2, 64, 0.5], [2.5, 67, 0.5], [3, 70, 1]],
  [[0, 69, 0.5], [0.5, 72, 0.5], [1, 77, 1], [2, 76, 0.5], [2.5, 74, 0.5], [3, 72, 1]],
  [[0, 74, 0.5], [0.5, 72, 0.5], [1, 69, 1], [2.5, 65, 0.5], [3, 69, 1]],
  [[0, 70, 1], [1, 69, 0.5], [1.5, 67, 0.5], [2, 65, 1], [3, 62, 0.5], [3.5, 64, 0.5]],
  [[0, 67, 1], [1, 72, 0.5], [1.5, 70, 0.5], [2, 67, 1], [3, 64, 0.5]],
]

/** Chord tones (stabs) and bass root per bar: F Dm Bb C7 F Dm Bb C7. */
const CHORD_TONES = [
  [65, 69, 72],
  [62, 65, 69],
  [62, 65, 70],
  [64, 67, 70],
]
const ROOTS = [41, 38, 34, 36]

/** Write one bar of the tune into `out`, starting at t = 0 (notes may ring past the bar). */
export function writeRadioBar(s: Synth, out: AudioNode, bar: number): void {
  const lead = s.lp(2600, 0.8)
  lead.connect(out)
  const ch = bar % 4
  for (const [beat, midi, beats] of MELODY[bar % BARS]) {
    const t = beat * BEAT
    const len = beats * BEAT
    const o = s.osc('square', mtof(midi), t, t + len + 0.25)
    s.lfo(5.5, mtof(midi) * 0.004, o.frequency, t, t + len + 0.25)
    const g = s.gain(0)
    s.ahr(g.gain, t, 0.13, 0.008, Math.max(0.02, len - 0.08), 0.12)
    o.connect(g).connect(lead)
  }
  // off-beat organ stabs
  for (const beat of [1.5, 3.5]) {
    for (const m of CHORD_TONES[ch]) pluck(s, out, beat * BEAT, { peak: 0.05, freq: mtof(m), decay: 0.22, type: 'triangle', bright: 3 })
  }
  // bass: root on 1, fifth on 3, approach note on 4&
  const root = ROOTS[ch]
  const nextRoot = ROOTS[(ch + 1) % 4]
  pluck(s, out, 0, { peak: 0.3, freq: mtof(root), decay: 0.4, type: 'triangle', bright: 3 })
  pluck(s, out, 2 * BEAT, { peak: 0.26, freq: mtof(root + 7), decay: 0.35, type: 'triangle', bright: 3 })
  pluck(s, out, 3.5 * BEAT, { peak: 0.18, freq: mtof(nextRoot - 1), decay: 0.2, type: 'triangle', bright: 3 })
  // drums
  for (const beat of [0, 2]) thump(s, out, beat * BEAT, { peak: 0.45, f0: 120, f1: 48, sweep: 0.08, decay: 0.22 })
  for (const beat of [1, 3]) {
    burst(s, out, beat * BEAT, { peak: 0.28, decay: 0.12, freq: 1800, q: 0.8 })
    thump(s, out, beat * BEAT, { peak: 0.15, f0: 200, f1: 150, sweep: 0.04, decay: 0.06 })
  }
  for (let e = 0; e < 8; e++) burst(s, out, e * 0.5 * BEAT, { peak: e % 2 ? 0.06 : 0.04, decay: 0.03, freq: 7000, type: 'highpass' })
}

const bakes = new WeakMap<BaseAudioContext, Promise<AudioBuffer | null>>()

type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext

function offlineCtor(): OfflineCtor | null {
  const g = globalThis as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor }
  return g.OfflineAudioContext ?? g.webkitOfflineAudioContext ?? null
}

/** Render the tune once per context; resolves null when offline rendering is unavailable. */
export function bakeRadioTune(ctx: BaseAudioContext): Promise<AudioBuffer | null> {
  let p = bakes.get(ctx)
  if (!p) {
    p = renderTune(ctx).catch(() => null)
    bakes.set(ctx, p)
  }
  return p
}

const idleAsync = () => new Promise<void>((resolve) => idle(resolve, 200))

/**
 * Render the 8-bar tune one bar at a time (each bar's nodes are built in its
 * own idle slot, so the main thread never stalls), summing every bar — and
 * its ringing tail, wrapped past the loop point — into one seamless loop.
 */
async function renderTune(ctx: BaseAudioContext): Promise<AudioBuffer | null> {
  const Off = offlineCtor()
  if (!Off) return null
  const barLen = 4 * BEAT
  const tail = 0.8
  let sr = SR
  try {
    new Off(1, 128, sr)
  } catch {
    sr = 44100
  }
  const n = Math.floor(sr * BARS * barLen)
  const acc = new Float32Array(n)
  for (let bar = 0; bar < BARS; bar++) {
    await idleAsync()
    const oc = new Off(1, Math.ceil(sr * (barLen + tail)), sr)
    const s = new Synth(oc, createRng(0x7ad10 + bar))
    const out = s.gain(0.9)
    out.connect(oc.destination)
    writeRadioBar(s, out, bar)
    const r = (await oc.startRendering()).getChannelData(0)
    const off = Math.floor(sr * bar * barLen)
    for (let i = 0; i < r.length; i++) acc[(off + i) % n] += r[i]
  }
  const looped = ctx.createBuffer(1, n, sr)
  looped.getChannelData(0).set(acc)
  return looped
}

export function createRadio(s: Synth, _p: LoopParams): LoopVoice {
  const ctx = s.ctx
  const t0 = ctx.currentTime
  const out = s.gain(1)

  // speaker colour
  const speakerIn = s.hp(380, 0.7)
  s.chain(speakerIn, s.peaking(1300, 1, 5), s.lp(3400, 0.8), s.shaper(driveCurve(2.2)), s.gain(0.55), out)

  // static, hiss and hum
  s.chain(s.noise('crackle', t0), s.hp(1500, 0.7), s.gain(0.07), out)
  s.chain(s.noise('white', t0), s.bp(4000, 0.5), s.gain(0.012), out)
  s.chain(s.osc('sine', 120, t0), s.gain(0.01), out)

  let stopped = false
  bakeRadioTune(ctx)
    .then((buf) => {
      if (!buf || stopped || s.isDisposed) return
      const now = ctx.currentTime
      const fade = s.gain(0)
      fade.gain.setValueAtTime(0, now)
      fade.gain.setTargetAtTime(1, now, 0.4)
      const src = s.buffer(buf, now, undefined, { loop: true, offset: s.rng() * buf.duration * 0.9 })
      src.connect(fade).connect(speakerIn)
    })
    .catch(() => {})

  return {
    output: out,
    setRate() {},
    stop(t: number) {
      stopped = true
      s.stopAll(t)
    },
  }
}
