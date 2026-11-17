import { interactionGroups } from '@react-three/rapier'

/**
 * Rapier collision groups. Every collider MUST set `collisionGroups` from
 * `GROUPS` (sensors also set `solverGroups` as needed).
 *
 *   STATIC   — buildings, walls, heavy machinery, fences (fixed bodies). Also block the camera.
 *   PLAYER   — the on-foot worker capsule (kinematic character controller)
 *   VEHICLE  — the forklift (dynamic)
 *   PROP     — light dynamic props: crates, barrels, cones, pallets
 *   NPC      — kinematic NPC capsules
 *   SENSOR   — trigger volumes (goals, etc.)
 *   BALL     — soccer ball / volleyball
 *   CAMERA   — camera-only blockers: invisible proxies that stop the camera boom but no bodies
 *
 * Rapier rule: A and B interact iff (A.memberships & B.filters) && (B.memberships & A.filters).
 */
export const CG = {
  STATIC: 0,
  PLAYER: 1,
  VEHICLE: 2,
  PROP: 3,
  NPC: 4,
  SENSOR: 5,
  BALL: 6,
  CAMERA: 7,
} as const

export const GROUPS = {
  static: interactionGroups(CG.STATIC, [CG.PLAYER, CG.VEHICLE, CG.PROP, CG.NPC, CG.BALL, CG.CAMERA]),
  player: interactionGroups(CG.PLAYER, [CG.STATIC, CG.VEHICLE, CG.PROP, CG.NPC, CG.SENSOR, CG.BALL]),
  vehicle: interactionGroups(CG.VEHICLE, [CG.STATIC, CG.PLAYER, CG.PROP, CG.NPC, CG.BALL, CG.SENSOR]),
  prop: interactionGroups(CG.PROP, [CG.STATIC, CG.PLAYER, CG.VEHICLE, CG.PROP, CG.BALL]),
  npc: interactionGroups(CG.NPC, [CG.STATIC, CG.PLAYER, CG.VEHICLE]),
  sensor: interactionGroups(CG.SENSOR, [CG.PLAYER, CG.VEHICLE, CG.BALL]),
  ball: interactionGroups(CG.BALL, [CG.STATIC, CG.PLAYER, CG.VEHICLE, CG.PROP, CG.BALL, CG.SENSOR]),
  /** Invisible camera-only blocker colliders (e.g. a tall machine without a full physics proxy). */
  cameraBlocker: interactionGroups(CG.CAMERA, [CG.CAMERA]),
} as const

/**
 * `filterGroups` for camera spring-arm ray/shape casts: hits STATIC and CAMERA
 * colliders only (never the player, NPCs, props, vehicle or balls).
 */
export const CAMERA_RAY_GROUPS = interactionGroups(CG.CAMERA, [CG.STATIC, CG.CAMERA])
