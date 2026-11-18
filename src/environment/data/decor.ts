/**
 * Static decor placements (pure data). Rendering (src/environment/parts/*) and
 * the layout tests read the SAME definitions, so every collider placed here is
 * checked against lanes, waypoint segments, doors and anchors.
 *
 * Everything is hand-placed against world/layout.ts (see the ASCII map there).
 */
import type { Rect, Vec2 } from '@/core/types'
import { createRng } from '@/core/rng'
import { RESTRICTED_ZONES } from '@/world/layout'
import { rectAt } from './rects'

// ---------------------------------------------------------------------------
// Feature placements (unique, merged into static batches)
// ---------------------------------------------------------------------------

export type FeatureKind =
  | 'tankV'
  | 'silo'
  | 'sphereTank'
  | 'bulletTank'
  | 'waterTower'
  | 'container'
  | 'trailer'
  | 'boxTruck'
  | 'van'
  | 'dumpster'
  | 'acUnit'
  | 'generator'
  | 'cabinet'
  | 'gasCage'
  | 'pipeStack'
  | 'tirePile'
  | 'scrapBin'
  | 'picnic'
  | 'spool'
  | 'bunker'
  | 'wreckage'
  | 'floodMast'
  | 'windsock'
  | 'barrels'
  | 'pallets'
  | 'crates'
  | 'propane'
  | 'bikeRack'

export interface Feature {
  kind: FeatureKind
  x: number
  z: number
  /** Yaw (multiples of PI/2 for anything with a box collider). */
  yaw?: number
  /** Kind-specific size parameters. */
  r?: number
  h?: number
  len?: number
  color?: string
  /** Cluster/grid counts. */
  nx?: number
  nz?: number
  /** Stack layers. */
  layers?: number
  /** Optional painted label (trucks/containers). */
  label?: string
  /** Visual-only (no collider), may be skipped on low quality. */
  detail?: boolean
  /** Emissive variant (glowing R&D waste barrels...). */
  glow?: boolean
  seed?: number
}

const PI = Math.PI
const HALF = PI / 2

