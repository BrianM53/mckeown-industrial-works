import type { Rng } from '@/core/rng'
import type { LoopName, QualityTier, SfxName, Vec3 } from '@/core/types'
import type { Occlusion } from './logic'
import type { Mixer } from './mixer'
import { Synth } from './synth/core'
import { LOOP_LIBRARY, LOOP_META } from './synth/loops'
import { SFX_LIBRARY, SFX_META, sfxLevel } from './synth/sfx'
import type { LoopVoice, SfxFn } from './synth/types'

/**
 * Voice / emitter chain builders shared by the engine and the offline
 * measurement tool, so what we measure is exactly what plays.
 */

export function createPanner(
  s: Synth,
  model: PanningModelType,
  pos: Vec3,
  ref: number,
  rolloff: number,
  maxDistance: number,
): PannerNode {
  const p = s.adopt(s.ctx.createPanner())
  p.panningModel = model
  p.distanceModel = 'inverse'
  p.refDistance = ref
  p.rolloffFactor = rolloff
  p.maxDistance = Math.max(maxDistance, ref + 1)
  p.coneInnerAngle = 360
  p.coneOuterAngle = 360
  p.coneOuterGain = 1
  placePanner(p, pos[0], pos[1], pos[2], 0, null)
  return p
}

/**
 * Move a panner. With `ctxTime` (and a running context) the move is smoothed
 * over ~40 ms; otherwise it is set immediately.
 */
export function placePanner(p: PannerNode, x: number, y: number, z: number, smooth: number, ctxTime: number | null): void {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return
  if (p.positionX) {
    if (ctxTime !== null && smooth > 0) {
      p.positionX.setTargetAtTime(x, ctxTime, smooth)
      p.positionY.setTargetAtTime(y, ctxTime, smooth)
      p.positionZ.setTargetAtTime(z, ctxTime, smooth)
    } else {
      p.positionX.value = x
      p.positionY.value = y
      p.positionZ.value = z
    }
  } else {
    ;(p as PannerNode & { setPosition(x: number, y: number, z: number): void }).setPosition(x, y, z)
  }
}

export interface OneShotSpec {
  name: SfxName
  volume: number
  rate: number
  /** null = non-positional (head-locked). */
  position: Vec3 | null
  occlusion: Occlusion
  panningModel: PanningModelType
  /** Reverb send scale (distant sounds are wetter). */
  wet: number
  rng: Rng
}

export interface BuiltVoice {
  synth: Synth
  out: GainNode
  /** Absolute context time when the voice is silent. */
  end: number
}

/** Build and schedule one SFX at time t. Returns null for unknown names. */
export function buildOneShot(ctx: BaseAudioContext, mixer: Mixer, spec: OneShotSpec, t: number): BuiltVoice | null {
  const fn = (SFX_LIBRARY as Record<string, SfxFn | undefined>)[spec.name]
  const meta = SFX_META[spec.name]
  if (!fn || !meta) return null
  const s = new Synth(ctx, spec.rng)
  const out = s.gain(sfxLevel(spec.name) * spec.volume * spec.occlusion.gain)
  let tail: AudioNode = out
  if (spec.occlusion.cutoff < 15000) {
    const f = s.lp(spec.occlusion.cutoff, 0.7)
    tail.connect(f)
    tail = f
  }
  if (spec.position) {
    const p = createPanner(s, spec.panningModel, spec.position, meta.ref, meta.rolloff, meta.max)
    tail.connect(p)
    tail = p
  }
  tail.connect(meta.ui ? mixer.ui : mixer.shots)
  if (meta.reverb > 0 && mixer.reverbIn && spec.wet > 0) {
    const send = s.gain(meta.reverb * spec.wet)
    out.connect(send).connect(mixer.reverbIn)
  }
  let end: number
  try {
    end = fn(s, out, t, { rate: spec.rate })
  } catch (err) {
    s.stopAll(t)
    s.dispose()
    throw err
  }
  if (!Number.isFinite(end) || end < t) end = t + 1
  return { synth: s, out, end }
}

export interface LoopSpec {
  name: LoopName
  rate: number
  quality: QualityTier
  position: Vec3 | null
  ref: number
  rolloff: number
  maxDistance: number
  panningModel: PanningModelType
  rng: Rng
  offline?: boolean
}

export interface BuiltLoop {
  synth: Synth
  voice: LoopVoice
  /** Emitter gain (volume × level × fades); starts at 0. */
  gain: GainNode
  /** Occlusion lowpass (positional only). */
  occ: BiquadFilterNode | null
  panner: PannerNode | null
}

export function buildLoop(ctx: BaseAudioContext, mixer: Mixer, spec: LoopSpec): BuiltLoop {
  const meta = LOOP_META[spec.name]
  const s = new Synth(ctx, spec.rng)
  let voice: LoopVoice
  try {
    voice = LOOP_LIBRARY[spec.name](s, { rate: spec.rate, quality: spec.quality, offline: spec.offline })
  } catch (err) {
    s.stopAll(ctx.currentTime)
    s.dispose()
    throw err
  }
  const gain = s.gain(0)
  voice.output.connect(gain)
  let tail: AudioNode = gain
  let occ: BiquadFilterNode | null = null
  let panner: PannerNode | null = null
  if (spec.position) {
    occ = s.lp(22000, 0.7)
    tail.connect(occ)
    tail = occ
    panner = createPanner(s, spec.panningModel, spec.position, spec.ref, spec.rolloff, spec.maxDistance)
    tail.connect(panner)
    tail = panner
  }
  tail.connect(mixer.input(meta.bus))
  return { synth: s, voice, gain, occ, panner }
}
