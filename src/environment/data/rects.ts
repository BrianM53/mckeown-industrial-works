/**
 * Pure 2D rectangle / segment helpers for the environment layout (no three.js).
 * Ground-plane coordinates: x east, z south (north = -z).
 */
import type { Rect, Vec2 } from '@/core/types'

export function rect(minX: number, maxX: number, minZ: number, maxZ: number): Rect {
  return { minX: Math.min(minX, maxX), maxX: Math.max(minX, maxX), minZ: Math.min(minZ, maxZ), maxZ: Math.max(minZ, maxZ) }
}

/** Rect from a center and full size. */
export function rectAt(cx: number, cz: number, w: number, d: number): Rect {
  return { minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 }
}

export function expandRect(r: Rect, d: number): Rect {
  return { minX: r.minX - d, maxX: r.maxX + d, minZ: r.minZ - d, maxZ: r.maxZ + d }
}

/** True when the interiors overlap by more than `eps` (touching edges do not count). */
export function rectsOverlap(a: Rect, b: Rect, eps = 1e-6): boolean {
  return a.minX < b.maxX - eps && a.maxX > b.minX + eps && a.minZ < b.maxZ - eps && a.maxZ > b.minZ + eps
}

export function rectContains(r: Rect, x: number, z: number, pad = 0): boolean {
  return x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad
}

export function rectArea(r: Rect): number {
  return Math.max(0, r.maxX - r.minX) * Math.max(0, r.maxZ - r.minZ)
}

export function rectCenter(r: Rect): Vec2 {
  return [(r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2]
}

/** Axis-aligned bounds of a w×d rectangle centered at (cx, cz) rotated by `yaw` about +Y. */
export function rotatedRectBounds(cx: number, cz: number, w: number, d: number, yaw: number): Rect {
  const c = Math.abs(Math.cos(yaw))
  const s = Math.abs(Math.sin(yaw))
  const hw = (w * c + d * s) / 2
  const hd = (w * s + d * c) / 2
  return { minX: cx - hw, maxX: cx + hw, minZ: cz - hd, maxZ: cz + hd }
}

function pointRectDistance(x: number, z: number, r: Rect): number {
  const dx = Math.max(r.minX - x, 0, x - r.maxX)
  const dz = Math.max(r.minZ - z, 0, z - r.maxZ)
  return Math.hypot(dx, dz)
}

function pointSegmentDistance(px: number, pz: number, a: Vec2, b: Vec2): number {
  const vx = b[0] - a[0]
  const vz = b[1] - a[1]
  const len2 = vx * vx + vz * vz
  let t = len2 > 1e-12 ? ((px - a[0]) * vx + (pz - a[1]) * vz) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (a[0] + vx * t), pz - (a[1] + vz * t))
}

/** Liang–Barsky: does segment a→b intersect the closed rect? */
function segmentHitsRect(a: Vec2, b: Vec2, r: Rect): boolean {
  let t0 = 0
  let t1 = 1
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const p = [-dx, dx, -dz, dz]
  const q = [a[0] - r.minX, r.maxX - a[0], a[1] - r.minZ, r.maxZ - a[1]]
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-12) {
      if (q[i] < 0) return false
    } else {
      const t = q[i] / p[i]
      if (p[i] < 0) {
        if (t > t1) return false
        if (t > t0) t0 = t
      } else {
        if (t < t0) return false
        if (t < t1) t1 = t
      }
    }
  }
  return true
}

/** Shortest distance between segment a→b and rect r (0 when they intersect). */
export function segmentRectDistance(a: Vec2, b: Vec2, r: Rect): number {
  if (segmentHitsRect(a, b, r)) return 0
  const corners: Vec2[] = [
    [r.minX, r.minZ],
    [r.maxX, r.minZ],
    [r.minX, r.maxZ],
    [r.maxX, r.maxZ],
  ]
  let d = Math.min(pointRectDistance(a[0], a[1], r), pointRectDistance(b[0], b[1], r))
  for (const c of corners) d = Math.min(d, pointSegmentDistance(c[0], c[1], a, b))
  return d
}

/**
 * Decompose the union of (possibly overlapping) rects into disjoint rects
 * (coordinate compression + row merging). Used so coplanar ground layers never
 * overlap each other (no z-fighting inside a layer).
 */
export function disjointUnion(rects: Rect[]): Rect[] {
  const valid = rects.filter((r) => r.maxX - r.minX > 1e-6 && r.maxZ - r.minZ > 1e-6)
  if (!valid.length) return []
  const xs = [...new Set(valid.flatMap((r) => [r.minX, r.maxX]))].sort((a, b) => a - b)
  const zs = [...new Set(valid.flatMap((r) => [r.minZ, r.maxZ]))].sort((a, b) => a - b)
  const out: Rect[] = []
  // For each z band, find covered x cells and merge runs; then merge identical runs across bands.
  let open = new Map<string, Rect>()
  for (let j = 0; j < zs.length - 1; j++) {
    const z0 = zs[j]
    const z1 = zs[j + 1]
    const zm = (z0 + z1) / 2
    const runs: [number, number][] = []
    let runStart: number | null = null
    for (let i = 0; i < xs.length - 1; i++) {
      const xm = (xs[i] + xs[i + 1]) / 2
      const covered = valid.some((r) => xm > r.minX && xm < r.maxX && zm > r.minZ && zm < r.maxZ)
      if (covered && runStart === null) runStart = xs[i]
      if (!covered && runStart !== null) {
        runs.push([runStart, xs[i]])
        runStart = null
      }
    }
    if (runStart !== null) runs.push([runStart, xs[xs.length - 1]])
    const next = new Map<string, Rect>()
    for (const [a, b] of runs) {
      const key = `${a}:${b}`
      const prev = open.get(key)
      if (prev && Math.abs(prev.maxZ - z0) < 1e-9) {
        prev.maxZ = z1
        next.set(key, prev)
        open.delete(key)
      } else next.set(key, { minX: a, maxX: b, minZ: z0, maxZ: z1 })
    }
    open.forEach((r) => out.push(r))
    open = next
  }
  open.forEach((r) => out.push(r))
  return out
}

/** Subtract the given [a, b] intervals from [lo, hi]; returns the remaining pieces (min length `minLen`). */
export function subtractIntervals(lo: number, hi: number, cuts: [number, number][], minLen = 0.05): [number, number][] {
  let pieces: [number, number][] = [[lo, hi]]
  for (const [c0, c1] of cuts) {
    const next: [number, number][] = []
    for (const [a, b] of pieces) {
      if (c1 <= a || c0 >= b) {
        next.push([a, b])
        continue
      }
      if (c0 > a) next.push([a, c0])
      if (c1 < b) next.push([c1, b])
    }
    pieces = next
  }
  return pieces.filter(([a, b]) => b - a >= minLen)
}
