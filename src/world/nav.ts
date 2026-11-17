import type { Vec2 } from '@/core/types'
import { WAYPOINTS, ZONES, type ZoneId, type WaypointDef } from './layout'

/** Nearest waypoint to (x, z) by straight-line distance. */
export function nearestWaypoint(x: number, z: number, graph: Record<string, WaypointDef> = WAYPOINTS): WaypointDef {
  let best: WaypointDef | null = null
  let bestD = Infinity
  for (const w of Object.values(graph)) {
    const d = Math.hypot(w.position[0] - x, w.position[1] - z)
    if (d < bestD) {
      bestD = d
      best = w
    }
  }
  if (!best) throw new Error('empty waypoint graph')
  return best
}

/** Dijkstra shortest path between two waypoint ids. Returns ids including both ends, or [] if unreachable. */
export function shortestPath(fromId: string, toId: string, graph: Record<string, WaypointDef> = WAYPOINTS): string[] {
  if (!graph[fromId] || !graph[toId]) return []
  if (fromId === toId) return [fromId]
  const dist = new Map<string, number>([[fromId, 0]])
  const prev = new Map<string, string>()
  const open = new Set<string>([fromId])
  const done = new Set<string>()
  while (open.size) {
    let cur: string | null = null
    let curD = Infinity
    for (const id of open) {
      const d = dist.get(id) ?? Infinity
      if (d < curD) {
        curD = d
        cur = id
      }
    }
    if (cur === null) break
    if (cur === toId) break
    open.delete(cur)
    done.add(cur)
    const w = graph[cur]
    for (const n of w.links) {
      if (done.has(n)) continue
      const nw = graph[n]
      const nd = curD + Math.hypot(nw.position[0] - w.position[0], nw.position[1] - w.position[1])
      if (nd < (dist.get(n) ?? Infinity)) {
        dist.set(n, nd)
        prev.set(n, cur)
        open.add(n)
      }
    }
  }
  if (!dist.has(toId)) return []
  const path = [toId]
  let c = toId
  while (c !== fromId) {
    const p = prev.get(c)
    if (!p) return []
    path.push(p)
    c = p
  }
  return path.reverse()
}

/**
 * Assisted route for the directory: polyline from the player's position to a
 * zone entrance, following the waypoint graph.
 */
export function routeToZone(x: number, z: number, zoneId: ZoneId): Vec2[] {
  const zone = ZONES[zoneId]
  const start = nearestWaypoint(x, z)
  const ids = shortestPath(start.id, zone.waypoint)
  const pts: Vec2[] = [[x, z], ...ids.map((id) => WAYPOINTS[id].position)]
  pts.push(zone.entrance)
  // Drop consecutive duplicates / tiny segments.
  const out: Vec2[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 0.25) out.push(p)
  }
  return out
}

export function polylineLength(pts: Vec2[]): number {
  let len = 0
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  return len
}
