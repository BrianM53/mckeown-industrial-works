/**
 * Player module tuning. Everything that defines the "feel" lives here so it can
 * be tuned in one place (and unit-tested against).
 */
const DEG = Math.PI / 180

export const PLAYER = {
  /** Capsule radius (m). */
  radius: 0.35,
  /** Half-height of the capsule's cylindrical section. Total height = 2 * (halfHeight + radius) = 1.8 m. */
  halfHeight: 0.55,
  /** Collider center above the feet. */
  centerY: 0.9,
  /** Character-controller skin offset (gap kept to obstacles). */
  skin: 0.02,
  walkSpeed: 4.2,
  runSpeed: 7.2,
  /** m/s² when speeding up / changing direction. */
  accel: 30,
  /** m/s² when releasing input or reversing. */
  decel: 40,
  /** Body yaw damping toward the move direction. */
  turnLambda: 14,
  /** Kinematic gravity (m/s²) — slightly heavier than the world for snappy landings. */
  gravity: 24,
  maxFallSpeed: 30,
  autostepHeight: 0.35,
  autostepMinWidth: 0.2,
  snapToGround: 0.3,
  maxClimbAngle: 50 * DEG,
  minSlideAngle: 40 * DEG,
  /** Mass used when the controller shoves light dynamic props. */
  mass: 75,
  /** A held direction must move us at least this far before 'clocked-in'. */
  clockInDistance: 1.5,
} as const

export const CAMERA = {
  fov: 55,
  /** Orbit pivot above the feet (m). */
  pivotHeight: 1.6,
  /** Look target above the feet — slightly above the head so the worker sits lower-center. */
  lookHeight: 1.9,
  /** Optional over-the-shoulder offset to the camera's right (m). 0 = centered framing. */
  shoulder: 0,
  defaultPitch: 10 * DEG,
  minPitch: -20 * DEG,
  maxPitch: 65 * DEG,
  defaultDistance: 5.5,
  minDistance: 2.2,
  maxDistance: 9,
  /** Max boom length while inside a building. */
  interiorMaxDistance: 4.2,
  /** Keep the camera this far below a building's eave when inside. */
  eaveMargin: 0.4,
  minCameraY: 0.35,
  /** Spring-arm probe sphere radius (covers the near plane). */
  probeRadius: 0.22,
  /** Shortest boom length allowed by the spring arm. */
  minArm: 0.3,
  /** Ease-out rate when an obstruction clears (slow → no popping). */
  armOutLambda: 3.2,
  /** Zoom smoothing (log-distance space). */
  zoomLambda: 11,
  /** Orbit input smoothing (high → responsive, removes mouse jaggies). */
  orbitLambda: 24,
  /** How fast the interior / eave boom caps glide in and out (doorways never pop). */
  capLambda: 5,
  /** Recenter swing rate. */
  recenterLambda: 6.5,
  /** Pivot follow rates (horizontal / vertical) — subtle lag, not floaty. */
  pivotLambdaXZ: 22,
  pivotLambdaY: 11,
  /** Drag orbit: radians per CSS pixel (600 px ≈ 180°). */
  dragYawPerPx: 0.0052,
  dragPitchPerPx: 0.0042,
  /** Touch drag is a little faster (phones have fewer pixels to swipe across). */
  touchLookScale: 1.25,
  /** Keyboard orbit rates (rad/s). */
  keyYawRate: 2.4,
  keyPitchRate: 1.3,
  /** Keyboard zoom rate (log units / s). */
  keyZoomRate: 1.3,
  /** Wheel zoom (log units per wheel pixel). */
  wheelZoomPerPx: 0.0011,
  /** Pinch zoom (log units per accumulated touchZoom unit). */
  pinchZoomPerUnit: 0.006,
  /** Subtle FOV boost while running (disabled with reduced motion). */
  runFovBoost: 2.5,
  /** Max shake translation (m) at trauma 1. */
  shakeMaxOffset: 0.22,
  shakeMaxRoll: 1.6 * DEG,
  /** Worker fades out when the boom gets shorter than this (camera inside the head otherwise). */
  fadeNear: 0.5,
  fadeFar: 1.3,
} as const

/** Chase camera while driving the forklift. */
export const FORKLIFT_CAMERA = {
  pivotHeight: 1.9,
  lookHeight: 2.2,
  defaultDistance: 8,
  defaultPitch: 18 * DEG,
  minDistance: 4,
  maxDistance: 12,
  /** Auto-trail rate behind the vehicle heading (scaled by speed). */
  trailLambda: 2.4,
  /** Seconds after a manual orbit before auto-trailing resumes. */
  trailDelay: 1.4,
  fovBoost: 3,
} as const

export const RECOVERY = {
  /** Safe-position sampling interval (s). */
  safeInterval: 1,
  safeCapacity: 12,
  /** Stuck detection: input held but displacement below this over the window → stuck. */
  stuckWindow: 1.5,
  stuckMinDisplacement: 0.15,
  stuckClearDisplacement: 0.5,
  /** Hint stays this long after input is released. */
  stuckHintLinger: 4,
  /** Fell out of the world below this height. */
  killY: -5,
  /** Recover prefers a safe spot at least this far from where we are (so R visibly unsticks). */
  recoverMinDistance: 1,
  recoverMinDistanceStuck: 2,
  /** Older/farther history is ignored in favour of the nearest checkpoint. */
  recoverMaxDistance: 30,
} as const

export const FADE = {
  outMs: 250,
  holdMs: 90,
  inMs: 300,
} as const

export const ROUTE = {
  /** Spacing between chevrons along the route (m). */
  spacing: 1.3,
  /** Chevron march speed (m/s). */
  marchSpeed: 1.6,
  /** Start drawing this far ahead of the player (m). */
  lead: 1.4,
  /** Recompute when the player strays farther than this from the line (m). */
  strayDistance: 6,
  /** Arrival radius around the destination entrance (m). */
  arriveRadius: 3,
  maxChevrons: 256,
  y: 0.045,
} as const

export const INTERACTION = {
  /** Target selection rate (Hz). */
  rate: 15,
  /** Duration of the 'point' gesture after interacting (s). */
  gestureTime: 0.6,
} as const

/** The anonymous player worker: white hard hat with an orange stripe, hi-vis lime vest. */
export const PLAYER_LOOK = {
  helmet: '#F3F1EA',
  helmetStripe: '#E57D35',
  vest: '#D2E83E',
  stripe: '#E8EEED',
  shirt: '#4A6890',
  pants: '#3E4654',
  skin: '#C99A76',
  boots: '#4A3426',
  gloves: '#8A6A45',
  accessory: 'none',
} as const
