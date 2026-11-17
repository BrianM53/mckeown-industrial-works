import { describe, expect, it } from 'vitest'
import type { Rect, Vec2 } from '@/core/types'
import { ANCHORS, PATHS, PLAYABLE_BOUNDS, RESTRICTED_ZONES, WAYPOINTS, WORLD_BOUNDS, ZONES, restrictedZoneAt } from '@/world/layout'
import { BUILDINGS, doorApproach, doorInside, wallBoxes, windowSpots } from './buildings'
import { colliderBounds, environmentColliders, type ColliderDef } from './colliders'
import { BARRIERS } from './decor'
import { createInteriorTracker, interiorAt } from './interior'
import { disjointUnion, rectArea, rectsOverlap, segmentRectDistance, subtractIntervals } from './rects'
import { SIGNPOSTS, bladesFor } from './signposts'

const blocking = environmentColliders().filter((c) => c.group === 'static')
// Colliders whose bottom is above head height do not obstruct walking.
const walkBlocking = blocking.filter((c) => c.y - (c.hy ?? 0) < 2.0)

function segments(): [string, Vec2, Vec2][] {
  const out: [string, Vec2, Vec2][] = []
  for (const w of Object.values(WAYPOINTS))
    for (const l of w.links) if (l > w.id) out.push([`${w.id}->${l}`, w.position, WAYPOINTS[l].position])
  return out
}

describe('rect helpers', () => {
  it('disjointUnion covers the union without overlaps', () => {
    const rs: Rect[] = [
      { minX: 0, maxX: 4, minZ: 0, maxZ: 2 },
      { minX: 2, maxX: 6, minZ: 1, maxZ: 3 },
      { minX: 10, maxX: 11, minZ: 0, maxZ: 1 },
    ]
    const u = disjointUnion(rs)
    for (let i = 0; i < u.length; i++) for (let j = i + 1; j < u.length; j++) expect(rectsOverlap(u[i], u[j])).toBe(false)
    const area = u.reduce((s, r) => s + rectArea(r), 0)
    expect(area).toBeCloseTo(8 + 8 - 2 + 1, 6)
  })
  it('segmentRectDistance', () => {
    const r = { minX: 0, maxX: 1, minZ: 0, maxZ: 1 }
    expect(segmentRectDistance([-1, 0.5], [2, 0.5], r)).toBe(0)
    expect(segmentRectDistance([-1, 2], [2, 2], r)).toBeCloseTo(1)
    expect(segmentRectDistance([2, 2], [3, 3], r)).toBeCloseTo(Math.SQRT2)
  })
  it('subtractIntervals', () => {
    expect(subtractIntervals(0, 10, [[2, 3], [5, 6]])).toEqual([
      [0, 2],
      [3, 5],
      [6, 10],
    ])
  })
})

