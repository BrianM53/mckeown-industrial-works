/**
 * SAFETY module tuning & content: the site safety inspector (patrol, hatches,
 * chase/tackle timings), the Night Shift blackout and the PA announcer.
 * Pure data — no React, no three — so the FSMs and their tests share it.
 *
 * Everything is placed against world/layout.ts (see the ASCII map there):
 *   - restricted zones: transformer yard (15.5..19.5, -6.5..-2.5, chain gap on its WEST side),
 *     wet paint (-19.5..-15.5, -6.5..-2.5, gap on its EAST side), launch-pad blast zone
 *     (circle (16,-34) r 7.5, barrier ring r 9 with a gap facing SOUTH at z ≈ -25).
 *   - the inspector patrols the tower plaza / north road loop between them.
 */
import type { Vec2 } from '@/core/types'
import { yawFromDirection } from '@/core/math'
import { ANCHORS, RESTRICTED_ZONES } from '@/world/layout'
import type { WorkerAnim, WorkerLook } from '@/world/WorkerModel'

// ---------------------------------------------------------------------------
// OSHA-style inspector: detection, chase and tackle
// ---------------------------------------------------------------------------

export const OSHA = {
  /** Seconds after a tackle during which re-entry only earns a warning. */
  tackleCooldown: 20,
  /** Director lock length for the chase + tackle (safety net; released earlier). */
  directorDuration: 5,
  /** Minimum seconds between two warnings (whistle + "Out. Now."). */
  warningInterval: 7,
  /** Forklift-in-a-restricted-zone toast cooldown. */
  forkliftWarningInterval: 15,
  /** Seconds the inspector visibly reacts (points, shakes his head) to a warning. */
  warningHold: 1.5,
  /** Only react visibly to a warning when the inspector is this close to the visitor (m). */
  warningVisualRadius: 18,
  /** Contact is guaranteed this many seconds after the whistle (spec: ≤ 1.2 s). */
  contactDeadline: 1.2,
  /** Climbing out of a safety hatch. */
  emergeTime: 0.3,
  /** Sprint speed (m/s). He speeds up further when needed to make the deadline. */
  sprintSpeed: 10.5,
  maxSprintSpeed: 26,
  /** Feet distance at which the tackle connects. */
  contactDistance: 0.95,
  /** Start the flying-dive pose this far out. */
  diveDistance: 3.2,
  /** A patrolling inspector this close chases straight from where he stands (no hatch). */
  directChaseRadius: 9,
  /** Preferred maximum hatch distance from the visitor (spec: ≤ 8 m). */
  hatchSearchRadius: 8.5,
  /** Leaving the zone by more than this (m) during the alert aborts the chase. */
  abortMargin: 0.3,
  /** Finger-wag / head-shake after an aborted chase. */
  abortHold: 1.8,
  /** If the player service never resolves the tackle, move on after this. */
  tackleFailsafe: 5,
  /** Post-contact choreography (seconds after contact). */
  slideTime: 0.35,
  slideSpeed: 5.5,
  lieUntil: 0.8,
  standUntil: 1.2,
  citeUntil: 3.4,
  /** Hatch lid stays open this long after the inspector climbed out. */
  hatchHoldOpen: 0.9,
} as const

/** Head-shake ("tsk tsk") amplitude/frequency for warnings and aborts. */
export const HEAD_SHAKE = { amplitude: 0.42, frequency: 2.6 } as const

// ---------------------------------------------------------------------------
// Patrol
// ---------------------------------------------------------------------------

export const PATROL = {
  /** Brisk, officious stroll (m/s). */
  walkSpeed: 1.45,
  /** Body yaw damping toward the walking direction. */
  turnLambda: 7,
  /** Arrival tolerance at a path/route point (m). */
  arrive: 0.12,
  /** Investigate an NPC mishap ('gag:start') within this straight-line distance. */
  investigateRadius: 30,
  /** At most one investigation per this many seconds. */
  investigateInterval: 40,
  /** Clipboard time at the scene of the mishap. */
  investigateScribble: 4.2,
  /** Give up an investigation that takes longer than this. */
  investigateTimeout: 45,
  /** Stop this far from the mishap. */
  approach: 1.9,
  /** Stop walking when the visitor is this close ahead (m). */
  yieldDistance: 1.35,
  /** After waiting this long for the visitor to move, step around them. */
  yieldPatience: 1.6,
  /** Only enable the blocking capsule when the visitor is at least this far away. */
  colliderClearance: 1.15,
} as const

export interface RouteStop {
  /** Seconds spent at the stop. */
  duration: number
  /** World point the inspector faces while stopped. */
  face: Vec2
  /** Main activity (scribbling = 'work' with the clipboard). */
  anim: WorkerAnim
  /** Seconds of accusatory pointing at the end of the stop (0 = none). */
  point: number
}

export interface RoutePoint {
  /** Waypoint id in world/layout WAYPOINTS, or a local id for off-graph stops. */
  id: string
  p: Vec2
  stop?: RouteStop
}

