import { impulse, softClipCurve } from './synth/buffers'

/**
 * MIXER GRAPH
 *
 *   one-shot voices ─▶ shots (crowd normalization) ─┐
 *   positional/world loops ─────────────────────────┼▶ sfx (sfxVolume) ─┐
 *   reverb sends ─▶ yard reverb ─▶ reverbReturn ────┘                   │
 *   ambience loop ─▶ ambienceDuck ─▶ ambience (sfxVolume × ratio) ──────┼▶ world (panel focus) ─┐
 *   music loop ─▶ musicDuck ─▶ music (musicVolume) ─────────────────────┘                      │
 *   UI one-shots ─▶ ui (sfxVolume) ─────────────────────────────────────────────────────────────┼▶ master
 *                     DynamicsCompressor (gentle) ◀── master (masterVolume × mute) ◀─────────────┘
 *                            └▶ WaveShaper soft-clip ceiling (|out| ≤ 0.95) ─▶ destination
 *
 * The soft clipper is a safety net: it is linear below 0.8 so normal mixes
 * pass untouched, and its curve can never output beyond ~−0.5 dBFS.
 */
export const MIX = {
  /** Ambience follows the SFX slider at this lower level. */
  ambienceRatio: 0.55,
  compressor: { threshold: -8, knee: 8, ratio: 6, attack: 0.003, release: 0.25 },
  limiter: { knee: 0.8, ceiling: 0.97 },
  reverbReturn: 0.5,
} as const

export type BusName = 'sfx' | 'music' | 'ambience'

export interface Mixer {
  master: GainNode
  shots: GainNode
  sfx: GainNode
  ambienceDuck: GainNode
  ambience: GainNode
  musicDuck: GainNode
  music: GainNode
  /** Everything except UI sounds; lowered while a portfolio panel is open. */
  world: GainNode
  /** UI one-shots (panel open/close, clicks, achievement chime). */
  ui: GainNode
  /** Sfx reverb send input (null on the low quality tier). */
  reverbIn: GainNode | null
  input(bus: BusName): AudioNode
  /** Assign the reverb impulse now (when created with deferReverb). Idempotent. */
  attachReverb(): void
  dispose(): void
}

export interface MixerOptions {
  reverb: boolean
  /** false = skip compressor + limiter (measurement of the raw mix). */
  dynamics?: boolean
  /** Initial master gain (the engine fades it in). */
  master?: number
  /** Leave the convolver empty until attachReverb() (keeps the Sound-button click cheap). */
  deferReverb?: boolean
}

export function createMixer(ctx: BaseAudioContext, o: MixerOptions): Mixer {
  const nodes: AudioNode[] = []
  const gain = (v: number) => {
    const g = ctx.createGain()
    g.gain.value = v
    nodes.push(g)
    return g
  }
  const master = gain(o.master ?? 0)
  const shots = gain(1)
  const sfx = gain(1)
  const ambienceDuck = gain(1)
  const ambience = gain(1)
  const musicDuck = gain(1)
  const music = gain(1)
  const world = gain(1)
  const ui = gain(1)

  shots.connect(sfx)
  sfx.connect(world)
  ambienceDuck.connect(ambience).connect(world)
  musicDuck.connect(music).connect(world)
  world.connect(master)
  ui.connect(master)

  let reverbIn: GainNode | null = null
  let conv: ConvolverNode | null = null
  let attached = false
  const attachReverb = () => {
    if (!conv || attached) return
    attached = true
    try {
      conv.buffer = impulse(ctx, 'yard')
    } catch {
      /* reverb is optional */
    }
  }
  if (o.reverb) {
    reverbIn = gain(1)
    conv = ctx.createConvolver()
    nodes.push(conv)
    const ret = gain(MIX.reverbReturn)
    reverbIn.connect(conv).connect(ret).connect(sfx)
    if (!o.deferReverb) attachReverb()
  }

  if (o.dynamics === false) {
    master.connect(ctx.destination)
  } else {
    const comp = ctx.createDynamicsCompressor()
    const c = MIX.compressor
    comp.threshold.value = c.threshold
    comp.knee.value = c.knee
    comp.ratio.value = c.ratio
    comp.attack.value = c.attack
    comp.release.value = c.release
    nodes.push(comp)
    const clip = ctx.createWaveShaper()
    clip.curve = softClipCurve(MIX.limiter.knee, MIX.limiter.ceiling) as Float32Array<ArrayBuffer>
    clip.oversample = 'none'
    nodes.push(clip)
    master.connect(comp).connect(clip).connect(ctx.destination)
  }

  return {
    master,
    shots,
    sfx,
    ambienceDuck,
    ambience,
    musicDuck,
    music,
    world,
    ui,
    reverbIn,
    input(bus) {
      return bus === 'music' ? musicDuck : bus === 'ambience' ? ambienceDuck : sfx
    },
    attachReverb,
    dispose() {
      for (const n of nodes) {
        try {
          n.disconnect()
        } catch {
          /* ignore */
        }
      }
      nodes.length = 0
    },
  }
}
