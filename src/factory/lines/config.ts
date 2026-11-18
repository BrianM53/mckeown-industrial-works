/**
 * PRODUCTION SPINE — layout data (pure, no three.js). Single source of truth
 * for machine stations, belts, the payload monorail, the QC arch, the elevated
 * collector, colliders and NPC worker spots. Everything is derived from
 * world/layout.ts (LINES, QC_ARCH, COLLECTOR, ANCHORS) so the module follows
 * the shared map; config.test.ts checks paths/doors stay clear.
 *
 * Conventions: meters, Y up, north = -Z. Items flow from a line's zStart
 * (south, item position 0) to zEnd (north, position 1).
 */
import type { LineId, Rect, Vec2 } from '@/core/types'
import { ANCHORS, COLLECTOR, LINES, QC_ARCH, type LineDef } from '@/world/layout'

export type GroundLineId = Exclude<LineId, 'payload'>

/** Ground lines west → east. */
export const GROUND_LINES: readonly GroundLineId[] = ['pipe', 'smelt', 'circuit', 'tank']

export function lineDef(id: LineId): LineDef {
  const l = LINES.find((d) => d.id === id)
  if (!l) throw new Error(`production: unknown line ${id}`)
  return l
}

/** Display numbers (LINE_IDS order used by the console: smelt 1 … payload 5). */
export const LINE_NUMBER: Record<LineId, number> = { smelt: 1, pipe: 2, circuit: 3, tank: 4, payload: 5 }

/** World z of a normalized item position on a line (0 = zStart / south, 1 = zEnd / north). */
export function zAt(line: LineDef, p: number): number {
  return line.zStart + (line.zEnd - line.zStart) * p
}

/** Normalized item position of a world z on a line. */
export function pAt(line: LineDef, z: number): number {
  return (z - line.zStart) / (line.zEnd - line.zStart)
}

// ---------------------------------------------------------------------------
// Ground belts, elevators, collector
// ---------------------------------------------------------------------------

export const BELT = {
  /** Belt surface height (items sit on it). */
  top: 0.9,
  /** Moving surface width. */
  width: 1.1,
  /** Frame (side rails) outer width. */
  frameW: 1.36,
  /** North end drum (inside the elevator casing). */
  zNorth: 1.95,
  /** South end drum. */
  zSouth: 18.75,
} as const

/** Bucket elevator at every ground line's north end: lifts parts to the collector. */
export const ELEVATOR = {
  zMin: 2.0,
  zMax: 3.15,
  halfW: 0.62,
  height: 6.3,
  /** Head bridge (enclosed) from the casing top north to the collector. */
  headY0: 5.42,
  headY1: 6.22,
  headZEnd: -0.05,
  /** Window in the casing's south face showing the bucket chain. */
  windowY0: 1.9,
  windowY1: 5.15,
} as const

export const COLLECTOR_CFG = {
  y: COLLECTOR.height,
  z: COLLECTOR.z,
  halfW: 0.45,
  /** Each half runs from |x| = outerX to |x| = innerX, then turns north. */
  innerX: 1.5,
  outerX: 16.8,
  /** Transfer belts end in hopper mouths just short of the tower face (tower footprint starts at z = -5). */
  transferZEnd: -4.25,
  /** Support columns at x = ±9, ±16 (line axes), north of the belt (keeps the crosswalk at z≈0.6 clear). */
  supportZ: -0.85,
  supportX: [-16, -9, 9, 16] as readonly number[],
} as const

// ---------------------------------------------------------------------------
// Payload line: monorail, portals, QC arch, reject chute, packing station
// ---------------------------------------------------------------------------

const PAYLOAD = lineDef('payload')

export const MONORAIL = {
  /**
   * Rail axis. Offset WEST of the aisle centerline (layout LINES.payload x = 0) so the hanging
   * pods, scanner ring and tower intake never sit between the main aisle and the rocket on the
   * tower axis (x = 0), nor in the aisle→launch-pad sightline (which runs north-east).
   * Pods (Ø0.84) clear the west transfer belt (|x| ≤ 1.95) and the arch legs (|x| ≥ 3.8).
   */
  x: -2.55,
  /** Underside of the rail (trolleys hang from here). */
  y: PAYLOAD.railHeight ?? 6.2,
  depth: 0.34,
  zSouth: 20.15,
  zNorth: PAYLOAD.zEnd,
  /** Portal frames that carry the rail (plus the QC arch). Legs stay at |x| = portalX. */
  portalZ: [16.0, 6.0, -1.6] as readonly number[],
  portalX: 4.3,
  portalLeg: 0.36,
  portalBeamY0: 6.98,
  portalTop: 7.42,
} as const

