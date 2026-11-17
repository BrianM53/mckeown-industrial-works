/**
 * Orientation conventions (MUST be followed by every module):
 *   - Y is up. North is -Z, east is +X. Units are meters.
 *   - yaw is a rotation about +Y. forward(yaw) = (-sin yaw, 0, -cos yaw).
 *       yaw 0 = facing north (-Z), yaw PI/2 = west (-X), yaw -PI/2 = east (+X), yaw PI = south (+Z).
 *   - All models are authored facing -Z in local space, so `object.rotation.y = yaw`
 *     makes them face forward(yaw). (Same as three.js cameras.)
 */
export const TAU = Math.PI * 2

export function forwardFromYaw(yaw: number): { x: number; z: number } {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) }
}

export function rightFromYaw(yaw: number): { x: number; z: number } {
  return { x: Math.cos(yaw), z: -Math.sin(yaw) }
}

/** Yaw that faces along direction (dx, dz). */
export function yawFromDirection(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz)
}

/** Yaw that, standing at `from`, faces `to`. */
export function yawToward(from: { x: number; z: number }, to: { x: number; z: number }): number {
  return yawFromDirection(to.x - from.x, to.z - from.z)
}

/**
 * Camera-relative movement. inputX: strafe right (+1) / left (-1);
 * inputY: forward (+1) / back (-1). Returns a world-space direction on the
 * ground plane with length <= 1 (diagonals normalized, analog sticks preserved).
 */
export function cameraRelativeMove(inputX: number, inputY: number, cameraYaw: number): { x: number; z: number } {
  let ix = inputX
  let iy = inputY
  const len = Math.hypot(ix, iy)
  if (len < 1e-6) return { x: 0, z: 0 }
  if (len > 1) {
    ix /= len
    iy /= len
  }
  const f = forwardFromYaw(cameraYaw)
  const r = rightFromYaw(cameraYaw)
  return { x: f.x * iy + r.x * ix, z: f.z * iy + r.z * ix }
}

/** Wrap angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI
  return a === -Math.PI ? Math.PI : a
}

/** Frame-rate independent exponential smoothing factor. */
export function dampFactor(lambda: number, dt: number): number {
  return 1 - Math.exp(-lambda * dt)
}

export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * dampFactor(lambda, dt)
}

/** Damp along the shortest arc between two angles. */
export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  return current + wrapAngle(target - current) * dampFactor(lambda, dt)
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

export function pointInRect(x: number, z: number, r: { minX: number; maxX: number; minZ: number; maxZ: number }, pad = 0): boolean {
  return x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad
}
