/**
 * Placement of building signs, zone-colored beacons and red emergency beacons
 * (pure data shared by the sign, beacon and lighting parts).
 */
import { ZONES } from '@/world/layout'
import { BUILDINGS, sidePoint, type BuildingInfo } from '../data/buildings'
import { GANTRY } from '../data/decor'
import { SIGNPOSTS } from '../data/signposts'

export interface SignSpot {
  /** Center along the door side. */
  along: number
  y0: number
  w: number
  h: number
  /** Outward offset from the wall face. */
  out: number
}

export function buildingSignSpot(b: BuildingInfo): SignSpot {
  const [d0, d1] = b.def.doorSpan
  const f = b.def.footprint
  const side = b.def.doorSide
  const wallLen = side === 'N' || side === 'S' ? f.maxX - f.minX : f.maxZ - f.minZ
  const span = d1 - d0
  const w = Math.min(Math.max(span + 2.6, 6.2), wallLen - 1.4)
  const H = b.def.height
  const h = b.id === 'warehouse' || b.id === 'server' ? 1.45 : 1.25
  const room = H - b.style.doorHeight
  // personnel: the sign sits above the awning
  const lift = b.id === 'personnel' ? 0.55 : 0
  const y0 = Math.min(H - h - 0.25, b.style.doorHeight + Math.max(0.3, (room - h) * 0.42) + lift)
  // keep the sign on the wall even when the door is off-center
  const lo = (side === 'N' || side === 'S' ? f.minX : f.minZ) + w / 2 + 0.6
  const hi = (side === 'N' || side === 'S' ? f.maxX : f.maxZ) - w / 2 - 0.6
  const along = Math.min(hi, Math.max(lo, (d0 + d1) / 2))
  return { along, y0, w, h, out: 0.16 }
}

/** +1 when "visitor's right" (facing the wall from outside) is the positive along-axis. */
export const RIGHT: Record<'N' | 'S' | 'E' | 'W', 1 | -1> = { S: 1, N: -1, E: -1, W: 1 }

export interface BeaconSpot {
  x: number
  y: number
  z: number
  color: string
  building?: string
}

/** Zone-colored beacon at the top corner of each building sign (+ intake arch & rec yard gate). */
export const ZONE_BEACONS: BeaconSpot[] = [
  ...BUILDINGS.map((b) => {
    const s = buildingSignSpot(b)
    const side = b.def.doorSide
    // "right" end of the sign as seen by a visitor facing the door
    const along = s.along + RIGHT[side] * (s.w / 2 - 0.25)
    const [x, z] = sidePoint(b, side, along, s.out + 0.18)
    return { x, y: s.y0 + s.h + 0.28, z, color: b.zone.color, building: b.id }
  }),
  { x: 30.6, y: 3.82, z: -16.6, color: ZONES.rec.color },
  { x: 30.6, y: 3.82, z: -11.4, color: ZONES.rec.color },
]

/** Red rotating emergency beacons (only lit during the night shift). */
export const EMERGENCY_BEACONS: BeaconSpot[] = [
  ...BUILDINGS.map((b) => {
    const s = buildingSignSpot(b)
    const side = b.def.doorSide
    const along = s.along - RIGHT[side] * (s.w / 2 + 0.55)
    const [x, z] = sidePoint(b, side, along, 0.35)
    return { x, y: Math.min(b.def.height - 0.3, s.y0 + s.h + 0.1), z, color: '#FF2A1C', building: b.id }
  }),
  ...SIGNPOSTS.filter((p) => p.max >= 5).map((p) => ({ x: p.position[0], y: 3.42, z: p.position[1], color: '#FF2A1C' })),
  { x: -GANTRY.legX, y: GANTRY.height + 0.25, z: GANTRY.z, color: '#FF2A1C' },
  { x: GANTRY.legX, y: GANTRY.height + 0.25, z: GANTRY.z, color: '#FF2A1C' },
]
