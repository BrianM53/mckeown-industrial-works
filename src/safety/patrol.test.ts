import { describe, expect, it } from 'vitest'
import type { Vec2 } from '@/core/types'
import { PATHS, RESTRICTED_ZONES, TRACK, WAYPOINTS, ZONES, restrictedZoneAt } from '@/world/layout'
import { HATCHES, HATCH_SIZE, OSHA, PATROL, PATROL_ROUTE } from './config'
import { InspectorBrain, createActor, legClearOfZones } from './patrol'
import { ZONE_TRIGGER_POINTS, nearestZone, zoneSignedDistance } from './zones'

const STEP = 1 / 30

function sampleSegment(a: Vec2, b: Vec2, n = 40): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i <= n; i++) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n])
  return out
}

describe('patrol route & hatch placement (layout contract)', () => {
  it('route waypoints match the shared waypoint graph; graph hops are linked', () => {
    for (const rp of PATROL_ROUTE) {
      const wp = WAYPOINTS[rp.id]
      if (wp) expect(wp.position).toEqual(rp.p)
      else expect(rp.stop).toBeTruthy()
    }
    for (let i = 0; i < PATROL_ROUTE.length; i++) {
      const a = PATROL_ROUTE[i]
      const b = PATROL_ROUTE[(i + 1) % PATROL_ROUTE.length]
      if (WAYPOINTS[a.id] && WAYPOINTS[b.id] && a.id !== b.id) expect(WAYPOINTS[a.id].links).toContain(b.id)
      else expect(Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1])).toBeLessThan(6) // short open hop to a viewing spot
    }
  })

  it('the patrol never enters (or brushes) a restricted zone', () => {
    for (let i = 0; i < PATROL_ROUTE.length; i++) {
      const a = PATROL_ROUTE[i].p
      const b = PATROL_ROUTE[(i + 1) % PATROL_ROUTE.length].p
      for (const p of sampleSegment(a, b)) {
        for (const z of RESTRICTED_ZONES) expect(zoneSignedDistance(z, p[0], p[1])).toBeGreaterThan(1.5)
      }
    }
  })

  it('each zone has a viewing stop facing it', () => {
    for (const z of RESTRICTED_ZONES) {
      const stop = PATROL_ROUTE.find((rp) => rp.stop && nearestZone(rp.stop.face[0], rp.stop.face[1]).id === z.id)
      expect(stop, z.id).toBeTruthy()
      expect(zoneSignedDistance(z, stop!.p[0], stop!.p[1])).toBeLessThan(8)
    }
  })

  it('hatches: outside the zones, close to them, apart, off the rocket track and out of buildings', () => {
    for (const h of HATCHES) {
      const zone = RESTRICTED_ZONES.find((z) => z.id === h.zone)!
      expect(zone, h.id).toBeTruthy()
      const [x, z] = h.position
      for (const rz of RESTRICTED_ZONES) expect(zoneSignedDistance(rz, x, z), h.id).toBeGreaterThan(1.5)
      // near its zone (spec: ≤ 8 m)
      expect(zoneSignedDistance(zone, x, z), h.id).toBeLessThanOrEqual(8)
      for (const o of HATCHES) if (o !== h) expect(Math.hypot(o.position[0] - x, o.position[1] - z)).toBeGreaterThan(2)
      // rocket transporter corridor (tower → (16,-10) → pad), gauge 3.2 m + body overhang
      const [p0, p1, p2] = TRACK.points
      const nearTrack = (a: Vec2, b: Vec2) => {
        const dx = b[0] - a[0]
        const dz = b[1] - a[1]
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)))
        return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t))
      }
      expect(Math.min(nearTrack(p0, p1), nearTrack(p1, p2)), h.id).toBeGreaterThan(2.9)
      for (const zd of Object.values(ZONES)) {
        const f = zd.building?.footprint
        if (f) expect(x > f.minX - 1 && x < f.maxX + 1 && z > f.minZ - 1 && z < f.maxZ + 1, h.id).toBe(false)
      }
      expect(HATCH_SIZE.top).toBeLessThan(0.045)
    }
  })

  it('every zone has at least two hatches; trigger points are inside their zones and covered', () => {
    for (const z of RESTRICTED_ZONES) {
      const own = HATCHES.filter((h) => h.zone === z.id)
      expect(own.length).toBeGreaterThanOrEqual(2)
      const tp = ZONE_TRIGGER_POINTS[z.id]
      expect(restrictedZoneAt(tp.x, tp.z)?.id).toBe(z.id)
      // a visitor just inside the zone has a hatch within the preferred chase radius
      expect(Math.min(...own.map((h) => Math.hypot(h.position[0] - tp.x, h.position[1] - tp.z)))).toBeLessThanOrEqual(OSHA.hatchSearchRadius)
    }
  })

  it('hatches stay off the main aisle', () => {
    const aisle = PATHS.find((p) => p.id === 'main-aisle')!.rect
    for (const h of HATCHES) {
      const [x, z] = h.position
      expect(x >= aisle.minX && x <= aisle.maxX && z >= aisle.minZ && z <= aisle.maxZ).toBe(false)
    }
  })
})

