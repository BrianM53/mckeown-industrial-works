/**
 * Bumpable props: kinds (physics + size) and hand-placed spots (pure data).
 * The placement test (propData.test.ts) checks every spot against lanes,
 * door spans, waypoint segments, environment colliders, the forklift's home
 * and exit spots, and each other.
 *
 * Body origin = bottom centre of the prop; `y` is the height of the surface it
 * rests on (0 = floor, or the top of the prop below when stacked).
 */
export type PropKind = 'box' | 'boxSmall' | 'crate' | 'cone' | 'barrel' | 'pallet'

export type PropCollider =
  | { type: 'cuboid'; half: [number, number, number]; y: number; mass: number }
  | { type: 'cylinder'; halfHeight: number; radius: number; y: number; mass: number }
  | { type: 'cone'; halfHeight: number; radius: number; y: number; mass: number }

export interface PropKindDef {
  colliders: PropCollider[]
  /** Footprint size (local x, local z) for placement checks. */
  size: [number, number]
  height: number
  /** Radius of the horizontal bounding circle (nudges, overlap). */
  radius: number
  friction: number
  restitution: number
  linearDamping: number
  angularDamping: number
}

export const PROP_KINDS: Record<PropKind, PropKindDef> = {
  box: {
    colliders: [{ type: 'cuboid', half: [0.31, 0.22, 0.25], y: 0.22, mass: 3 }],
    size: [0.62, 0.5],
    height: 0.44,
    radius: 0.4,
    friction: 0.7,
    restitution: 0.1,
    linearDamping: 0.25,
    angularDamping: 0.6,
  },
  boxSmall: {
    colliders: [{ type: 'cuboid', half: [0.22, 0.17, 0.2], y: 0.17, mass: 2 }],
    size: [0.44, 0.4],
    height: 0.34,
    radius: 0.3,
    friction: 0.7,
    restitution: 0.1,
    linearDamping: 0.25,
    angularDamping: 0.6,
  },
  crate: {
    colliders: [{ type: 'cuboid', half: [0.4, 0.4, 0.4], y: 0.4, mass: 18 }],
    size: [0.8, 0.8],
    height: 0.8,
    radius: 0.57,
    friction: 0.65,
    restitution: 0.08,
    linearDamping: 0.3,
    angularDamping: 0.7,
  },
  cone: {
    // weighted rubber base + light body: wobbles, tips, rolls
    colliders: [
      { type: 'cuboid', half: [0.21, 0.025, 0.21], y: 0.025, mass: 1.8 },
      { type: 'cone', halfHeight: 0.33, radius: 0.17, y: 0.38, mass: 0.7 },
    ],
    size: [0.42, 0.42],
    height: 0.71,
    radius: 0.3,
    friction: 0.8,
    restitution: 0.15,
    linearDamping: 0.3,
    angularDamping: 0.5,
  },
  barrel: {
    colliders: [{ type: 'cylinder', halfHeight: 0.44, radius: 0.29, y: 0.44, mass: 9 }],
    size: [0.58, 0.58],
    height: 0.88,
    radius: 0.29,
    friction: 0.6,
    restitution: 0.18,
    linearDamping: 0.25,
    angularDamping: 0.45,
  },
  pallet: {
    colliders: [{ type: 'cuboid', half: [0.6, 0.07, 0.5], y: 0.07, mass: 15 }],
    size: [1.2, 1.0],
    height: 0.14,
    radius: 0.78,
    friction: 0.8,
    restitution: 0.05,
    linearDamping: 0.4,
    angularDamping: 0.8,
  },
}

export interface PropSpot {
  id: string
  kind: PropKind
  x: number
  z: number
  /** Height of the supporting surface (stacking). */
  y: number
  yaw: number
  /** Area tag (debug / tests). */
  area: 'bay' | 'backlot' | 'yard' | 'warehouse' | 'avenue'
}

const H = Math.PI / 2
const PAL = PROP_KINDS.pallet.height
const BOX = PROP_KINDS.box.height
const CRATE = PROP_KINDS.crate.height

function spot(area: PropSpot['area'], kind: PropKind, x: number, z: number, yaw = 0, y = 0): Omit<PropSpot, 'id'> {
  return { area, kind, x, z, y, yaw }
}

const RAW: Omit<PropSpot, 'id'>[] = [
  // --- Maintenance Bay: a delivery waiting on a pallet + a crate (south side, clear of the forklift lane)
  spot('bay', 'pallet', -14.1, 31.75),
  spot('bay', 'box', -14.35, 31.7, 0, PAL),
  spot('bay', 'box', -14.33, 31.72, 0.16, PAL + BOX),
  spot('bay', 'boxSmall', -13.75, 31.86, -0.1, PAL),
  spot('bay', 'crate', -12.55, 31.95, 0.05),
  // --- back lot behind the bay (reached from the intake plaza)
  spot('backlot', 'crate', -14.7, 35.0),
  spot('backlot', 'crate', -14.68, 35.02, 0.22, CRATE),
  spot('backlot', 'box', -13.5, 35.1, -0.12),
  spot('backlot', 'barrel', -11.6, 35.4),
  spot('backlot', 'cone', -9.0, 35.0),
  spot('backlot', 'cone', -8.05, 35.6),
  // --- yard between the bay and the west avenue
  spot('yard', 'pallet', -20.8, 27.4, H),
  spot('yard', 'box', -20.8, 27.1, H, PAL),
  spot('yard', 'box', -20.8, 27.76, H + 0.05, PAL),
  spot('yard', 'barrel', -19.0, 29.5),
  spot('yard', 'barrel', -19.25, 30.15),
  spot('yard', 'barrel', -18.62, 30.25),
  spot('yard', 'cone', -22.1, 25.4),
  spot('yard', 'cone', -21.2, 24.85),
  // --- warehouse forklift practice area: slalom cones, a box pyramid, pallets, drums, a crate
  ...[-35.2, -37.8, -40.4, -43.0].flatMap((x) => [spot('warehouse', 'cone', x, 27.5), spot('warehouse', 'cone', x, 32.5)]),
  spot('warehouse', 'box', -43.3, 29.36, H),
  spot('warehouse', 'box', -43.3, 30.0, H),
  spot('warehouse', 'box', -43.3, 30.64, H),
  spot('warehouse', 'box', -43.3, 29.68, H, BOX),
  spot('warehouse', 'box', -43.3, 30.32, H, BOX),
  spot('warehouse', 'box', -43.3, 30.0, H, BOX * 2),
  spot('warehouse', 'pallet', -36.0, 26.6),
  spot('warehouse', 'pallet', -41.2, 33.5, 0.08),
  spot('warehouse', 'barrel', -33.9, 26.5),
  spot('warehouse', 'barrel', -33.9, 33.5),
  spot('warehouse', 'crate', -38.6, 33.6, -0.06),
  // --- west avenue edge (strip west of the avenue, south of the control room)
  spot('avenue', 'barrel', -28.6, 20.6),
  spot('avenue', 'barrel', -28.0, 21.25),
]

export const PROP_SPOTS: PropSpot[] = RAW.map((s, i) => ({ ...s, id: `${s.area}:${s.kind}:${i}` }))

/** Spots of one kind, in a stable order (instance index = position in this list). */
export function spotsOfKind(kind: PropKind): PropSpot[] {
  return PROP_SPOTS.filter((s) => s.kind === kind)
}
