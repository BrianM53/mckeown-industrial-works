/**
 * The safety inspector's ROUTINE (pure logic, no React/three): patrol loop with
 * clipboard stops at each restricted zone, NPC-mishap investigations
 * ('gag:start'), short "holds" (point + head shake at a warned visitor), and
 * polite yielding around the visitor. The OSHA FSM (oshaFsm.ts) pauses the brain
 * while it runs the chase/tackle and resumes it afterwards.
 *
 * The brain writes an `InspectorActor` that the 3D component renders every frame.
 */
import type { Vec2 } from '@/core/types'
import { clamp, dampAngle, wrapAngle, yawFromDirection, yawToward } from '@/core/math'
import { RESTRICTED_ZONES, WAYPOINTS } from '@/world/layout'
import { nearestWaypoint, shortestPath } from '@/world/nav'
import type { WorkerAnim } from '@/world/WorkerModel'
import { HEAD_SHAKE, PATROL, PATROL_ROUTE, type RoutePoint } from './config'
import { zoneSignedDistance } from './zones'

export type BurstKind = 'tweet' | 'whump'

/** Everything the renderer needs about the inspector, updated in place. */
export interface InspectorActor {
  x: number
  z: number
  /** Body yaw (forward = (-sin, 0, -cos)). */
  yaw: number
  anim: WorkerAnim
  /** Ground speed driving the gait (m/s). */
  speed: number
  /** 1 = standing on the floor; < 1 while climbing out of a hatch (0 = fully below). */
  rise: number
  /** Head glance relative to the body (rad), or null. */
  look: number | null
  /** The blocking capsule may be enabled (never while overlapping the visitor). */
  collidable: boolean
  /** Comic text burst over his head and seconds since it started. */
  burst: BurstKind | null
  burstT: number
  /** Sprinting: kick up dust. */
  dust: boolean
}

export function createActor(x: number, z: number, yaw = 0): InspectorActor {
  return { x, z, yaw, anim: 'idle', speed: 0, rise: 1, look: null, collidable: false, burst: null, burstT: 0, dust: false }
}

export interface BrainDeps {
  /** Visitor feet position (for yielding / side-eye); null when unknown. */
  player?: () => { x: number; z: number } | null
  route?: RoutePoint[]
}

interface Hold {
  until: number
  face: () => { x: number; z: number } | null
  anim: WorkerAnim
  shake: boolean
  start: number
}

interface Investigation {
  id: string
  x: number
  z: number
  phase: 'walk' | 'scribble'
  startedAt: number
  phaseAt: number
}

export type BrainMode = 'paused' | 'hold' | 'investigate' | 'stop' | 'path' | 'route' | 'yield'

const SIDE_EYE_RADIUS = 6
/** Keep off-graph walking legs at least this far outside every restricted zone (m). */
const ZONE_CLEARANCE = 0.6

/** True when the straight leg a→b keeps clear of every restricted zone (sampled every 0.4 m). */
export function legClearOfZones(a: Vec2, b: Vec2): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.4))
  for (let i = 0; i <= n; i++) {
    const u = i / n
    const x = a[0] + (b[0] - a[0]) * u
    const z = a[1] + (b[1] - a[1]) * u
    for (const zone of RESTRICTED_ZONES) if (zoneSignedDistance(zone, x, z) < ZONE_CLEARANCE) return false
  }
  return true
}

export class InspectorBrain {
  readonly actor: InspectorActor
  private readonly deps: BrainDeps
  private readonly route: RoutePoint[]
  private routeIndex = 0
  private path: Vec2[] = []
  private pathIndex = 0
  /** Seconds into the current route stop, or -1 when not stopped. */
  private stopT = -1
  private paused = false
  private holdState: Hold | null = null
  private inv: Investigation | null = null
  private lastInvestigateAt = -Infinity
  private yieldT = 0
  private yielding = false
  private colliderOn = false
  private t = 0

