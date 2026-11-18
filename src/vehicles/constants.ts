/**
 * Vehicles module tuning: forklift dimensions, handling feel, recovery rules
 * and prop behavior. Everything that defines the "feel" lives here.
 *
 * Forklift local frame: origin on the ground under the middle of the
 * wheelbase, forward = -Z (like every model), +X = right, +Y = up.
 */
import { ANCHORS } from '@/world/layout'

/** Home parking spot in the Maintenance Bay (facing the bay door, east). */
export const HOME = {
  x: ANCHORS.forklift.position[0],
  z: ANCHORS.forklift.position[1],
  yaw: ANCHORS.forklift.yaw,
} as const

/**
 * Free-standing tutorial sign in the bay: north of the forklift, just west of
 * the door's keep-clear zone, angled to face visitors coming in the door.
 */
export const TUTORIAL_SIGN = {
  x: -10.35,
  z: 25.95,
  /** Faces the bay door (front normal points toward (-7, 29)). */
  yaw: Math.atan2(-(-7 - -10.35), -(29 - 25.95)),
  boardWidth: 1.12,
  boardHeight: 1.68,
  boardBottom: 0.62,
  postInset: 0.08,
} as const

export const FORKLIFT = {
  /** Half width of the body including the front tyres. */
  halfWidth: 0.66,
  /** Fork tips (front-most point). */
  frontZ: -2.18,
  /** Rear-most point of the rounded counterweight. */
  rearZ: 1.42,
  height: 2.5,
  frontAxleZ: -0.62,
  rearAxleZ: 0.78,
  frontWheel: { x: 0.53, r: 0.31, w: 0.24 },
  rearWheel: { x: 0.47, r: 0.24, w: 0.19 },
  /** Wheel colliders (balls, inset so they never stick out past the tyres). */
  frontBall: { x: 0.4, r: 0.31 },
  rearBall: { x: 0.36, r: 0.24 },
  /** Seat cushion top and its z (driver hips sit here). */
  seatTop: 1.08,
  seatZ: 0.42,
  /** Floor plate the driver's boots rest on. */
  deckTop: 0.66,
  /** Overhead guard roof height. */
  guardY: 2.3,
  /** Fork blade bottom height when parked / driving. */
  forkParked: 0.05,
  forkDriving: 0.13,
  /** Physics masses (kg): heavy low counterweight keeps the centre of mass low and rear. */
  mass: { chassis: 1400, counterweight: 1700, mast: 220, guard: 60, forks: 70, wheel: 40 },
} as const

/** Handling: comically heavy but controllable arcade model (see logic/drive.ts). */
export const DRIVE = {
  maxForward: 7,
  maxReverse: 3.5,
  /** m/s² (tapers near top speed). */
  accel: 4.2,
  reverseAccel: 3.2,
  /** Pressing the opposite direction. */
  brake: 9,
  /** No input: rolling resistance + engine braking. */
  coast: 2.6,
  /** Unoccupied / exiting. */
  parkBrake: 12,
  /** Steering (normalized units per second) toward the input / back to center. */
  steerRate: 3.4,
  steerReturn: 4.6,
  /** Yaw rate grows with speed (rad/s per m/s), capped. */
  yawPerSpeed: 0.62,
  maxYawRate: 1.5,
  /** Fraction of the front-axle side slip cancelled per physics step (slow → fast & full lock). */
  lateralGrip: 0.86,
  lateralGripFast: 0.66,
  /** Fraction of the yaw-rate error corrected per step (collisions can still spin us). */
  yawGrip: 0.35,
  /** Hard caps (stability, no tunneling). */
  maxSpeed: 10,
  maxRiseSpeed: 4.5,
  maxAngular: 5,
  /** Roll/pitch angular-velocity damping per step while grounded and nearly upright. */
  antiRoll: 0.12,
  /** Above this tilt (cos of angle between body up and world up) no anti-roll assistance. */
  antiRollMinUp: 0.86,
} as const

export const RECOVERY = {
  /** Body up·Y below this for `overturnAfter` seconds → overturned. */
  overturnUp: 0.4,
  overturnAfter: 1.5,
  /** Upright again when up·Y above this for `rightedAfter` seconds. */
  rightedUp: 0.75,
  rightedAfter: 0.4,
  /** Throttle held but |speed| below this for `stuckAfter` → stuck hint. */
  stuckSpeed: 0.3,
  stuckAfter: 2,
  /** Safe positions are sampled at this interval. */
  safeInterval: 1,
  safeCapacity: 10,
  /** Fell out of the world below this height. */
  killY: -3,
  /** Distance outside PLAYABLE_BOUNDS that counts as out of bounds. */
  boundsSlack: 1.5,
  /** Minimum seconds between two manual recoveries. */
  recoverCooldown: 0.6,
} as const

export const ROUTE_GUARD = {
  /** Unoccupied forklift parked in a door span / on a waypoint segment longer than this → returned. */
  blockingAfter: 30,
  /** Unoccupied with its footprint in a restricted zone longer than this → returned. */
  restrictedAfter: 10,
  /** Unoccupied anywhere away from home longer than this → returned. */
  idleAfter: 180,
  /** Unoccupied and on its side longer than this → set back on its wheels in place. */
  overturnedAfter: 8,
  /** Footprint closer than this to a waypoint segment counts as blocking it. */
  waypointMargin: 0.6,
  /** Door zone depth outside / inside the wall. */
  doorOutside: 2.4,
  doorInside: 1.6,
  /** Within this distance (m) and yaw (rad) of home counts as "home". */
  homeRadius: 1.4,
  homeYaw: 0.6,
  /** Retry interval when the home spot is occupied. */
  retryAfter: 3,
} as const

export const IMPACT = {
  /** Unexplained velocity change (m/s) in one step that counts as a crash. */
  minDeltaV: 1.4,
  /** Velocity change mapping to strength 1. */
  fullDeltaV: 7,
  /** Seconds between impact events. */
  cooldown: 0.28,
  /** Crash "kick" (comedic stoppie / tip) above this strength. */
  kickMin: 0.35,
  /** Peak extra pitch / roll rates (rad/s) at strength 1. */
  kickPitch: 1.6,
  kickRoll: 2.9,
} as const

export const PROPS = {
  /** Displaced (or tipped) this long while the player is far → reset to home. */
  resetAfter: 60,
  displacedDistance: 0.5,
  playerFarDistance: 25,
  /** Player nudge: within this surface gap and walking toward the prop. */
  nudgeGap: 0.22,
  nudgeMinSpeed: 0.6,
  nudgeCooldown: 0.22,
  /** Velocity caps (no comedic chain reactions into orbit). */
  maxSpeed: 8,
  maxAngular: 14,
  /** Bump sound: per-step velocity change threshold and rate limits. */
  bumpDeltaV: 1.1,
  bumpCooldownPerProp: 0.25,
  bumpCooldownGlobal: 0.07,
} as const
