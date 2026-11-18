import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { PALETTE } from '@/world/palette'
import { textures } from '@/world/materials'
import { DECAL_UV, forkliftDecalTexture } from '../lib/canvasTextures'
import { GeoBuilder, atlasQuad, lin, type V3 } from '../lib/GeoBuilder'
import { FORKLIFT } from '../constants'

/**
 * Procedural forklift (local frame: origin on the ground under the middle of
 * the wheelbase, forward = -Z). Built once and cached for the app lifetime.
 *
 * Draw calls: body (painted, worn) · metal (mast, cylinders, pipes) ·
 * carriage + forks (moves) · steering wheel (turns) · wheels (1 instanced
 * mesh) · lamps (unlit) · beacon lens (flashes) · decals (stencils, dents).
 */

// ---- colors (linear) ---------------------------------------------------------
const YELLOW = lin('#E8B12F')
const YELLOW_SHADE = lin('#C99322')
const BLACK = lin('#1F2324')
const FRAME = lin('#2B3132')
const RUBBER = lin('#191B1C')
const SEAT = lin('#2C2F31')
const SEAT_SEAM = lin('#3C4144')
const STEEL = lin(PALETTE.steel)
const STEEL_DARK = lin(PALETTE.gunmetal)
const CHROME = lin('#D5DCDD')
const FORK = lin('#30373A')
const RED = lin(PALETTE.signalRed)
const CREAM = lin(PALETTE.cream)
const HAZ_BLACK = lin('#1A1E1F')

const F = FORKLIFT
const ROUND_CACHE = new Map<string, THREE.BufferGeometry>()
function rounded(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const key = `${w}:${h}:${d}:${r}`
  let g = ROUND_CACHE.get(key)
  if (!g) {
    g = new RoundedBoxGeometry(w, h, d, 2, r)
    ROUND_CACHE.set(key, g)
  }
  return g
}

/** Rounded box by min/max corners. */
function rbox(b: GeoBuilder, min: V3, max: V3, color: THREE.Color, r = 0.035, rot: V3 = [0, 0, 0]) {
  const w = max[0] - min[0]
  const h = max[1] - min[1]
  const d = max[2] - min[2]
  b.add(rounded(w, h, d, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)), color, [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2], rot)
}

