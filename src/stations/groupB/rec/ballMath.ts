/**
 * Ball flight helpers (pure, unit-tested). Ballistic solutions under the world
 * gravity with a small first-order correction for linear damping, so a kick or
 * bump lands where the game intends (forgiving, "aim-assisted" arcade feel).
 */
import type { Rng } from '@/core/rng'
import type { Rect, Vec2 } from '@/core/types'
import { BALL_SPOT, GOAL, PITCH } from './layout'

/** World gravity magnitude (world/Scene.tsx mounts <Physics gravity={[0, -18, 0]}>). */
export const G = 18

export interface V3 {
  x: number
  y: number
  z: number
}

export interface Flight {
  v: V3
  /** Flight time to the target (s). */
  t: number
}

/**
 * Velocity that carries a ball from `from` to `to` in a lob whose apex is at
 * `apexY` (clamped above both ends). Damping is compensated to first order.
 */
export function solveLob(from: V3, to: V3, apexY: number, damping = 0): Flight {
  const top = Math.max(apexY, from.y + 0.2, to.y + 0.2)
  const up = Math.sqrt(2 * G * (top - from.y))
  const tUp = up / G
  const tDown = Math.sqrt((2 * (top - to.y)) / G)
  const t = tUp + tDown
  const k = 1 + damping * t * 0.5
  return { v: { x: ((to.x - from.x) / t) * k, y: up * (1 + damping * tUp * 0.5), z: ((to.z - from.z) / t) * k }, t }
}

/** Velocity for a driven shot along the ground plane at horizontal `speed` that reaches `to`. */
export function solveShot(from: V3, to: V3, speed: number, damping = 0): Flight {
  const dx = to.x - from.x
  const dz = to.z - from.z
  const d = Math.max(0.01, Math.hypot(dx, dz))
  const t = d / Math.max(0.1, speed)
  const k = 1 + damping * t * 0.5
  const vy = (to.y - from.y + 0.5 * G * t * t) / t
  return { v: { x: (dx / t) * k, y: vy, z: (dz / t) * k }, t }
}

/** Height of a ballistic flight (no damping) at time `t`. */
export function heightAt(from: V3, v: V3, t: number): number {
  return from.y + v.y * t - 0.5 * G * t * t
}

export interface KickPlan {
  kind: 'shot' | 'clear'
  /** Which side of the goal the shot goes (keeper's view irrelevant): -1 = west post, +1 = east post. */
  side: -1 | 1
  target: V3
  v: V3
  t: number
}

/**
 * Aim-assisted kick. From anywhere in front of the goal it shoots at a corner of
 * the goal mouth with a little randomness (always inside the posts and under
 * the bar). From behind/beside the goal it clears the ball back toward the spot.
 */
export function planKick(ball: V3, rng: Rng, damping = 0): KickPlan {
  const side: -1 | 1 = rng() < 0.5 ? -1 : 1
  const behind = ball.z < GOAL.mouthZ + 0.35
  const wide = Math.abs(ball.x - GOAL.x) > 6.5 && ball.z < GOAL.mouthZ + 3
  if (behind || wide) {
    const target = { x: BALL_SPOT[0] + (rng() - 0.5) * 2, y: 0.11, z: BALL_SPOT[1] + (rng() - 0.5) * 1.5 }
    const f = solveLob(ball, target, Math.max(ball.y, 0.11) + 1.6, damping)
    return { kind: 'clear', side, target, v: f.v, t: f.t }
  }
  const inner = GOAL.width / 2 - GOAL.post - 0.25
  const off = 0.45 + rng() * (inner - 0.45)
  const target = { x: GOAL.x + side * off, y: 0.3 + rng() * 0.7, z: GOAL.mouthZ - 0.55 }
  const dist = Math.hypot(target.x - ball.x, target.z - ball.z)
  const speed = Math.min(14, 8.5 + dist * 0.35)
  const f = solveShot(ball, target, speed, damping)
  return { kind: 'shot', side, target, v: f.v, t: f.t }
}

export function randomIn(r: Rect, rng: Rng): Vec2 {
  return [r.minX + rng() * (r.maxX - r.minX), r.minZ + rng() * (r.maxZ - r.minZ)]
}

/** True when the point is on the pitch (used to keep clearances sensible). */
export function onPitch(x: number, z: number): boolean {
  return x >= PITCH.minX && x <= PITCH.maxX && z >= PITCH.minZ && z <= PITCH.maxZ
}

/** Where along a flight the ball crosses plane z = zPlane (null if it never does). */
export function crossTime(from: V3, v: V3, zPlane: number): number | null {
  if (Math.abs(v.z) < 1e-6) return null
  const t = (zPlane - from.z) / v.z
  return t > 0 ? t : null
}