export const FEATURES: Feature[] = [
  // --- tank farm between Control Room and Server Hall ---
  { kind: 'tankV', x: -42.4, z: 2.0, r: 1.6, h: 7.2, color: '#C9CBC4' },
  { kind: 'tankV', x: -37.6, z: 2.0, r: 1.6, h: 7.2, color: '#B7BDB8' },
  { kind: 'tankV', x: -33.2, z: 2.6, r: 1.1, h: 4.6, color: '#A95E39' },
  // --- silos between Server Hall and R&D ---
  { kind: 'silo', x: -43.0, z: -21.0, r: 1.7, h: 10.5, color: '#B8BCB6' },
  { kind: 'silo', x: -38.2, z: -21.0, r: 1.7, h: 10.5, color: '#C3C6BF' },
  { kind: 'silo', x: -33.4, z: -21.0, r: 1.7, h: 10.5, color: '#B1B6B0' },
  { kind: 'acUnit', x: -43.4, z: -17.0 },
  { kind: 'acUnit', x: -40.6, z: -17.0 },
  { kind: 'acUnit', x: -37.8, z: -17.0 },
  // --- propellant farm (north-east) ---
  { kind: 'sphereTank', x: 39.0, z: -41.0, r: 3.0, color: '#E7E4DA' },
  { kind: 'sphereTank', x: 45.6, z: -41.0, r: 3.0, color: '#DEDAD0' },
  { kind: 'bulletTank', x: 41.5, z: -31.0, r: 1.4, len: 8.4, color: '#D9D4C5' },
  // --- water tower (east) ---
  { kind: 'waterTower', x: 45.0, z: 0.5 },
  // --- shipping containers between Broadcast Booth and Break Room ---
  { kind: 'container', x: 36.25, z: 19.82, yaw: 0, layers: 2, color: '#A95E39', label: 'MIW' },
  { kind: 'container', x: 43.63, z: 22.02, yaw: 0, layers: 1, color: '#4F86A8', label: 'MIW' },
  // --- parking lot ---
  { kind: 'trailer', x: 19.3, z: 32.7, yaw: PI, label: 'McKEOWN FREIGHT' },
  { kind: 'boxTruck', x: 25.65, z: 36.0, yaw: PI, color: '#E9B63F', label: 'PARTS & MORE PARTS' },
  { kind: 'van', x: 28.65, z: 35.7, yaw: PI, color: '#D9D4C5' },
  // --- warehouse apron / behind maintenance ---
  { kind: 'boxTruck', x: -20.05, z: 35.0, yaw: PI, color: '#D9483B', label: 'McKEOWN LOGISTICS' },
  { kind: 'dumpster', x: -25.0, z: 38.4, yaw: 0, color: '#3E6B4F' },
  { kind: 'pallets', x: -25.1, z: 33.6, yaw: HALF, layers: 5 },
  { kind: 'gasCage', x: -28.8, z: 38.4, yaw: 0 },
  { kind: 'dumpster', x: -15.0, z: 38.9, yaw: 0, color: '#4F86A8' },
  { kind: 'tirePile', x: -11.6, z: 37.6 },
  { kind: 'barrels', x: -8.6, z: 37.45, nx: 2, nz: 2, color: '#4F86A8', seed: 3 },
  { kind: 'scrapBin', x: -17.0, z: 36.4, yaw: 0 },
  // --- south of Personnel ---
  { kind: 'acUnit', x: 9.2, z: 35.7 },
  { kind: 'acUnit', x: 11.7, z: 35.7 },
  { kind: 'picnic', x: 14.9, z: 37.5, yaw: 0 },
  { kind: 'bikeRack', x: 8.6, z: 38.7, yaw: 0, detail: true },
  // --- break room outdoor area & east strip ---
  { kind: 'picnic', x: 33.4, z: 38.3, yaw: 0 },
  { kind: 'picnic', x: 37.6, z: 38.3, yaw: 0 },
  { kind: 'generator', x: 47.0, z: 28.0, yaw: HALF },
  { kind: 'propane', x: 47.2, z: 33.5, yaw: HALF },
  // --- warehouse south ---
  { kind: 'pallets', x: -44.0, z: 38.3, yaw: 0, layers: 3 },
  { kind: 'pallets', x: -41.7, z: 38.3, yaw: 0, layers: 6 },
  { kind: 'crates', x: -38.4, z: 38.4, yaw: 0, nx: 2, nz: 1, layers: 2, seed: 11 },
  { kind: 'spool', x: -34.6, z: 38.4 },
  // --- west strip (between buildings and west avenue) ---
  { kind: 'barrels', x: -28.4, z: -0.6, nx: 2, nz: 3, color: '#A95E39', seed: 5 },
  { kind: 'cabinet', x: -28.9, z: 3.9, yaw: HALF },
  { kind: 'pallets', x: -28.6, z: 18.6, yaw: 0, layers: 3 },
  // --- east strip ---
  { kind: 'barrels', x: 28.6, z: -1.6, nx: 2, nz: 2, color: '#D9483B', seed: 9 },
  { kind: 'cabinet', x: 28.9, z: 4.2, yaw: -HALF },
  { kind: 'pallets', x: 28.6, z: 18.4, yaw: 0, layers: 2 },
  { kind: 'acUnit', x: 44.6, z: 8.6 },
  { kind: 'generator', x: 46.9, z: 12.2, yaw: 0 },
  // --- north-west ---
  { kind: 'barrels', x: -33.4, z: -43.6, nx: 2, nz: 2, color: '#5DBB63', glow: true, seed: 13 },
  { kind: 'scrapBin', x: -40.0, z: -44.2, yaw: 0 },
  // --- plaza west strip ---
  { kind: 'pipeStack', x: -17.3, z: -12.1, yaw: 0 },
  // --- launch yard ---
  { kind: 'bunker', x: -12.75, z: -43.5, yaw: 0 },
  { kind: 'wreckage', x: -3.5, z: -43.0, yaw: 0 },
  { kind: 'floodMast', x: -8.5, z: -31.0 },
  { kind: 'floodMast', x: 6.5, z: -45.5 },
  { kind: 'floodMast', x: 29.5, z: -45.0 },
  { kind: 'floodMast', x: 31.0, z: -30.5 },
  { kind: 'windsock', x: -12.0, z: -35.0 },
]

