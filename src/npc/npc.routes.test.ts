/**
 * NPC placement & routing integrity (spec §8 / §11 "NPC blocks a doorway"):
 * every station and every route segment (incl. gag walks and walks back) stays
 * inside the playable area, out of restricted zones, building walls (except
 * through doors), the tower, other modules' machinery colliders and our own
 * props; stations never loiter in lanes, door zones or on portfolio stations.
 */
import { describe, expect, it } from 'vitest'
import type { Rect, Vec2 } from '@/core/types'
import { colliderBounds, environmentColliders } from '@/environment/data/colliders'
import { ANCHORS, PATHS, TOWER, WAYPOINTS } from '@/world/layout'
import { DOOR_ZONES, LANES, inRect, inWallBand, nearRestricted, pointSegDist } from './geo'
import { GAGS } from './gagDefs'
import { PROP_PLACEMENTS } from './propsData'
import { ROSTER, rosterFor, SPOT_SOURCES } from './roster'
import { compileNpc, legKey, resolveRoute, walkSegments } from './routes'
import type { NpcDef, StationDef } from './types'

const NPC_R = 0.3

// ---- obstacles from other modules (pure data) ------------------------------------

/** Environment colliders that obstruct walking (bottom below head height). */
const ENV = environmentColliders()
  .filter((c) => c.group === 'static' && c.y - (c.hy ?? 0) < 2.0)
  .map((c) => ({ id: c.id, rect: colliderBounds(c) }))

/** Production-line machinery colliders, if that module publishes them (imported defensively). */
interface ProdCollider {
  id: string
  rect: Rect
  y0: number
  group: string
}
const prodModules = import.meta.glob<{ COLLIDERS?: readonly ProdCollider[] }>('../factory/lines/config.ts', { eager: true })
const PROD = (Object.values(prodModules)[0]?.COLLIDERS ?? [])
  .filter((c) => c.group === 'static' && c.y0 < 2.0)
  .map((c) => ({ id: `production:${c.id}`, rect: c.rect }))

const PROPS = PROP_PLACEMENTS.map((p) => ({ id: `npc-prop:${p.id}`, rect: p.footprint }))

const TOWER_RECT = { id: 'tower', rect: TOWER.footprint }

/** Everything an NPC body must not overlap (optionally ignoring some ids, e.g. the prop it sits on). */
function blockers(ignore: (id: string) => boolean = () => false) {
  return [TOWER_RECT, ...ENV, ...PROD, ...PROPS].filter((b) => !ignore(b.id))
}

function pointProblems(x: number, z: number, ignore?: (id: string) => boolean): string[] {
  const out: string[] = []
  if (!Number.isFinite(x) || !Number.isFinite(z)) return ['non-finite']
  if (nearRestricted(x, z, NPC_R + 0.2)) out.push('restricted zone')
  if (inWallBand(x, z, NPC_R)) out.push('building wall')
  for (const b of blockers(ignore)) if (inRect(x, z, b.rect, NPC_R)) out.push(b.id)
  return out
}

function segmentProblems(a: Vec2, b: Vec2, ignore?: (id: string) => boolean): string[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  const n = Math.max(1, Math.ceil(len / 0.1))
  const out = new Set<string>()
  for (let i = 0; i <= n; i++) {
    const x = a[0] + ((b[0] - a[0]) * i) / n
    const z = a[1] + ((b[1] - a[1]) * i) / n
    for (const p of pointProblems(x, z, ignore)) out.add(p)
  }
  return [...out]
}

function stationIgnore(npc: NpcDef, st: StationDef): (id: string) => boolean {
  // a station "on a prop" sits on that prop / furniture by design
  if (!st.onProp) return () => false
  return (id) => {
    if (id.startsWith('npc-prop:nap-conveyor')) return npc.id === 'driver'
    if (id.startsWith('furn:sofa')) return npc.id === 'lounger-a'
    return false
  }
}

