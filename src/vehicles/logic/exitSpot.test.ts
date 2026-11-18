import { describe, expect, it } from 'vitest'
import { EAST, NORTH } from '@/world/layout'
import { FORKLIFT, HOME } from '../constants'
import { chooseExitSpot, exitCandidates, EXIT_DIMS } from './exitSpot'
import { footprintCorners, pointInPolygon } from './geometry2d'

describe('forklift exit spot selection', () => {
  it('prefers the driver (left) side, then right, back, front', () => {
    const c = exitCandidates({ x: 0, z: 0, yaw: NORTH })
    expect(c.slice(0, 4).map((s) => s.side)).toEqual(['left', 'right', 'back', 'front'])
    // facing north: left is west (-x), back is south (+z), front is north (-z)
    expect(c[0].x).toBeLessThan(-1)
    expect(c[1].x).toBeGreaterThan(1)
    expect(c[2].z).toBeGreaterThan(1)
    expect(c[3].z).toBeLessThan(-2)
  })

  it('rotates with the vehicle: parked at home facing east, the driver side is north', () => {
    const c = exitCandidates({ x: HOME.x, z: HOME.z, yaw: EAST })
    expect(c[0].side).toBe('left')
    expect(c[0].z).toBeLessThan(HOME.z - 1)
    expect(Math.abs(c[0].x - (HOME.x - FORKLIFT.seatZ))).toBeLessThan(0.01)
  })

  it('never proposes a spot inside the forklift footprint (plus the worker radius)', () => {
    for (const yaw of [0, 0.7, -2, Math.PI]) {
      const pose = { x: 3, z: -4, yaw }
      const poly = footprintCorners(pose, undefined, 0.34)
      for (const s of exitCandidates(pose)) expect(pointInPolygon(s.x, s.z, poly)).toBe(false)
    }
  })

  it('side spots clear the body by at least the worker radius', () => {
    expect(EXIT_DIMS.side - FORKLIFT.halfWidth).toBeGreaterThanOrEqual(0.35)
    expect(EXIT_DIMS.back - FORKLIFT.rearZ).toBeGreaterThanOrEqual(0.35)
    expect(EXIT_DIMS.front + FORKLIFT.frontZ).toBeGreaterThanOrEqual(0.35)
  })

  it('falls through blocked candidates in order', () => {
    const c = exitCandidates({ x: 0, z: 0, yaw: NORTH })
    const blockedLeft = (x: number) => x > -0.5 // anything on the left (west) is blocked
    const pick = chooseExitSpot(c, (x) => blockedLeft(x))
    expect(pick?.side).toBe('right')
    const onlyBack = chooseExitSpot(c, (_x, z) => z > 1.5 && Math.abs(_x) < 0.2)
    expect(onlyBack?.side).toBe('back')
  })

  it('respects the accept filter (bounds / restricted zones) and returns null when boxed in', () => {
    const c = exitCandidates({ x: 0, z: 0, yaw: NORTH })
    expect(chooseExitSpot(c, () => true, (x) => x > 0)?.side).toBe('right')
    expect(chooseExitSpot(c, () => false)).toBeNull()
  })

  it('offers a ring of fallback spots around the vehicle', () => {
    const c = exitCandidates({ x: 0, z: 0, yaw: NORTH })
    const ring = c.filter((s) => s.side === 'ring')
    expect(ring.length).toBe(EXIT_DIMS.rings.length * EXIT_DIMS.ringSteps)
    // first ring spot is on the driver side
    expect(ring[0].x).toBeLessThan(-2.5)
    expect(Math.abs(ring[0].z)).toBeLessThan(1e-9)
  })

  it('skips non-finite candidates', () => {
    const c = exitCandidates({ x: Number.NaN, z: 0, yaw: 0 })
    expect(chooseExitSpot(c, () => true)).toBeNull()
  })
})