/** Footprint (w along local x, d along local z) and height per feature kind. */
export function featureFootprint(f: Feature): { w: number; d: number; h: number; round?: number } | null {
  switch (f.kind) {
    case 'tankV':
      return { w: 0, d: 0, h: f.h ?? 6, round: (f.r ?? 1.5) + 0.12 }
    case 'silo':
      return { w: 0, d: 0, h: f.h ?? 10, round: (f.r ?? 1.7) + 0.12 }
    case 'sphereTank':
      return { w: 0, d: 0, h: (f.r ?? 3) * 2 + 1.6, round: (f.r ?? 3) + 0.15 }
    case 'bulletTank':
      return { w: f.len ?? 8, d: (f.r ?? 1.4) * 2 + 0.2, h: (f.r ?? 1.4) * 2 + 0.8 }
    case 'waterTower':
      return null // legs handled separately
    case 'container':
      return { w: 6.06, d: 2.44, h: 2.59 * (f.layers ?? 1) }
    case 'trailer':
      return { w: 2.6, d: 12.2, h: 4.0 }
    case 'boxTruck':
      return { w: 2.5, d: 7.2, h: 3.6 }
    case 'van':
      return { w: 2.1, d: 5.3, h: 2.5 }
    case 'dumpster':
      return { w: 1.9, d: 1.3, h: 1.5 }
    case 'acUnit':
      return { w: 1.3, d: 1.3, h: 1.15 }
    case 'generator':
      return { w: 2.2, d: 1.2, h: 1.7 }
    case 'cabinet':
      return { w: 1.4, d: 0.6, h: 2.0 }
    case 'gasCage':
      return { w: 2.0, d: 1.4, h: 2.1 }
    case 'pipeStack':
      return { w: 2.6, d: 5.0, h: 1.4 }
    case 'tirePile':
      return { w: 0, d: 0, h: 1.2, round: 0.85 }
    case 'scrapBin':
      return { w: 1.8, d: 1.3, h: 1.4 }
    case 'picnic':
      return { w: 1.9, d: 1.7, h: 0.9 }
    case 'spool':
      return { w: 0, d: 0, h: 1.6, round: 0.85 }
    case 'bunker':
      return { w: 6.5, d: 6.0, h: 3.4 }
    case 'wreckage':
      return { w: 4.0, d: 3.0, h: 1.8 }
    case 'floodMast':
      return { w: 0, d: 0, h: 14, round: 0.38 }
    case 'windsock':
      return { w: 0, d: 0, h: 6, round: 0.14 }
    case 'barrels':
      return { w: (f.nx ?? 2) * 0.66 + 0.06, d: (f.nz ?? 2) * 0.66 + 0.06, h: 0.9 }
    case 'pallets':
      return { w: 1.25, d: 1.05, h: 0.16 * (f.layers ?? 3) }
    case 'crates':
      return { w: (f.nx ?? 1) * 1.05, d: (f.nz ?? 1) * 1.05, h: 1.0 * (f.layers ?? 1) }
    case 'propane':
      return { w: 2.6, d: 1.3, h: 1.4 }
    case 'bikeRack':
      return null
  }
}

/** Water tower leg positions (relative to the feature). */
export const WATER_TOWER_LEGS: Vec2[] = [
  [-1.8, -1.8],
  [1.8, -1.8],
  [-1.8, 1.8],
  [1.8, 1.8],
]

// ---------------------------------------------------------------------------
// Instanced props
// ---------------------------------------------------------------------------

export type PropKind = 'bollard' | 'hydrant' | 'plant' | 'pole' | 'cone'

export interface Prop {
  kind: PropKind
  x: number
  z: number
  yaw?: number
  /** Visual-only (no collider). */
  noCollide?: boolean
}

export const PROP_RADIUS: Record<PropKind, number> = { bollard: 0.14, hydrant: 0.22, plant: 0.45, pole: 0.16, cone: 0.2 }
export const PROP_HEIGHT: Record<PropKind, number> = { bollard: 1.05, hydrant: 0.9, plant: 1.6, pole: 7.5, cone: 0.7 }