  constructor(actor: InspectorActor, deps: BrainDeps = {}) {
    this.actor = actor
    this.deps = deps
    this.route = deps.route && deps.route.length ? deps.route : PATROL_ROUTE
    this.placeAtRouteStart()
  }

  /** Current activity (debug/tests). */
  get mode(): BrainMode {
    if (this.paused) return 'paused'
    if (this.holdState) return 'hold'
    if (this.inv) return 'investigate'
    if (this.stopT >= 0) return 'stop'
    if (this.yielding) return 'yield'
    if (this.pathIndex < this.path.length) return 'path'
    return 'route'
  }

  get investigating(): string | null {
    return this.inv?.id ?? null
  }

  get routeTargetId(): string {
    return this.route[this.routeIndex]?.id ?? ''
  }

  /** Teleport back to the first route point (start-up / NaN recovery). */
  placeAtRouteStart(): void {
    const a = this.actor
    const p0 = this.route[0].p
    const p1 = this.route[1 % this.route.length].p
    a.x = p0[0]
    a.z = p0[1]
    a.yaw = yawFromDirection(p1[0] - p0[0], p1[1] - p0[1])
    a.anim = 'idle'
    a.speed = 0
    a.rise = 1
    a.look = null
    this.routeIndex = 1 % this.route.length
    this.path = []
    this.pathIndex = 0
    this.stopT = -1
    this.inv = null
    this.holdState = null
  }

  /** Hand control to someone else (the chase). Cancels stops and investigations. */
  pause(): void {
    this.paused = true
    this.holdState = null
    this.inv = null
    this.stopT = -1
    this.yieldT = 0
    this.yielding = false
    this.colliderOn = false
    this.actor.collidable = false
  }

  /**
   * Take control back: walk through `points` (e.g. back to the hatch he came
   * from), then along the waypoint graph to the nearest patrol waypoint, and
   * carry on with the loop from there.
   */
  resumeVia(points: Vec2[]): void {
    const a = this.actor
    const valid = points.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
    const from: Vec2 = valid.length ? valid[valid.length - 1] : [a.x, a.z]
    const ri = this.nearestRouteIndex(from[0], from[1])
    const rp = this.route[ri]
    let tail: Vec2[] = [rp.p]
    if (WAYPOINTS[rp.id]) {
      const wp = nearestWaypoint(from[0], from[1])
      const ids = shortestPath(wp.id, rp.id)
      if (ids.length) tail = ids.map((id) => WAYPOINTS[id].position)
    }
    this.path = dedupe([...valid, ...tail], [a.x, a.z])
    this.pathIndex = 0
    this.routeIndex = ri
    this.stopT = -1
    this.paused = false
    this.holdState = null
    this.inv = null
    this.yieldT = 0
    this.yielding = false
  }

  /** Stand still for `seconds`, facing `face()`, doing `anim` (optionally shaking the head). */
  hold(seconds: number, face: () => { x: number; z: number } | null, anim: WorkerAnim, shake = false): void {
    if (this.paused) return
    this.holdState = { until: this.t + Math.max(0, seconds), face, anim, shake, start: this.t }
  }

  /** Walk over to an NPC mishap and write it up. Returns false when ignored. */
  investigate(id: string, x: number, z: number): boolean {
    if (this.paused || this.holdState || this.inv) return false
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false
    if (this.t - this.lastInvestigateAt < PATROL.investigateInterval) return false
    const a = this.actor
    if (Math.hypot(x - a.x, z - a.z) > PATROL.investigateRadius) return false
    const from = nearestWaypoint(a.x, a.z)
    const to = nearestWaypoint(x, z)
    const ids = shortestPath(from.id, to.id)
    if (!ids.length) return false
    const pts: Vec2[] = ids.map((wid) => WAYPOINTS[wid].position)
    const last = pts[pts.length - 1]
    const ax = x - last[0]
    const az = z - last[1]
    const len = Math.hypot(ax, az)
    if (len > PATROL.approach) {
      // The last leg leaves the waypoint graph: never across (or into) a restricted zone.
      const end: Vec2 = [x - (ax / len) * PATROL.approach, z - (az / len) * PATROL.approach]
      if (legClearOfZones(last, end)) pts.push(end)
    }
    this.path = dedupe(pts, [a.x, a.z])
    this.pathIndex = 0
    this.stopT = -1
    this.inv = { id, x, z, phase: 'walk', startedAt: this.t, phaseAt: this.t }
    this.lastInvestigateAt = this.t
    return true
  }