// ---- body ----------------------------------------------------------------------
function buildBody(): THREE.BufferGeometry {
  const b = new GeoBuilder()
  const deck = F.deckTop
  // lower frame between the wheels (dark)
  b.boxMinMax([-0.42, 0.17, -0.98], [0.42, 0.57, 1.02], FRAME)
  // operator deck / front fenders (sit over the front tyres)
  rbox(b, [-0.645, deck - 0.11, -0.99], [0.645, deck, 0.04], YELLOW, 0.03)
  b.boxMinMax([-0.46, deck, -0.84], [0.46, deck + 0.014, -0.06], RUBBER) // anti-slip mat
  // fender lips (slightly darker edge under the deck)
  b.boxMinMax([-0.655, deck - 0.13, -0.97], [-0.4, deck - 0.1, -0.27], YELLOW_SHADE, [0, 0, 0.04]) // left lip, bent (dent!)
  b.boxMinMax([0.4, deck - 0.13, -0.97], [0.655, deck - 0.1, -0.27], YELLOW_SHADE)
  // dashboard cowl in front of the driver (under the mast)
  rbox(b, [-0.43, deck, -0.99], [0.43, 1.03, -0.72], YELLOW, 0.04)
  b.boxMinMax([-0.37, 1.03, -0.95], [0.37, 1.055, -0.74], BLACK)
  // gauges facing the driver
  for (const x of [-0.17, 0.02]) {
    b.cyl([x, 0.97, -0.716], 0.05, 0.016, BLACK, 14, [Math.PI / 2, 0, 0])
    b.cyl([x, 0.97, -0.71], 0.038, 0.006, CREAM, 14, [Math.PI / 2, 0, 0])
  }
  b.box([0.2, 0.93, -0.712], [0.08, 0.05, 0.01], RED) // the warning light nobody reads
  // hydraulic control levers (right of the column)
  for (let i = 0; i < 3; i++) {
    const x = 0.18 + i * 0.065
    b.tube([x, 1.05, -0.8], [x, 1.27, -0.76], 0.011, BLACK, 6)
    b.sphere([x, 1.285, -0.758], 0.028, i === 0 ? RED : BLACK, 8, 6)
  }
  // engine cover / seat pedestal (flush with the counterweight sides)
  rbox(b, [-0.62, deck - 0.02, 0.02], [0.62, 0.98, 0.72], YELLOW, 0.04)
  b.boxMinMax([-0.5, 0.98, 0.06], [0.5, 0.99, 0.7], YELLOW_SHADE) // hood seam
  // counterweight: block + rounded rear bulge
  rbox(b, [-0.62, 0.3, 0.66], [0.62, 1.08, 1.19], YELLOW, 0.05)
  {
    const half = new THREE.CylinderGeometry(1, 1, 1, 18, 1, false, -Math.PI / 2, Math.PI)
    // axis Y → X (rotate about Z); half disc faces +Z; scale: x→radius(height), y→width, z→bulge depth
    b.add(half, YELLOW, [0, 0.69, 1.185], [0, 0, Math.PI / 2], [0.39, 1.235, 0.39 * 0.55])
    half.dispose()
  }
  // rear bumper + tow pin
  rbox(b, [-0.61, 0.21, 1.17], [0.61, 0.42, 1.42], BLACK, 0.03)
  b.cyl([0, 0.47, 1.33], 0.035, 0.12, CHROME, 8)
  // side step + grab handle (driver side)
  b.boxMinMax([-0.69, 0.3, -0.28], [-0.43, 0.335, 0.02], BLACK)
  b.tube([-0.66, 0.98, -0.7], [-0.66, 1.62, -0.68], 0.022, BLACK, 8)
  b.tube([-0.66, 0.98, -0.7], [-0.6, 0.98, -0.72], 0.018, BLACK, 6)
  b.tube([-0.66, 1.62, -0.68], [-0.6, 1.62, -0.7], 0.018, BLACK, 6)
  // seat
  rbox(b, [-0.27, 0.98, F.seatZ - 0.24], [0.27, F.seatTop, F.seatZ + 0.22], SEAT, 0.04)
  b.boxMinMax([-0.2, F.seatTop - 0.005, F.seatZ - 0.2], [0.2, F.seatTop + 0.004, F.seatZ + 0.18], SEAT_SEAM)
  b.add(rounded(0.52, 0.52, 0.1, 0.04), SEAT, [0, F.seatTop + 0.3, F.seatZ + 0.27], [0.2, 0, 0])
  b.add(rounded(0.1, 0.18, 0.16, 0.03), SEAT, [-0.29, F.seatTop + 0.1, F.seatZ + 0.02]) // armrest bolsters
  b.add(rounded(0.1, 0.18, 0.16, 0.03), SEAT, [0.29, F.seatTop + 0.1, F.seatZ + 0.02])
  // overhead guard (black): posts, roof frame and slats
  const gy = F.guardY
  const px = 0.57
  for (const s of [-1, 1]) {
    b.bar([s * px, deck - 0.02, -0.8], [s * px, gy, -0.76], 0.075, BLACK)
    b.bar([s * px, 1.06, 0.96], [s * px, gy, 0.86], 0.075, BLACK)
    b.bar([s * px, gy, -0.8], [s * px, gy, 0.92], 0.075, BLACK)
  }
  b.bar([-px, gy, -0.8], [px, gy, -0.8], 0.075, BLACK)
  b.bar([-px, gy, 0.92], [px, gy, 0.92], 0.075, BLACK)
  for (let i = 0; i < 6; i++) {
    const z = -0.62 + i * 0.25
    b.boxMinMax([-px, gy - 0.012, z - 0.03], [px, gy + 0.03, z + 0.03], BLACK)
  }
  // hazard paint on the guard's front beam
  for (let i = 0; i < 8; i++) {
    const x0 = -px + (i * 2 * px) / 8
    b.boxMinMax([x0, gy - 0.04, -0.845], [x0 + (2 * px) / 8, gy + 0.04, -0.835], i % 2 ? HAZ_BLACK : YELLOW)
  }
  // work-light housings on the front posts + tail-light housings
  for (const s of [-1, 1]) {
    b.add(rounded(0.13, 0.11, 0.1, 0.02), BLACK, [s * (px + 0.02), 1.98, -0.88])
    b.boxMinMax([s * 0.52 - 0.07, 1.075, 1.07], [s * 0.52 + 0.07, 1.16, 1.17], BLACK)
  }
  // beacon base + mirror
  b.cyl([0.36, gy + 0.05, 0.78], 0.075, 0.05, BLACK, 12)
  b.tube([-px - 0.02, 1.95, -0.78], [-px - 0.16, 2.06, -0.82], 0.012, BLACK, 6)
  b.cyl([-px - 0.19, 2.08, -0.83], 0.075, 0.02, BLACK, 14, [Math.PI / 2, 0.4, 0])
  b.cyl([-px - 0.19, 2.08, -0.842], 0.06, 0.005, lin('#9FB6BB'), 14, [Math.PI / 2, 0.4, 0])
  return b.build()
}

