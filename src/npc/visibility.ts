/**
 * "Can the visitor plausibly see this?" — used to start gags and chatter only
 * where they will be noticed (pure; unit-tested).
 */
import { forwardFromYaw } from '@/core/math'
import { lineOfSight } from './geo'

export interface ViewState {
  /** Player feet. */
  px: number
  pz: number
  /** Camera position + orbit yaw (camera looks along forward(yaw)). */
  cx: number
  cz: number
  yaw: number
}

export const VIEW = {
  maxDistance: 35,
  /** Horizontal half-angle of the view cone (radians, a bit inside the 16:9 frame). */
  halfFov: (48 * Math.PI) / 180,
}

export function plausiblyVisible(x: number, z: number, v: ViewState, maxDistance: number = VIEW.maxDistance, halfFov: number = VIEW.halfFov): boolean {
  if (![x, z, v.px, v.pz, v.cx, v.cz, v.yaw].every(Number.isFinite)) return false
  if (Math.hypot(x - v.px, z - v.pz) > maxDistance) return false
  const dx = x - v.cx
  const dz = z - v.cz
  const d = Math.hypot(dx, dz)
  if (d > 0.5) {
    const f = forwardFromYaw(v.yaw)
    if ((dx * f.x + dz * f.z) / d < Math.cos(halfFov)) return false
  }
  return lineOfSight(v.cx, v.cz, x, z)
}
