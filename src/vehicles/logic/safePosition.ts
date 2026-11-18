/**
 * Last-safe-position tracking for forklift recovery (unit-tested).
 *
 * The physics step offers a sample about once per second; the tracker keeps a
 * short history of places where the forklift was upright, on the ground,
 * inside the playable area, outside every restricted zone and not wedged into
 * static geometry. Recovery tries the newest first.
 */
import type { Rect } from '@/core/types'
import { PLAYABLE_BOUNDS, RESTRICTED_ZONES, type RestrictedZoneDef } from '@/world/layout'
import { RECOVERY } from '../constants'
import { footprintCorners, pointInPolygon, polygonOverlapsRect, rectContains, type Footprint, type Pose2, FORKLIFT_FOOTPRINT } from './geometry2d'

export interface SafeSample extends Pose2 {
  /** Sample time (seconds, tracker clock). */
  t: number
}

/** Does the oriented footprint touch a restricted zone? */
export function footprintInRestricted(pose: Pose2, fp: Footprint = FORKLIFT_FOOTPRINT, zones: RestrictedZoneDef[] = RESTRICTED_ZONES): boolean {
  const poly = footprintCorners(pose, fp, 0.2)
  for (const r of zones) {
    if (r.shape.kind === 'rect') {
      if (polygonOverlapsRect(poly, r.shape.rect)) return true
    } else {
      const [cx, cz] = r.shape.center
      const rad = r.shape.radius
      if (pointInPolygon(cx, cz, poly)) return true
      for (const [x, z] of poly) if (Math.hypot(x - cx, z - cz) <= rad) return true
      // edge midpoints catch a long side brushing the circle
      for (let i = 0; i < poly.length; i++) {
        const [ax, az] = poly[i]
        const [bx, bz] = poly[(i + 1) % poly.length]
        if (Math.hypot((ax + bx) / 2 - cx, (az + bz) / 2 - cz) <= rad) return true
      }
    }
  }
  return false
}

/** Whole footprint inside the playable rectangle (with a margin). */
export function footprintInBounds(pose: Pose2, fp: Footprint = FORKLIFT_FOOTPRINT, bounds: Rect = PLAYABLE_BOUNDS, margin = 0.3): boolean {
  for (const [x, z] of footprintCorners(pose, fp)) {
    if (!rectContains({ minX: bounds.minX + margin, maxX: bounds.maxX - margin, minZ: bounds.minZ + margin, maxZ: bounds.maxZ - margin }, x, z)) return false
  }
  return true
}

/** Static rules for a safe forklift pose (the physics overlap test is separate). */
export function isSafePose(pose: Pose2): boolean {
  if (!Number.isFinite(pose.x) || !Number.isFinite(pose.z) || !Number.isFinite(pose.yaw)) return false
  return footprintInBounds(pose) && !footprintInRestricted(pose)
}

export class SafePositionTracker {
  private list: SafeSample[] = []
  private timer = 0
  private clock = 0

  constructor(
    private readonly interval: number = RECOVERY.safeInterval,
    private readonly capacity: number = RECOVERY.safeCapacity,
    /** Samples closer than this to the newest one just refresh it. */
    private readonly minSpacing = 0.75,
  ) {}

  /** Advance; every `interval` seconds `sample()` is asked for a validated pose (or null). */
  update(dt: number, sample: () => Pose2 | null): void {
    if (!(dt > 0)) return
    this.clock += dt
    this.timer += dt
    if (this.timer < this.interval) return
    this.timer = 0
    let p: Pose2 | null = null
    try {
      p = sample()
    } catch {
      p = null
    }
    if (!p || !isSafePose(p)) return
    this.record(p)
  }

  record(p: Pose2): void {
    const s: SafeSample = { x: p.x, z: p.z, yaw: p.yaw, t: this.clock }
    const last = this.list[0]
    if (last && Math.hypot(last.x - s.x, last.z - s.z) < this.minSpacing) {
      this.list[0] = s
      return
    }
    this.list.unshift(s)
    if (this.list.length > this.capacity) this.list.length = this.capacity
  }

  latest(): SafeSample | null {
    return this.list[0] ?? null
  }

  /** Newest first. */
  candidates(): SafeSample[] {
    return [...this.list]
  }

  get size(): number {
    return this.list.length
  }

  clear(): void {
    this.list = []
    this.timer = 0
  }
}
