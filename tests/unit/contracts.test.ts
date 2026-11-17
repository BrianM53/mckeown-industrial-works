import { describe, expect, it } from 'vitest'
import { cameraRelativeMove, forwardFromYaw, rightFromYaw, wrapAngle, yawFromDirection, yawToward } from '@/core/math'
import { selectTarget, type Interactable } from '@/core/interaction'
import { Director } from '@/systems/director'
import {
  ANCHORS,
  CHECKPOINTS,
  LINES,
  PLAYABLE_BOUNDS,
  PRINCIPAL_ZONES,
  RESTRICTED_ZONES,
  TOWER,
  WAYPOINTS,
  ZONES,
  restrictedZoneAt,
  zoneAt,
} from '@/world/layout'
import { routeToZone, shortestPath } from '@/world/nav'
import { createRng, weightedPick } from '@/core/rng'
import type { Rect } from '@/core/types'

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps

describe('orientation conventions', () => {
  it('yaw 0 faces north (-Z), PI/2 west, -PI/2 east', () => {
    expect(near(forwardFromYaw(0).z, -1)).toBe(true)
    expect(near(forwardFromYaw(Math.PI / 2).x, -1)).toBe(true)
    expect(near(forwardFromYaw(-Math.PI / 2).x, 1)).toBe(true)
  })
  it('right vector is forward rotated clockwise (from above)', () => {
    const r = rightFromYaw(0)
    expect(near(r.x, 1) && near(r.z, 0)).toBe(true)
  })
  it('yawFromDirection inverts forwardFromYaw', () => {
    for (const yaw of [0, 0.5, -1.2, 2.9, -3]) {
      const f = forwardFromYaw(yaw)
      expect(near(wrapAngle(yawFromDirection(f.x, f.z) - yaw), 0, 1e-9)).toBe(true)
    }
    expect(near(yawToward({ x: 0, z: 0 }, { x: 5, z: 0 }), -Math.PI / 2)).toBe(true)
  })
  it('camera-relative move: W follows camera forward, diagonals normalized', () => {
    const yaw = 0.7
    const w = cameraRelativeMove(0, 1, yaw)
    const f = forwardFromYaw(yaw)
    expect(near(w.x, f.x) && near(w.z, f.z)).toBe(true)
    const d = cameraRelativeMove(1, 1, yaw)
    expect(near(Math.hypot(d.x, d.z), 1)).toBe(true)
    const s = cameraRelativeMove(0, -1, yaw)
    expect(near(s.x, -f.x) && near(s.z, -f.z)).toBe(true)
    expect(cameraRelativeMove(0, 0, yaw)).toEqual({ x: 0, z: 0 })
  })
})

describe('interaction target selection', () => {
  const mk = (id: string, x: number, z: number, extra: Partial<Interactable> = {}): Interactable => ({
    id,
    label: id,
    verb: 'Inspect',
    getPosition: () => ({ x, y: 0, z }),
    onInteract: () => {},
    ...extra,
  })
  it('picks the nearest in range and ignores out-of-range', () => {
    const t = selectTarget({ x: 0, z: 0 }, 0, 'foot', [mk('far', 0, -5), mk('near', 0, -1.5), mk('mid', 0, -2.2)])
    expect(t?.id).toBe('near')
    expect(selectTarget({ x: 0, z: 0 }, 0, 'foot', [mk('far', 0, -5)])).toBeNull()
  })
  it('respects modes and enabled()', () => {
    expect(selectTarget({ x: 0, z: 0 }, 0, 'forklift', [mk('a', 0, -1)])).toBeNull()
    expect(selectTarget({ x: 0, z: 0 }, 0, 'forklift', [mk('a', 0, -1, { modes: ['forklift'] })])?.id).toBe('a')
    expect(selectTarget({ x: 0, z: 0 }, 0, 'foot', [mk('a', 0, -1, { enabled: () => false })])).toBeNull()
  })
  it('prefers targets in front at similar distance', () => {
    const t = selectTarget({ x: 0, z: 0 }, 0, 'foot', [mk('behind', 0, 1.5), mk('front', 0, -1.6)])
    expect(t?.id).toBe('front')
  })
})

describe('director pacing', () => {
  it('enforces per-id cooldowns, ambient gap and exclusivity', () => {
    let t = 0
    const d = new Director(() => t)
    expect(d.request({ id: 'a', kind: 'ambient', cooldown: 30, duration: 5 })).toBe(true)
    expect(d.request({ id: 'b', kind: 'ambient', cooldown: 30, duration: 5 })).toBe(false) // ambient gap
    t = 10
    expect(d.request({ id: 'a', kind: 'ambient', cooldown: 30, duration: 5 })).toBe(false) // cooldown
    expect(d.request({ id: 'b', kind: 'ambient', cooldown: 30, duration: 5 })).toBe(true)
    expect(d.request({ id: 'osha', kind: 'player', cooldown: 10, duration: 4 })).toBe(true)
    expect(d.request({ id: 'night', kind: 'player', cooldown: 10, duration: 15 })).toBe(false) // exclusive
    t = 15
    expect(d.request({ id: 'night', kind: 'player', cooldown: 10, duration: 15 })).toBe(true)
  })
  it('suppresses involuntary events while reading, but not player-triggered ones', () => {
    let t = 0
    let reading = true
    const d = new Director(() => t)
    d.addSuppressor(() => reading)
    expect(d.request({ id: 'g', kind: 'ambient', cooldown: 1, duration: 1 })).toBe(false)
    expect(d.request({ id: 'p', kind: 'disruptive', cooldown: 1, duration: 1 })).toBe(false)
    expect(d.request({ id: 'osha', kind: 'player', cooldown: 1, duration: 1 })).toBe(true)
    reading = false
    t = 5
    expect(d.request({ id: 'g', kind: 'ambient', cooldown: 1, duration: 1 })).toBe(true)
  })
})

