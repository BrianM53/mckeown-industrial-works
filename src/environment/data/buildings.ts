/**
 * Building shells derived from world/layout ZONES[*].building (pure data).
 * Walls leave the door span open; windows avoid doors, corners and the walls
 * that station modules dress (anchor walls).
 */
import type { Rect } from '@/core/types'
import { ZONE_LIST, type BuildingDef, type DoorSide, type ZoneDef, type ZoneId } from '@/world/layout'

export type WallMaterial = 'corr' | 'brick'
export type DoorKind = 'rollup' | 'storefront' | 'glass'
export type FloorKind = 'carpet' | 'epoxy' | 'tile' | 'raised' | 'lab' | 'wood' | 'concrete'

export interface BuildingStyle {
  wall: WallMaterial
  wallColor: string
  trimColor: string
  roofColor: string
  /** Clear height of the door opening. */
  doorHeight: number
  door: DoorKind
  /** Windows: sill height, window height & width, spacing. */
  window: { y0: number; h: number; w: number; spacing: number }
  windowSides: DoorSide[]
  /** Ranges along a wall (z for E/W, x for N/S) that must stay free of windows/wall decor. */
  keepClear: { side: DoorSide; from: number; to: number }[]
  floor: FloorKind
  floorColor: string
  /** Interior wall paint (lining). */
  liningColor: string
  /** Lower interior wall band color. */
  wainscotColor: string
  /** Big painted building number. */
  number: string
}

const OFFICE_WINDOW = { y0: 1.25, h: 1.45, w: 1.7, spacing: 3.1 }
const HIGH_WINDOW = (H: number) => ({ y0: H - 2.5, h: 1.15, w: 2.3, spacing: 3.5 })

const STYLES: Partial<Record<ZoneId, (def: BuildingDef) => BuildingStyle>> = {
  personnel: () => ({
    wall: 'brick',
    wallColor: '#B0654A',
    trimColor: '#EAE3D2',
    roofColor: '#5B6466',
    doorHeight: 3.7,
    door: 'storefront',
    window: OFFICE_WINDOW,
    windowSides: ['N', 'S'],
    keepClear: [{ side: 'E', from: 25.5, to: 32.5 }],
    floor: 'carpet',
    floorColor: '#56636E',
    liningColor: '#E2DACB',
    wainscotColor: '#7E8B8F',
    number: '01',
  }),
  maintenance: (d) => ({
    wall: 'corr',
    wallColor: '#66726F',
    trimColor: '#E57D35',
    roofColor: '#7E8486',
    doorHeight: 4.7,
    door: 'rollup',
    window: HIGH_WINDOW(d.height),
    windowSides: ['N', 'S'],
    keepClear: [],
    floor: 'epoxy',
    floorColor: '#6C7770',
    liningColor: '#C9C6B8',
    wainscotColor: '#E57D35',
    number: '02',
  }),
  control: () => ({
    wall: 'corr',
    wallColor: '#5D8581',
    trimColor: '#D9D4C5',
    roofColor: '#56605F',
    doorHeight: 3.2,
    door: 'glass',
    window: { y0: 1.4, h: 2.1, w: 2.4, spacing: 3.0 },
    windowSides: ['N', 'S', 'E'],
    keepClear: [],
    floor: 'carpet',
    floorColor: '#3F4D55',
    liningColor: '#D7D4C8',
    wainscotColor: '#638C88',
    number: '04',
  }),
  server: (d) => ({
    wall: 'corr',
    wallColor: '#4D6C82',
    trimColor: '#C9CED0',
    roofColor: '#69767A',
    doorHeight: 3.9,
    door: 'rollup',
    window: HIGH_WINDOW(d.height),
    windowSides: ['N', 'S'],
    keepClear: [{ side: 'W', from: -12.5, to: -5.5 }],
    floor: 'raised',
    floorColor: '#9AA3A6',
    liningColor: '#CDD2D2',
    wainscotColor: '#4F86A8',
    number: '05',
  }),
  rnd: () => ({
    wall: 'corr',
    wallColor: '#CFCABE',
    trimColor: '#8C6BB1',
    roofColor: '#6A6E70',
    doorHeight: 3.3,
    door: 'glass',
    window: { y0: 1.3, h: 1.6, w: 2.0, spacing: 3.2 },
    windowSides: ['N', 'S'],
    keepClear: [{ side: 'W', from: -35.5, to: -30.5 }],
    floor: 'lab',
    floorColor: '#C4C8C2',
    liningColor: '#E6E3DA',
    wainscotColor: '#8C6BB1',
    number: '06',
  }),
  radio: () => ({
    wall: 'brick',
    wallColor: '#8F4A3A',
    trimColor: '#EAE3D2',
    roofColor: '#4E5658',
    doorHeight: 3.1,
    door: 'glass',
    window: OFFICE_WINDOW,
    windowSides: ['N', 'S'],
    keepClear: [],
    floor: 'wood',
    floorColor: '#8C6A4B',
    liningColor: '#3C3F44',
    wainscotColor: '#C8553D',
    number: '07',
  }),
  breakroom: () => ({
    wall: 'corr',
    wallColor: '#B3A385',
    trimColor: '#6B5440',
    roofColor: '#5E6567',
    doorHeight: 3.1,
    door: 'glass',
    window: OFFICE_WINDOW,
    windowSides: ['N', 'S', 'E'],
    keepClear: [],
    floor: 'tile',
    floorColor: '#C9BFA8',
    liningColor: '#E5DCC8',
    wainscotColor: '#9A8466',
    number: '08',
  }),
  warehouse: (d) => ({
    wall: 'corr',
    wallColor: '#806C56',
    trimColor: '#E9B63F',
    roofColor: '#6F7476',
    doorHeight: 5.4,
    door: 'rollup',
    window: HIGH_WINDOW(d.height),
    windowSides: ['N', 'S', 'W'],
    keepClear: [],
    floor: 'concrete',
    floorColor: '#8E8C84',
    liningColor: '#B9B4A6',
    wainscotColor: '#E9B63F',
    number: '03',
  }),
}

