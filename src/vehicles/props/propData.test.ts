import { describe, expect, it } from 'vitest'
import type { Rect, Vec2 } from '@/core/types'
import { ANCHORS, PATHS, PLAYABLE_BOUNDS, ZONE_LIST, restrictedZoneAt } from '@/world/layout'
import { colliderBounds, environmentColliders } from '@/environment/data/colliders'
import { HOME, TUTORIAL_SIGN } from '../constants'
import { exitCandidates } from '../logic/exitSpot'
import { footprintCorners, localToWorld, pointInPolygon, polygonBounds, polygonOverlapsRect, polygonSegmentDistance, rectsOverlap } from '../logic/geometry2d'
import { WAYPOINT_SEGMENTS } from '../logic/routeGuard'
import { PROP_KINDS, PROP_SPOTS, type PropSpot } from './propData'

function footprint(s: PropSpot, pad = 0): Vec2[] {
  const [w, d] = PROP_KINDS[s.kind].size
  const hw = w / 2 + pad
  const hd = d / 2 + pad
  const pose = { x: s.x, z: s.z, yaw: s.yaw }
  return [localToWorld(pose, -hw, hd), localToWorld(pose, -hw, -hd), localToWorld(pose, hw, -hd), localToWorld(pose, hw, hd)]
}

function doorRects(): { id: string; rect: Rect }[] {
  const out: { id: string; rect: Rect }[] = []
  for (const z of ZONE_LIST) {
    const b = z.building
    if (!b) continue
    const f = b.footprint
    const i = b.interior
    const [d0, d1] = b.doorSpan
    const depth = 2.4
    if (b.doorSide === 'E') out.push({ id: z.id, rect: { minX: i.maxX - depth, maxX: f.maxX + depth, minZ: d0, maxZ: d1 } })
    if (b.doorSide === 'W') out.push({ id: z.id, rect: { minX: f.minX - depth, maxX: i.minX + depth, minZ: d0, maxZ: d1 } })
    if (b.doorSide === 'N') out.push({ id: z.id, rect: { minX: d0, maxX: d1, minZ: f.minZ - depth, maxZ: i.minZ + depth } })
    if (b.doorSide === 'S') out.push({ id: z.id, rect: { minX: d0, maxX: d1, minZ: i.maxZ - depth, maxZ: f.maxZ + depth } })
  }
  return out
}

const walkBlocking = environmentColliders().filter((c) => c.group === 'static' && c.y - (c.hy ?? 0) < 2.0)