/**
 * Patrol loop around the tower plaza and the north road, visiting a viewing spot
 * at each restricted zone (outside the chain, clear of the gap). Consecutive
 * points are linked waypoints (segments guaranteed obstacle-free) or short open
 * plaza hops to the viewing spots.
 */
export const PATROL_ROUTE: RoutePoint[] = [
  { id: 'plazaS', p: [0, -2.5] },
  { id: 'plazaE', p: [9.5, -4] },
  { id: 'stop:transformer', p: [12.4, -5.0], stop: { duration: 4.2, face: [17.6, -4.6], anim: 'work', point: 1.1 } },
  { id: 'plazaE', p: [9.5, -4] },
  { id: 'plazaNE', p: [9.5, -16] },
  { id: 'northE', p: [12, -20] },
  { id: 'stop:blast', p: [11.0, -23.1], stop: { duration: 4.8, face: [16, -34], anim: 'work', point: 1.2 } },
  { id: 'northE', p: [12, -20] },
  { id: 'northMid', p: [0, -20] },
  { id: 'northW', p: [-12, -20] },
  { id: 'plazaNW', p: [-9.5, -16] },
  { id: 'plazaW', p: [-9.5, -3.5] },
  { id: 'stop:wetpaint', p: [-12.4, -5.0], stop: { duration: 4.2, face: [-17.5, -4.5], anim: 'work', point: 1.0 } },
  { id: 'plazaW', p: [-9.5, -3.5] },
]

// ---------------------------------------------------------------------------
// Safety hatches (manhole-style; the inspector pops out of the nearest one)
// ---------------------------------------------------------------------------

export interface HatchDef {
  id: string
  /** Restricted zone this hatch serves. */
  zone: string
  position: Vec2
  /** Yaw of the lid's hinge side: away from the zone, so the open lid never hides him climbing out toward it. */
  hinge: number
}

function hatch(id: string, zone: string, x: number, z: number): HatchDef {
  const rz = RESTRICTED_ZONES.find((r) => r.id === zone)
  const c: Vec2 = !rz ? [x, z] : rz.shape.kind === 'circle' ? rz.shape.center : [(rz.shape.rect.minX + rz.shape.rect.maxX) / 2, (rz.shape.rect.minZ + rz.shape.rect.maxZ) / 2]
  return { id, zone, position: [x, z], hinge: yawFromDirection(x - c[0], z - c[1]) }
}

/**
 * Two hatches per zone, outside the chain barriers on the approach side
 * (≤ 8 m from the zone), flush with the floor, clear of signs, poles, floor
 * decals, the rocket transporter track and the barrier gaps.
 */
export const HATCHES: HatchDef[] = [
  hatch('hatch:transformer-n', 'transformer-yard', 12.0, -6.9),
  hatch('hatch:transformer-s', 'transformer-yard', 12.2, -1.6),
  hatch('hatch:wetpaint-n', 'wet-paint', -12.0, -6.9),
  hatch('hatch:wetpaint-s', 'wet-paint', -12.2, -1.6),
  hatch('hatch:blast-w', 'blast-zone', 10.3, -22.2),
  hatch('hatch:blast-e', 'blast-zone', 21.7, -22.2),
]

/** Hatch geometry (m). Tops stay below y 0.045 (ground-decal limit). */
export const HATCH_SIZE = { radius: 0.48, frame: 0.6, top: 0.04 } as const

// ---------------------------------------------------------------------------
// The inspector himself
// ---------------------------------------------------------------------------

/** White hard hat, safety-orange vest, clipboard (built in) + a whistle on a lanyard (attached). */
export const INSPECTOR_LOOK: Partial<WorkerLook> = {
  helmet: '#F5F3EC',
  vest: '#F2671F',
  stripe: '#EEF1EC',
  shirt: '#D5DEE3',
  pants: '#7A6E55',
  skin: '#D7A47E',
  boots: '#2C2420',
  gloves: '#3A3E41',
  accessory: 'clipboard',
  face: 'mustache',
}

export const INSPECTOR_SEED = 11

// ---------------------------------------------------------------------------
// Texts (in-world fiction; original parody character, no real agency)
// ---------------------------------------------------------------------------

export const ZONE_PHRASE: Record<string, string> = {
  'blast-zone': 'In a blast zone',
  'transformer-yard': 'In the transformer yard',
  'wet-paint': 'On wet paint',
}

