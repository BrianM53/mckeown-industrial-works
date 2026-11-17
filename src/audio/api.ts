import type { LoopName, SfxName, Vec3 } from '@/core/types'

/**
 * AUDIO API CONTRACT. Any module may call `audio.play/loop/duck` (or emit the
 * 'sfx' event). The audio module installs the real engine with `setAudioImpl`;
 * until then (and whenever sound is muted / not consented) calls are no-ops.
 *
 * Loop handles returned before the engine starts MUST keep working: the real
 * implementation re-binds pending handles when the AudioContext starts.
 */
export interface LoopOptions {
  /** World position for a positional (3D) emitter; omit for non-positional. */
  position?: Vec3
  volume?: number
  rate?: number
  /** Distance at which attenuation begins (m). Default ~4. */
  refDistance?: number
  /** Beyond this distance the emitter is inaudible/culled (m). Default ~35. */
  maxDistance?: number
}

export interface LoopHandle {
  setVolume(v: number): void
  setRate(r: number): void
  setPosition(x: number, y: number, z: number): void
  stop(): void
}

export interface PlayOptions {
  position?: Vec3
  volume?: number
  rate?: number
}

export interface AudioApi {
  play(name: SfxName, opts?: PlayOptions): void
  loop(name: LoopName, opts?: LoopOptions): LoopHandle
  /** Lower the music bus by `amount` (0..1) for `seconds`, then restore. */
  duck(amount: number, seconds: number): void
  /** True when sound is audible (consented, unmuted, context running). */
  isActive(): boolean
}

const noopHandle: LoopHandle = { setVolume() {}, setRate() {}, setPosition() {}, stop() {} }

const noop: AudioApi = {
  play() {},
  loop() {
    return noopHandle
  },
  duck() {},
  isActive() {
    return false
  },
}

let impl: AudioApi = noop

export function setAudioImpl(next: AudioApi | null): void {
  impl = next ?? noop
}

export const audio: AudioApi = {
  play: (name, opts) => impl.play(name, opts),
  loop: (name, opts) => impl.loop(name, opts),
  duck: (amount, seconds) => impl.duck(amount, seconds),
  isActive: () => impl.isActive(),
}
