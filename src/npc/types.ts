/**
 * NPC module shared types (pure — no React / three.js so the logic is unit-testable).
 */
import type { QualityTier, Vec2 } from '@/core/types'
import type { WorkerAnim, WorkerLook } from '@/world/WorkerModel'
import type { ZoneId } from '@/world/layout'

/** What an NPC does while it stays at a station. 'lean' = idle pose tilted against a wall. */
export type StationActivity = 'idle' | 'work' | 'sit' | 'lean' | 'nap' | 'point' | 'wave'

export interface StationDef {
  id: string
  pos: Vec2
  /** Facing while staying here. */
  yaw: number
  activity: StationActivity
  /** Seconds to stay before moving on [min, max]. */
  dur: [number, number]
  /** Body height offset (sitting on a sofa, lying on a conveyor). */
  y?: number
  /** Lean angle (radians) about the body's local X (positive = leaning back). */
  lean?: number
  /** Standing on top of an NPC-owned prop (skipped by the physics free-spot check). */
  onProp?: boolean
  /** Glance target while here (world point), e.g. a screen. */
  lookAt?: Vec2
  /**
   * Briefly stands at the very edge of a lane (e.g. peeking under the QC arch).
   * Tests require such stations to hug the lane edge and stay short.
   */
  laneOk?: boolean
}

/**
 * Route point reference: a literal [x, z] point or `wp:<waypointId>` (resolved from
 * world/layout WAYPOINTS). `auto` inserts the waypoint-graph shortest path between the
 * waypoints nearest to the previous and next point.
 */
export type RoutePoint = Vec2 | `wp:${string}` | 'auto'

export interface LegDef {
  from: string
  to: string
  /** Intermediate points (excluding the station positions themselves). */
  via?: RoutePoint[]
  /** Carry a component box on this leg. */
  carry?: boolean
}

export interface NpcDef {
  id: string
  name: string
  role: string
  /** Lowest quality tier that spawns this NPC. */
  tier: QualityTier
  look: Partial<WorkerLook>
  seed: number
  /** Home zone (for debug / directory flavor). */
  zone: ZoneId
  stations: StationDef[]
  /** Cyclic order of station ids. Consecutive ids must have a leg (either direction). */
  routine: string[]
  legs: LegDef[]
  /** Walk speed m/s. */
  speed: number
  /** Carries a component box sometimes (renders the box prop). */
  carries?: boolean
  /** Greets the visitor with a wave when they first come near. */
  greeter?: boolean
  /** Interaction radius for "Talk". */
  talkRadius?: number
}

/** Pose override written by gag timelines each frame. */
export interface ActorPose {
  x: number
  z: number
  y: number
  yaw: number
  anim: WorkerAnim
  speed: number
  lean: number
  /** 0..1 soot (black) tint, 0..1 slime (green) tint. */
  soot: number
  slime: number
  /** Hide the worker (e.g. fully under a crate) — never used for long. */
  hidden: boolean
  /** Holding a component box. */
  carry: boolean
}

export function defaultPose(): ActorPose {
  return { x: 0, z: 0, y: 0, yaw: 0, anim: 'idle', speed: 0, lean: 0, soot: 0, slime: 0, hidden: false, carry: false }
}
