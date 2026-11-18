import * as THREE from 'three'
import type { RapierRigidBody } from '@react-three/rapier'
import { runtime } from '@/core/runtime'

/**
 * Allocation-free ball tracking from the (interpolated) rigid-body object:
 * position, finite-difference velocity, bounce detection and the idle timer
 * that sends a forgotten ball back to its spot. Also the "walk into the ball"
 * dribble nudge (the character controller alone tends to stop dead on it).
 */
export interface BallTracker {
  pos: THREE.Vector3
  prev: THREE.Vector3
  vel: THREE.Vector3
  speed: number
  /** Seconds the ball has been resting away from its spot. */
  idle: number
  spot: { x: number; z: number }
  radius: number
  bounced: boolean
  /** Downward speed at the last bounce (m/s). */
  impact: number
  prevVy: number
  dribbleCd: number
  /** Frames to skip velocity estimation (after teleports). */
  skip: number
}

export function makeBallTracker(x: number, radius: number, z: number): BallTracker {
  return {
    pos: new THREE.Vector3(x, radius, z),
    prev: new THREE.Vector3(x, radius, z),
    vel: new THREE.Vector3(),
    speed: 0,
    idle: 0,
    spot: { x, z },
    radius,
    bounced: false,
    impact: 0,
    prevVy: 0,
    dribbleCd: 0,
    skip: 2,
  }
}

export function trackBall(t: BallTracker, p: THREE.Vector3, dt: number): void {
  t.prev.copy(t.pos)
  t.pos.copy(p)
  t.dribbleCd = Math.max(0, t.dribbleCd - dt)
  t.bounced = false
  if (t.skip > 0 || dt < 1e-4) {
    t.skip = Math.max(0, t.skip - 1)
    t.vel.set(0, 0, 0)
    t.prevVy = 0
    t.speed = 0
    return
  }
  t.vel.subVectors(t.pos, t.prev).divideScalar(dt)
  if (!Number.isFinite(t.vel.x) || !Number.isFinite(t.vel.y) || !Number.isFinite(t.vel.z)) t.vel.set(0, 0, 0)
  t.speed = t.vel.length()
  if (t.prevVy < -1.2 && t.vel.y > t.prevVy * 0.3 && t.pos.y < t.radius + 0.3) {
    t.bounced = true
    t.impact = -t.prevVy
  }
  t.prevVy = t.vel.y
  const far = Math.hypot(t.pos.x - t.spot.x, t.pos.z - t.spot.z) > 0.6
  t.idle = t.speed < 0.08 && far ? t.idle + dt : 0
}

/**
 * Nudge the ball ahead of a visitor walking into it: within `reach` (m, ball
 * center to worker center) and moving toward it, the ball gets a velocity a bit
 * faster than the worker along their heading (never slows a faster ball).
 */
export function dribble(t: BallTracker, body: RapierRigidBody, reach: number, mult: number): boolean {
  if (runtime.player.mode !== 'foot' || t.dribbleCd > 0) return false
  const p = runtime.player.position
  const v = runtime.player.velocity
  const dx = t.pos.x - p.x
  const dz = t.pos.z - p.z
  const d = Math.hypot(dx, dz)
  const sp = Math.hypot(v.x, v.z)
  if (d > reach || d < 1e-3 || sp < 0.8 || t.pos.y > 0.9) return false
  const dot = (dx * v.x + dz * v.z) / (d * sp)
  if (dot < 0.45) return false
  let nx = (v.x / sp) * 0.7 + (dx / d) * 0.3
  let nz = (v.z / sp) * 0.7 + (dz / d) * 0.3
  const nl = Math.hypot(nx, nz) || 1
  nx /= nl
  nz /= nl
  const want = Math.min(7, sp * mult + 0.6)
  if (t.vel.x * nx + t.vel.z * nz >= want * 0.85) return false
  try {
    body.setLinvel({ x: nx * want, y: Math.max(0.35, t.vel.y), z: nz * want }, true)
  } catch {
    return false
  }
  t.dribbleCd = 0.18
  return true
}