function defaultStyle(def: BuildingDef): BuildingStyle {
  return {
    wall: 'corr',
    wallColor: '#7D8A8C',
    trimColor: '#E9B63F',
    roofColor: '#666E70',
    doorHeight: Math.min(4, def.height - 1.5),
    door: 'rollup',
    window: HIGH_WINDOW(def.height),
    windowSides: ['N', 'S'],
    keepClear: [],
    floor: 'concrete',
    floorColor: '#8E8C84',
    liningColor: '#C9C6B8',
    wainscotColor: '#E9B63F',
    number: '09',
  }
}

export interface BuildingInfo {
  id: ZoneId
  zone: ZoneDef
  def: BuildingDef
  style: BuildingStyle
  /** Wall thickness (footprint → interior inset). */
  t: number
}

export const BUILDINGS: BuildingInfo[] = ZONE_LIST.filter((z) => z.building).map((z) => {
  const def = z.building!
  const style = (STYLES[z.id] ?? defaultStyle)(def)
  const f = def.footprint
  const i = def.interior
  const t = Math.max(0.2, Math.min(i.minX - f.minX, f.maxX - i.maxX, i.minZ - f.minZ, f.maxZ - i.maxZ))
  return { id: z.id, zone: z, def, style, t }
})

export function getBuilding(id: ZoneId): BuildingInfo | undefined {
  return BUILDINGS.find((b) => b.id === id)
}

export interface WallBox {
  side: DoorSide
  kind: 'wall' | 'header'
  rect: Rect
  y0: number
  y1: number
}

/** Length range of a side along its own axis (x for N/S, z for E/W). */
export function sideRange(b: BuildingInfo, side: DoorSide): [number, number] {
  const f = b.def.footprint
  return side === 'N' || side === 'S' ? [f.minX, f.maxX] : [f.minZ + b.t, f.maxZ - b.t]
}

/** Wall band rect for a whole side (before cutting the door). */
function sideRect(b: BuildingInfo, side: DoorSide, from: number, to: number): Rect {
  const f = b.def.footprint
  const t = b.t
  switch (side) {
    case 'N':
      return { minX: from, maxX: to, minZ: f.minZ, maxZ: f.minZ + t }
    case 'S':
      return { minX: from, maxX: to, minZ: f.maxZ - t, maxZ: f.maxZ }
    case 'W':
      return { minX: f.minX, maxX: f.minX + t, minZ: from, maxZ: to }
    case 'E':
      return { minX: f.maxX - t, maxX: f.maxX, minZ: from, maxZ: to }
  }
}

/** Wall boxes: full-height segments plus a header above the door opening. */
export function wallBoxes(b: BuildingInfo): WallBox[] {
  const H = b.def.height
  const out: WallBox[] = []
  for (const side of ['N', 'S', 'W', 'E'] as DoorSide[]) {
    const [lo, hi] = sideRange(b, side)
    if (side !== b.def.doorSide) {
      out.push({ side, kind: 'wall', rect: sideRect(b, side, lo, hi), y0: 0, y1: H })
      continue
    }
    const [d0, d1] = b.def.doorSpan
    if (d0 - lo > 0.02) out.push({ side, kind: 'wall', rect: sideRect(b, side, lo, d0), y0: 0, y1: H })
    if (hi - d1 > 0.02) out.push({ side, kind: 'wall', rect: sideRect(b, side, d1, hi), y0: 0, y1: H })
    out.push({ side, kind: 'header', rect: sideRect(b, side, d0, d1), y0: b.style.doorHeight, y1: H })
  }
  return out
}

