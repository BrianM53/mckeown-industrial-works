/**
 * Placements of the NPC module's own gag props (pure data — tests check their
 * footprints against lanes, doors, anchors and other modules' colliders).
 *
 * Every prop sits outside the aisles/avenues/walkways/spurs and door zones.
 */
import type { Rect, Vec2 } from '@/core/types'
import { EAST, WEST } from '@/world/layout'

export interface PropPlacement {
  id: string
  pos: Vec2
  yaw: number
  /** Ground footprint (axis-aligned, world space) used for route avoidance + tests. */
  footprint: Rect
  /** Has a solid static collider (blocks the player). */
  solid: boolean
}

const rectAround = (x: number, z: number, hx: number, hz: number): Rect => ({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz })

/** Roller conveyor in the Maintenance Bay lift area (the forklift driver naps on its end). Runs north–south. */
export const NAP_CONVEYOR = {
  pos: [-15.3, 28.8] as Vec2,
  /** Length along z, width along x, top-of-rollers height. */
  length: 3.6,
  width: 0.78,
  height: 0.78,
}

/** Pallet jacks parked in the free strips beside the main aisle (south of the QC arch). */
export const JACK_A = { pos: [-4.75, 14.2] as Vec2, yaw: EAST }
export const JACK_B = { pos: [4.75, 14.2] as Vec2, yaw: WEST }
/** Length (handle tip → fork tips) and width. The parked position is the jack's center. */
export const JACK_SIZE = { length: 1.7, width: 0.72 }

/** Sputtering parts-tumbler beside the circuit line (front faces the aisle). */
export const KICK_MACHINE = { pos: [4.75, 7.3] as Vec2, yaw: WEST }

/** Bubbling green vat beside the tank line (east strip, between hall columns). */
export const VAT = { pos: [19.15, 15.2] as Vec2, radius: 0.52 }

/** Memo printer outside the Break Room, slot facing west; the ribbon unrolls west along z. */
export const PRINTER = { pos: [27.7, 25.9] as Vec2, yaw: WEST, ribbonLength: 10 }

/** Rocket-part handling robot arm + foam crash pile in the tower plaza (west side). */
export const ROBOT_ARM = { pos: [-12.4, -9.8] as Vec2 }
export const FOAM_PILE = { pos: [-12.3, -14.3] as Vec2, radius: 1.25 }

export const PROP_PLACEMENTS: PropPlacement[] = [
  {
    id: 'nap-conveyor',
    pos: NAP_CONVEYOR.pos,
    yaw: 0,
    footprint: rectAround(NAP_CONVEYOR.pos[0], NAP_CONVEYOR.pos[1], NAP_CONVEYOR.width / 2 + 0.12, NAP_CONVEYOR.length / 2 + 0.1),
    solid: true,
  },
  { id: 'jack-a', pos: JACK_A.pos, yaw: JACK_A.yaw, footprint: rectAround(JACK_A.pos[0], JACK_A.pos[1], JACK_SIZE.length / 2, JACK_SIZE.width / 2), solid: true },
  { id: 'jack-b', pos: JACK_B.pos, yaw: JACK_B.yaw, footprint: rectAround(JACK_B.pos[0], JACK_B.pos[1], JACK_SIZE.length / 2, JACK_SIZE.width / 2), solid: true },
  { id: 'kick-machine', pos: KICK_MACHINE.pos, yaw: KICK_MACHINE.yaw, footprint: rectAround(KICK_MACHINE.pos[0], KICK_MACHINE.pos[1], 0.5, 0.62), solid: true },
  { id: 'vat', pos: VAT.pos, yaw: 0, footprint: rectAround(VAT.pos[0], VAT.pos[1], VAT.radius + 0.06, VAT.radius + 0.06), solid: true },
  { id: 'printer', pos: PRINTER.pos, yaw: PRINTER.yaw, footprint: rectAround(PRINTER.pos[0] + 0.12, PRINTER.pos[1], 0.52, 0.42), solid: true },
  { id: 'robot-arm', pos: ROBOT_ARM.pos, yaw: 0, footprint: rectAround(ROBOT_ARM.pos[0], ROBOT_ARM.pos[1], 0.62, 0.62), solid: true },
  { id: 'foam-pile', pos: FOAM_PILE.pos, yaw: 0, footprint: rectAround(FOAM_PILE.pos[0], FOAM_PILE.pos[1], FOAM_PILE.radius, FOAM_PILE.radius), solid: true },
]

/** Footprints NPC routes must avoid (by id; a station may sit on its own prop). */
export function propFootprints(exclude: string[] = []): Rect[] {
  return PROP_PLACEMENTS.filter((p) => !exclude.includes(p.id)).map((p) => p.footprint)
}