export const OSHA_TEXT = {
  alertCaption: '🔊 Whistle! The safety inspector spotted you.',
  /** First warning is always the classic; repeats cycle through the rest. */
  warnings: [
    'Inspector: Out. Now.',
    'Inspector: I am writing this down.',
    'Inspector: Behind the chain, please. The chain is the whole point.',
    'Inspector: That sign was not decorative.',
    'Inspector: This is an OSHA-adjacent situation.',
  ],
  darkWarning: 'Inspector: Lights out does not mean rules out.',
  warningToast: (label: string) => `Restricted area: ${label}. Step back behind the chain.`,
  abortCaption: 'Inspector: I saw that.',
  tackleToast: 'Safety violation logged. Welcome back to Visitor Intake.',
  forkliftToast: (zoneId: string) => `Inspector: That's a forklift. ${ZONE_PHRASE[zoneId] ?? 'In a restricted area'}. I'm not even mad.`,
} as const

// ---------------------------------------------------------------------------
// Night Shift
// ---------------------------------------------------------------------------

export const NIGHT = {
  /** Phase lengths (s). Reduced motion uses `gentleFade` for power-down / restore. */
  powerDown: 2,
  blackout: 12,
  restore: 2,
  cooldown: 45,
  gentleFade: 3,
  /** Blackout light level (environment keeps ≥ ~15% visibility on top of this). */
  level: 0.12,
  /** Emergency beacon ramp at the start of the blackout / end in restore (s). */
  emergencyRamp: 0.6,
  /** Director lock (safety net; released when restore completes). */
  directorDuration: 20,
  /** PA line this many seconds into the blackout. */
  paAt: 1.4,
  paText: 'Remain calm. Do not lick the machinery.',
  startCaption: '⚡ Power failure! Emergency lighting engaged.',
  restorePa: 'Power restored. Whoever pressed the button: we know.',
  restorePaDelay: 0.8,
  /** Watchdog: an event whose sim clock made no progress for this many real seconds is force-restored. */
  watchdogStall: 20,
  /** Watchdog: an event still running this many sim seconds after it should have ended is force-restored. */
  watchdogSimMargin: 4,
  /** Watchdog: hard real-time cap on one event (a < ~1.5 fps device gets its lights back early). */
  watchdogMaxActive: 120,
} as const

export const NIGHT_BUTTON = {
  anchor: ANCHORS.nightShiftButton,
  label: 'Night Shift button',
  verb: 'Press',
  jammedToast: 'The Night Shift button is jammed while something else is going on. Try again in a moment.',
  /** Pressing the locked cover during the blackout. */
  busyToast: 'It is already dark. That is the button working.',
  /** Pressing the locked cover while it recharges. */
  rechargeToast: (s: number) => `Night Shift button recharging: ${s} s. Even emergencies need a coffee break.`,
} as const

// ---------------------------------------------------------------------------
// PA announcer
// ---------------------------------------------------------------------------

export const PA = {
  /** Seconds between announcements. */
  minGap: 90,
  maxGap: 150,
  /** First announcement after load. */
  firstMin: 50,
  firstMax: 80,
  /** Retry delay when blocked / suppressed. */
  retry: 6,
  /** Director per-id cooldown and lock. */
  cooldown: 90,
  duration: 6,
  /** Keep this much quiet after anyone else's PA line (e.g. the launch announcer). */
  quietAfterOtherPa: 20,
  captionSeconds: 6,
} as const

/** Implausible corporate awards & notices (fiction). */
export const PA_LINES: readonly string[] = [
  'Congratulations to Line 3 for fourteen consecutive minutes without incident.',
  'The CEO has once again been named Employee of the Month. This is month forty.',
  'Reminder: the forklift is not a team-building exercise.',
  'Lost and found: one (1) fin. Rocket owner please collect.',
  'Today’s safety tip: if the machine is screaming, it is not singing.',
  'Congratulations to the Tank Line, winners of this quarter’s Least Leaky award.',
  'Hearing protection is mandatory in the press area. If you can hear this, please put it on.',
  'The suggestion box has been relocated. Please stop asking where.',
  'This week’s motto: measure twice, launch once. Results may vary.',
  'Quality Control reminds everyone that “probably fine” is not a measurement.',
  'The fire drill has been rescheduled. Please continue to not be on fire.',
  'Congratulations to the night shift for record productivity during the day shift.',
  'Would whoever set the guidance computer to “vibes” please report to Electronics.',
  'Parking reminder: the launch pad is not a parking spot. Not even briefly.',
  'Employee recognition: thank you to the safety inspector for four hundred consecutive tackles.',
  'The wet paint remains wet. Management thanks you for your patience since 2019.',
  'Rockets are reminded to leave the site through the designated launch pad only.',
  'Snacks in the break room are for employees and, apparently, the forklift.',
  'The transformer would like to remind everyone that it bites.',
  'Correction to an earlier announcement: the rocket was supposed to do that.',
  'Congratulations to Payload for fitting eleven items into a box rated for four.',
  'Please do not feed the conveyor belts.',
  'The Night Shift button is for emergencies only. There has never been an emergency.',
  'The quarterly synergy meeting has moved to the executive office. Nobody has the key.',
  'Will the owner of a slightly dented forklift please report to Maintenance. Again.',
  'Today’s lunch special is whatever fell off the smelting line. It is mostly gears.',
]
