import type { LoopName, SfxName, Vec3 } from '@/core/types'

/**
 * AUDIO API CONTRACT. Any module may call `audio.play/loop/duck` (or emit the
 * 'sfx' event). The audio module installs the real engine with `setAudioImpl`;
 * until then (and whenever sound is muted / not consented) calls are no-ops.
 *
 * Loop handles returned before the engine starts MUST keep working: the real
 * implementation re-binds pending handles when the AudioContext starts.
 * (Implemented here: every handle is a small proxy that remembers its latest
 * volume / rate / position and re-binds whenever an engine is installed.)
 *
 * Conventions:
 *   - Unknown names are ignored. Invalid numbers (NaN) are ignored or clamped.
 *   - `rate` is a pitch/speed multiplier (1 = nominal). For 'forklift-engine'
 *     use setRate(1) at idle up to ~2.5 at full throttle; for 'belt-clatter'
 *     it is the conveyor speed.
 *   - Positional sounds take world coordinates [x, y, z] (meters, Y up).
 *     setPosition on a loop created without a position is ignored.
 */
export interface LoopOptions {
  /** World position for a positional (3D) emitter; omit for non-positional. */
  position?: Vec3
  volume?: number
  rate?: number
  /** Distance at which attenuation begins (m). Default ~4 (per sound). */
  refDistance?: number
  /** Beyond this distance the emitter is inaudible/culled (m). Default ~45 (per sound). */
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

/** Live (not stopped) loop handles, re-bound whenever the implementation changes. */
const live = new Set<DeferredLoop>()

class DeferredLoop implements LoopHandle {
  private real: LoopHandle | null = null
  private stopped = false
  private readonly opts: LoopOptions
  private readonly positional: boolean

  constructor(
    private readonly name: LoopName,
    opts: LoopOptions | undefined,
  ) {
    this.opts = { ...opts }
    this.positional = !!opts?.position
    if (opts?.position) this.opts.position = [opts.position[0], opts.position[1], opts.position[2]]
  }

  bind(target: AudioApi | null): void {
    const prev = this.real
    this.real = null
    if (prev) safe(() => prev.stop())
    if (this.stopped || !target) return
    const opts: LoopOptions = { ...this.opts }
    if (this.opts.position) opts.position = [this.opts.position[0], this.opts.position[1], this.opts.position[2]]
    this.real = safe(() => target.loop(this.name, opts)) ?? null
  }

  setVolume(v: number): void {
    if (this.stopped) return
    this.opts.volume = v
    const r = this.real
    if (r) safe(() => r.setVolume(v))
  }

  setRate(rate: number): void {
    if (this.stopped) return
    this.opts.rate = rate
    const r = this.real
    if (r) safe(() => r.setRate(rate))
  }

  setPosition(x: number, y: number, z: number): void {
    if (this.stopped || !this.positional) return
    const p = this.opts.position!
    p[0] = x
    p[1] = y
    p[2] = z
    const r = this.real
    if (r) safe(() => r.setPosition(x, y, z))
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    live.delete(this)
    const r = this.real
    this.real = null
    if (r) safe(() => r.stop())
  }
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn()
  } catch (err) {
    console.warn('[audio] call failed', err)
    return undefined
  }
}

export function setAudioImpl(next: AudioApi | null): void {
  const target = next ?? noop
  if (target === impl) return
  impl = target
  const bindTo = impl === noop ? null : impl
  for (const h of [...live]) h.bind(bindTo)
}

/** Uninstall `expected` only if it is still the installed implementation (HMR/StrictMode safe). */
export function clearAudioImpl(expected: AudioApi): void {
  if (impl === expected) setAudioImpl(null)
}

/** Number of live loop handles (leak tests / debug). */
export function liveLoopCount(): number {
  return live.size
}

export const audio: AudioApi = {
  play: (name, opts) => impl.play(name, opts),
  loop: (name, opts) => {
    const h = new DeferredLoop(name, opts)
    live.add(h)
    h.bind(impl === noop ? null : impl)
    return h
  },
  duck: (amount, seconds) => impl.duck(amount, seconds),
  isActive: () => impl.isActive(),
}
