/**
 * RECREATION YARD layout (pure data, unit-tested). Open-air yard ZONES.rec
 * (x 30..48, z -24..-4). The environment owns the gateway posts + crossbar sign
 * at x 30.6, z -16.6 / -11.4; this fence closes the yard around them and leaves
 * that gate open. The north road's asphalt ends at x 32, so the fence jogs east
 * of it (the road dead-ends at the fence instead of running under it).
 *
 *   z -24.2  ┌──────────── north fence ──────────────┐ NE mast
 *   road end │  ▒▒ GOAL ▒▒ (39,-23.3) keeper            │
 *   (x<32.1) │      pitch            [bleachers+canopy] │
 *   z -16.6 ─┘      ● ball (38,-18)  [  spectators   ] │
 *    GATE  →     walkway                   [SCOREBOARD]│
 *   z -11.4 ─┐      ○ volleyball (41,-10.6)             │
 *   [rules]  │  ════════ NET z -8 (posts 36.4/45.6) ════│
 *            │            opponent (41,-5.9)            │
 *   z -4.3   └──────────── south fence ─────────────────┘
 */
import type { Rect, Vec2 } from '@/core/types'
import { ANCHORS, SOUTH, WEST, ZONES } from '@/world/layout'

export const YARD: Rect = ZONES.rec.bounds
export const FENCE_H = 3.0

/** Environment-owned gateway posts (layout of environment/data/decor REC_GATE). */
export const GATE = { x: 30.6, z0: -16.6, z1: -11.4 }

export interface FenceSegment {
  id: string
  a: Vec2
  b: Vec2
}

export const FENCE_X_EAST = 47.7
export const FENCE_Z_NORTH = -24.2
export const FENCE_Z_SOUTH = -4.3
/** West fence north of the gate stands just east of the north road's end (x ≤ 32). */
export const FENCE_X_NW = 32.15

export const FENCE: FenceSegment[] = [
  { id: 'w-south', a: [GATE.x, GATE.z1], b: [GATE.x, FENCE_Z_SOUTH] },
  { id: 'south', a: [GATE.x, FENCE_Z_SOUTH], b: [FENCE_X_EAST, FENCE_Z_SOUTH] },
  { id: 'east', a: [FENCE_X_EAST, FENCE_Z_SOUTH], b: [FENCE_X_EAST, FENCE_Z_NORTH] },
  { id: 'north', a: [FENCE_X_EAST, FENCE_Z_NORTH], b: [FENCE_X_NW, FENCE_Z_NORTH] },
  { id: 'w-north', a: [FENCE_X_NW, FENCE_Z_NORTH], b: [FENCE_X_NW, GATE.z0] },
  { id: 'w-jog', a: [FENCE_X_NW, GATE.z0], b: [GATE.x, GATE.z0] },
]

/** Inside of the fence (balls leaving this rect, plus margin, are reset). */
export const INSIDE: Rect = { minX: GATE.x, maxX: FENCE_X_EAST, minZ: FENCE_Z_NORTH, maxZ: FENCE_Z_SOUTH }

// ---------------------------------------------------------------------------
// Soccer
// ---------------------------------------------------------------------------

export const PITCH: Rect = { minX: 33.6, maxX: 44.4, minZ: -23.9, maxZ: -14.9 }
export const BALL_SPOT: Vec2 = [ANCHORS.soccerBall.position[0], ANCHORS.soccerBall.position[1]]
export const SOCCER_BALL_R = 0.11

export const GOAL = {
  x: ANCHORS.soccerGoal.position[0],
  /** Goal center (box center between mouth and back net). */
  z: ANCHORS.soccerGoal.position[1],
  yaw: SOUTH,
  width: 3.0,
  height: 1.6,
  depth: 1.2,
  post: 0.06,
  /** Goal line (mouth) z and back net z. */
  get mouthZ() {
    return this.z + this.depth / 2
  },
  get backZ() {
    return this.z - this.depth / 2
  },
}

/** Keeper stands just in front of the goal line. */
export const KEEPER_HOME: Vec2 = [GOAL.x, GOAL.z + GOAL.depth / 2 + 0.45]

// ---------------------------------------------------------------------------
// Volleyball
// ---------------------------------------------------------------------------

export const NET = {
  x: ANCHORS.volleyNet.position[0],
  z: ANCHORS.volleyNet.position[1],
  /** Post x offsets from the net center. */
  half: 4.6,
  top: 2.43,
  bottom: 1.45,
}

/** Court markings; the visitor plays from the north half, the opponent the south half. */
export const COURT: Rect = { minX: 37.0, maxX: 45.0, minZ: -12.2, maxZ: -4.85 }
export const VOLLEY_SPOT: Vec2 = [NET.x, -10.6]
export const VOLLEY_BALL_R = 0.105
export const OPPONENT_HOME: Vec2 = [NET.x, -5.9]

/** Far (opponent) court landing targets for the visitor's bumps. */
export const FAR_TARGET: Rect = { minX: 38.0, maxX: 44.0, minZ: -7.1, maxZ: -5.4 }
/** Near (visitor) court targets for the opponent's returns. */
export const NEAR_TARGET: Rect = { minX: 38.2, maxX: 43.8, minZ: -11.4, maxZ: -9.3 }

// ---------------------------------------------------------------------------
// Furniture
// ---------------------------------------------------------------------------

/** Bleachers (3 tiers) along the east fence, facing west at the pitch. */
export const BLEACHERS = { rect: { minX: 45.05, maxX: 47.45, minZ: -21.9, maxZ: -15.5 } as Rect, tiers: 3, tierH: 0.45, yaw: WEST }

export const SCOREBOARD = { x: 47.25, z: -12.0, yaw: WEST, w: 3.0, h: 1.55, y0: 2.35 }

/** Rules board just outside the gate (south side), facing arriving visitors. */
export const RULES_BOARD = { x: 29.78, z: -10.45, yaw: WEST, w: 1.5, h: 1.05, y0: 0.95 }
export const RULES_INTERACT: Vec2 = [29.0, -10.9]

export const FLOOD_MASTS: Vec2[] = [
  [FENCE_X_EAST - 0.45, FENCE_Z_NORTH + 0.45],
  [FENCE_X_NW + 0.45, FENCE_Z_NORTH + 0.45],
  [FENCE_X_EAST - 0.45, FENCE_Z_SOUTH - 0.45],
  [GATE.x + 0.45, FENCE_Z_SOUTH - 0.45],
]

export const WATER_COOLER: Vec2 = [46.95, -14.2]
export const BALL_CART: Vec2 = [46.5, -6.0]

/** Spectators on the bleachers (seat tier index, position). */
export const SPECTATORS: { tier: number; x: number; z: number; seed: number }[] = [
  { tier: 0, x: 45.5, z: -19.6, seed: 31 },
  { tier: 1, x: 46.3, z: -17.0, seed: 47 },
]
