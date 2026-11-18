import type * as THREE from 'three'

/**
 * Pneumatic capsule motion along a polyline (pure; unit-tested).
 * Timeline (seconds after "Send"): the lever drops, the capsule is sucked up
 * (ease-in), whooshes along the route at speed and vanishes into the wall;
 * a fresh capsule is back in the cabinet when the sequence ends.
 */
export const SEND_TIMING = {
  /** Lever returns up after this. */
  leverUp: 0.6,
  travelStart: 0.15,
  travelEnd: 1.45,
  total: 2.2,
}

type P3 = readonly [number, number, number]

export function polyLength(path: readonly P3[]): number {
  let len = 0
  for (let i = 1; i < path.length; i++) len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2])
  return len
}

/** Fraction of the route covered at time t (0 before the start, 1 at/after the end). */
export function travelFraction(t: number): number {
  const { travelStart: a, travelEnd: b } = SEND_TIMING
  if (!(t > a)) return 0
  if (t >= b) return 1
  const k = (t - a) / (b - a)
  // suction: quick ease-in over the first 25 %, then constant speed
  const e = 0.25
  if (k < e) return (k * k) / (2 * e) / (1 - e / 2)
  return (k - e / 2) / (1 - e / 2)
}

/**
 * Capsule position/direction at time t. Visible while waiting in the cabinet
 * (idle or before departure) and in transit; hidden after it enters the wall
 * until the sequence completes (then a fresh capsule waits again).
 */
export function capsuleAt(path: readonly P3[], length: number, t: number, outPos: THREE.Vector3, outDir: THREE.Vector3): { visible: boolean } {
  const f = travelFraction(t)
  if (t >= SEND_TIMING.travelEnd && t < SEND_TIMING.total) return { visible: false }
  let d = f * length
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    if (d <= seg || i === path.length - 1) {
      const k = seg > 0 ? Math.min(1, Math.max(0, d / seg)) : 0
      outPos.set(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k)
      if (seg > 0) outDir.set((b[0] - a[0]) / seg, (b[1] - a[1]) / seg, (b[2] - a[2]) / seg)
      else outDir.set(0, 1, 0)
      // waiting capsules stand upright behind the porthole
      if (f === 0 || t >= SEND_TIMING.total) {
        outPos.set(path[0][0], path[0][1], path[0][2])
        outDir.set(0, 1, 0)
      }
      return { visible: true }
    }
    d -= seg
  }
  outPos.set(path[0][0], path[0][1], path[0][2])
  outDir.set(0, 1, 0)
  return { visible: true }
}