export const PROPS: Prop[] = [
  // light poles (lamp head faces along yaw)
  { kind: 'pole', x: -26.8, z: 8.8, yaw: -HALF },
  { kind: 'pole', x: -26.8, z: -2.4, yaw: -HALF },
  { kind: 'pole', x: -26.8, z: -20.0, yaw: -HALF },
  { kind: 'pole', x: -26.8, z: -38.0, yaw: -HALF },
  { kind: 'pole', x: 26.8, z: 1.0, yaw: HALF },
  { kind: 'pole', x: 26.8, z: -6.0, yaw: HALF },
  { kind: 'pole', x: -14.0, z: -22.8, yaw: PI },
  { kind: 'pole', x: 6.2, z: -22.8, yaw: PI },
  { kind: 'pole', x: 29.5, z: -22.8, yaw: PI },
  { kind: 'pole', x: -13.6, z: -2.6, yaw: 0 },
  { kind: 'pole', x: 13.6, z: -2.6, yaw: 0 },
  { kind: 'pole', x: 29.3, z: 26.8, yaw: HALF },
  { kind: 'pole', x: 21.3, z: 31.6, yaw: HALF },
  { kind: 'pole', x: -36.2, z: 39.4, yaw: 0 },
  { kind: 'pole', x: 31.0, z: 17.8, yaw: 0 },
  { kind: 'pole', x: -45.0, z: -24.5, yaw: PI },
  // fire hydrants
  { kind: 'hydrant', x: -26.6, z: 7.6 },
  { kind: 'hydrant', x: -26.6, z: -15.2 },
  { kind: 'hydrant', x: 26.6, z: 6.6 },
  { kind: 'hydrant', x: 26.6, z: -6.9 },
  { kind: 'hydrant', x: -19.7, z: 24.6 },
  { kind: 'hydrant', x: 30.6, z: -26.0 },
  // corporate potted plants at the intake
  { kind: 'plant', x: -6.2, z: 38.6 },
  { kind: 'plant', x: 6.2, z: 38.6 },
  { kind: 'plant', x: -6.45, z: 37.0 },
  { kind: 'plant', x: 6.45, z: 37.0 },
  // decorative cones (no colliders: the forklift may "drive through" a painted cone)
  { kind: 'cone', x: -19.15, z: -6.2, noCollide: true },
  { kind: 'cone', x: -15.85, z: -6.2, noCollide: true },
  { kind: 'cone', x: -19.15, z: -2.8, noCollide: true },
  { kind: 'cone', x: -15.85, z: -2.8, noCollide: true },
  { kind: 'cone', x: -9.2, z: 25.0, noCollide: true },
  { kind: 'cone', x: 22.3, z: 25.0, noCollide: true },
  { kind: 'cone', x: 21.7, z: 25.4, noCollide: true },
  { kind: 'cone', x: -44.8, z: 34.0, noCollide: true },
  { kind: 'cone', x: -44.8, z: 26.0, noCollide: true },
]

/** Bollards flanking each door opening (skipped where a gantry leg already protects the corner). */
export const DOOR_BOLLARDS: Vec2[] = [
  [-29.55, 10.65],
  [-29.55, 15.35],
  [-29.55, -11.35],
  [-29.55, -6.65],
  [-29.55, -35.35],
  [-29.55, -30.65],
  [-29.55, 24.65],
  [-29.55, 35.35],
  [29.55, 8.65],
  [29.55, 13.35],
  [29.55, 27.65],
  [29.55, 32.35],
  [6.55, 32.85],
  [-6.55, 33.35],
]

// ---------------------------------------------------------------------------
// Structures (arch, gantry, racks, hall frame, observation deck)
// ---------------------------------------------------------------------------

/** Recreation Yard gateway (two posts + crossbar sign over the gate, facing west). */
export const REC_GATE = { x: 30.6, z0: -16.6, z1: -11.4, height: 3.6 }

export const ARCH = { z: 38.5, pillarX: 4.9, pillar: 0.8, height: 6.9, beamY0: 5.3 }
export const GANTRY = { z: 24.5, legX: 6.3, leg: 0.5, height: 7.0, beamY0: 4.9 }
export const INCIDENT_BOARD = { x0: -6.05, x1: -3.9, z: 24.45, y0: 2.15, y1: 3.65, postX: -4.05 }

/** Production hall portal columns (x = ±19.3) shared with the avenue pipe racks. */
export const HALL = { x: 19.3, columnZ: [18.4, 12.0, 5.6, -0.8], trussY0: 9.6, trussY1: 11.0, column: 0.45 }

