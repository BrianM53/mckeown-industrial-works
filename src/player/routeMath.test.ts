import { describe, expect, it } from 'vitest'
import { routeToZone } from '@/world/nav'
import { ZONES } from '@/world/layout'
import { buildPolyline, distanceToPolyline, projectOnPolyline, sampleAt } from './routeMath'

describe('route polyline math', () => {
  const poly = buildPolyline([
    [0, 0],
    [0, -10],
    [10, -10],
  ])
  it('accumulates arc length and drops duplicate points', () => {
    expect(poly.length).toBe(20)
    expect(buildPolyline([[0, 0], [0, 0], [3, 4]]).pts).toHaveLength(2)
    expect(buildPolyline([[0, 0], [Number.NaN, 1]]).pts).toHaveLength(1)
  })
  it('projects points onto the closest segment', () => {
    expect(projectOnPolyline(poly, 1, -5)).toEqual({ s: 5, dist: 1 })
    const p = projectOnPolyline(poly, 5, -12)
    expect(p.s).toBeCloseTo(15, 9)
    expect(p.dist).toBeCloseTo(2, 9)
    expect(distanceToPolyline(poly, -3, 4)).toBeCloseTo(5, 9)
  })
  it('samples position and travel direction at an arc length', () => {
    const a = sampleAt(poly, 5)
    expect([a.x, a.z, a.dx, a.dz]).toEqual([0, -5, 0, -1])
    const b = sampleAt(poly, 15)
    expect(b.x).toBeCloseTo(5, 9)
    expect(b.z).toBeCloseTo(-10, 9)
    expect(b.dx).toBeCloseTo(1, 9)
    const end = sampleAt(poly, 999)
    expect([end.x, end.z]).toEqual([10, -10])
  })
  it('directory routes from spawn end at every zone entrance', () => {
    for (const z of Object.values(ZONES)) {
      const p = buildPolyline(routeToZone(0, 32, z.id))
      const end = sampleAt(p, p.length)
      expect(end.x).toBeCloseTo(z.entrance[0], 6)
      expect(end.z).toBeCloseTo(z.entrance[1], 6)
      expect(p.length).toBeLessThan(200)
    }
  })
})
