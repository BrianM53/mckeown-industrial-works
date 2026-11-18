/**
 * "The forklift can never block a route" (spec §7/§11), as pure rules
 * (unit-tested):
 *  - unoccupied and parked in a building door span, or on a straight segment
 *    between linked nav waypoints, for > 30 s → returned to the bay;
 *  - unoccupied away from home for > 3 min → returned;
 *  - unoccupied and on its side for > 8 s → set back on its wheels in place.
 */
import type { Rect, Vec2 } from '@/core/types'
import { WAYPOINTS, ZONE_LIST, type ZoneId } from '@/world/layout'
import { HOME, ROUTE_GUARD } from '../constants'
import { footprintCorners, polygonOverlapsRect, polygonSegmentDistance, type Pose2 } from './geometry2d'
import { wrapAngle } from '@/core/math'

export interface DoorZone {
  id: ZoneId
  rect: Rect
}

/** Rect covering each building door opening plus room on both sides of the wall. */
export function buildDoorZones(outside: number = ROUTE_GUARD.doorOutside, inside: number = ROUTE_GUARD.doorInside): DoorZone[] {
  const out: DoorZone[] = []
  for (const z of ZONE_LIST) {
    const b = z.building
    if (!b) continue
    const f = b.footprint
    const [d0, d1] = b.doorSpan
    let rect: Rect
    switch (b.doorSide) {
      case 'E':
        rect = { minX: f.maxX - inside, maxX: f.maxX + outside, minZ: d0, maxZ: d1 }
        break
      case 'W':
        rect = { minX: f.minX - outside, maxX: f.minX + inside, minZ: d0, maxZ: d1 }
        break
      case 'N':
        rect = { minX: d0, maxX: d1, minZ: f.minZ - outside, maxZ: f.minZ + inside }
        break
      case 'S':
        rect = { minX: d0, maxX: d1, minZ: f.maxZ - inside, maxZ: f.maxZ + outside }
        break
    }
    out.push({ id: z.id, rect })
  }
  return out
}

export const DOOR_ZONES: DoorZone[] = buildDoorZones()

export interface Segment {
  id: string
  a: Vec2
  b: Vec2
}

/** Every straight segment between linked waypoints (each once). */
export function waypointSegments(): Segment[] {
  const out: Segment[] = []
  for (const w of Object.values(WAYPOINTS))
    for (const l of w.links) if (l > w.id) out.push({ id: `${w.id}->${l}`, a: w.position, b: WAYPOINTS[l].position })
  return out
}

export const WAYPOINT_SEGMENTS: Segment[] = waypointSegments()

export function isAtHome(pose: Pose2): boolean {
  return Math.hypot(pose.x - HOME.x, pose.z - HOME.z) <= ROUTE_GUARD.homeRadius && Math.abs(wrapAngle(pose.yaw - HOME.yaw)) <= ROUTE_GUARD.homeYaw
}

/** Door zone the footprint overlaps, or null. */
export function blockedDoor(pose: Pose2, zones: DoorZone[] = DOOR_ZONES): ZoneId | null {
  const poly = footprintCorners(pose)
  for (const d of zones) if (polygonOverlapsRect(poly, d.rect)) return d.id
  return null
}

/** Waypoint segment within `margin` of the footprint, or null. */
export function blockedSegment(pose: Pose2, margin: number = ROUTE_GUARD.waypointMargin, segs: Segment[] = WAYPOINT_SEGMENTS): string | null {
  const poly = footprintCorners(pose)
  for (const s of segs) if (polygonSegmentDistance(poly, s.a, s.b) < margin) return s.id
  return null
}

export type GuardAction = 'return' | 'upright' | null

export interface GuardInput extends Pose2 {
  occupied: boolean
  /** Not on its side / roof. */
  upright: boolean
}

export class RouteGuard {
  blockingFor = 0
  idleFor = 0
  overturnedFor = 0
  /** Why the last 'return' fired. */
  reason: 'door' | 'waypoint' | 'idle' | null = null
  private retry = 0
  private checkTimer = 0
  private blocking: 'door' | 'waypoint' | null = null

  constructor(private readonly cfg = ROUTE_GUARD) {}

  /**
   * Advance by dt. Geometry checks run at ~4 Hz (cheap but not free).
   * Returns an action at most once per trigger; the caller reports back with
   * `done()` (success) or `deferred()` (home spot occupied → retry later).
   */
  update(dt: number, s: GuardInput): GuardAction {
    if (!(dt > 0)) return null
    if (this.retry > 0) this.retry = Math.max(0, this.retry - dt)
    if (s.occupied || !Number.isFinite(s.x) || !Number.isFinite(s.z)) {
      this.reset()
      return null
    }
    if (!s.upright) {
      this.overturnedFor += dt
      if (this.overturnedFor >= this.cfg.overturnedAfter && this.retry <= 0) {
        this.overturnedFor = 0
        this.retry = this.cfg.retryAfter
        return 'upright'
      }
      return null
    }
    this.overturnedFor = 0
    if (isAtHome(s)) {
      this.blockingFor = 0
      this.idleFor = 0
      this.blocking = null
      return null
    }
    this.checkTimer -= dt
    if (this.checkTimer <= 0) {
      this.checkTimer = 0.25
      this.blocking = blockedDoor(s) ? 'door' : blockedSegment(s) ? 'waypoint' : null
    }
    this.blockingFor = this.blocking ? this.blockingFor + dt : 0
    this.idleFor += dt
    if (this.retry > 0) return null
    if (this.blocking && this.blockingFor >= this.cfg.blockingAfter) {
      this.reason = this.blocking
      // fire once, then back off until done() / the retry interval elapses
      this.retry = this.cfg.retryAfter
      return 'return'
    }
    if (this.idleFor >= this.cfg.idleAfter) {
      this.reason = 'idle'
      this.retry = this.cfg.retryAfter
      return 'return'
    }
    return null
  }

  /** The action was carried out. */
  done(): void {
    this.reset()
    this.retry = 0
  }

  /** The action could not run now (e.g. someone stands on the home spot): try again shortly. */
  deferred(): void {
    this.retry = this.cfg.retryAfter
  }

  reset(): void {
    this.blockingFor = 0
    this.idleFor = 0
    this.overturnedFor = 0
    this.blocking = null
    this.checkTimer = 0
  }
}