/** Pods hang this far below the rail underside (pod body center). */
export const POD = { hang: 0.95, radius: 0.42, height: 1.0 } as const

export const ARCH = {
  z: QC_ARCH.position[1],
  /** Inner clear half-width (legs' inner faces). */
  inner: QC_ARCH.width / 2,
  legW: 0.5,
  legX: QC_ARCH.width / 2 + 0.25,
  top: QC_ARCH.height,
  beamY0: 4.72,
  /** Scanner ring around the monorail (centered on MONORAIL.x): encloses the pods and the rail. */
  ringR: 1.1,
  ringTube: 0.12,
  ringY: 5.6,
  /** Player detection half-width (|x| < 3.6 when crossing z). */
  detectHalfW: 3.6,
} as const

export const REJECT = {
  /** West of the aisle, under the monorail side of the arch (keeps the east half of the arch open toward the pad). */
  bin: { minX: -5.8, maxX: -4.4, minZ: 11.85, maxZ: 13.35 } as Rect,
  binH: 1.2,
  /** Chute: from under the ring to above the bin. */
  chuteA: [-2.75, 4.25, 11.5] as const,
  chuteB: [-4.15, 2.45, 12.45] as const,
  /** Where a rejected pod comes to rest (first slot); later ones stack beside it. */
  rest: [-5.1, 0.42, 12.6] as const,
  maxInBin: 4,
} as const

export const PACKING = { x: MONORAIL.x, z0: 18.65, z1: 20.4, y0: 5.15, y1: 7.42, halfW: 1.3 } as const
export const TOWER_HATCH = { x: MONORAIL.x, z0: -4.62, z1: -3.55, y0: 4.3, y1: 7.2, halfW: 0.5 } as const

// ---------------------------------------------------------------------------
// Line Supervisor Console (desk faces west toward the main aisle)
// ---------------------------------------------------------------------------

export const CONSOLE = {
  anchor: ANCHORS.console,
  /** Desk footprint (kept north of the cross aisle z >= 19.5). */
  rect: { minX: 4.98, maxX: 6.36, minZ: 17.95, maxZ: 19.45 } as Rect,
  front: 4.98,
  centerZ: 18.7,
} as const

// ---------------------------------------------------------------------------
// Stations (z positions along each line) — shared by builders, item types,
// colliders and worker spots.
// ---------------------------------------------------------------------------

export const SMELT = {
  x: lineDef('smelt').x,
  hopper: { z0: 17.15, z1: 19.3, top: 5.2 },
  skipZ: 19.15,
  furnace: { z0: 13.55, z1: 17.15, zc: 15.35, r: 1.55, top: 5.0 },
  stack: { x: -8.45, z: 15.35, r: 0.5, top: 14.2 },
  pourZ: 13.2,
  mill: { z0: 11.3, z1: 12.8, zc: 12.05 },
  press: { z0: 8.95, z1: 11.05, zc: 10.0, ramRestBottom: 2.32, ramSlamBottom: 1.04 },
  qcZ: 5.4,
} as const

export const PIPE = {
  x: lineDef('pipe').x,
  signZ: 19.3,
  rack: { x0: -17.95, x1: -16.65, z0: 15.4, z1: 19.2 },
  lathe: { x0: -15.4, x1: -14.15, z0: 12.25, z1: 15.5, axisX: -14.78, axisY: 1.25 },
  bender: { x0: -17.95, x1: -16.6, z0: 9.85, z1: 12.25, dieX: -17.05, dieZ: 11.0 },
  robot: { x: -14.7, z: 8.4 },
  valveBin: { x: -14.72, z: 6.85 },
  strapperZ: 5.9,
} as const