describe('NPC roster', () => {
  it('spawns 6 / 10 / 14 workers by quality tier with unique ids', () => {
    expect(rosterFor('low')).toHaveLength(6)
    expect(rosterFor('medium')).toHaveLength(10)
    expect(rosterFor('high')).toHaveLength(14)
    expect(new Set(ROSTER.map((n) => n.id)).size).toBe(ROSTER.length)
    // the greeter and the gag actors of the low tier are always present
    const low = rosterFor('low').map((n) => n.id)
    for (const id of ['greeter', 'smelter', 'circuit', 'qc', 'chief', 'driver']) expect(low).toContain(id)
  })

  it('every routine step has a precomputed leg', () => {
    for (const n of ROSTER) {
      const c = compileNpc(n)
      expect(n.routine.length, n.id).toBeGreaterThanOrEqual(2)
      for (let i = 0; i < n.routine.length; i++) {
        const a = n.routine[i]
        const b = n.routine[(i + 1) % n.routine.length]
        expect(c.paths.get(legKey(a, b)), `${n.id}: ${a}>${b}`).toBeDefined()
      }
    }
  })

  it('resolves waypoint references and auto graph segments', () => {
    const r = resolveRoute([0, 30], ['wp:aisleS', 'auto', 'wp:plazaS'], [0, -3])
    expect(r[0]).toEqual([0, 30])
    expect(r).toContainEqual([...WAYPOINTS.aisleS.position])
    expect(r).toContainEqual([...WAYPOINTS.aisleN.position])
    expect(r[r.length - 1]).toEqual([0, -3])
  })

  it('uses the production module worker spots when they are published', () => {
    const anyProduction = Object.values(SPOT_SOURCES).some((s) => s.source === 'production')
    if (PROD.length) expect(anyProduction).toBe(true)
  })
})

describe('NPC stations', () => {
  it('are walkable spots clear of walls, restricted zones, machinery and props', () => {
    const problems: string[] = []
    for (const n of ROSTER)
      for (const st of n.stations) {
        const p = pointProblems(st.pos[0], st.pos[1], stationIgnore(n, st))
        if (p.length) problems.push(`${n.id}:${st.id} → ${p.join(', ')}`)
      }
    expect(problems).toEqual([])
  })

  it('never loiter in a lane or a door zone (lane-edge peeks leave ≥ 2.5 m of lane free)', () => {
    const problems: string[] = []
    for (const n of ROSTER)
      for (const st of n.stations) {
        const [x, z] = st.pos
        for (const d of DOOR_ZONES) if (inRect(x, z, d.rect, NPC_R)) problems.push(`${n.id}:${st.id} in door zone ${d.id}`)
        for (const lane of LANES) {
          if (!inRect(x, z, lane.rect, NPC_R)) continue
          if (!st.laneOk) {
            problems.push(`${n.id}:${st.id} in lane ${lane.id}`)
            continue
          }
          // peeks must hug one edge: the rest of the lane stays walkable
          const r = lane.rect
          const across = r.maxX - r.minX < r.maxZ - r.minZ ? [x - NPC_R - r.minX, r.maxX - (x + NPC_R)] : [z - NPC_R - r.minZ, r.maxZ - (z + NPC_R)]
          if (Math.max(...across) < 2.5) problems.push(`${n.id}:${st.id} leaves < 2.5 m of ${lane.id}`)
        }
      }
    expect(problems).toEqual([])
  })

  it('keep clear of portfolio station anchors and their interaction spots', () => {
    const problems: string[] = []
    for (const n of ROSTER)
      for (const st of n.stations)
        for (const [id, a] of Object.entries(ANCHORS)) {
          const dI = Math.hypot(st.pos[0] - a.interact[0], st.pos[1] - a.interact[1])
          if (dI < 1.4) problems.push(`${n.id}:${st.id} ${dI.toFixed(2)} m from ${id}.interact`)
        }
    expect(problems).toEqual([])
  })
})

