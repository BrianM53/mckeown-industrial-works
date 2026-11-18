/**
 * Bumpable-prop housekeeping rules (unit-tested):
 *  - fell out of the world / NaN / pushed outside the playable area → reset now;
 *  - displaced (> 0.5 m from home, or tipped over) for > 60 s while the
 *    visitor is > 25 m away from both the prop and its home → reset quietly.
 */
import type { Rect } from '@/core/types'
import { PLAYABLE_BOUNDS } from '@/world/layout'
import { PROPS } from '../constants'

export interface PropSnapshot {
  x: number
  y: number
  z: number
  /** Body up·Y (1 = upright). */
  up: number
  homeX: number
  homeY: number
  homeZ: number
  /** Visitor position on the ground plane. */
  playerX: number
  playerZ: number
}

export type PropVerdict = 'ok' | 'displaced' | 'reset-now' | 'reset'

export interface PropRuleConfig {
  resetAfter: number
  displacedDistance: number
  playerFarDistance: number
  killY: number
  bounds: Rect
  boundsSlack: number
}

export const PROP_RULES: PropRuleConfig = {
  resetAfter: PROPS.resetAfter,
  displacedDistance: PROPS.displacedDistance,
  playerFarDistance: PROPS.playerFarDistance,
  killY: -2,
  bounds: PLAYABLE_BOUNDS,
  boundsSlack: 0.6,
}

export function isLost(p: PropSnapshot, cfg: PropRuleConfig = PROP_RULES): boolean {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return true
  if (p.y < cfg.killY) return true
  const b = cfg.bounds
  const s = cfg.boundsSlack
  return p.x < b.minX - s || p.x > b.maxX + s || p.z < b.minZ - s || p.z > b.maxZ + s
}

export function isDisplaced(p: PropSnapshot, cfg: PropRuleConfig = PROP_RULES): boolean {
  const moved = Math.hypot(p.x - p.homeX, p.z - p.homeZ) > cfg.displacedDistance || Math.abs(p.y - p.homeY) > cfg.displacedDistance
  const tipped = Number.isFinite(p.up) && p.up < 0.7
  return moved || tipped
}

/**
 * Advance one prop's timer by `dt` and decide. Returns the verdict and the
 * new displaced-for time (callers keep it per prop).
 */
export function propRule(p: PropSnapshot, displacedFor: number, dt: number, cfg: PropRuleConfig = PROP_RULES): { verdict: PropVerdict; displacedFor: number } {
  if (isLost(p, cfg)) return { verdict: 'reset-now', displacedFor: 0 }
  if (!isDisplaced(p, cfg)) return { verdict: 'ok', displacedFor: 0 }
  const t = displacedFor + Math.max(0, dt)
  const far =
    Math.hypot(p.playerX - p.x, p.playerZ - p.z) > cfg.playerFarDistance && Math.hypot(p.playerX - p.homeX, p.playerZ - p.homeZ) > cfg.playerFarDistance
  if (t >= cfg.resetAfter && far) return { verdict: 'reset', displacedFor: 0 }
  return { verdict: 'displaced', displacedFor: t }
}