/** Extra west pipe-rack T-columns north of the hall. */
export const WEST_RACK_EXTRA_Z = [-10.0, -15.4, -25.0, -31.5, -38.0, -44.5]
export const RACK = { armY: 5.0, armLen: 6.1, pipeY: 5.3 }

export const OBS_DECK = {
  rect: { minX: -1, maxX: 5, minZ: -29.5, maxZ: -25.0 } as Rect,
  height: 1.2,
  ramp: { minX: -2.7, maxX: -1.0, z0: -23.2, z1: -28.2 },
  landing: { minX: -2.7, maxX: -1.0, minZ: -29.5, maxZ: -28.2 },
}

// ---------------------------------------------------------------------------
// Interior furniture (inside building interiors; keeps anchors & lanes clear)
// ---------------------------------------------------------------------------

export type FurnitureKind =
  | 'filing'
  | 'desk'
  | 'chairs'
  | 'cooler'
  | 'workbench'
  | 'toolchest'
  | 'compressor'
  | 'liftPost'
  | 'shelf'
  | 'drums'
  | 'tires'
  | 'rack'
  | 'vending'
  | 'counter'
  | 'fridge'
  | 'table'
  | 'sofa'
  | 'cabinetTall'
  | 'cylinders'
  | 'labBench'
  | 'fumeHood'
  | 'records'
  | 'plantPot'
  | 'glassWall'

export interface Furniture {
  kind: FurnitureKind
  rect: Rect
  h: number
  /** Facing (front) yaw for directional items. */
  yaw?: number
  color?: string
  /** Variant index (vending machine brand, etc.). */
  v?: number
}

const R = (minX: number, maxX: number, minZ: number, maxZ: number): Rect => ({ minX, maxX, minZ, maxZ })

export const FURNITURE: Furniture[] = [
  // Personnel Office
  { kind: 'filing', rect: R(8.2, 10.8, 24.55, 25.2), h: 1.35, yaw: PI },
  { kind: 'desk', rect: R(12.8, 14.9, 24.6, 25.45), h: 0.8, yaw: PI },
  { kind: 'plantPot', rect: rectAt(16.0, 25.05, 0.8, 0.8), h: 1.5 },
  { kind: 'chairs', rect: R(8.6, 11.9, 32.9, 33.45), h: 0.85, yaw: 0 },
  { kind: 'cooler', rect: rectAt(15.95, 33.0, 0.5, 0.5), h: 1.25 },
  // Maintenance Bay
  { kind: 'workbench', rect: R(-16.8, -13.8, 24.55, 25.35), h: 0.95, yaw: PI },
  { kind: 'toolchest', rect: R(-13.4, -12.4, 24.6, 25.25), h: 1.1, yaw: PI },
  { kind: 'compressor', rect: rectAt(-11.4, 25.0, 0.8, 0.8), h: 1.6 },
  { kind: 'liftPost', rect: rectAt(-16.9, 26.6, 0.42, 0.42), h: 3.7 },
  { kind: 'liftPost', rect: rectAt(-16.9, 31.4, 0.42, 0.42), h: 3.7 },
  { kind: 'shelf', rect: R(-16.8, -13.8, 32.9, 33.45), h: 2.0, yaw: 0 },
  { kind: 'drums', rect: R(-12.9, -11.5, 32.75, 33.45), h: 0.9 },
  { kind: 'tires', rect: rectAt(-10.4, 33.0, 0.9, 0.9), h: 1.0 },
  // Warehouse racks (center left clear for forklift practice)
  { kind: 'rack', rect: R(-44.2, -33.2, 24.55, 25.75), h: 5.0, yaw: PI },
  { kind: 'rack', rect: R(-44.2, -33.2, 34.25, 35.45), h: 5.0, yaw: 0 },
  { kind: 'rack', rect: R(-45.45, -44.25, 26.6, 33.4), h: 5.0, yaw: -HALF },
  // Break room
  { kind: 'vending', rect: R(31.9, 32.95, 24.55, 25.4), h: 1.95, yaw: PI, v: 0 },
  { kind: 'vending', rect: R(33.1, 34.15, 24.55, 25.4), h: 1.95, yaw: PI, v: 1 },
  { kind: 'vending', rect: R(34.3, 35.35, 24.55, 25.4), h: 1.95, yaw: PI, v: 2 },
  { kind: 'counter', rect: R(36.2, 39.6, 24.55, 25.2), h: 0.95, yaw: PI },
  { kind: 'fridge', rect: R(39.8, 40.65, 24.55, 25.35), h: 1.85, yaw: PI },
  { kind: 'table', rect: rectAt(34.2, 27.1, 2.1, 2.1), h: 0.76 },
  { kind: 'table', rect: rectAt(37.2, 27.1, 2.1, 2.1), h: 0.76 },
  { kind: 'sofa', rect: R(31.2, 34.0, 34.6, 35.45), h: 0.85, yaw: 0 },
  { kind: 'plantPot', rect: rectAt(38.35, 35.0, 0.7, 0.7), h: 1.6 },
  { kind: 'glassWall', rect: R(38.95, 39.05, 30.5, 35.5), h: 3.85 },
  { kind: 'glassWall', rect: R(39.05, 43.5, 30.45, 30.55), h: 3.85 },
  // Control Room (perimeter only)
  { kind: 'cabinetTall', rect: R(-45.45, -44.85, 7.0, 9.6), h: 2.2, yaw: -HALF },
  { kind: 'cabinetTall', rect: R(-45.45, -44.85, 16.4, 19.0), h: 2.2, yaw: -HALF },
  // Server Hall (perimeter only)
  { kind: 'cylinders', rect: R(-31.5, -30.6, -15.4, -14.6), h: 1.5 },
  // R&D Annex
  { kind: 'labBench', rect: R(-37.4, -33.0, -39.45, -38.75), h: 0.95, yaw: 0 },
  { kind: 'fumeHood', rect: R(-32.6, -31.0, -39.45, -38.7), h: 2.3, yaw: 0 },
  { kind: 'labBench', rect: R(-37.0, -33.0, -27.25, -26.55), h: 0.95, yaw: PI },
  { kind: 'cylinders', rect: R(-31.3, -30.6, -39.3, -38.4), h: 1.5 },
  // Broadcast Booth
  { kind: 'sofa', rect: R(37.5, 40.2, 14.6, 15.45), h: 0.85, yaw: 0 },
  { kind: 'records', rect: R(37.0, 40.5, 6.55, 7.1), h: 1.6, yaw: PI },
]