  tick(dt: number): void {
    if (!(dt > 0)) return
    this.t += dt
    const a = this.actor
    if (this.paused) return
    a.dust = false
    this.yielding = false
    if (this.holdState) this.tickHold(dt)
    else if (this.inv && this.t - this.inv.startedAt > PATROL.investigateTimeout) this.endInvestigation()
    else if (this.inv?.phase === 'scribble') this.tickScribble(dt)
    else if (this.stopT >= 0) this.tickStop(dt)
    else this.tickWalk(dt)
    this.updateCollider()
  }

  // ------------------------------------------------------------------ internals

  private player(): { x: number; z: number } | null {
    const p = this.deps.player?.() ?? null
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return null
    return p
  }

  private glance(radius: number): number | null {
    const p = this.player()
    if (!p) return null
    const a = this.actor
    if (Math.hypot(p.x - a.x, p.z - a.z) > radius) return null
    return clamp(wrapAngle(yawToward(a, p) - a.yaw), -1.1, 1.1)
  }

  private tickHold(dt: number): void {
    const h = this.holdState!
    const a = this.actor
    const target = h.face()
    if (target && Number.isFinite(target.x) && Number.isFinite(target.z)) a.yaw = dampAngle(a.yaw, yawToward(a, target), 9, dt)
    a.anim = h.anim
    a.speed = 0
    const T = this.t - h.start
    a.look = h.shake && T > 0.2 ? Math.sin(T * Math.PI * 2 * HEAD_SHAKE.frequency) * HEAD_SHAKE.amplitude : null
    if (this.t >= h.until) {
      this.holdState = null
      a.look = null
    }
  }

  private tickScribble(dt: number): void {
    const inv = this.inv!
    const a = this.actor
    const T = this.t - inv.phaseAt
    a.yaw = dampAngle(a.yaw, yawToward(a, { x: inv.x, z: inv.z }), 6, dt)
    a.speed = 0
    a.anim = T < 0.4 ? 'idle' : T < PATROL.investigateScribble - 0.9 ? 'work' : 'point'
    a.look = null
    if (T >= PATROL.investigateScribble) this.endInvestigation()
  }

  private endInvestigation(): void {
    this.inv = null
    this.resumeVia([])
  }

  private tickStop(dt: number): void {
    const rp = this.route[this.routeIndex]
    const stop = rp.stop
    const a = this.actor
    if (!stop) {
      this.stopT = -1
      return
    }
    this.stopT += dt
    a.yaw = dampAngle(a.yaw, yawToward(a, { x: stop.face[0], z: stop.face[1] }), 6, dt)
    a.speed = 0
    const pointFrom = stop.duration - stop.point
    a.anim = this.stopT < 0.45 ? 'idle' : this.stopT < pointFrom ? stop.anim : 'point'
    a.look = this.glance(SIDE_EYE_RADIUS)
    if (this.stopT >= stop.duration) {
      this.stopT = -1
      this.routeIndex = (this.routeIndex + 1) % this.route.length
    }
  }

  private target(): Vec2 {
    return this.pathIndex < this.path.length ? this.path[this.pathIndex] : this.route[this.routeIndex].p
  }

