import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { SEND_TIMING, capsuleAt, polyLength, travelFraction } from './tubeRoute'

const PATH = [
  [0, 1, 0],
  [0, 4, 0],
  [3, 4, 0],
  [3, 4, -4],
] as const

describe('contact tube capsule route', () => {
  it('measures polyline length', () => {
    expect(polyLength(PATH)).toBeCloseTo(3 + 3 + 4)
    expect(polyLength([[1, 2, 3]])).toBe(0)
  })

  it('travel fraction is 0 before departure, 1 on arrival, and monotonic in between', () => {
    expect(travelFraction(0)).toBe(0)
    expect(travelFraction(SEND_TIMING.travelStart)).toBe(0)
    expect(travelFraction(NaN)).toBe(0)
    expect(travelFraction(SEND_TIMING.travelEnd)).toBe(1)
    expect(travelFraction(99)).toBe(1)
    let prev = 0
    for (let t = SEND_TIMING.travelStart; t <= SEND_TIMING.travelEnd; t += 0.01) {
      const f = travelFraction(t)
      expect(f).toBeGreaterThanOrEqual(prev - 1e-9)
      expect(f).toBeLessThanOrEqual(1)
      prev = f
    }
    // suction ease-in: slow start, then cruise
    const early = travelFraction(SEND_TIMING.travelStart + 0.05)
    const mid = travelFraction((SEND_TIMING.travelStart + SEND_TIMING.travelEnd) / 2)
    expect(early).toBeLessThan(0.02)
    expect(mid).toBeGreaterThan(0.4)
    expect(mid).toBeLessThan(0.6)
  })

  it('waits upright in the cabinet, travels along the route, hides in the wall, then a fresh capsule waits', () => {
    const len = polyLength(PATH)
    const pos = new THREE.Vector3()
    const dir = new THREE.Vector3()

    expect(capsuleAt(PATH, len, 0, pos, dir).visible).toBe(true)
    expect(pos.toArray()).toEqual([0, 1, 0])
    expect(dir.toArray()).toEqual([0, 1, 0])

    // somewhere along the route: on one of the segments, direction normalized
    const tMid = (SEND_TIMING.travelStart + SEND_TIMING.travelEnd) / 2
    expect(capsuleAt(PATH, len, tMid, pos, dir).visible).toBe(true)
    expect(dir.length()).toBeCloseTo(1)
    const onSeg = pos.y === 4 && ((pos.z === 0 && pos.x >= 0 && pos.x <= 3) || (pos.x === 3 && pos.z <= 0 && pos.z >= -4))
    expect(onSeg).toBe(true)

    // inside the wall: hidden until the sequence completes
    expect(capsuleAt(PATH, len, SEND_TIMING.travelEnd + 0.01, pos, dir).visible).toBe(false)
    expect(capsuleAt(PATH, len, SEND_TIMING.total - 0.01, pos, dir).visible).toBe(false)

    // a fresh capsule is back in the cabinet
    expect(capsuleAt(PATH, len, SEND_TIMING.total, pos, dir).visible).toBe(true)
    expect(pos.toArray()).toEqual([0, 1, 0])
    for (const v of pos.toArray()) expect(Number.isFinite(v)).toBe(true)
  })
})
