/**
 * Restricted-zone geometry helpers (pure). The zones themselves are defined in
 * world/layout.ts RESTRICTED_ZONES; the environment module paints and fences them.
 */
import type { Vec2 } from '@/core/types'
import { NORTH, EAST, WEST, RESTRICTED_ZONES, type RestrictedZoneDef } from '@/world/layout'

export function restrictedZoneById(id: string, zones: readonly RestrictedZoneDef[] = RESTRICTED_ZONES): RestrictedZoneDef | undefined {
  return zones.find((z) => z.id === id)
}

/** Which zone (if any) contains (x, z). Same rule as layout.restrictedZoneAt, over any zone list. */
export function zoneAtPoint(x: number, z: number, zones: readonly RestrictedZoneDef[] = RESTRICTED_ZONES): RestrictedZoneDef | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null
  for (const r of zones) if (zoneSignedDistance(r, x, z) <= 0) return r
  return null
}

/** Signed distance (m) from (x, z) to the zone boundary: negative inside, positive outside. */
export function zoneSignedDistance(zone: RestrictedZoneDef, x: number, z: number): number {
  const s = zone.shape
  if (s.kind === 'circle') return Math.hypot(x - s.center[0], z - s.center[1]) - s.radius
  const r = s.rect
  const dx = Math.max(r.minX - x, 0, x - r.maxX)
  const dz = Math.max(r.minZ - z, 0, z - r.maxZ)
  if (dx > 0 || dz > 0) return Math.hypot(dx, dz)
  return -Math.min(x - r.minX, r.maxX - x, z - r.minZ, r.maxZ - z)
}

export function zoneCenter(zone: RestrictedZoneDef): Vec2 {
  const s = zone.shape
  if (s.kind === 'circle') return [s.center[0], s.center[1]]
  return [(s.rect.minX + s.rect.maxX) / 2, (s.rect.minZ + s.rect.maxZ) / 2]
}

/** The zone whose boundary is nearest to (x, z). */
export function nearestZone(x: number, z: number, zones: readonly RestrictedZoneDef[] = RESTRICTED_ZONES): RestrictedZoneDef {
  let best = zones[0]
  let bestD = Infinity
  for (const r of zones) {
    const d = zoneSignedDistance(r, x, z)
    if (d < bestD) {
      bestD = d
      best = r
    }
  }
  return best
}

/**
 * Debug/test entry points: a free spot just inside each zone, reachable from the
 * barrier gap (the transformer yard's literal center is the transformer itself,
 * and the blast zone's center is the launch pad under the rocket).
 */
export const ZONE_TRIGGER_POINTS: Record<string, { x: number; z: number; yaw: number }> = {
  'transformer-yard': { x: 15.95, z: -4.5, yaw: EAST },
  'wet-paint': { x: -17.5, z: -4.5, yaw: WEST },
  'blast-zone': { x: 13.4, z: -27.4, yaw: NORTH },
}

export function triggerPointFor(zoneId: string): { x: number; z: number; yaw: number } | null {
  const p = ZONE_TRIGGER_POINTS[zoneId]
  if (p) return p
  const zone = restrictedZoneById(zoneId)
  if (!zone) return null
  const [x, z] = zoneCenter(zone)
  return { x, z, yaw: NORTH }
}