describe('world layout integrity', () => {
  const obstacles: { name: string; rect: Rect }[] = [
    { name: 'tower', rect: TOWER.footprint },
    ...LINES.filter((l) => !l.overhead).map((l) => ({
      name: `line:${l.id}`,
      rect: { minX: l.x - l.width / 2, maxX: l.x + l.width / 2, minZ: l.zEnd, maxZ: l.zStart },
    })),
    ...RESTRICTED_ZONES.filter((r) => r.shape.kind === 'rect').map((r) => ({ name: r.id, rect: (r.shape as { rect: Rect }).rect })),
  ]
  const inRect = (x: number, z: number, r: Rect, pad = 0) => x > r.minX - pad && x < r.maxX + pad && z > r.minZ - pad && z < r.maxZ + pad

  it('every zone waypoint/entrance/checkpoint is valid and inside playable bounds', () => {
    for (const z of Object.values(ZONES)) {
      expect(WAYPOINTS[z.waypoint], z.id).toBeDefined()
      const [x, zz] = z.entrance
      expect(inRect(x, zz, PLAYABLE_BOUNDS)).toBe(true)
      expect(restrictedZoneAt(x, zz)).toBeNull()
    }
    for (const c of CHECKPOINTS) expect(restrictedZoneAt(c.position[0], c.position[1])).toBeNull()
    expect(PRINCIPAL_ZONES).toHaveLength(5)
  })

  it('waypoint links never cross the tower, line strips, restricted zones, or building walls (except via doors)', () => {
    const problems: string[] = []
    for (const w of Object.values(WAYPOINTS)) {
      for (const lid of w.links) {
        if (lid < w.id) continue
        const o = WAYPOINTS[lid]
        const [ax, az] = w.position
        const [bx, bz] = o.position
        const len = Math.hypot(bx - ax, bz - az)
        const steps = Math.ceil(len / 0.2)
        for (let i = 0; i <= steps; i++) {
          const x = ax + ((bx - ax) * i) / steps
          const z = az + ((bz - az) * i) / steps
          for (const ob of obstacles) if (inRect(x, z, ob.rect, 0.3)) problems.push(`${w.id}->${lid} hits ${ob.name}`)
          if (restrictedZoneAt(x, z)) problems.push(`${w.id}->${lid} enters restricted ${restrictedZoneAt(x, z)!.id}`)
          for (const zone of Object.values(ZONES)) {
            const b = zone.building
            if (!b) continue
            const f = b.footprint
            // inside the wall band?
            const insideOuter = inRect(x, z, f)
            const insideInner = inRect(x, z, { minX: f.minX + 0.6, maxX: f.maxX - 0.6, minZ: f.minZ + 0.6, maxZ: f.maxZ - 0.6 })
            if (insideOuter && !insideInner) {
              const [d0, d1] = b.doorSpan
              const along = b.doorSide === 'E' || b.doorSide === 'W' ? z : x
              if (!(along > d0 + 0.4 && along < d1 - 0.4)) problems.push(`${w.id}->${lid} crosses ${zone.id} wall`)
            }
          }
        }
      }
    }
    expect([...new Set(problems)]).toEqual([])
  })

  it('every zone is reachable from intake', () => {
    for (const z of Object.values(ZONES)) {
      expect(shortestPath('intake', z.waypoint).length, z.id).toBeGreaterThan(0)
      const r = routeToZone(0, 32, z.id)
      expect(r[r.length - 1]).toEqual(z.entrance)
    }
  })

  it('anchors are inside playable bounds and not in restricted zones', () => {
    for (const [id, a] of Object.entries(ANCHORS)) {
      expect(inRect(a.position[0], a.position[1], PLAYABLE_BOUNDS), id).toBe(true)
      expect(restrictedZoneAt(a.interact[0], a.interact[1]), id).toBeNull()
    }
  })

  it('zoneAt resolves buildings', () => {
    expect(zoneAt(12, 29)).toBe('personnel')
    expect(zoneAt(-38, -9)).toBe('server')
    expect(zoneAt(0, 32)).toBe('intake')
  })
})

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = createRng(42)
    const b = createRng(42)
    for (let i = 0; i < 5; i++) expect(a()).toBe(b())
    const r = createRng(1)
    const counts = { x: 0, y: 0 }
    for (let i = 0; i < 1000; i++) counts[weightedPick(r, { x: 3, y: 1 })]++
    expect(counts.x).toBeGreaterThan(counts.y * 2)
  })
})
