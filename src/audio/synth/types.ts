import type { QualityTier } from '@/core/types'
import type { Synth } from './core'

/** Per-play parameters for a one-shot. */
export interface SfxParams {
  /** Pitch / speed multiplier (1 = nominal). */
  rate: number
}

/**
 * One-shot builder: creates nodes on `s`, connects them into `out` (the
 * voice's output gain), schedules everything from time `t` and returns the
 * absolute time at which the sound is silent.
 */
export type SfxFn = (s: Synth, out: AudioNode, t: number, p: SfxParams) => number

export interface SfxMeta {
  /** Target peak (dBFS) of the voice output at volume 1, before buses. */
  peakDb: number
  /** Minimum seconds between two plays of this name (rate limit). */
  minInterval: number
  /** Max simultaneous voices of this name. */
  maxVoices: number
  /** At maxVoices: steal the oldest same-name voice, or drop the new one. */
  onLimit: 'steal' | 'reject'
  /** Distance where attenuation begins (m). */
  ref: number
  rolloff: number
  /** Beyond this distance the one-shot is not started at all (m). */
  max: number
  /** Reverb send 0..1 (outdoor "yard" reverb). */
  reverb: number
  /** Importance multiplier for voice stealing (cues survive crowds). */
  priority: number
  /** Interface sound: UI bus, never ducked by panel focus. */
  ui?: boolean
}

/** Values every loop builder receives. */
export interface LoopParams {
  rate: number
  quality: QualityTier
  /** True when rendering in an OfflineAudioContext (no timers). */
  offline?: boolean
}

/** World state pushed to realized loops ~10×/s. */
export interface LoopEnv {
  /** Building interior the player is in (runtime.world.interior), or null outdoors. */
  interior: string | null
  /** Machinery power 0..1 (Night Shift blackout pulls it down). */
  power: number
}

export interface LoopVoice {
  /** Connect this into the emitter chain. */
  output: AudioNode
  setRate(rate: number, t: number): void
  update?(env: LoopEnv, t: number): void
  /** Stop all sources at time t (the engine fades the emitter gain first). */
  stop(t: number): void
}

export type LoopFn = (s: Synth, p: LoopParams) => LoopVoice

export interface LoopMeta {
  /** Linear level at volume 1. */
  level: number
  bus: 'sfx' | 'music' | 'ambience'
  ref: number
  rolloff: number
  /** Default maxDistance for positional instances (m). */
  max: number
  /** Max realized positional instances sharing this name (nearest win). */
  perName: number
  /** 0..1: how much this loop quiets during a power outage. */
  power: number
  /** Fade-in time constant when realized (s). */
  fadeIn: number
}