describe('NPC routes', () => {
  it('every leg segment avoids restricted zones, building walls (except doors), machinery and props', () => {
    const problems: string[] = []
    for (const n of ROSTER) {
      const c = compileNpc(n)
      for (const key of c.paths.keys()) {
        const [from, to] = key.split('>')
        for (const [a, b] of walkSegments(c, from, to)) {
          const p = segmentProblems(a, b)
          if (p.length) problems.push(`${n.id} ${key} [${a}]→[${b}]: ${p.join(', ')}`)
        }
      }
    }
    expect([...new Set(problems)]).toEqual([])
  })

  it('mount segments onto props are short (a step onto a conveyor / into a seat)', () => {
    for (const n of ROSTER) {
      const c = compileNpc(n)
      for (const st of n.stations.filter((s) => s.onProp)) {
        for (const [key, pts] of c.paths) {
          if (!key.endsWith(`>${st.id}`)) continue
          const ap = pts[pts.length - 2]
          expect(Math.hypot(ap[0] - st.pos[0], ap[1] - st.pos[1]), `${n.id} ${key}`).toBeLessThan(1.2)
          expect(pts.length, `${n.id} ${key} needs an approach point`).toBeGreaterThanOrEqual(3)
        }
      }
    }
  })

  it('routes never run through a portfolio interaction spot', () => {
    const problems: string[] = []
    for (const n of ROSTER) {
      const c = compileNpc(n)
      for (const [key, pts] of c.paths)
        for (let i = 1; i < pts.length; i++)
          for (const [id, a] of Object.entries(ANCHORS)) {
            const d = pointSegDist(a.interact[0], a.interact[1], pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])
            if (d < 0.9) problems.push(`${n.id} ${key} passes ${d.toFixed(2)} m from ${id}.interact`)
          }
    }
    expect(problems).toEqual([])
  })
})

describe('gag choreography', () => {
  it('actors start at their station and walk back along clear segments', () => {
    const problems: string[] = []
    for (const g of GAGS) {
      const ends = g.endPositions()
      for (const a of g.actors) {
        const def = ROSTER.find((n) => n.id === a.npc)
        expect(def, `${g.id} actor ${a.npc}`).toBeDefined()
        const st = def!.stations.find((s) => s.id === a.station)
        const back = def!.stations.find((s) => s.id === a.returnTo)
        expect(st && back, `${g.id} stations`).toBeTruthy()
        const end = ends[a.npc]
        expect(end, `${g.id} end position of ${a.npc}`).toBeDefined()
        const pts: Vec2[] = [end, ...(a.returnVia ?? []), back!.pos]
        for (let i = 1; i < pts.length; i++) {
          const p = segmentProblems(pts[i - 1], pts[i])
          if (p.length) problems.push(`${g.id} ${a.npc} walk back: ${p.join(', ')}`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('gag props stay out of lanes, door zones and other modules’ colliders', () => {
    const problems: string[] = []
    for (const p of PROP_PLACEMENTS) {
      const f = p.footprint
      for (const lane of PATHS.filter((l) => l.kind !== 'plaza'))
        if (f.minX < lane.rect.maxX && f.maxX > lane.rect.minX && f.minZ < lane.rect.maxZ && f.maxZ > lane.rect.minZ) problems.push(`${p.id} on ${lane.id}`)
      for (const d of DOOR_ZONES) if (f.minX < d.rect.maxX && f.maxX > d.rect.minX && f.minZ < d.rect.maxZ && f.maxZ > d.rect.minZ) problems.push(`${p.id} in ${d.id}`)
      for (const b of [TOWER_RECT, ...ENV, ...PROD])
        if (f.minX < b.rect.maxX && f.maxX > b.rect.minX && f.minZ < b.rect.maxZ && f.maxZ > b.rect.minZ) problems.push(`${p.id} overlaps ${b.id}`)
      if (nearRestricted((f.minX + f.maxX) / 2, (f.minZ + f.maxZ) / 2, 0.8)) problems.push(`${p.id} near a restricted zone`)
      for (const [id, a] of Object.entries(ANCHORS)) {
        const cx = Math.max(f.minX, Math.min(a.interact[0], f.maxX))
        const cz = Math.max(f.minZ, Math.min(a.interact[1], f.maxZ))
        if (Math.hypot(cx - a.interact[0], cz - a.interact[1]) < 1.0) problems.push(`${p.id} crowds ${id}`)
      }
      // never on a waypoint link (assisted routes walk those)
      for (const w of Object.values(WAYPOINTS))
        for (const l of w.links) {
          const o = WAYPOINTS[l]
          const cx = (f.minX + f.maxX) / 2
          const cz = (f.minZ + f.maxZ) / 2
          const half = Math.hypot(f.maxX - f.minX, f.maxZ - f.minZ) / 2
          if (pointSegDist(cx, cz, w.position[0], w.position[1], o.position[0], o.position[1]) < half * 0.7 + 0.5) problems.push(`${p.id} on ${w.id}->${l}`)
        }
    }
    expect([...new Set(problems)]).toEqual([])
  })
})