describe('inspector brain', () => {
  it('walks the whole loop, stopping to scribble at every zone', () => {
    const actor = createActor(0, 0)
    const brain = new InspectorBrain(actor)
    const seen = new Set<string>()
    const anims = new Set<string>()
    let t = 0
    while (t < 200) {
      brain.tick(STEP)
      t += STEP
      seen.add(brain.routeTargetId)
      anims.add(actor.anim)
      expect(Number.isFinite(actor.x) && Number.isFinite(actor.z) && Number.isFinite(actor.yaw)).toBe(true)
      expect(restrictedZoneAt(actor.x, actor.z)).toBeNull()
    }
    for (const rp of PATROL_ROUTE) expect(seen.has(rp.id), rp.id).toBe(true)
    expect(anims.has('walk')).toBe(true)
    expect(anims.has('work')).toBe(true)
    expect(anims.has('point')).toBe(true)
  })

  it('yields to a visitor in the way, then steps around them', () => {
    const actor = createActor(0, 0)
    const player = { x: 0, z: 0 }
    const brain = new InspectorBrain(actor, { player: () => player })
    // walking from plazaS (0,-2.5) toward plazaE (9.5,-4): stand in his way
    brain.tick(STEP)
    player.x = actor.x + 1.0
    player.z = actor.z - 0.15
    const modes = new Set<string>()
    for (let i = 0; i < 30 * 8; i++) {
      brain.tick(STEP)
      modes.add(brain.mode)
      const d = Math.hypot(actor.x - player.x, actor.z - player.z)
      expect(d).toBeGreaterThan(0.75) // never walks into the visitor
    }
    expect(modes.has('yield')).toBe(true)
    expect(actor.x).toBeGreaterThan(player.x + 1) // got past
  })

  it('never enables his collider while overlapping the visitor', () => {
    const actor = createActor(0, 0)
    const player = { x: 0, z: -2.5 }
    const brain = new InspectorBrain(actor, { player: () => player })
    brain.pause()
    brain.resumeVia([])
    brain.tick(STEP)
    expect(actor.collidable).toBe(false)
    player.x = 30
    brain.tick(STEP)
    expect(actor.collidable).toBe(true)
  })

  it('investigates a nearby NPC mishap, writes it up and returns to the route', () => {
    const actor = createActor(0, 0)
    const brain = new InspectorBrain(actor)
    for (let i = 0; i < 30; i++) brain.tick(STEP)
    expect(brain.investigate('gag:nap', 60, 30)).toBe(false) // too far
    expect(brain.investigate('gag:nap', 0, 9)).toBe(true)
    expect(brain.investigate('gag:other', 1, 9)).toBe(false) // busy
    let closest = Infinity
    const anims = new Set<string>()
    let t = 0
    while (brain.investigating && t < PATROL.investigateTimeout + 5) {
      brain.tick(STEP)
      t += STEP
      closest = Math.min(closest, Math.hypot(actor.x - 0, actor.z - 9))
      anims.add(actor.anim)
    }
    expect(brain.investigating).toBeNull()
    expect(closest).toBeLessThan(PATROL.approach + 0.3)
    expect(anims.has('work')).toBe(true)
    expect(['path', 'route']).toContain(brain.mode)
    // and it is rate limited
    expect(brain.investigate('gag:again', 0, 9)).toBe(false)
  })

  it('investigating a mishap inside a restricted zone never takes him into the zone', () => {
    expect(legClearOfZones([9.5, -4], [17.6, -4.6])).toBe(false)
    expect(legClearOfZones([0, -2.5], [9.5, -4])).toBe(true)
    // the transformer itself, and a spot just past the wet-paint rectangle
    for (const gag of [
      [17.6, -4.6],
      [-21, -4.5],
    ] as Vec2[]) {
      const actor = createActor(0, 0)
      const brain = new InspectorBrain(actor)
      for (let i = 0; i < 10; i++) brain.tick(STEP)
      expect(brain.investigate('gag:zone', gag[0], gag[1])).toBe(true)
      let t = 0
      let worst = Infinity
      while (brain.investigating && t < PATROL.investigateTimeout + 5) {
        brain.tick(STEP)
        t += STEP
        for (const z of RESTRICTED_ZONES) worst = Math.min(worst, zoneSignedDistance(z, actor.x, actor.z))
      }
      expect(brain.investigating).toBeNull()
      expect(worst).toBeGreaterThan(0.25)
    }
  })

  it('hold(): faces the target with a head shake, then carries on', () => {
    const actor = createActor(0, 0)
    const brain = new InspectorBrain(actor)
    for (let i = 0; i < 30; i++) brain.tick(STEP)
    const x0 = actor.x
    brain.hold(1, () => ({ x: actor.x + 5, z: actor.z }), 'point', true)
    const looks: number[] = []
    for (let i = 0; i < 25; i++) {
      brain.tick(STEP)
      if (actor.look !== null) looks.push(actor.look)
      expect(actor.anim).toBe('point')
    }
    expect(actor.x).toBe(x0)
    expect(Math.max(...looks)).toBeGreaterThan(0.2)
    expect(Math.min(...looks)).toBeLessThan(-0.2)
    for (let i = 0; i < 30; i++) brain.tick(STEP)
    expect(actor.anim).toBe('walk')
  })
})