// ---- metal: mast, cylinders, exhaust ---------------------------------------------
function buildMetal(): THREE.BufferGeometry {
  const b = new GeoBuilder()
  const mz = -1.04
  for (const s of [-1, 1]) {
    // outer channel (C-profile suggested by a darker web)
    b.boxMinMax([s * 0.4 - 0.045, 0.1, mz - 0.065], [s * 0.4 + 0.045, 2.38, mz + 0.065], STEEL)
    b.boxMinMax([s * 0.4 - 0.03, 0.1, mz - 0.07], [s * 0.4 + 0.03, 2.38, mz - 0.06], STEEL_DARK)
    // inner (telescoping) channel
    b.boxMinMax([s * 0.31 - 0.035, 0.12, mz - 0.11], [s * 0.31 + 0.035, 2.3, mz - 0.05], STEEL_DARK)
    // tilt cylinder: barrel + chrome rod
    b.tube([s * 0.47, 0.86, -0.6], [s * 0.45, 1.02, -0.84], 0.045, STEEL_DARK, 10)
    b.tube([s * 0.45, 1.02, -0.84], [s * 0.42, 1.12, -0.99], 0.022, CHROME, 8)
    // lift chains
    b.boxMinMax([s * 0.18 - 0.018, 0.62, mz - 0.1], [s * 0.18 + 0.018, 2.26, mz - 0.07], lin('#3A3F40'))
    b.cyl([s * 0.18, 2.27, mz - 0.085], 0.05, 0.04, STEEL_DARK, 12, [0, 0, Math.PI / 2]) // chain sheave
  }
  // cross members
  b.boxMinMax([-0.45, 2.3, mz - 0.07], [0.45, 2.38, mz + 0.07], STEEL)
  b.boxMinMax([-0.45, 1.26, mz - 0.05], [0.45, 1.33, mz + 0.06], STEEL)
  b.boxMinMax([-0.45, 0.1, mz - 0.07], [0.45, 0.2, mz + 0.07], STEEL_DARK)
  // hazard stripes on the top crossbar
  for (let i = 0; i < 6; i++) {
    const x0 = -0.45 + i * 0.15
    b.boxMinMax([x0, 2.305, mz - 0.075], [x0 + 0.15, 2.375, mz - 0.07], i % 2 ? HAZ_BLACK : YELLOW)
  }
  // main lift cylinder
  b.cyl([0, 0.7, mz + 0.02], 0.06, 1.0, STEEL_DARK, 12)
  b.cyl([0, 1.62, mz + 0.02], 0.035, 0.84, CHROME, 10)
  // exhaust pipe with a flapper cap, up the rear-left post
  b.tube([-0.42, 1.06, 1.06], [-0.42, 1.92, 1.04], 0.036, lin('#34393B'), 10)
  b.cyl([-0.42, 1.96, 1.035], 0.045, 0.08, lin('#2A2E2F'), 10)
  b.cyl([-0.42, 2.01, 1.0], 0.05, 0.012, lin('#4B4F50'), 10, [0.55, 0, 0])
  // steering column
  b.tube([0, 1.0, -0.73], [0, 1.27, -0.52], 0.032, BLACK, 8)
  return b.build()
}

/** Where exhaust puffs leave the pipe (local). */
export const EXHAUST_TIP: V3 = [-0.42, 2.04, 1.0]

