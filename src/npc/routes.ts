/**
 * Route compilation: every NPC leg is resolved ONCE into a polyline (waypoint
 * references `wp:<id>` and `auto` graph segments are expanded with
 * world/nav shortestPath). No per-frame pathfinding anywhere.
 */
import type { Vec2 } from '@/core/types'
import { WAYPOINTS } from '@/world/layout'
import { nearestWaypoint, shortestPath } from '@/world/nav'
import type { LegDef, NpcDef, RoutePoint, StationDef } from './types'

export interface CompiledNpc {
  def: NpcDef
  stations: Map<string, StationDef>
  /** `${from}>${to}` → polyline from the `from` station position to the `to` station position (both directions stored). */
  paths: Map<string, Vec2[]>
  /** Directed leg keys on which the NPC carries a component box. */
  carry: Set<string>
}

export const legKey = (from: string, to: string) => `${from}>${to}`

function resolvePoint(p: Exclude<RoutePoint, 'auto'>): Vec2 {
  if (typeof p === 'string') {
    const id = p.slice(3)
    const w = WAYPOINTS[id]
    if (!w) throw new Error(`[npc] unknown waypoint ${id}`)
    return [w.position[0], w.position[1]]
  }
  return [p[0], p[1]]
}

/**
 * Expand a leg into a polyline: [start, ...via, end]. An `auto` entry inserts the
 * waypoint-graph shortest path between the waypoints nearest to its neighbours.
 */
export function resolveRoute(start: Vec2, via: RoutePoint[] | undefined, end: Vec2): Vec2[] {
  const out: Vec2[] = [[start[0], start[1]]]
  const items = via ?? []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it === 'auto') {
      const prev = out[out.length - 1]
      const nextItem = items.slice(i + 1).find((x) => x !== 'auto') as Exclude<RoutePoint, 'auto'> | undefined
      const next = nextItem ? resolvePoint(nextItem) : end
      const a = nearestWaypoint(prev[0], prev[1])
      const b = nearestWaypoint(next[0], next[1])
      for (const id of shortestPath(a.id, b.id)) out.push([WAYPOINTS[id].position[0], WAYPOINTS[id].position[1]])
      continue
    }
    out.push(resolvePoint(it))
  }
  out.push([end[0], end[1]])
  // Drop consecutive duplicates.
  const clean: Vec2[] = []
  for (const p of out) {
    const last = clean[clean.length - 1]
    if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 0.05) clean.push(p)
  }
  return clean
}

export function compileNpc(def: NpcDef): CompiledNpc {
  const stations = new Map<string, StationDef>()
  for (const s of def.stations) stations.set(s.id, s)
  const paths = new Map<string, Vec2[]>()
  const carry = new Set<string>()
  for (const leg of def.legs) addLeg(def, stations, paths, carry, leg)
  return { def, stations, paths, carry }
}

function addLeg(def: NpcDef, stations: Map<string, StationDef>, paths: Map<string, Vec2[]>, carry: Set<string>, leg: LegDef): void {
  const a = stations.get(leg.from)
  const b = stations.get(leg.to)
  if (!a || !b) throw new Error(`[npc] ${def.id}: leg ${leg.from}>${leg.to} references an unknown station`)
  const pts = resolveRoute(a.pos, leg.via, b.pos)
  paths.set(legKey(leg.from, leg.to), pts)
  paths.set(legKey(leg.to, leg.from), [...pts].reverse())
  if (leg.carry) carry.add(legKey(leg.from, leg.to))
}

/** Total length of a polyline. */
export function pathLength(pts: Vec2[]): number {
  let l = 0
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  return l
}

/**
 * Segments of a leg polyline that must be walkable. A segment touching an
 * `onProp` station (climbing onto a conveyor / sitting into a sofa) is a mount
 * transition and is exempt.
 */
export function walkSegments(c: CompiledNpc, from: string, to: string): [Vec2, Vec2][] {
  const pts = c.paths.get(legKey(from, to))
  if (!pts) return []
  const a = c.stations.get(from)!
  const b = c.stations.get(to)!
  const segs: [Vec2, Vec2][] = []
  for (let i = 1; i < pts.length; i++) {
    if (i === 1 && a.onProp) continue
    if (i === pts.length - 1 && b.onProp) continue
    segs.push([pts[i - 1], pts[i]])
  }
  return segs
}
