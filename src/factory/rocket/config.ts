/**
 * Rocket module tuning: every coordinate is derived from world/layout.ts
 * (TOWER, TRACK, PAD, COUNTER_SIGN, OBSERVATION_DECK) or is a local offset
 * from those anchors. Pure data — no React / three.
 */
import type { QualityTier, Vec2 } from '@/core/types'
import { PHASE_SECONDS } from '@/systems/factory'
import { COUNTER_SIGN, OBSERVATION_DECK, PAD, TOWER } from '@/world/layout'

// ---------------------------------------------------------------------------
// Launch timeline (seconds since the countdown started; see launchTime()).
// ---------------------------------------------------------------------------

export const T_IGNITION = PHASE_SECONDS.countdown
export const T_LIFTOFF = T_IGNITION + PHASE_SECONDS.ignition
export const T_AFTERMATH = T_LIFTOFF + PHASE_SECONDS.flight
export const T_RESET = T_AFTERMATH + PHASE_SECONDS.aftermath
export const T_END = T_RESET + PHASE_SECONDS.reset
/** Launch time at which rollout begins (negative: before the countdown). */
export const T_ROLLOUT = -(PHASE_SECONDS.rollout + PHASE_SECONDS.pad)
export const T_PAD = -PHASE_SECONDS.pad

// ---------------------------------------------------------------------------
// Tower
// ---------------------------------------------------------------------------

export const TOWER_CX = TOWER.center[0]
export const TOWER_CZ = TOWER.center[1]
export const TOWER_H = TOWER.height
/** Half size of the footprint (10 x 10 m). */
export const TOWER_HALF = (TOWER.footprint.maxX - TOWER.footprint.minX) / 2
/** Corner column centre offset from the tower centre and its square section. */
export const COLUMN_OFF = TOWER_HALF - 0.45
export const COLUMN_SIZE = 0.9
/** Service platform levels (north + west faces, inside). */
export const PLATFORM_LEVELS = [6.5, 11, 15.5, 20] as const
export const PLATFORM_DEPTH = 1.1
/** East face is the rollout portal: open below this height. */
export const PORTAL_TOP = 19.5
/** South face is open below the staging deck (collector belt + payload monorail enter at y 4.8–6.2). */
export const STAGING_DECK_Y = 11
/** Where finished stage parts are staged (top of the deck) before the crane lifts them. */
export const STAGING_POINT: Vec2 = [2.6, TOWER_CZ + TOWER_HALF - 0.9]
export const STAGING_DECK = { minX: -0.4, maxX: 4.1, minZ: TOWER_CZ + TOWER_HALF - 1.9, maxZ: TOWER_CZ + TOWER_HALF + 0.05 }
/** Hammerhead crane on the NE corner column. */
export const CRANE_PIVOT: Vec2 = [TOWER_CX + COLUMN_OFF, TOWER_CZ - COLUMN_OFF]
export const CRANE_JIB_Y = TOWER_H + 3.9
export const CRANE_TROLLEY_Y = CRANE_JIB_Y - 0.45
export const CRANE_PARK = { angle: -Math.PI / 2, radius: 5.2, hookY: TOWER_H - 0.5 }
/** Umbilical arms: hinge on the west face (south part), reaching the rocket skin. */
export const UMBILICAL_HINGE_Z = TOWER_CZ + 2.6
/** Umbilical arm heights (world): chassis level and guidance-ring level. */
export const UMBILICAL_LEVELS = [7.25, 10.55] as const

// ---------------------------------------------------------------------------
// Rocket / transporter
// ---------------------------------------------------------------------------

/** Transporter deck top (rocket base sits here). */
export const DECK_Y = 1.62
export const TRANSPORTER = { length: 5.8, width: 4.6, gauge: 3.2 }
/** Rocket envelope limits the builder must respect (tower platforms / portal clearance). */
export const ROCKET_LIMITS = { maxRadius: 2.95, maxHeight: 14.2 }

// ---------------------------------------------------------------------------
// Pad
// ---------------------------------------------------------------------------

