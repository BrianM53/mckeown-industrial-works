import type { Vec2 } from '@/core/types'

/**
 * Pure polyline helpers for the directory route guide (unit-tested).
 */
export interface Polyline {
  pts: Vec2[]
  /** Cumulative arc length at each point. */
  cum: number[]
  length: number
}

export function buildPolyline(pts: Vec2[]): Polyline {
  const clean: Vec2[] = []
  for (const p of pts) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue
    const last = clean[clean.length - 1]
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-3) clean.push([p[0], p[1]])
  }
  const cum: number[] = []
  let len = 0
  for (let i = 0; i < clean.length; i++) {
    if (i > 0) len += Math.hypot(clean[i][0] - clean[i - 1][0], clean[i][1] - clean[i - 1][1])
    cum.push(len)
  }
  return { pts: clean, cum, length: len }
}

/** Closest point on the polyline to (x, z): arc length `s` and distance `dist`. */
export function projectOnPolyline(poly: Polyline, x: number, z: number): { s: number; dist: number } {
  const { pts, cum } = poly
  if (pts.length === 0) return { s: 0, dist: Infinity }
  if (pts.length === 1) return { s: 0, dist: Math.hypot(x - pts[0][0], z - pts[0][1]) }
  let bestS = 0
  let bestD = Infinity
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0]
    const az = pts[i - 1][1]
    const bx = pts[i][0]
    const bz = pts[i][1]
    const dx = bx - ax
    const dz = bz - az
    const l2 = dx * dx + dz * dz
    const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / l2)) : 0
    const px = ax + dx * t
    const pz = az + dz * t
    const d = Math.hypot(x - px, z - pz)
    if (d < bestD) {
      bestD = d
      bestS = cum[i - 1] + Math.sqrt(l2) * t
    }
  }
  return { s: bestS, dist: bestD }
}

export interface PolySample {
  x: number
  z: number
  /** Unit direction of travel. */
  dx: number
  dz: number
}

/** Position and direction at arc length `s` (clamped to the ends). */
export function sampleAt(poly: Polyline, s: number, out: PolySample = { x: 0, z: 0, dx: 0, dz: -1 }): PolySample {
  const { pts, cum } = poly
  if (pts.length === 0) return out
  if (pts.length === 1) {
    out.x = pts[0][0]
    out.z = pts[0][1]
    return out
  }
  const ss = Math.min(Math.max(s, 0), poly.length)
  let i = 1
  while (i < pts.length - 1 && cum[i] < ss) i++
  const ax = pts[i - 1][0]
  const az = pts[i - 1][1]
  const bx = pts[i][0]
  const bz = pts[i][1]
  const segLen = cum[i] - cum[i - 1]
  const t = segLen > 0 ? (ss - cum[i - 1]) / segLen : 0
  out.x = ax + (bx - ax) * t
  out.z = az + (bz - az) * t
  if (segLen > 0) {
    out.dx = (bx - ax) / segLen
    out.dz = (bz - az) / segLen
  }
  return out
}

export function distanceToPolyline(poly: Polyline, x: number, z: number): number {
  return projectOnPolyline(poly, x, z).dist
}
