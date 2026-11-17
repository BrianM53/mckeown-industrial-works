import { cameraRelativeMove, dampAngle, yawFromDirection } from '@/core/math'
import { PLAYER } from './constants'

/**
 * Pure locomotion math (unit-tested). The controller calls these once per fixed
 * physics step; nothing here touches Rapier or React.
 */

export interface Planar {
  x: number
  z: number
}

/**
 * Desired planar velocity from stick/keys, relative to the camera yaw.
 * Diagonals are normalized; analog magnitudes (< 1) walk proportionally slower.
 */
export function targetVelocity(inputX: number, inputY: number, cameraYaw: number, run: boolean, out: Planar = { x: 0, z: 0 }): Planar {
  const dir = cameraRelativeMove(inputX, inputY, cameraYaw)
  const speed = run ? PLAYER.runSpeed : PLAYER.walkSpeed
  out.x = dir.x * speed
  out.z = dir.z * speed
  return out
}

/**
 * Move `v` toward `target` with linear acceleration: `accel` while speeding up
 * or turning, `decel` when stopping or reversing (snappy arcade feel).
 * Mutates and returns `v`.
 */
export function approachVelocity(v: Planar, target: Planar, accel: number, decel: number, dt: number): Planar {
  const tl = Math.hypot(target.x, target.z)
  const reversing = v.x * target.x + v.z * target.z < 0
  const rate = tl < 1e-4 || reversing ? decel : accel
  const dx = target.x - v.x
  const dz = target.z - v.z
  const d = Math.hypot(dx, dz)
  const maxDelta = rate * dt
  if (d <= maxDelta || d < 1e-9) {
    v.x = target.x
    v.z = target.z
  } else {
    v.x += (dx / d) * maxDelta
    v.z += (dz / d) * maxDelta
  }
  return v
}

/**
 * Turn the body toward the direction of travel. Returns the new facing yaw.
 * Below a small input magnitude the body keeps its current facing.
 */
export function turnToward(facing: number, moveX: number, moveZ: number, dt: number, lambda: number = PLAYER.turnLambda): number {
  if (Math.hypot(moveX, moveZ) < 0.05) return facing
  return dampAngle(facing, yawFromDirection(moveX, moveZ), lambda, dt)
}

/**
 * Vertical velocity update for a kinematic walker: a small constant push into
 * the ground while grounded (keeps ground detection stable), gravity otherwise.
 */
export function verticalVelocity(vy: number, grounded: boolean, dt: number): number {
  if (grounded && vy <= 0) return -1.5
  return Math.max(vy - PLAYER.gravity * dt, -PLAYER.maxFallSpeed)
}

/**
 * Integrate a simple walker on flat ground (no collisions). Used by tests and as
 * a reference for the fixed-step controller.
 */
export function simulateFlat(
  steps: number,
  dt: number,
  input: { x: number; y: number; run?: boolean },
  cameraYaw: number,
  start: { x: number; z: number; facing: number } = { x: 0, z: 0, facing: 0 },
): { x: number; z: number; vx: number; vz: number; facing: number } {
  const v: Planar = { x: 0, z: 0 }
  const tgt: Planar = { x: 0, z: 0 }
  let x = start.x
  let z = start.z
  let facing = start.facing
  for (let i = 0; i < steps; i++) {
    targetVelocity(input.x, input.y, cameraYaw, !!input.run, tgt)
    approachVelocity(v, tgt, PLAYER.accel, PLAYER.decel, dt)
    facing = turnToward(facing, tgt.x, tgt.z, dt)
    x += v.x * dt
    z += v.z * dt
  }
  return { x, z, vx: v.x, vz: v.z, facing }
}
