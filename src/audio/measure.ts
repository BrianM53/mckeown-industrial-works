import { createRng } from '@/core/rng'
import type { LoopName, SfxName } from '@/core/types'
import { crowdGain, crowdWeight, gainToDb, OCC_NONE, voiceLoudness, volumeToGain } from './logic'
import { createMixer, MIX, type Mixer } from './mixer'
import { Synth } from './synth/core'
import { LOOP_META, LOOP_NAMES } from './synth/loops'
import type { MusicVoice } from './synth/music'
import { bakeRadioTune } from './synth/radio'
import { SFX_LIBRARY, SFX_META, SFX_NAMES, sfxLevel } from './synth/sfx'
import { buildLoop, buildOneShot } from './voice'

/**
 * OFFLINE LEVEL MEASUREMENT (debug only; loaded on demand by
 * `__MIW__.audio.measure()`). Renders every sound with OfflineAudioContext
 * through the same voice / mixer code that plays live:
 *   - raw peak of each SFX function (calibrates RAW_PEAK → loudness normalization)
 *   - final peak / RMS at default settings through compressor + limiter
 *   - loops (RMS after fade-in), the generative music, and a worst-case stress
 *     mix (24 loud one-shots at once with every slider at max) that must stay
 *     below 0 dBFS after the limiter.
 */
const SR = 48000
/** Sounds start here so the compressor has settled (a fresh compressor needs ~100 ms). */
const T0 = 0.3
type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext

function Offline(): OfflineCtor {
  const g = globalThis as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor }
  const C = g.OfflineAudioContext ?? g.webkitOfflineAudioContext
  if (!C) throw new Error('OfflineAudioContext unavailable')
  return C
}

const db = (g: number) => Math.round(gainToDb(g) * 10) / 10

function stats(buf: AudioBuffer, from = 0, to = buf.duration): { peak: number; rms: number } {
  let peak = 0
  let sum = 0
  let n = 0
  const a = Math.max(0, Math.floor(from * buf.sampleRate))
  const b = Math.min(buf.length, Math.ceil(to * buf.sampleRate))
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c)
    for (let i = a; i < b; i++) {
      const v = d[i]
      const av = v < 0 ? -v : v
      if (av > peak) peak = av
      sum += v * v
      n++
    }
  }
  return { peak, rms: Math.sqrt(sum / Math.max(1, n)) }
}

function defaultMixer(oc: BaseAudioContext, o: { master?: number; sfx?: number; music?: number; dynamics?: boolean } = {}): Mixer {
  const mx = createMixer(oc, { reverb: true, master: volumeToGain(o.master ?? 0.8), dynamics: o.dynamics })
  const sfx = volumeToGain(o.sfx ?? 0.8)
  mx.sfx.gain.value = sfx
  mx.ui.gain.value = sfx
  mx.ambience.gain.value = sfx * MIX.ambienceRatio
  mx.music.gain.value = volumeToGain(o.music ?? 0.45)
  return mx
}

export interface SfxRow {
  name: SfxName
  seconds: number
  /** Median raw peak of the synth function at gain 1 (linear). */
  rawPeak: number
  targetDb: number
  /** Voice output peak at volume 1 (dBFS) with the current calibration. */
  voicePeakDb: number
  /** Final output (default sliders, through compressor + limiter). */
  peakDb: number
  rmsDb: number
}

async function rawPeak(name: SfxName, seed: number): Promise<{ peak: number; seconds: number }> {
  const oc = new (Offline())(1, Math.ceil(SR * 7.5), SR)
  const s = new Synth(oc, createRng(seed))
  const out = s.gain(1)
  out.connect(oc.destination)
  const end = SFX_LIBRARY[name](s, out, 0.01, { rate: 1 })
  const buf = await oc.startRendering()
  return { peak: stats(buf).peak, seconds: Math.round((end - 0.01) * 100) / 100 }
}

export async function measureSfx(names: SfxName[] = SFX_NAMES, seeds = 3): Promise<SfxRow[]> {
  const rows: SfxRow[] = []
  for (const name of names) {
    const peaks: number[] = []
    let seconds = 0
    for (let k = 0; k < seeds; k++) {
      const r = await rawPeak(name, 101 + k * 17)
      peaks.push(r.peak)
      seconds = Math.max(seconds, r.seconds)
    }
    peaks.sort((a, b) => a - b)
    const raw = peaks[Math.floor(peaks.length / 2)]
    const oc = new (Offline())(2, Math.ceil(SR * (T0 + seconds + 0.6)), SR)
    const mx = defaultMixer(oc)
    buildOneShot(
      oc,
      mx,
      { name, volume: 1, rate: 1, position: null, occlusion: OCC_NONE, panningModel: 'equalpower', wet: 1, rng: createRng(101) },
      T0,
    )
    const buf = await oc.startRendering()
    const st = stats(buf, T0, T0 + seconds + 0.05)
    rows.push({
      name,
      seconds,
      rawPeak: Math.round(raw * 10000) / 10000,
      targetDb: SFX_META[name].peakDb,
      voicePeakDb: db(raw * sfxLevel(name)),
      peakDb: db(st.peak),
      rmsDb: db(st.rms),
    })
  }
  return rows
}