/** The locked executive office inside the break room (SE corner). */
export const EXEC_OFFICE = {
  rect: R(39.05, 43.5, 30.55, 35.5),
  door: { z0: 32.35, z1: 33.65, x: 39.0 },
  glassHeight: 3.1,
  /** Top of the modular office pod (fascia band above the glass, flat ceiling). */
  podHeight: 3.75,
}

// ---------------------------------------------------------------------------
// Restricted-zone chain barriers (one deliberate gap each)
// ---------------------------------------------------------------------------

export interface ChainSpan {
  zone: string
  a: Vec2
  b: Vec2
}

export interface BarrierDef {
  zone: string
  posts: Vec2[]
  spans: ChainSpan[]
  /** Center of the deliberate opening. */
  gap: Vec2
  gapWidth: number
}

function rectBarrier(zone: string, r: Rect, inset: number, gapSide: 'W' | 'E', gapWidth: number, spacing = 1.6): BarrierDef {
  const x0 = r.minX - inset
  const x1 = r.maxX + inset
  const z0 = r.minZ - inset
  const z1 = r.maxZ + inset
  const zc = (z0 + z1) / 2
  const gx = gapSide === 'W' ? x0 : x1
  const g0 = zc - gapWidth / 2
  const g1 = zc + gapWidth / 2
  // Polyline around the rect starting at one gap edge, ending at the other.
  const corners: Vec2[] =
    gapSide === 'W'
      ? [
          [gx, g0],
          [x0, z0],
          [x1, z0],
          [x1, z1],
          [x0, z1],
          [gx, g1],
        ]
      : [
          [gx, g1],
          [x1, z1],
          [x0, z1],
          [x0, z0],
          [x1, z0],
          [gx, g0],
        ]
  const posts: Vec2[] = []
  const spans: ChainSpan[] = []
  for (let i = 0; i < corners.length - 1; i++) {
    const [ax, az] = corners[i]
    const [bx, bz] = corners[i + 1]
    const len = Math.hypot(bx - ax, bz - az)
    const n = Math.max(1, Math.round(len / spacing))
    for (let k = 0; k < n; k++) {
      const t0 = k / n
      const t1 = (k + 1) / n
      const a: Vec2 = [ax + (bx - ax) * t0, az + (bz - az) * t0]
      const b: Vec2 = [ax + (bx - ax) * t1, az + (bz - az) * t1]
      posts.push(a)
      spans.push({ zone, a, b })
    }
  }
  posts.push(corners[corners.length - 1])
  return { zone, posts, spans, gap: [gx, zc], gapWidth }
}