  private tickWalk(dt: number): void {
    const a = this.actor
    const [tx, tz] = this.target()
    const dx = tx - a.x
    const dz = tz - a.z
    const d = Math.hypot(dx, dz)

    // Yield to the visitor standing in the way; step around them if they stay.
    const p = this.player()
    if (p && d > PATROL.arrive) {
      const px = p.x - a.x
      const pz = p.z - a.z
      const pd = Math.hypot(px, pz)
      const ux = dx / d
      const uz = dz / d
      const ahead = pd > 1e-3 ? (px * ux + pz * uz) / pd : 1
      if (pd < PATROL.yieldDistance && ahead > 0.25) {
        this.yielding = true
        this.yieldT += dt
        a.anim = 'idle'
        a.speed = 0
        a.yaw = dampAngle(a.yaw, yawToward(a, p), 5, dt)
        a.look = this.glance(SIDE_EYE_RADIUS)
        if (this.yieldT > PATROL.yieldPatience) {
          this.yieldT = 0
          this.detourAround(p, ux, uz)
        }
        return
      }
    }
    this.yieldT = 0

    const desired = d > 1e-4 ? yawFromDirection(dx, dz) : a.yaw
    const err = Math.abs(wrapAngle(desired - a.yaw))
    const k = err > 1.3 ? 0.25 : 1 - err * 0.55
    const step = PATROL.walkSpeed * k * dt
    if (d <= Math.max(PATROL.arrive, step)) {
      a.x = tx
      a.z = tz
      this.arrived()
    } else {
      a.x += (dx / d) * step
      a.z += (dz / d) * step
    }
    a.yaw = dampAngle(a.yaw, desired, PATROL.turnLambda, dt)
    a.anim = 'walk'
    a.speed = PATROL.walkSpeed * k
    a.look = this.glance(SIDE_EYE_RADIUS - 1.5)
  }

  private detourAround(p: { x: number; z: number }, ux: number, uz: number): void {
    const a = this.actor
    // left-hand normal of the travel direction; pass on the side away from the visitor
    const sx = -uz
    const sz = ux
    const rel = (p.x - a.x) * sx + (p.z - a.z) * sz
    const side = rel > 0 ? -1 : 1
    const along = (p.x - a.x) * ux + (p.z - a.z) * uz
    const off = 1.5
    const d1: Vec2 = [a.x + ux * Math.max(0.4, along) + sx * side * off, a.z + uz * Math.max(0.4, along) + sz * side * off]
    const d2: Vec2 = [d1[0] + ux * 1.6, d1[1] + uz * 1.6]
    const rest = this.path.slice(this.pathIndex)
    this.path = [d1, d2, ...rest]
    this.pathIndex = 0
  }

  private arrived(): void {
    if (this.pathIndex < this.path.length) {
      this.pathIndex++
      if (this.pathIndex >= this.path.length) {
        this.path = []
        this.pathIndex = 0
        if (this.inv && this.inv.phase === 'walk') {
          this.inv.phase = 'scribble'
          this.inv.phaseAt = this.t
        }
      }
      return
    }
    const rp = this.route[this.routeIndex]
    if (rp.stop) {
      this.stopT = 0
      return
    }
    this.routeIndex = (this.routeIndex + 1) % this.route.length
  }

  private updateCollider(): void {
    const a = this.actor
    const p = this.player()
    const d = p ? Math.hypot(p.x - a.x, p.z - a.z) : Infinity
    if (!this.colliderOn && d > PATROL.colliderClearance) this.colliderOn = true
    a.collidable = this.colliderOn && a.rise >= 1
  }

  private nearestRouteIndex(x: number, z: number): number {
    let best = 0
    let bestD = Infinity
    this.route.forEach((rp, i) => {
      if (!WAYPOINTS[rp.id]) return
      const d = Math.hypot(rp.p[0] - x, rp.p[1] - z)
      if (d < bestD - 1e-6) {
        bestD = d
        best = i
      }
    })
    return best
  }
}

/** Drop points within 0.25 m of their predecessor (the first is compared with `start`). */
function dedupe(points: Vec2[], start: Vec2): Vec2[] {
  const out: Vec2[] = []
  let prev = start
  for (const p of points) {
    if (Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 0.25) {
      out.push([p[0], p[1]])
      prev = p
    }
  }
  return out
}