export const CIRCUIT = {
  x: lineDef('circuit').x,
  loader: { z0: 17.25, z1: 19.3 },
  booth: { x0: 7.1, x1: 10.9, z0: 11.0, z1: 16.85, h: 3.3 },
  oven: { x0: 7.45, x1: 10.55, z0: 7.0, z1: 10.55, y0: 0.32, y1: 2.15 },
  rack: { x0: 7.05, x1: 7.9, z0: 4.55, z1: 6.85, h: 2.35 },
  testHeadZ: 5.7,
} as const

export const TANK = {
  x: lineDef('tank').x,
  roller: { x0: 14.55, x1: 17.45, z0: 16.5, z1: 19.3, zc: 17.9 },
  welder: { x: 14.55, z: 12.55 },
  capWelder: { x: 17.45, z: 8.4 },
  chamber: { z0: 4.6, z1: 7.5, r: 0.78, y: 1.42 },
  gauge: { x: 17.55, z: 6.0, y: 2.78 },
} as const

// ---------------------------------------------------------------------------
// Item visuals (which item model a part shows at a given belt position)
// ---------------------------------------------------------------------------

export type ItemKind =
  | 'ingot'
  | 'sheet'
  | 'panel'
  | 'fin'
  | 'pipeStraight'
  | 'pipeElbow'
  | 'pipeValve'
  | 'pipeBundle'
  | 'boardBlank'
  | 'boardPopulated'
  | 'tankShell'
  | 'tankFuel'
  | 'podCapsule'
  | 'podCrate'

/** Position thresholds where the part changes look (inside/under a machine). */
export const ITEM_STAGES = {
  smelt: { sheetAt: pAt(lineDef('smelt'), SMELT.mill.zc), panelAt: pAt(lineDef('smelt'), SMELT.press.zc) },
  pipe: {
    elbowAt: pAt(lineDef('pipe'), PIPE.bender.dieZ),
    valveAt: pAt(lineDef('pipe'), PIPE.robot.z),
    bundleAt: pAt(lineDef('pipe'), PIPE.strapperZ),
  },
  circuit: { populatedAt: pAt(lineDef('circuit'), CIRCUIT.booth.z0) },
  tank: { fuelAt: pAt(lineDef('tank'), TANK.welder.z) },
} as const

/** Final (output) item model per ground line — what rides the elevator and collector. */
export const OUTPUT_KIND: Record<GroundLineId, ItemKind> = {
  smelt: 'panel',
  pipe: 'pipeBundle',
  circuit: 'boardPopulated',
  tank: 'tankFuel',
}

// ---------------------------------------------------------------------------
// Line name signs (south ends) — positions only; art lives in build/signs.ts
// ---------------------------------------------------------------------------

/**
 * Eye-height "what it makes" plaque per line, facing south (+z). Ground lines
 * get a thin post (`post: true`); the payload plaque is bolted to the west leg
 * of the first monorail portal (never a post in the main aisle).
 */
export const PLAQUES: Record<LineId, { x: number; z: number; post: boolean }> = {
  smelt: { x: SMELT.x + 1.62, z: 19.3, post: true },
  pipe: { x: -14.15, z: PIPE.signZ + 0.08, post: false },
  circuit: { x: CIRCUIT.x - 1.68, z: 19.3, post: true },
  tank: { x: 14.28, z: 19.3, post: true },
  payload: { x: -MONORAIL.portalX, z: MONORAIL.portalZ[0] + MONORAIL.portalLeg / 2 + 0.03, post: false },
}

// ---------------------------------------------------------------------------
// Colliders (fixed cuboids / cylinders). 'static' blocks bodies + camera,
// 'camera' only stops the camera boom (overhead structures).
// ---------------------------------------------------------------------------

export interface ColliderSpec {
  id: string
  shape: 'box' | 'cyl'
  /** Ground footprint (box) — for cylinders the bounding square of the circle. */
  rect: Rect
  y0: number
  y1: number
  /** Cylinder center + radius. */
  c?: Vec2
  r?: number
  group: 'static' | 'camera'
}

const box = (id: string, minX: number, maxX: number, minZ: number, maxZ: number, y0: number, y1: number, group: ColliderSpec['group'] = 'static'): ColliderSpec => ({
  id,
  shape: 'box',
  rect: { minX, maxX, minZ, maxZ },
  y0,
  y1,
  group,
})