function circleBarrier(zone: string, center: Vec2, radius: number, gapHalfWidth: number): BarrierDef {
  // Gap faces south (+z), where the rocket transporter track enters.
  const theta = Math.asin(Math.min(0.95, gapHalfWidth / radius))
  const start = theta
  const end = 2 * PI - theta
  const arc = (end - start) * radius
  const n = Math.max(6, Math.round(arc / 2.5))
  const posts: Vec2[] = []
  for (let k = 0; k <= n; k++) {
    const a = start + ((end - start) * k) / n
    // angle measured from +z toward +x
    posts.push([center[0] + Math.sin(a) * radius, center[1] + Math.cos(a) * radius])
  }
  const spans: ChainSpan[] = []
  for (let k = 0; k < posts.length - 1; k++) spans.push({ zone, a: posts[k], b: posts[k + 1] })
  return { zone, posts, spans, gap: [center[0], center[1] + radius], gapWidth: gapHalfWidth * 2 }
}

export const BARRIER_RADIUS_BLAST = 9.0

export const BARRIERS: BarrierDef[] = RESTRICTED_ZONES.map((rz) => {
  if (rz.shape.kind === 'circle') return circleBarrier(rz.id, rz.shape.center, Math.max(rz.shape.radius + 1.5, BARRIER_RADIUS_BLAST), 4.0)
  const r = rz.shape.rect
  // Openings face the tower plaza (transformer: west side, wet paint: east side).
  const cx = (r.minX + r.maxX) / 2
  return rectBarrier(rz.id, r, 0.35, cx > 0 ? 'W' : 'E', 1.6)
})

/** Sign boards for restricted zones: position + facing yaw. */
export interface RestrictedSign {
  zone: string
  x: number
  z: number
  yaw: number
}

export const RESTRICTED_SIGNS: RestrictedSign[] = [
  { zone: 'transformer-yard', x: 14.55, z: -6.0, yaw: PI / 2 },
  { zone: 'wet-paint', x: -14.55, z: -6.0, yaw: -PI / 2 },
  { zone: 'blast-zone', x: 10.6, z: -25.4, yaw: PI - 0.55 },
  { zone: 'blast-zone', x: 21.4, z: -25.4, yaw: PI + 0.55 },
  { zone: 'blast-zone', x: 6.4, z: -36.0, yaw: PI / 2 },
  { zone: 'blast-zone', x: 25.6, z: -38.0, yaw: -PI / 2 },
]

export const TRANSFORMER = { x: 17.6, z: -4.6, w: 2.0, d: 1.6, h: 2.3, pole: [19.25, -6.15] as Vec2 }

// ---------------------------------------------------------------------------
// Deterministic sub-placement helpers (barrel clusters etc.)
// ---------------------------------------------------------------------------

/** Individual barrel positions in a cluster (slight jitter, deterministic). */
export function barrelPositions(f: Feature): { x: number; z: number; yaw: number; tilt: number }[] {
  const rng = createRng(f.seed ?? 1)
  const nx = f.nx ?? 2
  const nz = f.nz ?? 2
  const out: { x: number; z: number; yaw: number; tilt: number }[] = []
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      out.push({
        x: f.x + (i - (nx - 1) / 2) * 0.66 + (rng() - 0.5) * 0.05,
        z: f.z + (j - (nz - 1) / 2) * 0.66 + (rng() - 0.5) * 0.05,
        yaw: rng() * PI * 2,
        tilt: rng() < 0.15 ? 0.04 : 0,
      })
    }
  return out
}