// ---- carriage + forks (moves vertically; local y = fork blade bottom) -------------
function buildCarriage(): THREE.BufferGeometry {
  const b = new GeoBuilder()
  // carriage bars
  b.boxMinMax([-0.53, 0.05, -1.2], [0.53, 0.16, -1.12], BLACK)
  b.boxMinMax([-0.53, 0.44, -1.2], [0.53, 0.55, -1.12], BLACK)
  // load backrest grid
  for (const x of [-0.48, -0.24, 0, 0.24, 0.48]) b.boxMinMax([x - 0.022, 0.55, -1.18], [x + 0.022, 1.2, -1.15], BLACK)
  b.boxMinMax([-0.51, 1.17, -1.19], [0.51, 1.22, -1.14], BLACK)
  b.boxMinMax([-0.51, 0.86, -1.18], [0.51, 0.89, -1.15], BLACK)
  // forks: shank + blade + tapered tip, slightly scuffed steel
  for (const x of [-0.28, 0.28]) {
    b.boxMinMax([x - 0.06, 0, -1.26], [x + 0.06, 0.6, -1.2], FORK)
    b.boxMinMax([x - 0.06, 0, -2.1], [x + 0.06, 0.05, -1.2], FORK)
    b.boxMinMax([x - 0.055, 0, -2.18], [x + 0.055, 0.03, -2.1], FORK)
    b.boxMinMax([x - 0.065, 0.42, -1.27], [x + 0.065, 0.57, -1.2], STEEL_DARK) // hook
  }
  // capacity plate on the carriage
  b.boxMinMax([-0.14, 0.22, -1.205], [0.14, 0.38, -1.195], YELLOW)
  return b.build()
}

// ---- steering wheel (local +Y = column axis, spins about Y) -------------------------
function buildSteeringWheel(): THREE.BufferGeometry {
  const b = new GeoBuilder()
  b.add(new THREE.TorusGeometry(0.16, 0.02, 8, 24), BLACK, [0, 0, 0], [Math.PI / 2, 0, 0])
  b.cyl([0, 0, 0], 0.045, 0.04, BLACK, 10)
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3 + Math.PI / 2
    b.bar([0, 0, 0], [Math.cos(a) * 0.155, 0, Math.sin(a) * 0.155], 0.022, BLACK)
  }
  // spinner knob (unmistakably a forklift wheel)
  b.cyl([0.16, 0.05, 0], 0.022, 0.08, RED, 8)
  return b.build()
}

/** Steering column top (local) and its axis direction. */
export const STEERING = { position: new THREE.Vector3(0, 1.285, -0.505), axis: new THREE.Vector3(0, 0.27, 0.21).normalize() }

// ---- wheel (unit: radius 1, width 1, axle along X, hub on +X) ----------------------
function buildWheel(): THREE.BufferGeometry {
  const b = new GeoBuilder()
  const toX: V3 = [0, 0, Math.PI / 2]
  // tyre: core + rounded shoulders
  b.cyl([0, 0, 0], 1, 0.78, RUBBER, 28, toX)
  b.cyl([0.43, 0, 0], 0.93, 0.08, RUBBER, 28, toX)
  b.cyl([-0.43, 0, 0], 0.93, 0.08, RUBBER, 28, toX)
  // tread blocks (make the spin readable)
  const lugs = 16
  for (let i = 0; i < lugs; i++) {
    const a = (i / lugs) * Math.PI * 2
    const off = i % 2 ? 0.17 : -0.17
    b.box([off, Math.cos(a) * 0.97, Math.sin(a) * 0.97], [0.36, 0.1, 0.17], RUBBER, [a, 0, 0])
  }
  // rims (both faces) + yellow hub cap + lug nuts
  b.cyl([0.47, 0, 0], 0.64, 0.06, lin('#41484A'), 22, toX)
  b.cyl([-0.47, 0, 0], 0.6, 0.06, lin('#383E40'), 22, toX)
  b.cyl([0.52, 0, 0], 0.34, 0.06, YELLOW, 18, toX)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    b.cyl([0.54, Math.cos(a) * 0.47, Math.sin(a) * 0.47], 0.07, 0.07, lin('#AEB6B7'), 6, toX)
  }
  b.cyl([0.56, 0, 0], 0.1, 0.05, lin('#2B3132'), 10, toX)
  return b.build()
}

