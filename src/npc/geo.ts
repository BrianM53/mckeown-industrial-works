/**
 * Pure ground-plane geometry for NPC placement and routing (no three.js).
 * Used by the unit tests (route / station validation) and at runtime (sidestep
 * checks, gag line-of-sight). Everything is derived from world/layout.ts.
 */
import type { Rect, Vec2 } from '@/core/types'
import { LINES, PATHS, PLAYABLE_BOUNDS, RESTRICTED_ZONES, TOWER, ZONE_LIST, type ZoneDef, type ZoneId } from '@/world/layout'

export function inRect(x: number, z: number, r: Rect, pad = 0): boolean {
  return x > r.minX - pad && x < r.maxX + pad && z > r.minZ - pad && z < r.maxZ + pad
}

export function dist2(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(bx - ax, bz - az)
}

/** Distance from point to segment a→b. */
export function pointSegDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax
  const vz = bz - az
  const l2 = vx * vx + vz * vz
  let t = l2 > 1e-12 ? ((px - ax) * vx + (pz - az) * vz) / l2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t))
}

/** Inside (or within `margin` of) a restricted OSHA zone. */
export function nearRestricted(x: number, z: number, margin = 0): boolean {
  for (const r of RESTRICTED_ZONES) {
    if (r.shape.kind === 'rect') {
      if (inRect(x, z, r.shape.rect, margin)) return true
    } else if (Math.hypot(x - r.shape.center[0], z - r.shape.center[1]) <= r.shape.radius + margin) return true
  }
  return false
}

const BUILDINGS: ZoneDef[] = ZONE_LIST.filter((z) => !!z.building)

/** Building interior containing (x, z), or null. */
export function interiorOf(x: number, z: number): ZoneId | null {
  for (const zone of BUILDINGS) if (inRect(x, z, zone.building!.interior)) return zone.id
  return null
}

/**
 * True when (x, z) lies in a building's wall band (between the outer footprint and
 * the interior, padded by `pad`) anywhere except through the door opening (kept
 * `doorPad` meters away from the jambs).
 */
export function inWallBand(x: number, z: number, pad = 0.35, doorPad = 0.45): boolean {
  for (const zone of BUILDINGS) {
    const b = zone.building!
    const f = b.footprint
    if (!inRect(x, z, f, pad)) continue
    const inner = { minX: f.minX + 0.6 + pad, maxX: f.maxX - 0.6 - pad, minZ: f.minZ + 0.6 + pad, maxZ: f.maxZ - 0.6 - pad }
    if (inRect(x, z, inner)) continue
    const [d0, d1] = b.doorSpan
    const along = b.doorSide === 'E' || b.doorSide === 'W' ? z : x
    // Within the door span AND near the door wall?
    const nearDoorWall =
      b.doorSide === 'E' ? x > f.maxX - 1.2 : b.doorSide === 'W' ? x < f.minX + 1.2 : b.doorSide === 'N' ? z < f.minZ + 1.2 : z > f.maxZ - 1.2
    if (nearDoorWall && along > d0 + doorPad && along < d1 - doorPad) continue
    return true
  }
  return false
}

/** The rocket tower and the ground-level production line strips (machinery). */
export const MACHINE_RECTS: { id: string; rect: Rect }[] = [
  { id: 'tower', rect: TOWER.footprint },
  ...LINES.filter((l) => !l.overhead).map((l) => ({
    id: `line:${l.id}`,
    rect: { minX: l.x - l.width / 2, maxX: l.x + l.width / 2, minZ: l.zEnd, maxZ: l.zStart },
  })),
]

export function inMachinery(x: number, z: number, pad = 0): boolean {
  for (const m of MACHINE_RECTS) if (inRect(x, z, m.rect, pad)) return true
  return false
}

/** Lanes that must stay clear of standing NPCs (aisle, avenues, roads, spurs, walkways — not plazas). */
export const LANES: { id: string; rect: Rect }[] = PATHS.filter((p) => p.kind !== 'plaza').map((p) => ({ id: p.id, rect: p.rect }))