const cyl = (id: string, x: number, z: number, r: number, y0: number, y1: number): ColliderSpec => ({
  id,
  shape: 'cyl',
  rect: { minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r },
  y0,
  y1,
  c: [x, z],
  r,
  group: 'static',
})

function lineColliders(id: GroundLineId): ColliderSpec[] {
  const x = lineDef(id).x
  const out: ColliderSpec[] = [
    // the belt run (keeps visitors off the belts between machines)
    box(`${id}:belt`, x - 0.76, x + 0.76, ELEVATOR.zMax, BELT.zSouth, 0, 1.06),
    // bucket elevator casing
    box(`${id}:elevator`, x - ELEVATOR.halfW - 0.03, x + ELEVATOR.halfW + 0.03, ELEVATOR.zMin, ELEVATOR.zMax, 0, ELEVATOR.height),
    // elevator head bridge (overhead, camera only)
    box(`${id}:elevator-head`, x - 0.5, x + 0.5, ELEVATOR.headZEnd, ELEVATOR.zMin, ELEVATOR.headY0, ELEVATOR.headY1, 'camera'),
  ]
  switch (id) {
    case 'smelt': {
      const s = SMELT
      out.push(
        box('smelt:furnace', x - 1.75, x + 1.75, s.furnace.z0, s.furnace.z1, 0, 5.9),
        box('smelt:hopper', x - 1.8, x + 1.15, s.furnace.z1, s.hopper.z1 + 0.1, 0, s.hopper.top + 0.2),
        cyl('smelt:stack', s.stack.x, s.stack.z, s.stack.r + 0.05, 5.6, s.stack.top),
        box('smelt:mill', x - 1.35, x + 1.35, s.mill.z0, s.mill.z1, 0, 2.6),
        box('smelt:press', x - 1.55, x + 1.8, s.press.z0, s.press.z1, 0, 6.7),
        box('smelt:press-cabinet', x - 1.98, x - 1.52, s.press.zc + 1.05, s.press.zc + 1.65, 0, 1.45),
        box('smelt:qc', x - 0.95, x + 0.95, s.qcZ - 0.16, s.qcZ + 0.16, 0, 2.5),
      )
      break
    }
    case 'pipe': {
      const p = PIPE
      out.push(
        cyl('pipe:sign-w', -17.85, p.signZ, 0.1, 0, 3.4),
        cyl('pipe:sign-e', -14.15, p.signZ, 0.1, 0, 3.4),
        box('pipe:rack', p.rack.x0, p.rack.x1, p.rack.z0, p.rack.z1, 0, 1.9),
        box('pipe:lathe', p.lathe.x0, p.lathe.x1, p.lathe.z0, p.lathe.z1, 0, 1.75),
        box('pipe:bender', p.bender.x0, p.bender.x1, p.bender.z0, p.bender.z1, 0, 1.6),
        cyl('pipe:robot', p.robot.x, p.robot.z, 0.45, 0, 1.0),
        box('pipe:valve-bin', p.valveBin.x - 0.42, p.valveBin.x + 0.42, p.valveBin.z - 0.4, p.valveBin.z + 0.4, 0, 0.8),
        box('pipe:strapper', x - 1.0, x + 1.0, p.strapperZ - 0.25, p.strapperZ + 0.25, 0, 2.6),
      )
      break
    }
    case 'circuit': {
      const c = CIRCUIT
      out.push(
        box('circuit:loader', x - 1.4, x + 1.4, c.loader.z0, c.loader.z1, 0, 2.2),
        box('circuit:booth', c.booth.x0, c.booth.x1, c.booth.z0, c.booth.z1, 0, c.booth.h + 0.5),
        box('circuit:oven', c.oven.x0, c.oven.x1, c.oven.z0, c.oven.z1, 0, 3.4),
        box('circuit:rack', c.rack.x0, c.rack.x1, c.rack.z0, c.rack.z1, 0, c.rack.h),
        box('circuit:test-head', x - 1.0, x + 1.0, c.testHeadZ - 0.2, c.testHeadZ + 0.2, 0, 2.4),
      )
      break
    }
    case 'tank': {
      const t = TANK
      out.push(
        box('tank:roller', t.roller.x0, t.roller.x1, t.roller.z0, t.roller.z1, 0, 2.6),
        cyl('tank:welder', t.welder.x, t.welder.z, 0.45, 0, 1.0),
        cyl('tank:cap-welder', t.capWelder.x, t.capWelder.z, 0.45, 0, 1.0),
        box('tank:chamber', x - 0.9, x + 0.9, t.chamber.z0 - 0.05, t.chamber.z1 + 0.05, 0, 2.25),
        cyl('tank:gauge', t.gauge.x, t.gauge.z, 0.2, 0, 3.3),
      )
      break
    }
  }
  return out
}

