import { clamp, damp, wrapAngle } from '@/core/math'
import { CAMERA } from './constants'

/**
 * Pure camera math (unit-tested): orbit clamps, zoom, spring-arm smoothing,
 * interior limits. The rig (cameraRig.ts) wires these to the scene and physics.
 *
 * Orbit convention: `yaw` is the horizontal direction the camera LOOKS
 * (forward(yaw) = (-sin, 0, -cos)); the camera sits behind the pivot, opposite
 * to that. `pitch` > 0 puts the camera above the pivot looking down.
 */

export function clampPitch(p: number, min: number = CAMERA.minPitch, max: number = CAMERA.maxPitch): number {
  return clamp(Number.isFinite(p) ? p : CAMERA.defaultPitch, min, max)
}

export function clampDistance(d: number, min: number = CAMERA.minDistance, max: number = CAMERA.maxDistance): number {
  return clamp(Number.isFinite(d) ? d : CAMERA.defaultDistance, min, max)
}

/** Zoom multiplicatively: `logDelta` > 0 zooms out. Result is clamped to [min, max]. */
export function applyZoom(distance: number, logDelta: number, min: number = CAMERA.minDistance, max: number = CAMERA.maxDistance): number {
  if (!Number.isFinite(logDelta)) return clampDistance(distance, min, max)
  return clampDistance(distance * Math.exp(logDelta), min, max)
}

/** Normalize a WheelEvent delta to log-zoom units (positive = zoom out). Clamped per event. */
export function wheelToZoom(deltaY: number, deltaMode: number): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY
  return clamp(px * CAMERA.wheelZoomPerPx, -0.6, 0.6)
}

/** Camera offset from the pivot for an orbit (yaw, pitch, distance). */
export function orbitOffset(yaw: number, pitch: number, dist: number, out: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }) {
  const cp = Math.cos(pitch)
  out.x = Math.sin(yaw) * cp * dist
  out.y = Math.sin(pitch) * dist
  out.z = Math.cos(yaw) * cp * dist
  return out
}

/** Yaw that puts the camera directly behind something facing `facingYaw`. */
export function behindYaw(facingYaw: number): number {
  return wrapAngle(facingYaw)
}

/** Express `target` as the angle closest to `current` (for unwrapped damping). */
export function nearestAngle(current: number, target: number): number {
  return current + wrapAngle(target - current)
}

/** Boom-length state for the spring arm. */
export interface ArmState {
  length: number
  /** True while the arm sits at its desired length (follows zoom 1:1). False while recovering from an obstruction. */
  free: boolean
}

/**
 * Spring-arm smoothing. `desired` is the (already smoothed) zoom distance,
 * `allowed` the collision-free length from the probe cast.
 *  - Pull in IMMEDIATELY when something is in the way (never clips).
 *  - Ease back out slowly once the obstruction clears (no popping).
 *  - Unobstructed zooming follows `desired` directly (no double smoothing).
 */
export function springArmStep(state: ArmState, desired: number, allowed: number, dt: number, outLambda: number = CAMERA.armOutLambda): number {
  const blocked = allowed < desired - 1e-3
  const target = Math.min(desired, allowed)
  if (!Number.isFinite(state.length)) state.length = target
  if (target <= state.length) {
    state.length = target
    state.free = !blocked
  } else if (state.free) {
    state.length = target
  } else {
    state.length = damp(state.length, target, outLambda, dt)
    if (target - state.length < 0.02) {
      state.length = target
      state.free = !blocked
    }
  }
  return state.length
}

/**
 * Longest boom (from a pivot at `pivotY`, pitched `pitch`) that keeps the camera
 * at or below `ceilingY`. Infinity when the camera points level/down from below.
 */
export function ceilingLimit(pivotY: number, pitch: number, ceilingY: number): number {
  const s = Math.sin(pitch)
  if (s <= 1e-4) return Infinity
  return Math.max(0, (ceilingY - pivotY) / s)
}

/** Frame-rate independent trauma decay for camera shake. */
export function decayTrauma(trauma: number, dt: number, duration: number): number {
  const rate = 1 / Math.max(0.05, duration)
  return Math.max(0, trauma - rate * dt)
}

