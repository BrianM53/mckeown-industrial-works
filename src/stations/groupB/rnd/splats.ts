/**
 * Gaussian-SLAM scanner visualization helpers (pure, unit-tested). The real
 * project reconstructs a scene as 3D Gaussians from streamed video; this is
 * only a stylized nod to it: splats sampled on a miniature worker's surface,
 * revealed coarse-to-fine over a ~20 s cycle, then dissolved and restarted.
 */
import type * as THREE from 'three'
import { createRng } from '@/core/rng'

export interface SplatCloud {
  count: number
  /** Surface positions (geometry space). */
  pos: Float32Array
  /** Surface normals. */
  nor: Float32Array
  /** Linear RGB vertex colors. */
  color: Float32Array
  /** reveal threshold 0..1, size (m), anisotropy 0..1, screen rotation (rad). */
  seed: Float32Array
  bounds: { minY: number; maxY: number }
}

/**
 * Area-weighted surface sampling of an indexed geometry with a `color`
 * attribute. Deterministic for a given seed.
 */
export function sampleSplats(geo: THREE.BufferGeometry, count: number, seed = 1): SplatCloud {
  const rng = createRng(seed)
  const pos = geo.getAttribute('position')
  const col = geo.getAttribute('color')
  const idx = geo.index
  const triCount = idx ? idx.count / 3 : pos.count / 3
  const vi = (t: number, k: number) => (idx ? idx.getX(t * 3 + k) : t * 3 + k)
  // cumulative areas
  const cum = new Float64Array(triCount)
  let total = 0
  let minY = Infinity
  let maxY = -Infinity
  for (let t = 0; t < triCount; t++) {
    const a = vi(t, 0)
    const b = vi(t, 1)
    const c = vi(t, 2)
    const ux = pos.getX(b) - pos.getX(a)
    const uy = pos.getY(b) - pos.getY(a)
    const uz = pos.getZ(b) - pos.getZ(a)
    const vx = pos.getX(c) - pos.getX(a)
    const vy = pos.getY(c) - pos.getY(a)
    const vz = pos.getZ(c) - pos.getZ(a)
    const cx = uy * vz - uz * vy
    const cy = uz * vx - ux * vz
    const cz = ux * vy - uy * vx
    total += Math.hypot(cx, cy, cz) * 0.5
    cum[t] = total
    minY = Math.min(minY, pos.getY(a))
    maxY = Math.max(maxY, pos.getY(a))
  }
  const out: SplatCloud = {
    count,
    pos: new Float32Array(count * 3),
    nor: new Float32Array(count * 3),
    color: new Float32Array(count * 3),
    seed: new Float32Array(count * 4),
    bounds: { minY, maxY },
  }
  if (triCount === 0 || total <= 0) return { ...out, count: 0 }
  const h = Math.max(1e-3, maxY - minY)
  for (let i = 0; i < count; i++) {
    // binary search the triangle
    const r = rng() * total
    let lo = 0
    let hi = triCount - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cum[mid] < r) lo = mid + 1
      else hi = mid
    }
    const a = vi(lo, 0)
    const b = vi(lo, 1)
    const c = vi(lo, 2)
    let u = rng()
    let v = rng()
    if (u + v > 1) {
      u = 1 - u
      v = 1 - v
    }
    const w = 1 - u - v
    const px = pos.getX(a) * w + pos.getX(b) * u + pos.getX(c) * v
    const py = pos.getY(a) * w + pos.getY(b) * u + pos.getY(c) * v
    const pz = pos.getZ(a) * w + pos.getZ(b) * u + pos.getZ(c) * v
    // face normal
    const ux = pos.getX(b) - pos.getX(a)
    const uy = pos.getY(b) - pos.getY(a)
    const uz = pos.getZ(b) - pos.getZ(a)
    const vx = pos.getX(c) - pos.getX(a)
    const vy = pos.getY(c) - pos.getY(a)
    const vz = pos.getZ(c) - pos.getZ(a)
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const nl = Math.hypot(nx, ny, nz) || 1
    nx /= nl
    ny /= nl
    nz /= nl
    out.pos.set([px, py, pz], i * 3)
    out.nor.set([nx, ny, nz], i * 3)
    if (col) out.color.set([col.getX(a) * w + col.getX(b) * u + col.getX(c) * v, col.getY(a) * w + col.getY(b) * u + col.getY(c) * v, col.getZ(a) * w + col.getZ(b) * u + col.getZ(c) * v], i * 3)
    else out.color.set([0.8, 0.8, 0.8], i * 3)
    const height = (py - minY) / h
    // coarse-to-fine everywhere, with a gentle bottom-to-top bias (the scan "fills in")
    const reveal = Math.min(0.97, 0.03 + 0.62 * rng() + 0.32 * height)
    out.seed.set([reveal, 0.016 + rng() * 0.026, rng(), rng() * Math.PI], i * 4)
  }
  return out
}

export interface ScanState {
  phase: 'scan' | 'hold' | 'dissolve'
  /** 0..1 reconstruction progress (1 during hold/dissolve). */
  progress: number
  /** 0..1 dissolve amount. */
  dissolve: number
  /** Whole percent shown on the monitor. */
  percent: number
}

/** Scan cycle at time `t` (seconds): scan for `cycle`, hold, dissolve, repeat. */
export function scanState(t: number, cycle: number, hold: number, dissolve: number, out: ScanState = { phase: 'scan', progress: 0, dissolve: 0, percent: 0 }): ScanState {
  const period = cycle + hold + dissolve
  const u = ((t % period) + period) % period
  if (u < cycle) {
    // ease: fast at first (coarse), slower toward the end (fine detail)
    const x = u / cycle
    const progress = 1 - Math.pow(1 - x, 1.6)
    out.phase = 'scan'
    out.progress = progress
    out.dissolve = 0
    out.percent = Math.min(99, Math.floor(progress * 100))
  } else if (u < cycle + hold) {
    out.phase = 'hold'
    out.progress = 1
    out.dissolve = 0
    out.percent = 100
  } else {
    out.phase = 'dissolve'
    out.progress = 1
    out.dissolve = (u - cycle - hold) / dissolve
    out.percent = 100
  }
  return out
}
