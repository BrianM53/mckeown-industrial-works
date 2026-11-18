/**
 * Pure choreography for the tower and the transporter: pure functions of the
 * factory sim's rocket state (phase, phaseTime, stagesComplete, stageProgress)
 * so a fast-forwarded sim renders the right picture immediately.
 */
import { clamp, lerp, smoothstep, wrapAngle } from '@/core/math'
import type { RocketPhase, RocketState } from '@/systems/factory'
import { PHASE_SECONDS, worldCycleSeconds, LAUNCH_SEQUENCE_SECONDS, type OptimizationParams } from '@/systems/factory'
import {
  CRANE_PARK,
  CRANE_PIVOT,
  CRANE_TROLLEY_Y,
  DECK_Y,
  STAGING_DECK_Y,
  STAGING_POINT,
  T_AFTERMATH,
  T_END,
  T_IGNITION,
  T_LIFTOFF,
  T_PAD,
  T_RESET,
  T_ROLLOUT,
  TOWER_CX,
  TOWER_CZ,
} from './config'

export const ROCKET_YAW_IN_TOWER = -Math.PI / 2

export function easeInOut(x: number): number {
  const t = clamp(x, 0, 1)
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function easeOut(x: number): number {
  const t = clamp(x, 0, 1)
  return 1 - (1 - t) * (1 - t) * (1 - t)
}

/**
 * Trapezoidal velocity profile: accelerate for `ta`, cruise, decelerate for
 * `td`, covering 0→1 over `total` seconds. Returns progress 0..1 at time t.
 */
export function trapezoid(t: number, total: number, ta: number, td: number): number {
  if (!(total > 0)) return 1
  const tt = clamp(t, 0, total)
  const cruise = Math.max(0, total - ta - td)
  const v = 1 / (cruise + 0.5 * ta + 0.5 * td)
  if (tt < ta) return 0.5 * (v / ta) * tt * tt
  if (tt < ta + cruise) return 0.5 * v * ta + v * (tt - ta)
  const r = total - tt
  return 1 - 0.5 * (v / td) * r * r
}

/** Cruise speed (fraction of the track per second) of a trapezoid profile. */
export function trapezoidCruise(total: number, ta: number, td: number): number {
  return 1 / (Math.max(0, total - ta - td) + 0.5 * ta + 0.5 * td)
}

const ROLL = { total: PHASE_SECONDS.rollout, ta: 2.5, td: 3 }
const RETURN = { total: PHASE_SECONDS.aftermath + PHASE_SECONDS.reset, ta: 2, td: 2.5 }
export const ROLLOUT_CRUISE = trapezoidCruise(ROLL.total, ROLL.ta, ROLL.td)
export const RETURN_CRUISE = trapezoidCruise(RETURN.total, RETURN.ta, RETURN.td)

/**
 * Seconds since the countdown started (negative during rollout/pad). During
 * 'assembling' it keeps counting from the end of the previous launch, so crew
 * walking back from the pad continue smoothly into the next rocket's assembly.
 */
export function launchTime(r: Pick<RocketState, 'phase' | 'phaseTime'>): number {
  const t = Number.isFinite(r.phaseTime) ? r.phaseTime : 0
  switch (r.phase) {
    case 'rollout':
      return T_ROLLOUT + t
    case 'pad':
      return T_PAD + t
    case 'countdown':
      return t
    case 'ignition':
      return T_IGNITION + t
    case 'flight':
      return T_LIFTOFF + t
    case 'aftermath':
      return T_AFTERMATH + t
    case 'reset':
      return T_RESET + t
    case 'assembling':
    default:
      return T_END + t
  }
}

/**
 * Where the transporter should be (0 = tower, 1 = pad) for a sim state. Same
 * endpoints as the sim's `transport` value, but with a trapezoid profile (a
 * steady walking pace the crew can keep up with instead of a cubic sprint).
 */
export function transportTarget(phase: RocketPhase, phaseTime: number): number {
  switch (phase) {
    case 'rollout':
      return trapezoid(phaseTime, ROLL.total, ROLL.ta, ROLL.td)
    case 'pad':
    case 'countdown':
    case 'ignition':
    case 'flight':
      return 1
    case 'aftermath':
      return 1 - trapezoid(phaseTime, RETURN.total, RETURN.ta, RETURN.td)
    case 'reset':
      return 1 - trapezoid(PHASE_SECONDS.aftermath + phaseTime, RETURN.total, RETURN.ta, RETURN.td)
    case 'assembling':
    default:
      return 0
  }
}

/** Is the rocket still standing on the transporter? */
export function rocketOnTransporter(phase: RocketPhase): boolean {
  return phase === 'assembling' || phase === 'rollout' || phase === 'pad' || phase === 'countdown' || phase === 'ignition'
}

// ---------------------------------------------------------------------------
// Crane
// ---------------------------------------------------------------------------

export interface StageDims {
  minY: number
  maxY: number
  hookY: number
}

export interface CraneState {
  /** Hook point (world) — where a rig's hookY sits. */
  hx: number
  hy: number
  hz: number
  /** Stage index hanging on the hook, or -1. */
  hanging: number
  /** Stage index standing on the staging deck (being fabricated), or -1. */
  staged: number
  /** 0..1 fabrication growth of the staged part. */
  grow: number
  /** Which stage's rigging hangs from the hook. */
  rig: number
  /** Crew bolting a seated part (sparks). */
  welding: boolean
  /** Small pendulum sway (radians) of a moving load. */
  sway: number
  /** Jib slew angle (rad; 0 = +Z) and trolley radius (m) from the crane pivot. */
  jib: number
  trolley: number
}

export function createCraneState(): CraneState {
  return { hx: 0, hy: 0, hz: 0, hanging: -1, staged: -1, grow: 0, rig: 0, welding: false, sway: 0, jib: CRANE_PARK.angle, trolley: CRANE_PARK.radius }
}

const HOOK_MAX_Y = CRANE_TROLLEY_Y - 1.1

/** Placed hook point of stage k (world). */
function placedHookY(dims: StageDims[], k: number): number {
  return DECK_Y + dims[k].hookY
}

/** Hook height while stage k stands on the staging deck. */
function stagedHookY(dims: StageDims[], k: number): number {
  return STAGING_DECK_Y - dims[k].minY + dims[k].hookY
}

/** Hook height that keeps stage k's bottom clear of the rocket stack and the staging deck. */
function clearHookY(dims: StageDims[], k: number): number {
  let top = DECK_Y
  for (let j = 0; j < k; j++) top = Math.max(top, DECK_Y + dims[j].maxY)
  const bottom = Math.max(top + 0.6, STAGING_DECK_Y + 0.7)
  return Math.min(HOOK_MAX_Y, bottom - dims[k].minY + dims[k].hookY)
}

/** Polar position about the crane pivot. */
function toPolar(x: number, z: number): [number, number] {
  const dx = x - CRANE_PIVOT[0]
  const dz = z - CRANE_PIVOT[1]
  return [Math.atan2(dx, dz), Math.hypot(dx, dz)]
}

const PARK_XZ: [number, number] = [CRANE_PIVOT[0] + Math.sin(CRANE_PARK.angle) * CRANE_PARK.radius, CRANE_PIVOT[1] + Math.cos(CRANE_PARK.angle) * CRANE_PARK.radius]

/** Move along an arc between two points (slew angle + trolley radius interpolated). */
function arcLerp(out: CraneState, ax: number, az: number, bx: number, bz: number, t: number): void {
  const [a0, r0] = toPolar(ax, az)
  const [a1, r1] = toPolar(bx, bz)
  const a = a0 + wrapAngle(a1 - a0) * t
  const r = lerp(r0, r1, t)
  out.hx = CRANE_PIVOT[0] + Math.sin(a) * r
  out.hz = CRANE_PIVOT[1] + Math.cos(a) * r
}

/**
 * Crane + staging choreography for the current sim state. Stage k's progress p:
 *   0.00–0.16  part grows on the staging deck; empty hook slews over to it
 *   0.16–0.25  lift clear
 *   0.25–0.47  slew/trolley over the rocket
 *   0.47–0.88  lower onto the stack
 *   0.88–1.00  seated, crew bolting (sparks)
 */
export function craneState(phase: RocketPhase, phaseTime: number, stagesComplete: number, stageProgress: number, dims: StageDims[], out: CraneState): CraneState {
  const n = dims.length
  out.hanging = -1
  out.staged = -1
  out.grow = 0
  out.welding = false
  out.sway = 0
  const axisX = TOWER_CX
  const axisZ = TOWER_CZ
  if (phase === 'assembling' && stagesComplete < n && n > 0) {
    const k = clamp(Math.floor(stagesComplete), 0, n - 1)
    const p = clamp(Number.isFinite(stageProgress) ? stageProgress : 0, 0, 1)
    out.rig = k
    const stagedY = stagedHookY(dims, k)
    const clearY = clearHookY(dims, k)
    const placedY = placedHookY(dims, k)
    // where the empty hook comes from: the previous stage's seat, or the park spot
    const fromX = k > 0 ? axisX : PARK_XZ[0]
    const fromZ = k > 0 ? axisZ : PARK_XZ[1]
    const fromY = k > 0 ? placedHookY(dims, k - 1) : CRANE_PARK.hookY
    if (p < 0.16) {
      out.staged = k
      out.grow = smoothstep(0, 0.14, p)
      const u = p / 0.16
      const travelY = Math.min(HOOK_MAX_Y, Math.max(fromY, stagedY) + 1.2)
      if (u < 0.28) {
        arcLerp(out, fromX, fromZ, fromX, fromZ, 0)
        out.hy = lerp(fromY, travelY, easeInOut(u / 0.28))
      } else if (u < 0.78) {
        const t = easeInOut((u - 0.28) / 0.5)
        arcLerp(out, fromX, fromZ, STAGING_POINT[0], STAGING_POINT[1], t)
        out.hy = travelY
      } else {
        arcLerp(out, STAGING_POINT[0], STAGING_POINT[1], STAGING_POINT[0], STAGING_POINT[1], 0)
        out.hy = lerp(travelY, stagedY, easeInOut((u - 0.78) / 0.22))
      }
    } else if (p < 0.25) {
      out.hanging = k
      arcLerp(out, STAGING_POINT[0], STAGING_POINT[1], STAGING_POINT[0], STAGING_POINT[1], 0)
      out.hy = lerp(stagedY, Math.max(stagedY, clearY), easeInOut((p - 0.16) / 0.09))
    } else if (p < 0.47) {
      out.hanging = k
      const t = easeInOut((p - 0.25) / 0.22)
      arcLerp(out, STAGING_POINT[0], STAGING_POINT[1], axisX, axisZ, t)
      out.hy = Math.max(stagedY, clearY)
      out.sway = Math.sin(t * Math.PI) * 0.045
    } else if (p < 0.88) {
      out.hanging = k
      arcLerp(out, axisX, axisZ, axisX, axisZ, 0)
      const t = easeOut((p - 0.47) / 0.41)
      out.hy = lerp(Math.max(stagedY, clearY), placedY, t)
      out.sway = Math.sin((p - 0.47) * 40) * 0.012 * (1 - t)
    } else {
      out.hanging = k
      arcLerp(out, axisX, axisZ, axisX, axisZ, 0)
      out.hy = placedY + 0.04
      out.welding = true
    }
  } else if (phase === 'rollout' && n > 0) {
    // hook lets go of the finished rocket and returns to park
    out.rig = n - 1
    const t = easeInOut(clamp(phaseTime / 4, 0, 1))
    const lift = easeInOut(clamp(phaseTime / 1.5, 0, 1))
    const topY = placedHookY(dims, n - 1)
    arcLerp(out, axisX, axisZ, PARK_XZ[0], PARK_XZ[1], t)
    out.hy = lerp(topY, CRANE_PARK.hookY, Math.max(lift * 0.5, t))
  } else {
    out.rig = 0
    out.hx = PARK_XZ[0]
    out.hz = PARK_XZ[1]
    out.hy = CRANE_PARK.hookY
  }
  if (!Number.isFinite(out.hx) || !Number.isFinite(out.hy) || !Number.isFinite(out.hz)) {
    out.hx = PARK_XZ[0]
    out.hz = PARK_XZ[1]
    out.hy = CRANE_PARK.hookY
  }
  out.hy = Math.min(out.hy, HOOK_MAX_Y)
  const [a, r] = toPolar(out.hx, out.hz)
  out.jib = a
  out.trolley = r
  return out
}

/** Highest point (world) of the placed stack while assembling. */
export function stackTop(dims: StageDims[], stagesComplete: number): number {
  let top = DECK_Y
  for (let j = 0; j < Math.min(stagesComplete, dims.length); j++) top = Math.max(top, DECK_Y + dims[j].maxY)
  return top
}

/**
 * Umbilical arm extension 0 (retracted) .. 1 (connected). Arm k connects once
 * the stack reaches its height; both swing away as rollout begins.
 */
export function armExtension(k: number, armWorldY: number, phase: RocketPhase, phaseTime: number, dims: StageDims[], stagesComplete: number): number {
  if (phase === 'assembling') {
    const top = stackTop(dims, stagesComplete)
    // wait until the stack is tall enough, then swing in over ~1.5 s worth of the next stage
    return top > armWorldY + 0.35 ? 1 : 0
  }
  if (phase === 'rollout') return 1 - easeInOut(clamp((phaseTime - k * 0.25) / 1.4, 0, 1))
  return 0
}

// ---------------------------------------------------------------------------
// Status text (binoculars / kiosk)
// ---------------------------------------------------------------------------

const STAGE_LABEL = ['chassis', 'side tanks', 'fins', 'guidance ring', 'nose cone', 'questionable attachments']

function roughTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 50) return `~${Math.max(5, Math.round(s / 5) * 5)} s`
  const m = s / 60
  if (m < 1.4) return '~1 min'
  return `~${Math.round(m)} min`
}