describe('bumpable prop placements', () => {
  it('there are 30-40 props with unique ids', () => {
    expect(PROP_SPOTS.length).toBeGreaterThanOrEqual(30)
    expect(PROP_SPOTS.length).toBeLessThanOrEqual(40)
    expect(new Set(PROP_SPOTS.map((s) => s.id)).size).toBe(PROP_SPOTS.length)
  })

  it('stay inside the playable area and outside restricted zones', () => {
    for (const s of PROP_SPOTS) {
      const b = polygonBounds(footprint(s))
      expect(b.minX > PLAYABLE_BOUNDS.minX && b.maxX < PLAYABLE_BOUNDS.maxX && b.minZ > PLAYABLE_BOUNDS.minZ && b.maxZ < PLAYABLE_BOUNDS.maxZ, s.id).toBe(true)
      expect(restrictedZoneAt(s.x, s.z), s.id).toBeNull()
    }
  })

  it('never sit on a lane (aisle / avenue / road / spur / walkway)', () => {
    const lanes = PATHS.filter((p) => p.kind !== 'plaza')
    const bad: string[] = []
    for (const s of PROP_SPOTS) for (const p of lanes) if (polygonOverlapsRect(footprint(s), p.rect)) bad.push(`${s.id} on ${p.id}`)
    expect(bad).toEqual([])
  })

  it('leave every door approach and door inside clear', () => {
    const bad: string[] = []
    for (const s of PROP_SPOTS) for (const d of doorRects()) if (polygonOverlapsRect(footprint(s), d.rect)) bad.push(`${s.id} blocks ${d.id} door`)
    expect(bad).toEqual([])
  })

  it('keep clear of every waypoint segment (worker radius margin)', () => {
    const bad: string[] = []
    for (const s of PROP_SPOTS)
      for (const seg of WAYPOINT_SEGMENTS) {
        const d = polygonSegmentDistance(footprint(s), seg.a, seg.b)
        if (d < 0.45) bad.push(`${s.id} ${d.toFixed(2)}m from ${seg.id}`)
      }
    expect(bad).toEqual([])
  })

  it('do not overlap environment colliders', () => {
    const bad: string[] = []
    for (const s of PROP_SPOTS) {
      const fp = footprint(s)
      for (const c of walkBlocking) if (polygonOverlapsRect(fp, colliderBounds(c))) bad.push(`${s.id} inside ${c.id}`)
    }
    expect(bad).toEqual([])
  })

  it('keep the forklift home, its lane and its exit spots clear', () => {
    const home = footprintCorners({ x: HOME.x, z: HOME.z, yaw: HOME.yaw }, undefined, 0.3)
    const lane: Rect = { minX: -13.5, maxX: -3.5, minZ: 27, maxZ: 31 }
    const exits = exitCandidates({ x: HOME.x, z: HOME.z, yaw: HOME.yaw }).slice(0, 4)
    const bad: string[] = []
    for (const s of PROP_SPOTS) {
      const fp = footprint(s)
      const b = polygonBounds(fp)
      if (rectsOverlap(polygonBounds(home), b) && polygonOverlapsRect(home, b)) bad.push(`${s.id} on the forklift`)
      if (polygonOverlapsRect(fp, lane)) bad.push(`${s.id} in the forklift lane`)
      for (const e of exits) if (polygonOverlapsRect(fp, { minX: e.x - 0.4, maxX: e.x + 0.4, minZ: e.z - 0.4, maxZ: e.z + 0.4 })) bad.push(`${s.id} on ${e.side} exit`)
    }
    expect(bad).toEqual([])
  })

  it('keep the tutorial sign and station anchors clear', () => {
    const sign = { minX: TUTORIAL_SIGN.x - 0.7, maxX: TUTORIAL_SIGN.x + 0.7, minZ: TUTORIAL_SIGN.z - 0.7, maxZ: TUTORIAL_SIGN.z + 0.7 }
    const bad: string[] = []
    for (const s of PROP_SPOTS) {
      const fp = footprint(s)
      if (polygonOverlapsRect(fp, sign)) bad.push(`${s.id} on the tutorial sign`)
      for (const [id, a] of Object.entries(ANCHORS)) {
        for (const p of [a.position, a.interact] as Vec2[]) {
          const r = 1.1
          if (polygonOverlapsRect(fp, { minX: p[0] - r, maxX: p[0] + r, minZ: p[1] - r, maxZ: p[1] + r })) bad.push(`${s.id} near ${id}`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('do not intersect each other; stacked props rest on the prop below', () => {
    const bad: string[] = []
    for (let i = 0; i < PROP_SPOTS.length; i++) {
      const a = PROP_SPOTS[i]
      const ka = PROP_KINDS[a.kind]
      for (let j = i + 1; j < PROP_SPOTS.length; j++) {
        const b = PROP_SPOTS[j]
        const kb = PROP_KINDS[b.kind]
        const vertical = a.y < b.y + kb.height - 1e-3 && b.y < a.y + ka.height - 1e-3
        if (!vertical) continue
        const fa = footprint(a)
        if (polygonOverlapsRect(fa, polygonBounds(footprint(b))) && polygonOverlapsRect(footprint(b), polygonBounds(fa))) {
          // rotated footprints: confirm with the tighter test both ways
          bad.push(`${a.id} overlaps ${b.id}`)
        }
      }
      if (a.y > 0) {
        // the centre of a stacked prop must sit on a supporting top (pyramids straddle two boxes)
        const support = PROP_SPOTS.find((s) => s !== a && Math.abs(s.y + PROP_KINDS[s.kind].height - a.y) < 1e-6 && pointInPolygon(a.x, a.z, footprint(s, 0.05)))
        if (!support) bad.push(`${a.id} floats at y=${a.y}`)
      }
    }
    expect(bad).toEqual([])
  })
})