// ---- lamps (unlit) ------------------------------------------------------------------
function buildLamps(): THREE.BufferGeometry {
  const b = new GeoBuilder()
  const px = 0.57
  for (const s of [-1, 1]) {
    b.cyl([s * (px + 0.02), 1.98, -0.932], 0.042, 0.012, lin('#FFF1CF', 2.4), 14, [Math.PI / 2, 0, 0])
    b.box([s * 0.52, 1.118, 1.172], [0.11, 0.05, 0.006], lin('#FF3B2F', 1.8))
  }
  return b.build()
}

// ---- beacon lens (unlit, color animated) ---------------------------------------------
function buildBeacon(): THREE.BufferGeometry {
  const b = new GeoBuilder()
  b.cyl([0, 0.06, 0], 0.062, 0.1, lin('#ffffff'), 14)
  b.sphere([0, 0.11, 0], 0.062, lin('#ffffff'), 14, 6, [1, 0.7, 1])
  return b.build()
}
export const BEACON_POS: V3 = [0.36, F.guardY + 0.07, 0.78]

// ---- decals (stencils, chevrons, dents) ------------------------------------------------
function buildDecals(): THREE.BufferGeometry {
  const b = new GeoBuilder()
  const white = lin('#ffffff')
  const prop = atlasQuad(0.96, 0.188, DECAL_UV.property)
  b.add(prop, white, [0.6265, 0.83, 0.5], [0, Math.PI / 2, 0])
  b.add(prop, white, [-0.6265, 0.83, 0.5], [0, -Math.PI / 2, 0])
  const chev = atlasQuad(1.17, 0.11, DECAL_UV.chevrons)
  b.add(chev, white, [0, 0.315, 1.4225])
  // dents: counterweight sides, dashboard front, counterweight top
  b.add(atlasQuad(0.3, 0.22, DECAL_UV.dent(0)), white, [0.6265, 0.5, 0.98], [0, Math.PI / 2, 0])
  b.add(atlasQuad(0.26, 0.2, DECAL_UV.dent(1)), white, [-0.6265, 0.56, 0.86], [0, -Math.PI / 2, 0.2])
  b.add(atlasQuad(0.22, 0.17, DECAL_UV.dent(2)), white, [0.16, 0.84, -0.9935], [0, Math.PI, 0])
  b.add(atlasQuad(0.3, 0.22, DECAL_UV.dent(3)), white, [0.22, 1.0855, 0.93], [-Math.PI / 2, 0, 0.5])
  prop.dispose()
  chev.dispose()
  return b.build()
}

// ---- cache + materials -------------------------------------------------------------------
export interface ForkliftAssets {
  body: THREE.BufferGeometry
  metal: THREE.BufferGeometry
  carriage: THREE.BufferGeometry
  steering: THREE.BufferGeometry
  wheel: THREE.BufferGeometry
  lamps: THREE.BufferGeometry
  beacon: THREE.BufferGeometry
  decals: THREE.BufferGeometry
  paint: THREE.MeshStandardMaterial
  metalMat: THREE.MeshStandardMaterial
  rubber: THREE.MeshStandardMaterial
  lampMat: THREE.MeshBasicMaterial
  decalMat: THREE.MeshStandardMaterial
}

let assets: ForkliftAssets | null = null

/** Built once (module lifetime); never disposed (shared across remounts). */
export function forkliftAssets(): ForkliftAssets {
  if (assets) return assets
  const wear = textures.paintWear()
  assets = {
    body: buildBody(),
    metal: buildMetal(),
    carriage: buildCarriage(),
    steering: buildSteeringWheel(),
    wheel: buildWheel(),
    lamps: buildLamps(),
    beacon: buildBeacon(),
    decals: buildDecals(),
    paint: new THREE.MeshStandardMaterial({ vertexColors: true, map: wear, roughness: 0.58, metalness: 0.18, name: 'vehicles:forklift-paint' }),
    metalMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.62, name: 'vehicles:forklift-metal' }),
    rubber: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.08, name: 'vehicles:forklift-wheel' }),
    lampMat: new THREE.MeshBasicMaterial({ vertexColors: true, name: 'vehicles:forklift-lamps' }),
    decalMat: new THREE.MeshStandardMaterial({
      map: forkliftDecalTexture(),
      transparent: true,
      depthWrite: false,
      roughness: 0.7,
      metalness: 0.1,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      name: 'vehicles:forklift-decals',
    }),
  }
  return assets
}