describe('environment colliders keep the factory walkable', () => {
  it('stay inside the world bounds', () => {
    for (const c of blocking) {
      const b = colliderBounds(c)
      expect(b.minX >= WORLD_BOUNDS.minX - 0.01 && b.maxX <= WORLD_BOUNDS.maxX + 0.01, c.id).toBe(true)
      expect(b.minZ >= WORLD_BOUNDS.minZ - 0.01 && b.maxZ <= WORLD_BOUNDS.maxZ + 0.01, c.id).toBe(true)
    }
  })

  it('never touch a waypoint segment (player radius margin)', () => {
    const problems: string[] = []
    for (const [name, a, b] of segments())
      for (const c of walkBlocking) {
        const d = segmentRectDistance(a, b, colliderBounds(c))
        if (d < 0.45) problems.push(`${c.id} within ${d.toFixed(2)}m of ${name}`)
      }
    expect(problems).toEqual([])
  })

  it('never sit on a lane (aisle / avenue / road / spur / walkway)', () => {
    const lanes = PATHS.filter((p) => p.kind !== 'plaza')
    const problems: string[] = []
    for (const p of lanes)
      for (const c of walkBlocking) if (rectsOverlap(colliderBounds(c), p.rect, 0.02)) problems.push(`${c.id} on ${p.id}`)
    expect(problems).toEqual([])
  })

  it('leave every door approach and door inside clear', () => {
    const problems: string[] = []
    for (const b of BUILDINGS) {
      const zones = [doorApproach(b), doorInside(b)]
      for (const c of walkBlocking) {
        if (c.kind === 'building') continue
        for (const z of zones) if (rectsOverlap(colliderBounds(c), z, 0.02)) problems.push(`${c.id} blocks ${b.id} door`)
      }
    }
    expect(problems).toEqual([])
  })

  it('leave station anchors and their interaction spots clear', () => {
    const problems: string[] = []
    for (const [id, a] of Object.entries(ANCHORS)) {
      const pr = id === 'executiveOffice' ? 0 : 1.1 // the pie chart sits inside the locked office on purpose
      const spots: [string, Vec2, number][] = [
        ['interact', a.interact as Vec2, 0.7],
        ['position', a.position as Vec2, pr],
      ]
      for (const [what, p, rad] of spots) {
        if (rad <= 0) continue
        const r = { minX: p[0] - rad, maxX: p[0] + rad, minZ: p[1] - rad, maxZ: p[1] + rad }
        for (const c of walkBlocking) {
          if (c.kind === 'building') continue
          if (rectsOverlap(colliderBounds(c), r, 0.02)) problems.push(`${c.id} blocks ${id}.${what}`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('keep the forklift bay lane to the aisle clear', () => {
    const lane: Rect = { minX: -13.5, maxX: -3.5, minZ: 27, maxZ: 31 }
    const bad = walkBlocking.filter((c) => rectsOverlap(colliderBounds(c), lane, 0.02)).map((c) => c.id)
    expect(bad).toEqual([])
  })

  it('keep checkpoints and zone entrances free', () => {
    const bad: string[] = []
    for (const z of Object.values(ZONES)) {
      const [x, zz] = z.entrance
      const r = { minX: x - 0.6, maxX: x + 0.6, minZ: zz - 0.6, maxZ: zz + 0.6 }
      for (const c of walkBlocking) if (rectsOverlap(colliderBounds(c), r)) bad.push(`${c.id} on ${z.id} entrance`)
    }
    expect(bad).toEqual([])
  })

  it('do not overlap each other between buildings and decor in silly ways', () => {
    // Decor must not intersect building walls.
    const walls = blocking.filter((c) => c.kind === 'building')
    const decor = blocking.filter((c) => c.kind === 'feature' || c.kind === 'prop' || c.kind === 'sign')
    const bad: string[] = []
    for (const d of decor) for (const w of walls) if (rectsOverlap(colliderBounds(d), colliderBounds(w), 0.01)) bad.push(`${d.id} x ${w.id}`)
    expect(bad).toEqual([])
  })
})

describe('restricted zones', () => {
  it('each barrier leaves a deliberate opening into its zone', () => {
    expect(BARRIERS).toHaveLength(RESTRICTED_ZONES.length)
    for (const b of BARRIERS) {
      expect(b.gapWidth, b.zone).toBeGreaterThanOrEqual(1.4)
      // The gap center must not be covered by any barrier span collider.
      const g = b.gap
      const probe = { minX: g[0] - 0.4, maxX: g[0] + 0.4, minZ: g[1] - 0.4, maxZ: g[1] + 0.4 }
      const spans = blocking.filter((c) => c.kind === 'barrier' && c.id.startsWith(`barrier:${b.zone}:`))
      const covering = spans.filter((c: ColliderDef) => segmentRectDistance([c.x - (c.hx ?? 0) * Math.cos(c.yaw ?? 0), c.z + (c.hx ?? 0) * Math.sin(c.yaw ?? 0)], [c.x + (c.hx ?? 0) * Math.cos(c.yaw ?? 0), c.z - (c.hx ?? 0) * Math.sin(c.yaw ?? 0)], probe) < 0.05)
      expect(covering.map((c) => c.id), b.zone).toEqual([])
    }
  })
  it('barrier posts stay outside their zone', () => {
    for (const b of BARRIERS) for (const p of b.posts) expect(restrictedZoneAt(p[0], p[1]), `${b.zone} post ${p}`).toBeNull()
  })
})

describe('buildings', () => {
  it('walls leave exactly the door span open', () => {
    for (const b of BUILDINGS) {
      const walls = wallBoxes(b).filter((w) => w.kind === 'wall')
      const [d0, d1] = b.def.doorSpan
      const mid = (d0 + d1) / 2
      const f = b.def.footprint
      const probe: Vec2 =
        b.def.doorSide === 'N' ? [mid, f.minZ + 0.2] : b.def.doorSide === 'S' ? [mid, f.maxZ - 0.2] : b.def.doorSide === 'W' ? [f.minX + 0.2, mid] : [f.maxX - 0.2, mid]
      const hit = walls.some((w) => probe[0] > w.rect.minX && probe[0] < w.rect.maxX && probe[1] > w.rect.minZ && probe[1] < w.rect.maxZ)
      expect(hit, b.id).toBe(false)
      expect(b.style.doorHeight, b.id).toBeGreaterThan(2.6)
      expect(b.style.doorHeight, b.id).toBeLessThan(b.def.height)
    }
  })
  it('windows avoid the door span', () => {
    for (const b of BUILDINGS)
      for (const w of windowSpots(b)) {
        if (w.side !== b.def.doorSide) continue
        const [d0, d1] = b.def.doorSpan
        expect(w.along + w.w / 2 <= d0 || w.along - w.w / 2 >= d1, b.id).toBe(true)
      }
  })
  it('playable spawn area is not inside any building', () => {
    for (const b of BUILDINGS) expect(rectsOverlap(b.def.footprint, { minX: -1, maxX: 1, minZ: 31, maxZ: 33 })).toBe(false)
    expect(PLAYABLE_BOUNDS.maxZ).toBeGreaterThan(32)
  })
})

describe('interior tracking (roof cutaway)', () => {
  it('detects interiors by the inner rect', () => {
    expect(interiorAt(12, 29)).toBe('personnel')
    expect(interiorAt(-38, -9)).toBe('server')
    expect(interiorAt(0, 32)).toBeNull()
    expect(interiorAt(NaN, 0)).toBeNull()
  })
  it('uses hysteresis at the doorway', () => {
    const t = createInteriorTracker(0.35)
    expect(t.update(7.6, 29)).toBe('personnel') // just inside
    expect(t.update(7.3, 29)).toBe('personnel') // in the wall band, within margin
    expect(t.update(6.9, 29)).toBeNull() // clearly outside
    expect(t.update(NaN, 29)).toBeNull()
    expect(t.update(10, 29)).toBe('personnel')
    expect(t.update(Infinity, 0)).toBe('personnel')
  })
})

describe('wayfinding signposts', () => {
  const blade = (postId: string, zone: string) => {
    const post = SIGNPOSTS.find((p) => p.id === postId)!
    return bladesFor(post).find((b) => b.zone === zone)
  }
  it('point along the actual route', () => {
    // From the west end of the cross aisle: Control Room is north, Résumé is back east.
    expect(blade('cross-west', 'control')?.dir[1]).toBeCloseTo(-1)
    expect(blade('cross-west', 'personnel')?.dir[0]).toBeCloseTo(1)
    // From the east end: the Broadcast Booth is north, the Break Room south.
    expect(blade('cross-east', 'radio')?.dir[1]).toBeCloseTo(-1)
    // Spur junction: the building is west.
    expect(blade('west-ctrl', 'control')?.dir[0]).toBeCloseTo(-1)
    expect(blade('east-rec', 'rec')?.dir[0]).toBeCloseTo(1)
    // At the plaza the tower is north (not back toward its viewing spot).
    expect(blade('plaza', 'tower')?.dir[1]).toBeCloseTo(-1)
  })
  it('every post has at least two blades and none point at nothing', () => {
    for (const p of SIGNPOSTS) {
      const bl = bladesFor(p)
      expect(bl.length, p.id).toBeGreaterThanOrEqual(2)
      expect(bl.length, p.id).toBeLessThanOrEqual(p.max)
      for (const b of bl) expect(Math.hypot(b.dir[0], b.dir[1])).toBeCloseTo(1)
    }
  })
  it('posts stand off the lanes', () => {
    for (const p of SIGNPOSTS) {
      const r = { minX: p.position[0] - 0.1, maxX: p.position[0] + 0.1, minZ: p.position[1] - 0.1, maxZ: p.position[1] + 0.1 }
      for (const path of PATHS) if (path.kind !== 'plaza') expect(rectsOverlap(r, path.rect), `${p.id} on ${path.id}`).toBe(false)
    }
  })
})
