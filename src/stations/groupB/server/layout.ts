/**
 * SERVER HALL layout (pure data, unit-tested). Derived from world/layout.ts:
 * ZONES.server.building (interior x -45.5..-30.5, z -15.5..-2.5, door on the
 * east wall z -11..-7), ANCHORS.serverTerminal (-38,-9) and ANCHORS.serverFan
 * (-45.5,-9).
 *
 *   north wall (z -15.5)  ── service corridor ──────────────────────────────
 *        FAN  |          [A]E  cold  W[B]  hot  [C]E   corridor  | E wall
 *   (W wall)  |  open     [A]   aisle  [B]  aisle [C]            |
 *             |  fan      kA            kB          kC           |
 *   z -9  ════╡  room  [TERMINAL]═══ central aisle (4.1 m) ═══════ DOOR
 *             |           kA'           kB'         kC'          |
 *             |          [A]E  cold  W[B]  hot  [C]E             |
 *   south wall (z -2.5)   ── service corridor ──────────────────────────────
 *
 * Racks stand in north-south rows (fronts facing each other across the cold
 * aisles), so walking the central aisle you look down canyons of blinking
 * LEDs. A CRT kiosk stands at the aisle end of every row, one per project.
 */
import type { Rect } from '@/core/types'
import { PROJECTS } from '@/content/projects'
import { ANCHORS, EAST, NORTH, SOUTH, WEST, ZONES } from '@/world/layout'

export const HALL = ZONES.server.building!
export const INTERIOR: Rect = HALL.interior
export const DOOR = { x: HALL.footprint.maxX, z0: HALL.doorSpan[0], z1: HALL.doorSpan[1] }

export const RACK = { w: 0.6, d: 1.05, h: 2.12 }
export const RACKS_PER_ROW = 5

/** Central aisle edge: rack rows (and kiosks) stay outside z ∈ (AISLE_N, AISLE_S). */
export const AISLE_N = -11.6
export const AISLE_S = -6.4

export interface RackRow {
  id: string
  /** Row label shown on the end cap. */
  label: string
  /** Row center x. */
  x: number
  /** Z range of the row. */
  z0: number
  z1: number
  /** Facing of the rack fronts (EAST or WEST). */
  yaw: number
  block: 'N' | 'S'
}

const ROW_XS: { x: number; yaw: number }[] = [
  { x: -36.625, yaw: EAST },
  { x: -34.375, yaw: WEST }, // faces west, across the cold aisle
  { x: -32.325, yaw: EAST },
]

export const RACK_ROWS: RackRow[] = (['N', 'S'] as const).flatMap((block, bi) =>
  ROW_XS.map((r, i) => {
    const len = RACKS_PER_ROW * RACK.w
    const z0 = block === 'N' ? AISLE_N - len : AISLE_S
    return {
      id: `${block}${i}`,
      label: `ROW ${String.fromCharCode(65 + i + bi * 3)}`,
      x: r.x,
      z0,
      z1: z0 + len,
      yaw: r.yaw,
      block,
    }
  }),
)

/** Cold aisles (perforated tiles + fog wisps): between the first two rows of each block. */
export const COLD_AISLES: Rect[] = (['N', 'S'] as const).map((block) => {
  const a = RACK_ROWS.find((r) => r.block === block && r.id.endsWith('0'))!
  const b = RACK_ROWS.find((r) => r.block === block && r.id.endsWith('1'))!
  return { minX: a.x + RACK.d / 2, maxX: b.x - RACK.d / 2, minZ: a.z0, maxZ: a.z1 }
})

export interface RackSlot {
  /** Rack center. */
  x: number
  z: number
  /** Front facing yaw. */
  yaw: number
  row: string
  index: number
  /** Deterministic variety (front layout variant). */
  variant: number
}

