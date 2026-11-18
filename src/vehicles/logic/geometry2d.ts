/**
 * Pure ground-plane geometry helpers (x east, z south). No three.js.
 */
import type { Rect, Vec2 } from '@/core/types'
import { FORKLIFT } from '../constants'

export interface Pose2 {
  x: number
  z: number
  /** forward = (-sin yaw, -cos yaw) */
  yaw: number
}

/** Vehicle-frame offset (right, forward) → world (x, z). */
export function localToWorld(pose: Pose2, right: number, forward: number): Vec2 {
  const s = Math.sin(pose.yaw)
  const c = Math.cos(pose.yaw)
  // right(yaw) = (cos, -sin), forward(yaw) = (-sin, -cos)
  return [pose.x + c * right - s * forward, pose.z - s * right - c * forward]
}

export interface Footprint {
  halfWidth: number
  /** Most forward extent (positive meters ahead of the origin). */
  front: number
  /** Most rearward extent (positive meters behind the origin). */
  rear: number
}

/** The forklift's ground footprint (forks included). */
export const FORKLIFT_FOOTPRINT: Footprint = {
  halfWidth: FORKLIFT.halfWidth,
  front: -FORKLIFT.frontZ,
  rear: FORKLIFT.rearZ,
}

/** Corners of an oriented footprint, counter-clockwise from front-left. */
export function footprintCorners(pose: Pose2, fp: Footprint = FORKLIFT_FOOTPRINT, pad = 0): Vec2[] {
  const w = fp.halfWidth + pad
  const f = fp.front + pad
  const r = fp.rear + pad
  return [localToWorld(pose, -w, f), localToWorld(pose, -w, -r), localToWorld(pose, w, -r), localToWorld(pose, w, f)]
}

export function polygonBounds(pts: Vec2[]): Rect {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const [x, z] of pts) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  return { minX, maxX, minZ, maxZ }
}

export function rectsOverlap(a: Rect, b: Rect, eps = 1e-6): boolean {
  return a.minX < b.maxX - eps && a.maxX > b.minX + eps && a.minZ < b.maxZ - eps && a.maxZ > b.minZ + eps
}

/** Separating-axis test: convex polygon vs axis-aligned rect. */
export function polygonOverlapsRect(poly: Vec2[], r: Rect): boolean {
  const pb = polygonBounds(poly)
  if (!rectsOverlap(pb, r, 0)) return false
  const rectPts: Vec2[] = [
    [r.minX, r.minZ],
    [r.maxX, r.minZ],
    [r.maxX, r.maxZ],
    [r.minX, r.maxZ],
  ]
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i]
    const [bx, bz] = poly[(i + 1) % poly.length]
    const nx = -(bz - az)
    const nz = bx - ax
    let pMin = Infinity
    let pMax = -Infinity
    for (const [x, z] of poly) {
      const d = x * nx + z * nz
      if (d < pMin) pMin = d
      if (d > pMax) pMax = d
    }
    let rMin = Infinity
    let rMax = -Infinity
    for (const [x, z] of rectPts) {
      const d = x * nx + z * nz
      if (d < rMin) rMin = d
      if (d > rMax) rMax = d
    }
    if (pMax <= rMin || rMax <= pMin) return false
  }
  return true
}

export function pointInPolygon(x: number, z: number, poly: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]
    const [xj, zj] = poly[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi) inside = !inside
  }
  return inside
}

export function pointSegmentDistance(px: number, pz: number, a: Vec2, b: Vec2): number {
  const vx = b[0] - a[0]
  const vz = b[1] - a[1]
  const len2 = vx * vx + vz * vz
  let t = len2 > 1e-12 ? ((px - a[0]) * vx + (pz - a[1]) * vz) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (a[0] + vx * t), pz - (a[1] + vz * t))
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const d1 = o(c, d, a)
  const d2 = o(c, d, b)
  const d3 = o(a, b, c)
  const d4 = o(a, b, d)
  return d1 * d2 < 0 && d3 * d4 < 0
}

/** Minimum distance between a convex polygon and a segment (0 when they touch/overlap). */
export function polygonSegmentDistance(poly: Vec2[], a: Vec2, b: Vec2): number {
  if (pointInPolygon(a[0], a[1], poly) || pointInPolygon(b[0], b[1], poly)) return 0
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    if (segmentsIntersect(p, q, a, b)) return 0
    best = Math.min(best, pointSegmentDistance(p[0], p[1], a, b), pointSegmentDistance(a[0], a[1], p, q), pointSegmentDistance(b[0], b[1], p, q))
  }
  return best
}

/** Distance between two points on the ground plane. */
export function dist2(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz)
}

export function rectContains(r: Rect, x: number, z: number, pad = 0): boolean {
  return x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad
}

/** Minimum distance from a point to an axis-aligned rect (0 inside). */
export function pointRectDistance(x: number, z: number, r: Rect): number {
  const dx = Math.max(r.minX - x, 0, x - r.maxX)
  const dz = Math.max(r.minZ - z, 0, z - r.maxZ)
  return Math.hypot(dx, dz)
}
