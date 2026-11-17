/**
 * Human-height wayfinding signposts at junctions. Blade directions are COMPUTED
 * from the nav graph (first hop of the shortest route from the junction to each
 * destination), so they stay correct if world/layout changes.
 */
import type { Vec2 } from '@/core/types'
import { yawFromDirection } from '@/core/math'
import { WAYPOINTS, ZONES, type ZoneId } from '@/world/layout'
import { shortestPath, polylineLength } from '@/world/nav'
import { BLADE_LABELS } from './text'

export interface SignpostDef {
  id: string
  /** Waypoint id of the junction the post serves. */
  junction: string
  /** Post position (kept off lanes and waypoint segments). */
  position: Vec2
  /** Maximum blades on this post. */
  max: number
}

export const SIGNPOSTS: SignpostDef[] = [
  { id: 'cross-west', junction: 'crossW', position: [-26.8, 24.2], max: 6 },
  { id: 'cross-east', junction: 'crossE', position: [26.8, 24.2], max: 6 },
  { id: 'west-north', junction: 'westNorth', position: [-19.4, -17.4], max: 6 },
  { id: 'east-north', junction: 'eastNorth', position: [26.8, -17.4], max: 6 },
  { id: 'plaza', junction: 'plazaS', position: [4.4, -1.6], max: 6 },
  { id: 'north-mid', junction: 'northMid', position: [-1.8, -17.4], max: 5 },
  { id: 'west-ctrl', junction: 'westCtrl', position: [-26.8, 16.4], max: 4 },
  { id: 'west-server', junction: 'westServer', position: [-26.8, -5.6], max: 4 },
  { id: 'west-rnd', junction: 'westRnd', position: [-26.8, -29.6], max: 4 },
  { id: 'west-south', junction: 'westSouth', position: [-25.0, 26.6], max: 3 },
  { id: 'east-radio', junction: 'eastRadio', position: [26.8, 14.4], max: 4 },
  { id: 'east-rec', junction: 'eastRec', position: [26.8, -10.6], max: 4 },
  { id: 'east-south', junction: 'eastSouth', position: [25.0, 26.8], max: 3 },
]

const CANDIDATES: ZoneId[] = ['personnel', 'control', 'radio', 'server', 'rec', 'rnd', 'launch', 'tower', 'maintenance', 'warehouse', 'breakroom', 'intake']

export interface Blade {
  zone: ZoneId
  label: string
  color: string
  /** Unit direction on the ground plane the blade points toward. */
  dir: Vec2
  /** Yaw of that direction (forward(yaw) = dir). */
  yaw: number
  /** Route length from the junction (m). */
  distance: number
}

const SNAP = Math.PI / 4

function snapYaw(yaw: number): number {
  const s = Math.round(yaw / SNAP) * SNAP
  return Math.abs(s - yaw) < 0.2 ? s : yaw
}

/** Blades for a post: local destinations first, then principal ones, then the nearest others. */
export function bladesFor(post: SignpostDef): Blade[] {
  const j = WAYPOINTS[post.junction]
  if (!j) return []
  const items: (Blade & { score: number })[] = []
  for (const zid of CANDIDATES) {
    const zone = ZONES[zid]
    const ids = shortestPath(post.junction, zone.waypoint)
    if (!ids.length) continue
    const pts = ids.map((id) => WAYPOINTS[id].position)
    let target: Vec2
    // The junction IS this zone's waypoint: point at the zone itself (its entrance can be behind us).
    if (ids.length >= 2) target = pts[1]
    else target = zone.center
    const dx = target[0] - j.position[0]
    const dz = target[1] - j.position[1]
    const len = Math.hypot(dx, dz)
    if (len < 0.3) continue
    const distance = polylineLength([...pts, zone.entrance])
    const yaw = snapYaw(yawFromDirection(dx, dz))
    const dir: Vec2 = [-Math.sin(yaw), -Math.cos(yaw)]
    const local = distance < 9
    const score = (local ? -1000 : 0) + (zone.principal ? 0 : 60) + distance
    items.push({ zone: zid, label: BLADE_LABELS[zid], color: zone.color, dir, yaw, distance, score })
  }
  items.sort((a, b) => a.score - b.score)
  const chosen = items.slice(0, post.max)
  // Stack blades that point the same way together (stable by yaw, then distance).
  chosen.sort((a, b) => a.yaw - b.yaw || a.distance - b.distance)
  return chosen.map(({ score: _s, ...b }) => b)
}