function centerColliders(): ColliderSpec[] {
  const out: ColliderSpec[] = []
  // QC arch legs (inner faces at |x| = ARCH.inner, never narrowing the aisle)
  for (const s of [-1, 1]) {
    const x0 = s * ARCH.inner
    const x1 = s * (ARCH.inner + ARCH.legW)
    out.push(box(`arch:leg:${s}`, Math.min(x0, x1), Math.max(x0, x1), ARCH.z - ARCH.legW / 2, ARCH.z + ARCH.legW / 2, 0, ARCH.top))
  }
  out.push(box('arch:beam', -ARCH.legX, ARCH.legX, ARCH.z - 0.3, ARCH.z + 0.3, ARCH.beamY0, ARCH.top + 0.6, 'camera'))
  // monorail portals
  const h = MONORAIL.portalLeg / 2
  for (const z of MONORAIL.portalZ) {
    for (const s of [-1, 1]) out.push(box(`portal:${z}:${s}`, s * MONORAIL.portalX - h, s * MONORAIL.portalX + h, z - h, z + h, 0, MONORAIL.portalTop))
  }
  // reject bin
  const b = REJECT.bin
  out.push(box('reject-bin', b.minX, b.maxX, b.minZ, b.maxZ, 0, REJECT.binH))
  // console desk + screen housing
  const c = CONSOLE.rect
  out.push(box('console', c.minX, c.maxX, c.minZ, c.maxZ, 0, 2.62))
  // collector support columns + overhead camera blockers
  for (const x of COLLECTOR_CFG.supportX) out.push(cyl(`collector:col:${x}`, x, COLLECTOR_CFG.supportZ, 0.24, 0, COLLECTOR_CFG.y - 0.55))
  const cy0 = COLLECTOR_CFG.y - 0.75
  const cy1 = COLLECTOR_CFG.y + 0.3
  const hw = COLLECTOR_CFG.halfW + 0.12
  out.push(box('collector:west', -COLLECTOR_CFG.outerX, -COLLECTOR_CFG.innerX + hw, -hw, hw, cy0, cy1, 'camera'))
  out.push(box('collector:east', COLLECTOR_CFG.innerX - hw, COLLECTOR_CFG.outerX, -hw, hw, cy0, cy1, 'camera'))
  for (const s of [-1, 1])
    out.push(box(`collector:transfer:${s}`, s * COLLECTOR_CFG.innerX - hw, s * COLLECTOR_CFG.innerX + hw, COLLECTOR_CFG.transferZEnd - 0.35, -hw, cy0, cy1, 'camera'))
  out.push(box('packing', PACKING.x - PACKING.halfW, PACKING.x + PACKING.halfW, PACKING.z0, PACKING.z1, PACKING.y0, PACKING.y1, 'camera'))
  out.push(box('tower-hatch', TOWER_HATCH.x - TOWER_HATCH.halfW, TOWER_HATCH.x + TOWER_HATCH.halfW, TOWER_HATCH.z0, TOWER_HATCH.z1, TOWER_HATCH.y0, TOWER_HATCH.y1, 'camera'))
  // plaque posts
  for (const [id, p] of Object.entries(PLAQUES)) if (p.post) out.push(cyl(`plaque:${id}`, p.x, p.z, 0.09, 0, 1.75))
  return out
}

export const COLLIDERS: readonly ColliderSpec[] = [...GROUND_LINES.flatMap(lineColliders), ...centerColliders()]
