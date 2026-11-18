/**
 * Pure arcade handling model for the forklift (unit-tested). The physics step
 * (forklift/ForkliftSystem.ts) turns these targets into velocity changes on the
 * Rapier body; collisions still act on top.
 *
 * Conventions: throttle +1 = forward (W), -1 = reverse/brake (S).
 * steer +1 = right (D), -1 = left (A). Yaw rate is + for counter-clockwise
 * seen from above (turning LEFT), matching yaw (0 = north, PI/2 = west).
 */
import { clamp, lerp } from '@/core/math'
import { DRIVE } from '../constants'

type Tuning = typeof DRIVE

/** Move `cur` toward `target` by at most `maxDelta`. */
export function approach(cur: number, target: number, maxDelta: number): number {
  if (!Number.isFinite(cur)) return target
  const d = target - cur
  if (Math.abs(d) <= maxDelta) return target
  return cur + Math.sign(d) * maxDelta
}

/**
 * New signed forward speed after one step.
 * - holding the travel direction accelerates (tapering near top speed),
 * - holding the opposite direction brakes, then drives the other way,
 * - no input coasts down; `parked` applies the strong parking brake.
 */
export function stepForwardSpeed(v: number, throttle: number, dt: number, parked = false, t: Tuning = DRIVE): number {
  if (!Number.isFinite(v)) return 0
  if (!(dt > 0)) return v
  const th = clamp(Number.isFinite(throttle) ? throttle : 0, -1, 1)
  if (parked || Math.abs(th) < 0.05) return approach(v, 0, (parked ? t.parkBrake : t.coast) * dt)
  const mag = Math.abs(th)
  if (th > 0) {
    if (v < -0.05) return approach(v, 0, t.brake * dt * Math.max(0.5, mag))
    const target = t.maxForward * mag
    if (v > target) return approach(v, target, t.coast * dt)
    const taper = 1 - 0.55 * (Math.max(0, v) / t.maxForward) ** 2
    return approach(v, target, t.accel * taper * dt * Math.max(0.35, mag))
  }
  if (v > 0.05) return approach(v, 0, t.brake * dt * Math.max(0.5, mag))
  const target = -t.maxReverse * mag
  if (v < target) return approach(v, target, t.coast * dt)
  return approach(v, target, t.reverseAccel * dt * Math.max(0.35, mag))
}

/** Smoothed steering: chase the input quickly, self-center a bit faster. */
export function stepSteer(cur: number, input: number, dt: number, t: Tuning = DRIVE): number {
  const target = clamp(Number.isFinite(input) ? input : 0, -1, 1)
  const c = Number.isFinite(cur) ? cur : 0
  const towardCenter = Math.abs(target) < Math.abs(c) || Math.sign(target) * Math.sign(c) < 0
  return approach(c, target, (towardCenter ? t.steerReturn : t.steerRate) * dt)
}

/**
 * Yaw rate (rad/s, + = turning left) for forward speed `v` and steer.
 * Proportional to speed (no turning on the spot), capped at speed. Reversing
 * flips the sign naturally, like a car.
 */
export function yawRateFor(v: number, steer: number, t: Tuning = DRIVE): number {
  if (!Number.isFinite(v) || !Number.isFinite(steer)) return 0
  const k = Math.min(Math.abs(v) * t.yawPerSpeed, t.maxYawRate)
  const r = -clamp(steer, -1, 1) * k * Math.sign(v)
  return r === 0 ? 0 : r
}

/** Fraction of side slip removed per step: grippy when slow, a little loose when fast at full lock. */
export function lateralGripFor(v: number, steer: number, t: Tuning = DRIVE): number {
  const s = clamp(Math.abs(v) / t.maxForward, 0, 1) * clamp(Math.abs(steer), 0, 1)
  return lerp(t.lateralGrip, t.lateralGripFast, s)
}

/** Engine loop pitch: 1 at idle up to 2.5 flat out. */
export function engineRate(v: number, throttle: number, t: Tuning = DRIVE): number {
  const sp = Number.isFinite(v) ? Math.abs(v) : 0
  const th = Number.isFinite(throttle) ? Math.abs(throttle) : 0
  const load = clamp((sp / t.maxForward) * 0.75 + clamp(th, 0, 1) * 0.25, 0, 1)
  return 1 + 1.5 * load
}

/**
 * Visual rear-wheel angle (rad about +Y) for a steer input. A rear-steer
 * forklift turns right by swinging its tail LEFT, so the rear wheels point
 * the opposite way to the turn (that's the clumsy charm).
 */
export function rearWheelAngle(steer: number, maxAngle = 0.62): number {
  return clamp(Number.isFinite(steer) ? steer : 0, -1, 1) * maxAngle
}

/** Clamp a velocity vector's horizontal magnitude in place; returns true if changed. */
export function capPlanar(v: { x: number; z: number }, max: number): boolean {
  const s = Math.hypot(v.x, v.z)
  if (s <= max || !(s > 0)) return false
  const k = max / s
  v.x *= k
  v.z *= k
  return true
}