export const RACK_SLOTS: RackSlot[] = RACK_ROWS.flatMap((row, ri) =>
  Array.from({ length: RACKS_PER_ROW }, (_, i) => ({
    x: row.x,
    z: row.z0 + RACK.w * (i + 0.5),
    yaw: row.yaw,
    row: row.id,
    index: i,
    variant: (ri * 7 + i * 3 + (i % 2)) % 4,
  })),
)

// ---------------------------------------------------------------------------
// Kiosks: one CRT terminal per PROJECTS entry, at the aisle end of each row
// (door side first). Unused slots show the repository index (github panel).
// ---------------------------------------------------------------------------

export const KIOSK = { w: 0.78, d: 0.55, h: 1.62 }

export interface KioskSlot {
  x: number
  z: number
  yaw: number
}

function aisleSlots(): KioskSlot[] {
  const out: KioskSlot[] = []
  // walk from the door westward: C, B, A rows, north then south
  for (const ri of [2, 1, 0]) {
    const x = ROW_XS[ri].x
    out.push({ x, z: AISLE_N + KIOSK.d / 2, yaw: SOUTH })
    out.push({ x, z: AISLE_S - KIOSK.d / 2, yaw: NORTH })
  }
  return out
}

/** Overflow slots along the fan-room walls (only used if PROJECTS grows past 6). */
const OVERFLOW_SLOTS: KioskSlot[] = [
  { x: -40.2, z: INTERIOR.minZ + 0.45, yaw: SOUTH },
  { x: -40.2, z: INTERIOR.maxZ - 0.45, yaw: NORTH },
  { x: -42.0, z: INTERIOR.minZ + 0.45, yaw: SOUTH },
  { x: -42.0, z: INTERIOR.maxZ - 0.45, yaw: NORTH },
]

export type KioskKind = { kind: 'project'; projectId: string; index: number } | { kind: 'index' }

export interface KioskDef extends KioskSlot {
  id: string
  content: KioskKind
}

/** One kiosk per project (+ a repository-index kiosk in the first free aisle slot). */
export function kioskLayout(projectIds: string[] = PROJECTS.map((p) => p.id)): KioskDef[] {
  const slots = [...aisleSlots(), ...OVERFLOW_SLOTS]
  const out: KioskDef[] = []
  projectIds.slice(0, slots.length).forEach((projectId, index) => {
    out.push({ ...slots[index], id: `server:kiosk:${projectId}`, content: { kind: 'project', projectId, index } })
  })
  const free = slots.slice(projectIds.length, 6)
  if (free.length > 0) out.push({ ...free[0], id: 'server:kiosk:index', content: { kind: 'index' } })
  return out
}

/** Where the visitor stands to use a kiosk (in front of the screen). */
export function kioskInteractPoint(k: KioskSlot, dist = 0.72): { x: number; z: number } {
  return { x: k.x - Math.sin(k.yaw) * (KIOSK.d / 2 + dist), z: k.z - Math.cos(k.yaw) * (KIOSK.d / 2 + dist) }
}

// ---------------------------------------------------------------------------
// Main terminal + fan + sign
// ---------------------------------------------------------------------------

export const TERMINAL = {
  x: ANCHORS.serverTerminal.position[0],
  z: ANCHORS.serverTerminal.position[1],
  yaw: ANCHORS.serverTerminal.yaw,
  /** Desk footprint (x depth, z width). */
  w: 2.6,
  d: 1.0,
  /** Interaction point (front edge of the desk). */
  interact: { x: ANCHORS.serverTerminal.position[0] + 1.15, z: ANCHORS.serverTerminal.position[1] },
}

export const FAN = {
  /** Wall plate center (on the west wall). */
  x: ANCHORS.serverFan.position[0],
  z: ANCHORS.serverFan.position[1],
  y: 3.05,
  radius: 2.5,
  /** Front of the cage (x). */
  cageX: ANCHORS.serverFan.position[0] + 1.05,
  interact: { x: ANCHORS.serverFan.interact[0], z: ANCHORS.serverFan.interact[1] },
}
