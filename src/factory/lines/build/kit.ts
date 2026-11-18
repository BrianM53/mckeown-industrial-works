/**
 * Shared build/animate plumbing for the production-spine machine builders.
 * A builder adds static parts to the batches, moving parts to the skinned
 * batch (bones from the rig), lamps, belts and signs, and returns an Animator
 * that poses its bones / drives effects from the factory sim every frame.
 */
import type * as THREE from 'three'
import type { FactoryState } from '@/systems/factory'
import type { SfxName, Vec3 } from '@/core/types'
import type { PuffPool, SparkPool } from '../render/particles'
import type { LampSet } from '../render/lamps'
import type { GeoBatch } from './builder'
import type { Rig } from './rig'
import type { SignAtlas } from './signs'

/** Belt registry: each id scrolls independently (speed in m/s along its motion). */
export class BeltSet {
  private tiles: number[] = []
  private speeds: number[] = []
  private offsets: Float32Array | null = null

  /** Register a belt; `tile` = meters per texture repeat. Returns the belt id. */
  add(tile: number): number {
    this.tiles.push(tile)
    this.speeds.push(0)
    return this.tiles.length - 1
  }

  get count(): number {
    return this.tiles.length
  }

  bind(offsets: Float32Array): void {
    this.offsets = offsets
  }

  setSpeed(id: number, metersPerSecond: number): void {
    if (id >= 0 && id < this.speeds.length) this.speeds[id] = Number.isFinite(metersPerSecond) ? metersPerSecond : 0
  }

  speed(id: number): number {
    return this.speeds[id] ?? 0
  }

  /** Advance every belt's UV offset (wrapped to keep float precision). */
  advance(dt: number): void {
    const o = this.offsets
    if (!o) return
    for (let i = 0; i < this.tiles.length && i < o.length; i++) {
      let v = o[i] + (this.speeds[i] * dt) / this.tiles[i]
      v -= Math.floor(v)
      o[i] = v
    }
  }
}

export interface Kit {
  /** Extra detail (bolts, cables, small props) — off on the low tier. */
  detail: boolean
  /** Static machinery chunks (split for frustum culling). */
  west: GeoBatch
  east: GeoBatch
  center: GeoBatch
  /** Diagonal hazard-stripe surfaces (shared stripe material). */
  hazard: GeoBatch
  /** Glass panes (shared glass material). */
  glass: GeoBatch
  /** Conveyor surfaces (scrolling). */
  belt: GeoBatch
  belts: BeltSet
  /** Atlas-mapped sign quads. */
  sign: GeoBatch
  atlas: SignAtlas
  /** Moving machinery (rigid skinned to `rig`). */
  skin: GeoBatch
  /** Additive glows (rigid skinned to `rig`). */
  fx: GeoBatch
  rig: Rig
  lamps: LampSet
}

export interface Effects {
  sparks: SparkPool
  puffs: PuffPool
  lamps: LampSet
  belts: BeltSet
  rig: Rig
  /** Machine/sign glow channel multipliers (see CH). */
  chan: THREE.Vector3[]
  /** Additive FX channel multipliers (see FX). */
  fxChan: THREE.Vector3[]
  /** Particle emission multiplier for the current quality tier. */
  emit: number
  furnaceLight: THREE.PointLight | null
  weldLight: THREE.PointLight | null
  sfx(name: SfxName, position: Vec3, volume?: number): void
}

export interface Frame {
  /** Real frame delta (s, clamped). */
  dt: number
  /** Factory sim time (s). */
  t: number
  s: FactoryState
  reduced: boolean
  /** Electric power 0..1 (Night Shift dims electric lights, not hot metal). */
  power: number
  fx: Effects
}

export interface Animator {
  update(f: Frame): void
}

/** Stable pseudo-random in [0, 1) for emitters (no Math.random → reproducible screenshots). */
export class Jitter {
  private s: number
  constructor(seed: number) {
    this.s = (seed >>> 0) % 2147483647 || 1
  }
  next(): number {
    this.s = (this.s * 16807) % 2147483647
    return (this.s - 1) / 2147483646
  }
  /** Uniform in [-1, 1). */
  sym(): number {
    return this.next() * 2 - 1
  }
}

/** Accumulates fractional emissions: returns how many particles to emit this frame. */
export class Emitter {
  private acc = 0
  take(rate: number, dt: number): number {
    if (!(rate > 0) || !(dt > 0)) return 0
    this.acc += rate * dt
    const n = Math.floor(this.acc)
    this.acc -= n
    return Math.min(n, 24)
  }
}