/** Smooth, deterministic pseudo-noise in [-1, 1] for shake (sum of incommensurate sines). */
export function shakeNoise(t: number, seed: number): number {
  return (
    Math.sin(t * 37.1 + seed * 1.7) * 0.5 +
    Math.sin(t * 23.3 + seed * 3.1) * 0.3 +
    Math.sin(t * 51.7 + seed * 5.3) * 0.2
  )
}

/** Worker opacity when the boom is very short (camera would otherwise sit inside the head). */
export function nearFade(armLength: number, near: number = CAMERA.fadeNear, far: number = CAMERA.fadeFar): number {
  const t = clamp((armLength - near) / (far - near), 0, 1)
  return t * t * (3 - 2 * t)
}

const RAD = Math.PI / 180

/**
 * Vertical FOV (degrees) for the viewport aspect. Landscape keeps `baseFov`;
 * narrow (portrait) screens widen it so the horizontal view stays at least
 * `minHorizontalFov`, up to `maxFov` (a 55° vertical FOV on a 9:20 phone would
 * show only ~28° across).
 */
export function fovForAspect(
  aspect: number,
  baseFov: number = CAMERA.fov,
  minHorizontalFov: number = CAMERA.minHorizontalFov,
  maxFov: number = CAMERA.maxPortraitFov,
): number {
  if (!Number.isFinite(aspect) || aspect <= 0) return baseFov
  const need = (2 * Math.atan(Math.tan((minHorizontalFov * RAD) / 2) / aspect)) / RAD
  return clamp(need, baseFov, Math.max(baseFov, maxFov))
}

/** Horizontal FOV (degrees) seen with vertical FOV `fov` at `aspect`. */
export function horizontalFov(fov: number, aspect: number): number {
  return (2 * Math.atan(Math.tan((fov * RAD) / 2) * aspect)) / RAD
}

/**
 * Extra look-target height on portrait screens (m): aim a little higher so the
 * worker sits in the lower part of the tall frame and more of the factory shows.
 * 0 for aspect >= 1, `max` at aspect <= 0.5.
 */
export function portraitLookLift(aspect: number, max: number = CAMERA.portraitLookLift): number {
  if (!Number.isFinite(aspect) || aspect <= 0 || aspect >= 1) return 0
  return max * clamp((1 - aspect) / 0.5, 0, 1)
}

/** A doorway in a building wall: the wall's mid-plane and the opening's span along it. */
export interface DoorSlab {
  /** 'x': the wall is a plane x = `plane` (E/W walls); 'z': a plane z = `plane` (N/S walls). */
  axis: 'x' | 'z'
  plane: number
  /** Opening span along the wall (z range for 'x' walls, x range for 'z' walls). */
  min: number
  max: number
}

/**
 * Longest boom (m) that keeps the camera below `maxY` while the boom passes through a doorway
 * (Infinity when the first `length` metres of the boom cross no door). The boom starts at the
 * pivot (px, py, pz) and runs along the unit vector (dx, dy, dz). With the camera kept low the
 * chase cam slips under a door header / half-lowered curtain instead of through it; when even
 * that is impossible it stops short on the pivot's side of the wall.
 */
export function doorwayLimit(
  px: number,
  py: number,
  pz: number,
  dx: number,
  dy: number,
  dz: number,
  length: number,
  doors: readonly DoorSlab[],
  maxY: number,
): number {
  if (!(dy > 1e-4) || !(length > 0)) return Infinity // level or descending boom: never above the pivot
  let crosses = false
  for (const d of doors) {
    const o = d.axis === 'x' ? px : pz
    const v = d.axis === 'x' ? dx : dz
    if (Math.abs(v) < 1e-6) continue
    const s = (d.plane - o) / v
    if (!(s > 0 && s < length)) continue
    const along = d.axis === 'x' ? pz + dz * s : px + dx * s
    if (along >= d.min && along <= d.max) {
      crosses = true
      break
    }
  }
  return crosses ? Math.max(0, (maxY - py) / dy) : Infinity
}