export interface LoopRow {
  name: LoopName
  peakDb: number
  rmsDb: number
}

export async function measureLoops(names: LoopName[] = LOOP_NAMES.filter((n) => n !== 'music'), seconds = 5): Promise<LoopRow[]> {
  const rows: LoopRow[] = []
  for (const name of names) {
    const oc = new (Offline())(2, Math.ceil(SR * seconds), SR)
    const mx = defaultMixer(oc)
    if (name === 'radio-music') await bakeRadioTune(oc)
    const meta = LOOP_META[name]
    const positional = meta.bus === 'sfx'
    const b = buildLoop(oc, mx, {
      name,
      rate: 1,
      quality: 'medium',
      // listener at the origin facing -Z; emitter at its reference distance in front
      position: positional ? [0, 0, -meta.ref] : null,
      ref: meta.ref,
      rolloff: meta.rolloff,
      maxDistance: meta.max,
      panningModel: 'equalpower',
      rng: createRng(5),
      offline: true,
    })
    b.gain.gain.value = meta.level
    b.voice.update?.({ interior: null, power: 1 }, 0)
    await Promise.resolve()
    await Promise.resolve()
    const buf = await oc.startRendering()
    const st = stats(buf, 1.5, seconds)
    rows.push({ name, peakDb: db(st.peak), rmsDb: db(st.rms) })
  }
  return rows
}

export async function measureMusic(bars = 12): Promise<{ seconds: number; peakDb: number; rmsDb: number; rawPeakDb: number }> {
  const seconds = (bars * 4 * 60) / 94 + 1
  const render = async (dynamics: boolean) => {
    const oc = new (Offline())(2, Math.ceil(SR * seconds), SR)
    const mx = defaultMixer(oc, { dynamics })
    const b = buildLoop(oc, mx, {
      name: 'music',
      rate: 1,
      quality: 'medium',
      position: null,
      ref: 4,
      rolloff: 1,
      maxDistance: 45,
      panningModel: 'equalpower',
      rng: createRng(3),
      offline: true,
    })
    b.gain.gain.value = LOOP_META.music.level
    ;(b.voice as MusicVoice).pump(seconds)
    return stats(await oc.startRendering(), 4, seconds)
  }
  const fin = await render(true)
  const raw = await render(false)
  return { seconds: Math.round(seconds), peakDb: db(fin.peak), rmsDb: db(fin.rms), rawPeakDb: db(raw.peak) }
}

const STRESS: SfxName[] = [
  'explosion',
  'liftoff-roar',
  'ignition',
  'press-thump',
  'press-thump',
  'press-thump',
  'forklift-impact',
  'forklift-impact',
  'tackle-thud',
  'whistle',
  'alarm',
  'big-button',
  'machine-kick',
  'print-stamp',
  'crate-bump',
  'breakup-clank',
  'goal-horn',
  'forklift-horn',
  'power-down',
  'pa-chime',
  'cheer',
  'boing',
  'machine-clank',
  'steam-hiss',
]

/**
 * Worst case: 24 loud one-shots within 0.1 s, every slider at max, all at
 * the listener. `preLimiterPeakDb` / `peakDb`: no voice caps and no crowd gain
 * (pessimistic). `enginePeakDb`: with the crowd normalization the engine applies
 * to the one-shot bus (what a visitor could actually hear). Both must stay < 0 dBFS.
 */
export async function measureStress(): Promise<{ voices: number; preLimiterPeakDb: number; peakDb: number; crowdGainDb: number; enginePeakDb: number }> {
  let crowd = 0
  for (const name of STRESS) crowd += crowdWeight(voiceLoudness(SFX_META[name].peakDb, 1, 1, 1))
  const shots = crowdGain(crowd)
  const render = async (dynamics: boolean, shotsGain: number) => {
    const oc = new (Offline())(2, Math.ceil(SR * (T0 + 7.5)), SR)
    const mx = defaultMixer(oc, { master: 1, sfx: 1, music: 1, dynamics })
    mx.shots.gain.value = shotsGain
    STRESS.forEach((name, i) =>
      buildOneShot(
        oc,
        mx,
        { name, volume: 1, rate: 1, position: null, occlusion: OCC_NONE, panningModel: 'equalpower', wet: 1, rng: createRng(900 + i) },
        T0 + i * 0.004,
      ),
    )
    return stats(await oc.startRendering())
  }
  const pre = await render(false, 1)
  const post = await render(true, 1)
  const engine = await render(true, shots)
  return { voices: STRESS.length, preLimiterPeakDb: db(pre.peak), peakDb: db(post.peak), crowdGainDb: db(shots), enginePeakDb: db(engine.peak) }
}

export async function runMeasurement(what = 'all'): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  if (what === 'all' || what === 'sfx') {
    const rows = await measureSfx()
    out.sfx = rows
    out.rawPeakTable = Object.fromEntries(rows.map((r) => [r.name, r.rawPeak]))
  }
  if (what === 'all' || what === 'loops') out.loops = await measureLoops()
  if (what === 'all' || what === 'music') out.music = await measureMusic()
  if (what === 'all' || what === 'stress') out.stress = await measureStress()
  return out
}