/** Estimated seconds until liftoff, or null while a launch is in progress. */
export function launchEta(r: Pick<RocketState, 'phase' | 'phaseTime' | 'stagesComplete' | 'stageProgress'>, params: OptimizationParams): number | null {
  const after = PHASE_SECONDS.countdown + PHASE_SECONDS.ignition
  switch (r.phase) {
    case 'assembling': {
      const total = Math.max(60, worldCycleSeconds(params) - LAUNCH_SEQUENCE_SECONDS)
      const done = clamp((r.stagesComplete + clamp(r.stageProgress, 0, 1)) / 6, 0, 1)
      return total * (1 - done) + PHASE_SECONDS.rollout + PHASE_SECONDS.pad + after
    }
    case 'rollout':
      return PHASE_SECONDS.rollout - r.phaseTime + PHASE_SECONDS.pad + after
    case 'pad':
      return PHASE_SECONDS.pad - r.phaseTime + after
    case 'countdown':
      return PHASE_SECONDS.countdown - r.phaseTime + PHASE_SECONDS.ignition
    case 'ignition':
      return PHASE_SECONDS.ignition - r.phaseTime
    default:
      return null
  }
}

/** One-line status for the binoculars toast. */
export function binocularsText(r: RocketState, params: OptimizationParams): string {
  const eta = launchEta(r, params)
  switch (r.phase) {
    case 'assembling': {
      const pct = Math.round(clamp((r.stagesComplete + clamp(r.stageProgress, 0, 1)) / 6, 0, 1) * 100)
      return `Next launch: assembly ${pct}% — ETA ${roughTime(eta ?? 0)}`
    }
    case 'rollout':
      return `Rocket #${r.id} is rolling out to the pad — launch in ${roughTime(eta ?? 0)}`
    case 'pad':
      return `Rocket #${r.id} is on the pad. Final checks (kicking the tyres) — launch in ${roughTime(eta ?? 0)}`
    case 'countdown':
      return `T-minus ${Math.max(1, Math.ceil(r.countdown ?? PHASE_SECONDS.countdown - r.phaseTime))}. Hold onto your hard hat.`
    case 'ignition':
      return 'Ignition! Watch the pad.'
    case 'flight':
      return 'Rocket in flight. Everyone is very calm.'
    default:
      return 'Pad clean-up in progress. The next rocket is already being bolted together.'
  }
}

/** Kiosk toast: what the tower is doing right now. */
export function kioskText(r: RocketState, params: OptimizationParams): string {
  if (r.phase === 'assembling') {
    const k = clamp(Math.floor(r.stagesComplete), 0, 5)
    const pct = Math.round(clamp(r.stageProgress, 0, 1) * 100)
    const eta = launchEta(r, params)
    return `Rocket #${r.id}: ${STAGE_LABEL[k]} going on (stage ${k + 1} of 6, ${pct}%). Launch in ${roughTime(eta ?? 0)}. Simulated, obviously.`
  }
  return binocularsText(r, params)
}