export function laneAt(x: number, z: number, pad = 0): string | null {
  for (const l of LANES) if (inRect(x, z, l.rect, pad)) return l.id
  return null
}

/** Rects just outside and just inside every building door (must not be loitered in). */
export const DOOR_ZONES: { id: string; rect: Rect }[] = BUILDINGS.flatMap((zone) => {
  const b = zone.building!
  const [d0, d1] = b.doorSpan
  const f = b.footprint
  const i = b.interior
  const depth = 2.4
  switch (b.doorSide) {
    case 'N':
      return [
        { id: `${zone.id}:out`, rect: { minX: d0, maxX: d1, minZ: f.minZ - depth, maxZ: f.minZ } },
        { id: `${zone.id}:in`, rect: { minX: d0, maxX: d1, minZ: i.minZ, maxZ: i.minZ + depth } },
      ]
    case 'S':
      return [
        { id: `${zone.id}:out`, rect: { minX: d0, maxX: d1, minZ: f.maxZ, maxZ: f.maxZ + depth } },
        { id: `${zone.id}:in`, rect: { minX: d0, maxX: d1, minZ: i.maxZ - depth, maxZ: i.maxZ } },
      ]
    case 'W':
      return [
        { id: `${zone.id}:out`, rect: { minX: f.minX - depth, maxX: f.minX, minZ: d0, maxZ: d1 } },
        { id: `${zone.id}:in`, rect: { minX: i.minX, maxX: i.minX + depth, minZ: d0, maxZ: d1 } },
      ]
    case 'E':
      return [
        { id: `${zone.id}:out`, rect: { minX: f.maxX, maxX: f.maxX + depth, minZ: d0, maxZ: d1 } },
        { id: `${zone.id}:in`, rect: { minX: i.maxX - depth, maxX: i.maxX, minZ: d0, maxZ: d1 } },
      ]
  }
})

export function doorZoneAt(x: number, z: number, pad = 0): string | null {
  for (const d of DOOR_ZONES) if (inRect(x, z, d.rect, pad)) return d.id
  return null
}

export function inPlayable(x: number, z: number, margin = 0.5): boolean {
  const b = PLAYABLE_BOUNDS
  return x > b.minX + margin && x < b.maxX - margin && z > b.minZ + margin && z < b.maxZ - margin
}

/**
 * Layout-level walkability of a point for an NPC body (radius ~0.3): inside the
 * playable area, clear of restricted zones, building walls (except doors), the
 * tower and the line strips. `extra` adds module-local obstacles (NPC props).
 */
export function walkable(x: number, z: number, extra: Rect[] = [], radius = 0.3): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false
  if (!inPlayable(x, z, radius + 0.2)) return false
  if (nearRestricted(x, z, radius + 0.25)) return false
  if (inWallBand(x, z, radius)) return false
  if (inMachinery(x, z, radius - 0.05)) return false
  for (const r of extra) if (inRect(x, z, r, radius)) return false
  return true
}

/** Sample a segment every `step` m and test `walkable` (endpoints included). */
export function segmentWalkable(a: Vec2, b: Vec2, extra: Rect[] = [], radius = 0.3, step = 0.2): boolean {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  const n = Math.max(1, Math.ceil(len / step))
  for (let i = 0; i <= n; i++) {
    const x = a[0] + ((b[0] - a[0]) * i) / n
    const z = a[1] + ((b[1] - a[1]) * i) / n
    if (!walkable(x, z, extra, radius)) return false
  }
  return true
}

/**
 * 2D line of sight between two ground points, blocked by building walls (doors
 * are open). Machinery is ignored (it is mostly see-through steelwork).
 */
export function lineOfSight(ax: number, az: number, bx: number, bz: number): boolean {
  const len = Math.hypot(bx - ax, bz - az)
  const n = Math.max(1, Math.ceil(len / 0.5))
  for (let i = 1; i < n; i++) {
    const x = ax + ((bx - ax) * i) / n
    const z = az + ((bz - az) * i) / n
    if (inWallBand(x, z, 0, 0.2)) return false
  }
  return true
}