export const PAD_X = PAD.center[0]
export const PAD_Z = PAD.center[1]
export const BLAST_RADIUS = PAD.blastRadius
export const PAD_SLAB_R = 6.5
export const PAD_TOP = 0.12
export const TRENCH = { halfWidth: 1.4, halfLength: PAD_SLAB_R }
export const PAD_MAST: Vec2 = [PAD_X - 4.8, PAD_Z - 4.6]
export const PAD_WATER_TOWER: Vec2 = [PAD_X + 4.2, PAD_Z - 4.2]
export const PAD_BEACONS: Vec2[] = [
  [PAD_X - 4.7, PAD_Z + 4.4],
  [PAD_X + 4.7, PAD_Z + 4.4],
]
/** Inflatable stowaway cushion (between the slab rim and the barrier). */
export const CUSHION: Vec2 = [PAD_X - 6.3, PAD_Z + 3.4]
export const CUSHION_SIZE = { w: 2.9, h: 1.25, d: 2.9 }
/** Where crew stand during the launch: outside the barrier (r 9), facing the pad. */
export const CREW_SAFE_SPOTS: Vec2[] = [
  [PAD_X - 5.2, PAD_Z + 11.0],
  [PAD_X + 5.4, PAD_Z + 10.8],
  [PAD_X - 2.6, PAD_Z + 11.6],
]

// ---------------------------------------------------------------------------
// Counter sign & observation deck
// ---------------------------------------------------------------------------

export const SIGN_POS = COUNTER_SIGN.position
export const SIGN_YAW = COUNTER_SIGN.yaw
export const SIGN_BOARD = { w: 7.4, h: 3.7, bottom: 2.55 }
export const RESET_FLASH_SECONDS = 5

/** Deck top (environment builds the deck, ramp and coin-op binoculars). */
export const DECK_TOP = OBSERVATION_DECK.height
/** Coin-op binoculars on the deck's north rail (environment visual). */
export const BINOCULARS: Vec2 = [OBSERVATION_DECK.position[0], OBSERVATION_DECK.position[1] - 2.05]
export const BENCH = { x: OBSERVATION_DECK.position[0] + 1.7, z: OBSERVATION_DECK.position[1] + 0.9, yaw: -0.75, w: 1.7, d: 0.55 }

/** Assembly status kiosk just west of the tower's SW column (clear of the plaza walk lines). */
export const KIOSK: Vec2 = [TOWER_CX - TOWER_HALF - 0.75, TOWER_CZ + TOWER_HALF - 0.85]
/** External switchback stair on the west face (visual + a blocking collider at its foot). */
export const STAIR = { x0: TOWER_CX - TOWER_HALF - 1.45, x1: TOWER_CX - TOWER_HALF - 0.1, z0: TOWER_CZ - TOWER_HALF + 0.6, z1: TOWER_CZ + 1.4 }

// ---------------------------------------------------------------------------
// Witness achievements, shake, safety
// ---------------------------------------------------------------------------

export const WITNESS_RANGE = 80
export const IGNITION_SHAKE = { intensity: 0.35, duration: 1.2 }
/** Look-ahead (m) in front of the moving transporter that must be clear of the visitor. */
export const TRACK_CLEARANCE_AHEAD = 4.2
export const TRACK_CLEARANCE_SIDE = 0.9
export const CLEAR_TRACK_CAPTION = 'Crew: Clear the track!'
export const CLEAR_TRACK_COOLDOWN = 7

// ---------------------------------------------------------------------------
// Quality scaling
// ---------------------------------------------------------------------------

export interface RocketQuality {
  smoke: number
  fire: number
  debris: number
  treadLinks: boolean
  halos: boolean
}

export const QUALITY: Record<QualityTier, RocketQuality> = {
  low: { smoke: 0.45, fire: 0.5, debris: 8, treadLinks: false, halos: true },
  medium: { smoke: 1, fire: 1, debris: 14, treadLinks: true, halos: true },
  high: { smoke: 1.35, fire: 1.3, debris: 18, treadLinks: true, halos: true },
}