export interface WindowSpot {
  side: DoorSide
  /** Center along the side axis. */
  along: number
  y0: number
  w: number
  h: number
}

/** Evenly spaced windows on the style's window sides, avoiding doors/corners/keep-clear ranges. */
export function windowSpots(b: BuildingInfo): WindowSpot[] {
  const out: WindowSpot[] = []
  const { y0, h, w, spacing } = b.style.window
  const f = b.def.footprint
  for (const side of b.style.windowSides) {
    const lo = side === 'N' || side === 'S' ? f.minX : f.minZ
    const hi = side === 'N' || side === 'S' ? f.maxX : f.maxZ
    const usable = hi - lo - 2.2
    const n = Math.max(1, Math.floor(usable / spacing))
    const step = (hi - lo) / (n + 1)
    for (let k = 1; k <= n; k++) {
      const along = lo + step * k
      const a0 = along - w / 2 - 0.3
      const a1 = along + w / 2 + 0.3
      if (side === b.def.doorSide) {
        const [d0, d1] = b.def.doorSpan
        if (a1 > d0 - 0.6 && a0 < d1 + 0.6) continue
      }
      if (b.style.keepClear.some((c) => c.side === side && a1 > c.from && a0 < c.to)) continue
      out.push({ side, along, y0, w, h })
    }
  }
  return out
}

/** Outward unit normal of a side on the ground plane. */
export function sideNormal(side: DoorSide): [number, number] {
  switch (side) {
    case 'N':
      return [0, -1]
    case 'S':
      return [0, 1]
    case 'W':
      return [-1, 0]
    case 'E':
      return [1, 0]
  }
}

/** Outer-face coordinate of a side (x for E/W, z for N/S). */
export function sideFace(b: BuildingInfo, side: DoorSide): number {
  const f = b.def.footprint
  return side === 'N' ? f.minZ : side === 'S' ? f.maxZ : side === 'W' ? f.minX : f.maxX
}

/** World (x, z) of a point `along` a side, offset `out` meters outward from the outer face. */
export function sidePoint(b: BuildingInfo, side: DoorSide, along: number, out: number): [number, number] {
  const face = sideFace(b, side)
  const [nx, nz] = sideNormal(side)
  return side === 'N' || side === 'S' ? [along, face + nz * out] : [face + nx * out, along]
}

/** Yaw that makes a -Z-facing model face outward from `side`. */
export function sideYaw(side: DoorSide): number {
  // forward(yaw) = (-sin yaw, -cos yaw)
  switch (side) {
    case 'N':
      return 0
    case 'S':
      return Math.PI
    case 'W':
      return Math.PI / 2
    case 'E':
      return -Math.PI / 2
  }
}

/** Rect just outside the door that must stay clear (door approach). */
export function doorApproach(b: BuildingInfo, depth = 2.4): Rect {
  const [d0, d1] = b.def.doorSpan
  const f = b.def.footprint
  switch (b.def.doorSide) {
    case 'N':
      return { minX: d0, maxX: d1, minZ: f.minZ - depth, maxZ: f.minZ }
    case 'S':
      return { minX: d0, maxX: d1, minZ: f.maxZ, maxZ: f.maxZ + depth }
    case 'W':
      return { minX: f.minX - depth, maxX: f.minX, minZ: d0, maxZ: d1 }
    case 'E':
      return { minX: f.maxX, maxX: f.maxX + depth, minZ: d0, maxZ: d1 }
  }
}

/** Rect just inside the door that must stay clear. */
export function doorInside(b: BuildingInfo, depth = 2.4): Rect {
  const [d0, d1] = b.def.doorSpan
  const i = b.def.interior
  switch (b.def.doorSide) {
    case 'N':
      return { minX: d0, maxX: d1, minZ: i.minZ, maxZ: i.minZ + depth }
    case 'S':
      return { minX: d0, maxX: d1, minZ: i.maxZ - depth, maxZ: i.maxZ }
    case 'W':
      return { minX: i.minX, maxX: i.minX + depth, minZ: d0, maxZ: d1 }
    case 'E':
      return { minX: i.maxX - depth, maxX: i.maxX, minZ: d0, maxZ: d1 }
  }
}
