import type { RespawnReason, Vec3 } from './types'

/**
 * Service locator for cross-module COMMANDS. The owning module provides the
 * implementation on mount (`provideService`) and removes it on unmount.
 * Callers use `getService(name)?.method()` and must tolerate `undefined`
 * (module not loaded yet / failed to load / WebGL fallback mode).
 */

export interface PlayerService {
  /** Move the worker to (x, z) facing `yaw`. With fade: true, fades the screen out/in around the move. */
  teleport(x: number, z: number, yaw?: number, opts?: { fade?: boolean }): void
  /** Respawn at a checkpoint id from world/layout CHECKPOINTS. */
  respawn(checkpointId: string, reason: RespawnReason): void
  /**
   * Cartoon tackle: worker tumbles (from direction of `from`), screen fades,
   * worker respawns at the 'intake' checkpoint. Must complete in < 4 s.
   * Resolves when the player is back in control.
   */
  tackle(from: Vec3): Promise<void>
  /** Lock/unlock player movement (e.g. while seated in forklift or during cutscene). */
  setLocked(locked: boolean, reason: string): void
  /** Show/hide the on-foot worker model (hidden while driving). */
  setVisible(visible: boolean): void
}

export interface CameraService {
  /** Smoothly swing the camera behind the current target. */
  recenter(): void
  /** Follow the on-foot worker or the forklift (forklift = higher, wider chase cam). */
  follow(target: 'player' | 'forklift'): void
  /** Directly set orbit parameters (radians / meters). Values are clamped. */
  set(opts: { yaw?: number; pitch?: number; distance?: number; immediate?: boolean }): void
}

export interface ForkliftService {
  enter(): void
  exit(): void
  /** Put the forklift upright at the last safe position. */
  recover(): void
  isOccupied(): boolean
}

export interface ServiceMap {
  player: PlayerService
  camera: CameraService
  forklift: ForkliftService
}

const registry: Partial<ServiceMap> = {}

export function provideService<K extends keyof ServiceMap>(name: K, impl: ServiceMap[K]): () => void {
  registry[name] = impl
  return () => {
    if (registry[name] === impl) delete registry[name]
  }
}

export function getService<K extends keyof ServiceMap>(name: K): ServiceMap[K] | undefined {
  return registry[name]
}
