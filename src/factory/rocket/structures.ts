/**
 * Static and articulated geometry of the launch complex (tower, crane, track,
 * pad, counter-sign frame, transporter, observation-deck bench, status kiosk),
 * built with GeoBuilder into a handful of merged geometries. Static parts are
 * built in WORLD coordinates (object-space y = height above ground, which the
 * shared material uses for ground occlusion); articulated parts in their own
 * frames with NO_AO surfaces.
 */
import * as THREE from 'three'
import { PALETTE } from '@/world/palette'
import { ATLAS_UV, atlasAspect } from './atlas'
import {
  BENCH,
  COLUMN_OFF,
  COLUMN_SIZE,
  CRANE_JIB_Y,
  CRANE_PIVOT,
  CRANE_TROLLEY_Y,
  CUSHION,
  CUSHION_SIZE,
  DECK_TOP,
  DECK_Y,
  KIOSK,
  PAD_BEACONS,
  PAD_MAST,
  PAD_SLAB_R,
  PAD_TOP,
  PAD_WATER_TOWER,
  PAD_X,
  PAD_Z,
  PLATFORM_DEPTH,
  PLATFORM_LEVELS,
  PORTAL_TOP,
  SIGN_BOARD,
  STAGING_DECK,
  STAGING_DECK_Y,
  STAIR,
  TOWER_CX,
  TOWER_CZ,
  TOWER_H,
  TOWER_HALF,
  TRANSPORTER,
  TRENCH,
} from './config'
import { BLINK, GeoBuilder, glow, noAO, SURF, type Surf, type V3 } from './geo'
import { TRACK_PATH, type TrackPoint } from './track'

const RED = '#B4503A'
const RED_DARK = '#8E3F2F'
const GUN = PALETTE.gunmetal
const DARK = '#2C3234'
const YEL = PALETTE.hazard
const CONCRETE = '#8F8C83'

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

/** Railing along a→b at height y (top rail, mid rail, posts). */
function railing(b: GeoBuilder, a: [number, number], c: [number, number], y: number, color = YEL, surf: Surf = SURF.paint): void {
  b.tube([a[0], y + 1.05, a[1]], [c[0], y + 1.05, c[1]], 0.035, color, 6, surf)
  b.tube([a[0], y + 0.55, a[1]], [c[0], y + 0.55, c[1]], 0.028, color, 6, surf)
  const len = Math.hypot(c[0] - a[0], c[1] - a[1])
  const n = Math.max(1, Math.round(len / 1.5))
  for (let k = 0; k <= n; k++) {
    const t = k / n
    const x = a[0] + (c[0] - a[0]) * t
    const z = a[1] + (c[1] - a[1]) * t
    b.tube([x, y, z], [x, y + 1.08, z], 0.03, color, 6, surf)
  }
  // toe board
  const mx = (a[0] + c[0]) / 2
  const mz = (a[1] + c[1]) / 2
  const yaw = Math.atan2(c[0] - a[0], c[1] - a[1])
  b.box(mx, y + 0.07, mz, 0.02, 0.14, len, color, { rot: [0, yaw, 0], surf })
}

/** Grated platform deck from (x0,z0) to (x1,z1) at height y (bars run along the long side). */
function gratedDeck(b: GeoBuilder, x0: number, z0: number, x1: number, z1: number, y: number, color = GUN): void {
  const w = x1 - x0
  const d = z1 - z0
  const alongX = w >= d
  // edge frame
  b.box((x0 + x1) / 2, y - 0.09, z0 + 0.05, w, 0.18, 0.1, color, { surf: SURF.metal })
  b.box((x0 + x1) / 2, y - 0.09, z1 - 0.05, w, 0.18, 0.1, color, { surf: SURF.metal })
  b.box(x0 + 0.05, y - 0.09, (z0 + z1) / 2, 0.1, 0.18, d, color, { surf: SURF.metal })
  b.box(x1 - 0.05, y - 0.09, (z0 + z1) / 2, 0.1, 0.18, d, color, { surf: SURF.metal })
  const span = alongX ? d : w
  const n = Math.max(2, Math.floor(span / 0.13))
  for (let k = 1; k < n; k++) {
    const t = k / n
    if (alongX) b.box((x0 + x1) / 2, y - 0.03, z0 + d * t, w - 0.1, 0.06, 0.03, '#3E4648', { surf: SURF.metal })
    else b.box(x0 + w * t, y - 0.03, (z0 + z1) / 2, 0.03, 0.06, d - 0.1, '#3E4648', { surf: SURF.metal })
  }
  // cross bearers
  const long = alongX ? w : d
  const m = Math.max(1, Math.round(long / 1.4))
  for (let k = 1; k < m; k++) {
    const t = k / m
    if (alongX) b.box(x0 + w * t, y - 0.1, (z0 + z1) / 2, 0.08, 0.14, d, color, { surf: SURF.metal })
    else b.box((x0 + x1) / 2, y - 0.1, z0 + d * t, w, 0.14, 0.08, color, { surf: SURF.metal })
  }
}

/** Lattice column: 4 chords + zig-zag lacing on every face. */
function latticeColumn(b: GeoBuilder, cx: number, cz: number, size: number, y0: number, y1: number, color: string, pitch = 1.0, chord = 0.13): void {
  const h = size / 2 - chord / 2
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(cx + sx * h, (y0 + y1) / 2, cz + sz * h, chord, y1 - y0, chord, color, { surf: SURF.paint })
  const n = Math.max(1, Math.round((y1 - y0) / pitch))
  const step = (y1 - y0) / n
  const faces: [V3, V3][] = [
    [
      [-h, 0, -h],
      [h, 0, -h],
    ],
    [
      [h, 0, -h],
      [h, 0, h],
    ],
    [
      [h, 0, h],
      [-h, 0, h],
    ],
    [
      [-h, 0, h],
      [-h, 0, -h],
    ],
  ]
  for (let k = 0; k < n; k++) {
    const ya = y0 + k * step
    const yb = ya + step
    faces.forEach(([p, q], fi) => {
      const flip = (k + fi) % 2 === 0
      const a: V3 = flip ? [cx + p[0], ya, cz + p[2]] : [cx + q[0], ya, cz + q[2]]
      const c: V3 = flip ? [cx + q[0], yb, cz + q[2]] : [cx + p[0], yb, cz + p[2]]
      b.beam(a, c, 0.06, 0.06, color, SURF.paint)
    })
  }
}

/** Lamp housing + emissive lens facing direction (dx, dy, dz). */
function floodlight(b: GeoBuilder, x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
  const len = Math.hypot(dx, dy, dz) || 1
  const nx = dx / len
  const ny = dy / len
  const nz = dz / len
  b.beam([x - nx * 0.25, y - ny * 0.25, z - nz * 0.25], [x, y, z], 0.42, 0.32, DARK, SURF.metal)
  b.beam([x, y, z], [x + nx * 0.03, y + ny * 0.03, z + nz * 0.03], 0.36, 0.26, '#FFF1D2', glow(BLINK.steady, 2.4))
}

// ---------------------------------------------------------------------------
// Tower
// ---------------------------------------------------------------------------

export interface FloodSpot {
  pos: V3
  dir: V3
}

export interface TowerBuild {
  geo: THREE.BufferGeometry
  /** Lamp positions (for halos). */
  floods: FloodSpot[]
  /** Red aviation lights (for halos). */
  aviation: V3[]
}

export function buildTower(): TowerBuild {
  const b = new GeoBuilder()
  const cx = TOWER_CX
  const cz = TOWER_CZ
  const o = COLUMN_OFF
  const H = TOWER_H
  const cols: [number, number][] = [
    [cx - o, cz - o],
    [cx + o, cz - o],
    [cx + o, cz + o],
    [cx - o, cz + o],
  ]
  // footings + lattice columns
  for (const [x, z] of cols) {
    b.box(x, 0.12, z, 1.5, 0.24, 1.5, CONCRETE, { surf: SURF.concrete })
    b.box(x, 0.32, z, 1.1, 0.16, 1.1, DARK, { surf: SURF.metal })
    latticeColumn(b, x, z, COLUMN_SIZE, 0.4, H, RED)
  }
  const inner = o - COLUMN_SIZE / 2
  // level beams
  const levels = [...PLATFORM_LEVELS, 23, H]
  const beam = (a: V3, c: V3, h = 0.42) => b.beam(a, c, 0.3, h, RED_DARK, SURF.paint)
  for (const y of levels) {
    beam([cx - inner, y, cz - o], [cx + inner, y, cz - o]) // north
    beam([cx - o, y, cz - inner], [cx - o, y, cz + inner]) // west
    if (y >= STAGING_DECK_Y - 0.01) beam([cx - inner, y, cz + o], [cx + inner, y, cz + o]) // south (open below the deck)
    if (y >= PORTAL_TOP) beam([cx + o, y, cz - inner], [cx + o, y, cz + inner]) // east (rollout portal)
  }
  beam([cx + o, PORTAL_TOP, cz - inner], [cx + o, PORTAL_TOP, cz + inner], 0.75)
  beam([cx + o, 23, cz - inner], [cx + o, 23, cz + inner])
  // X bracing
  const brace = (a: V3, c: V3) => b.beam(a, c, 0.1, 0.1, RED, SURF.paint)
  const bands = (lo: number) => {
    const out: [number, number][] = []
    const ys = [lo, ...levels.filter((y) => y > lo + 0.5)]
    for (let i = 0; i < ys.length - 1; i++) out.push([ys[i], ys[i + 1]])
    return out
  }
  for (const [y0, y1] of bands(PLATFORM_LEVELS[0])) {
    // north and west faces
    brace([cx - inner, y0, cz - o], [cx + inner, y1, cz - o])
    brace([cx + inner, y0, cz - o], [cx - inner, y1, cz - o])
    brace([cx - o, y0, cz - inner], [cx - o, y1, cz + inner])
    brace([cx - o, y0, cz + inner], [cx - o, y1, cz - inner])
  }
  for (const [y0, y1] of bands(PLATFORM_LEVELS[2])) {
    brace([cx - inner, y0, cz + o], [cx + inner, y1, cz + o])
    brace([cx + inner, y0, cz + o], [cx - inner, y1, cz + o])
  }
  for (const [y0, y1] of bands(23)) {
    brace([cx + o, y0, cz - inner], [cx + o, y1, cz + inner])
    brace([cx + o, y0, cz + inner], [cx + o, y1, cz - inner])
  }
  // portal knee braces (make the rollout door read as a portal)
  b.beam([cx + o, PORTAL_TOP - 2.2, cz - inner], [cx + o, PORTAL_TOP - 0.2, cz - inner + 2.2], 0.16, 0.16, RED_DARK, SURF.paint)
  b.beam([cx + o, PORTAL_TOP - 2.2, cz + inner], [cx + o, PORTAL_TOP - 0.2, cz + inner - 2.2], 0.16, 0.16, RED_DARK, SURF.paint)

  // service platforms (L: north + west faces) with railings
  const pd = PLATFORM_DEPTH
  for (const y of PLATFORM_LEVELS) {
    gratedDeck(b, cx - inner, cz - inner, cx + inner, cz - inner + pd, y)
    gratedDeck(b, cx - inner, cz - inner + pd, cx - inner + pd, cz + inner, y)
    railing(b, [cx - inner + pd, cz - inner + pd], [cx + inner, cz - inner + pd], y)
    railing(b, [cx - inner + pd, cz - inner + pd], [cx - inner + pd, cz + inner], y)
  }
  // staging deck on the south face where finished parts wait for the crane
  {
    const s = STAGING_DECK
    gratedDeck(b, s.minX, s.minZ, s.maxX, s.maxZ, STAGING_DECK_Y)
    railing(b, [s.minX, s.minZ], [s.minX, s.maxZ], STAGING_DECK_Y)
    railing(b, [s.maxX, s.minZ], [s.maxX, s.maxZ], STAGING_DECK_Y)
    b.beam([s.minX + 0.2, STAGING_DECK_Y - 0.15, s.minZ], [cx - inner, STAGING_DECK_Y - 2.2, cz + o - 0.3], 0.12, 0.12, RED_DARK, SURF.paint)
    b.beam([s.maxX - 0.2, STAGING_DECK_Y - 0.15, s.minZ], [cx + inner, STAGING_DECK_Y - 2.2, cz + o - 0.3], 0.12, 0.12, RED_DARK, SURF.paint)
    // fabrication jig: a bright welding bay frame
    b.box((s.minX + s.maxX) / 2, STAGING_DECK_Y + 0.05, (s.minZ + s.maxZ) / 2, 2.6, 0.1, 1.2, '#5C6A6E', { surf: SURF.metal })
  }
  // top deck
  gratedDeck(b, cx - inner, cz - inner, cx + inner, cz - inner + pd * 1.3, H)
  gratedDeck(b, cx - inner, cz + inner - pd * 1.3, cx + inner, cz + inner, H)
  railing(b, [cx - o, cz - o], [cx + o, cz - o], H)
  railing(b, [cx - o, cz + o], [cx + o, cz + o], H)
  railing(b, [cx - o, cz - o], [cx - o, cz + o], H)

  // external switchback stair (west face) to the first platform + caged ladder above
  {
    const { x0, x1, z0, z1 } = STAIR
    const xm = (x0 + x1) / 2
    const half = PLATFORM_LEVELS[0] / 2
    const flights: [number, number, number, number][] = [
      [x0, xm - 0.04, z1, z0 + 1.1],
      [xm + 0.04, x1, z0 + 1.1, z1],
    ]
    flights.forEach(([fx0, fx1, fz0, fz1], i) => {
      const ya = i * half
      const yb = ya + half
      for (const xx of [fx0 + 0.04, fx1 - 0.04]) b.beam([xx, ya, fz0], [xx, yb, fz1], 0.06, 0.24, GUN, SURF.metal)
      const n = Math.round(Math.abs(fz1 - fz0) / 0.28)
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n
        b.box((fx0 + fx1) / 2, ya + (yb - ya) * t, fz0 + (fz1 - fz0) * t, fx1 - fx0 - 0.1, 0.04, 0.24, '#5A6669', { surf: SURF.metal })
      }
      b.tube([fx0, ya + 1.0, fz0], [fx0, yb + 1.0, fz1], 0.03, YEL, 6, SURF.paint)
    })
    // landings
    b.box(xm, half - 0.05, z0 + 0.55, x1 - x0, 0.1, 1.1, GUN, { surf: SURF.metal })
    b.box(xm, PLATFORM_LEVELS[0] - 0.05, z1 + 0.2, x1 - x0, 0.1, 0.9, GUN, { surf: SURF.metal })
    for (const [x, z] of [
      [x0 + 0.05, z0 + 0.05],
      [x1 - 0.05, z0 + 0.05],
      [x0 + 0.05, z1 - 0.05],
      [x1 - 0.05, z1 - 0.05],
    ])
      b.box(x, PLATFORM_LEVELS[0] / 2, z, 0.12, PLATFORM_LEVELS[0], 0.12, GUN, { surf: SURF.metal })
    // chained-off foot of the stair ("authorised personnel only")
    b.tube([x0, 0.95, z1 + 0.05], [x1, 0.95, z1 + 0.05], 0.02, PALETTE.signalRed, 4, SURF.paint)
    // caged ladder from the first platform to the top (on the NW column, outside)
    const lx = cx - o - COLUMN_SIZE / 2 - 0.35
    const lz = cz - o + 1.0
    for (const dz of [-0.22, 0.22]) b.box(lx, (PLATFORM_LEVELS[0] + H) / 2, lz + dz, 0.05, H - PLATFORM_LEVELS[0], 0.05, YEL, { surf: SURF.paint })
    for (let y = PLATFORM_LEVELS[0] + 0.3; y < H; y += 0.3) b.box(lx, y, lz, 0.04, 0.03, 0.44, YEL, { surf: SURF.paint })
    for (let y = PLATFORM_LEVELS[0] + 2.2; y < H; y += 1.2) b.torus(lx - 0.3, y, lz, 0.38, 0.025, YEL, { arc: Math.PI, rot: [Math.PI / 2, 0, Math.PI / 2], surf: SURF.paint })
  }

  // vertical service pipes on the west face (fuel, oxidiser, water)
  const pipes: [number, string][] = [
    [cz - 1.2, YEL],
    [cz - 0.7, '#E9E3D3'],
    [cz - 0.2, '#5E8F6C'],
  ]
  for (const [pz, col] of pipes) {
    b.tube([cx - o + 0.2, 0.0, pz], [cx - o + 0.2, PLATFORM_LEVELS[2] + 0.4, pz], 0.08, col, 8, SURF.gloss)
    b.box(cx - o + 0.2, 0.15, pz, 0.3, 0.3, 0.3, DARK, { surf: SURF.metal })
  }

  // crane mast on the NE column
  const [px, pz] = CRANE_PIVOT
  latticeColumn(b, px, pz, 1.1, H, CRANE_JIB_Y - 0.75, '#C9A43C', 0.8, 0.1)
  b.cyl(px, CRANE_JIB_Y - 0.75, pz, 0.85, 0.22, DARK, { segs: 18, surf: SURF.metal })

  // signage
  {
    const w = 9.0
    const h = w / atlasAspect('towerSign')
    const y = 21.4
    for (const side of [1, -1]) {
      const z = cz + side * (o + 0.3)
      b.box(cx, y, z - side * 0.06, w + 0.3, h + 0.3, 0.1, DARK, { surf: SURF.metal })
      b.quad(cx, y, z + side * 0.005, w, h, '#ffffff', ATLAS_UV.towerSign, { rot: [0, side > 0 ? 0 : Math.PI, 0], surf: SURF.paint })
      for (const sx of [-1, 1]) b.beam([cx + sx * (w / 2 - 0.3), y - h / 2 - 0.15, z - side * 0.12], [cx + sx * (w / 2 - 0.3), y - h / 2 - 0.15, cz + side * o], 0.1, 0.1, DARK, SURF.metal)
    }
    const pw = 8.4
    const ph = pw / atlasAspect('portalSign')
    b.box(cx + o + 0.32, PORTAL_TOP - 0.85, cz, 0.08, ph + 0.16, pw + 0.16, DARK, { surf: SURF.metal })
    b.quad(cx + o + 0.37, PORTAL_TOP - 0.85, cz, pw, ph, '#ffffff', ATLAS_UV.portalSign, { rot: [0, Math.PI / 2, 0], surf: SURF.paint })
  }

  // floodlights (top ring, aimed at the rocket) + platform lamps
  const floods: FloodSpot[] = []
  for (const [x, z] of cols) {
    const dx = cx - x
    const dz = cz - z
    const p: V3 = [x + Math.sign(dx) * 0.7, H - 0.5, z + Math.sign(dz) * 0.7]
    const dir: V3 = [dx * 0.6, -H * 0.55, dz * 0.6]
    floodlight(b, p[0], p[1], p[2], dir[0], dir[1], dir[2])
    floods.push({ pos: p, dir })
  }
  for (const y of [PLATFORM_LEVELS[1] + 1.6, PLATFORM_LEVELS[3] + 1.6]) {
    const p: V3 = [cx - inner + 0.3, y, cz - inner + 0.3]
    floodlight(b, p[0], p[1], p[2], 1, -0.25, 1)
    floods.push({ pos: p, dir: [1, -0.25, 1] })
  }
  // red aviation lights on the column tops
  const aviation: V3[] = []
  for (const [x, z] of cols) {
    if (x === px && z === pz) continue
    const p: V3 = [x, H + 0.35, z]
    b.cyl(x, H, z, 0.06, 0.25, DARK, { segs: 6, surf: SURF.metal })
    b.sphere(x, H + 0.35, z, 0.13, '#FF3B2F', { surf: glow(BLINK.aviation, 3), w: 10, h: 6 })
    aviation.push(p)
  }
  // cable trays along the north face
  b.box(cx, PLATFORM_LEVELS[1] - 0.6, cz - o - 0.15, 2 * inner, 0.12, 0.35, '#6E7A7D', { surf: SURF.metal })
  const geo = b.build()!
  b.dispose()
  return { geo, floods, aviation }
}

// ---------------------------------------------------------------------------
// Crane (jib assembly in a frame rotated about the pivot; local +Z = jib)
// ---------------------------------------------------------------------------

export const JIB_LENGTH = 12.6
export const COUNTER_JIB = 4.6

export function buildCraneJib(): { geo: THREE.BufferGeometry; tip: V3; apex: V3 } {
  const b = new GeoBuilder()
  const S = noAO(SURF.paint)
  const M = noAO(SURF.metal)
  const y = CRANE_JIB_Y
  const col = '#D8B13C'
  // slewing platform + cab
  b.cyl(0, y - 0.5, 0, 0.95, 0.35, DARK, { segs: 18, surf: M })
  b.box(0.95, y + 0.1, 0.4, 1.0, 1.3, 1.3, '#E3DCC8', { surf: S })
  b.box(1.46, y + 0.25, 0.4, 0.02, 0.6, 1.0, '#7FA3AE', { surf: noAO(SURF.glass) })
  b.box(0.95, y + 0.25, 1.06, 0.8, 0.6, 0.02, '#7FA3AE', { surf: noAO(SURF.glass) })
  // jib: triangular truss along +Z
  const chord = (p: V3, q: V3, r = 0.07) => b.tube(p, q, r, col, 6, S)
  const w = 0.55
  const top = 0.95
  const L = JIB_LENGTH
  chord([-w, y, 0.4], [-w, y, L])
  chord([w, y, 0.4], [w, y, L])
  chord([0, y + top, 0.4], [0, y + top * 0.55, L])
  const n = Math.round(L / 0.9)
  for (let k = 0; k < n; k++) {
    const za = 0.4 + ((L - 0.4) * k) / n
    const zb = 0.4 + ((L - 0.4) * (k + 1)) / n
    const ta = top - (top * 0.45 * (za - 0.4)) / (L - 0.4)
    const tb = top - (top * 0.45 * (zb - 0.4)) / (L - 0.4)
    b.tube([-w, y, za], [0, y + tb, zb], 0.035, col, 4, S)
    b.tube([w, y, za], [0, y + tb, zb], 0.035, col, 4, S)
    b.tube([-w, y, zb], [w, y, zb], 0.03, col, 4, S)
    void ta
  }
  // trolley rails under the jib
  b.box(-w + 0.08, y - 0.12, L / 2 + 0.3, 0.08, 0.1, L - 0.6, DARK, { surf: M })
  b.box(w - 0.08, y - 0.12, L / 2 + 0.3, 0.08, 0.1, L - 0.6, DARK, { surf: M })
  // hazard tip + aviation light
  b.box(0, y + 0.25, L + 0.1, 1.3, 0.6, 0.2, '#ffffff', { surf: S, uv: ATLAS_UV.hazard })
  const tip: V3 = [0, y + 0.75, L + 0.1]
  b.sphere(tip[0], tip[1], tip[2], 0.12, '#FF3B2F', { surf: glow(BLINK.aviation, 3), w: 8, h: 6 })
  // counter-jib with concrete counterweights
  chord([-w, y, -0.4], [-w, y, -COUNTER_JIB])
  chord([w, y, -0.4], [w, y, -COUNTER_JIB])
  b.box(0, y - 0.05, -COUNTER_JIB / 2 - 0.3, 1.3, 0.12, COUNTER_JIB - 0.8, '#5A6366', { surf: M })
  for (let k = 0; k < 3; k++) b.box(0, y - 0.55, -COUNTER_JIB + 0.45 + k * 0.62, 1.5, 0.95, 0.56, '#9A978E', { surf: noAO(SURF.concrete) })
  // A-frame apex and tie bars
  const apex: V3 = [0, y + 3.0, 0]
  b.tube([-w, y, 0.3], apex, 0.06, col, 6, S)
  b.tube([w, y, 0.3], apex, 0.06, col, 6, S)
  b.tube([-w, y, -0.3], apex, 0.06, col, 6, S)
  b.tube([w, y, -0.3], apex, 0.06, col, 6, S)
  b.tube(apex, [0, y + top * 0.6, L * 0.62], 0.03, '#3A3F40', 4, M)
  b.tube(apex, [0, y + top * 0.5, L * 0.98], 0.03, '#3A3F40', 4, M)
  b.tube(apex, [0, y, -COUNTER_JIB + 0.2], 0.03, '#3A3F40', 4, M)
  b.sphere(apex[0], apex[1] + 0.12, apex[2], 0.12, '#FF3B2F', { surf: glow(BLINK.aviation, 3), w: 8, h: 6 })
  const geo = b.build()!
  b.dispose()
  return { geo, tip, apex: [apex[0], apex[1] + 0.12, apex[2]] }
}

/** Trolley (local to the jib frame, centred at z = 0; positioned along +Z). */
export function buildTrolley(): THREE.BufferGeometry {
  const b = new GeoBuilder()
  const y = CRANE_TROLLEY_Y
  b.box(0, y, 0, 1.2, 0.35, 0.9, '#3E4648', { surf: noAO(SURF.metal) })
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(sx * 0.47, y + 0.12, sz * 0.32, 0.09, 0.08, DARK, { rot: [0, 0, Math.PI / 2], segs: 8, surf: noAO(SURF.metal) })
  b.cyl(-0.25, y - 0.32, 0, 0.16, 0.5, '#5A6366', { rot: [0, 0, -Math.PI / 2], segs: 10, surf: noAO(SURF.metal) })
  const g = b.build()!
  b.dispose()
  return g
}

/** Unit cable: radius 1, from y = 0 down to y = -1 (scale x/z = radius, y = length). */
export function buildCable(): THREE.BufferGeometry {
  const b = new GeoBuilder()
  b.cyl(0, -1, 0, 1, 1, '#2A2D2D', { segs: 5, open: true, surf: noAO(SURF.metal) })
  const g = b.build()!
  b.dispose()
  return g
}

/** Umbilical swing arm (hinge at origin, reaching along +X, length ~3.4 m). */
export function buildArm(length: number): THREE.BufferGeometry {
  const b = new GeoBuilder()
  const S = noAO(SURF.paint)
  const M = noAO(SURF.metal)
  b.cyl(0, -0.55, 0, 0.13, 1.1, DARK, { segs: 10, surf: M })
  for (const dz of [-0.18, 0.18]) {
    b.tube([0.1, 0.22, dz], [length, 0.12, dz], 0.05, RED, 6, S)
    b.tube([0.1, -0.22, dz], [length, -0.1, dz], 0.05, RED, 6, S)
  }
  const n = Math.round(length / 0.45)
  for (let k = 0; k < n; k++) {
    const xa = 0.1 + ((length - 0.1) * k) / n
    const xb = 0.1 + ((length - 0.1) * (k + 1)) / n
    for (const dz of [-0.18, 0.18]) b.tube([xa, -0.2, dz], [xb, 0.2, dz], 0.025, RED, 4, S)
    b.tube([xb, 0.18, -0.18], [xb, 0.18, 0.18], 0.022, RED, 4, S)
  }
  // hose bundle sagging under the arm
  const hoses = ['#E9E3D3', YEL, '#2E3536']
  hoses.forEach((c, i) => {
    const dz = (i - 1) * 0.1
    let prev: V3 = [0.2, -0.3, dz]
    for (let k = 1; k <= 6; k++) {
      const t = k / 6
      const p: V3 = [0.2 + (length - 0.25) * t, -0.3 - Math.sin(t * Math.PI) * 0.35, dz]
      b.tube(prev, p, 0.045, c, 6, S)
      prev = p
    }
  })
  // clamp head
  b.box(length + 0.05, 0, 0, 0.3, 0.52, 0.55, '#3E4648', { surf: M })
  b.box(length + 0.22, 0, 0, 0.06, 0.4, 0.42, '#1D2122', { surf: M })
  const g = b.build()!
  b.dispose()
  return g
}

// ---------------------------------------------------------------------------
// Track: bed, rails, buffer stops (world), sleepers (instanced)
// ---------------------------------------------------------------------------

export const TRACK_START = -3.6
export const TRACK_END_EXTRA = 3.3
const SLEEPER_STEP = 0.72

function trackPoint(s: number, out: TrackPoint): TrackPoint {
  const L = TRACK_PATH.length
  TRACK_PATH.sample(Math.min(L, Math.max(0, s)), out)
  if (s < 0) {
    out.x += out.tx * s
    out.z += out.tz * s
  } else if (s > L) {
    out.x += out.tx * (s - L)
    out.z += out.tz * (s - L)
  }
  return out
}

/** Arc length where the track crosses onto the pad slab. */
export function padEdgeS(): number {
  return TRACK_PATH.length - PAD_SLAB_R + 0.1
}

export function buildTrack(): { geo: THREE.BufferGeometry; sleepers: THREE.Matrix4[] } {
  const b = new GeoBuilder()
  const L = TRACK_PATH.length
  const s0 = TRACK_START
  const s1 = L + TRACK_END_EXTRA
  const sPad = padEdgeS()
  const tp: TrackPoint = { x: 0, z: 0, yaw: 0, tx: 1, tz: 0 }
  const tq: TrackPoint = { x: 0, z: 0, yaw: 0, tx: 1, tz: 0 }
  const step = 0.5
  const halfG = TRANSPORTER.gauge / 2
  for (let s = s0; s < s1 - 1e-6; s += step) {
    const e = Math.min(s1, s + step)
    trackPoint(s, tp)
    trackPoint(e, tq)
    const mx = (tp.x + tq.x) / 2
    const mz = (tp.z + tq.z) / 2
    const yaw = Math.atan2(tq.x - tp.x, tq.z - tp.z)
    const len = Math.hypot(tq.x - tp.x, tq.z - tp.z) + 0.03
    // concrete bed (off the pad only)
    if (s < sPad) b.box(mx, 0.028, mz, 4.3, 0.056, len, '#6F6D66', { rot: [0, yaw, 0], surf: SURF.concrete })
    for (const side of [-1, 1]) {
      // right of travel = (-tz, tx)
      const rx = -((tp.tz + tq.tz) / 2) * side * halfG
      const rz = ((tp.tx + tq.tx) / 2) * side * halfG
      b.box(mx + rx, 0.115, mz + rz, 0.16, 0.03, len, '#3B3F40', { rot: [0, yaw, 0], surf: SURF.metal })
      b.box(mx + rx, 0.15, mz + rz, 0.05, 0.06, len, '#4B5355', { rot: [0, yaw, 0], surf: SURF.metal })
      b.box(mx + rx, 0.19, mz + rz, 0.085, 0.03, len, '#AEB6B6', { rot: [0, yaw, 0], surf: SURF.metal })
    }
  }
  // buffer stops at both ends
  for (const [s, dir] of [
    [s0, -1],
    [s1, 1],
  ] as const) {
    trackPoint(s, tp)
    const yaw = Math.atan2(tp.tx, tp.tz)
    b.frame([tp.x, 0, tp.z], [0, yaw, 0], () => {
      b.box(0, 0.45, dir * 0.15, 3.9, 0.5, 0.3, '#ffffff', { surf: SURF.paint, uv: ATLAS_UV.hazard })
      for (const sx of [-1.6, 1.6]) {
        b.box(sx, 0.35, dir * 0.45, 0.25, 0.7, 0.6, DARK, { surf: SURF.metal })
        b.cyl(sx, 0.45, -dir * 0.05, 0.13, 0.25, '#B8BFC0', { rot: [Math.PI / 2, 0, 0], segs: 10, surf: SURF.metal })
      }
    })
  }
  const sleepers: THREE.Matrix4[] = []
  for (let s = s0 + 0.3; s < Math.min(sPad, s1); s += SLEEPER_STEP) {
    trackPoint(s, tp)
    const yaw = Math.atan2(tp.tx, tp.tz)
    sleepers.push(new THREE.Matrix4().compose(new THREE.Vector3(tp.x, 0.075, tp.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1)))
  }
  const geo = b.build()!
  b.dispose()
  return { geo, sleepers }
}

/** One sleeper (instanced): 3.9 m across the track. */
export function buildSleeper(): THREE.BufferGeometry {
  const b = new GeoBuilder()
  b.box(0, 0, 0, 3.9, 0.07, 0.26, '#8A867D', { surf: SURF.concrete })
  for (const sx of [-1.6, 1.6]) b.box(sx, 0.04, 0, 0.3, 0.02, 0.22, '#3B3F40', { surf: SURF.metal })
  const g = b.build()!
  b.dispose()
  return g
}

// ---------------------------------------------------------------------------
// Launch pad (world)
// ---------------------------------------------------------------------------

export interface PadBuild {
  geo: THREE.BufferGeometry
  beacons: V3[]
  aviation: V3[]
  /** Swing-arm hinge points on the umbilical mast (world) and their arm length. */
  armHinges: { pos: V3; length: number; connectedYaw: number }[]
}

export function buildPad(): PadBuild {
  const b = new GeoBuilder()
  const cx = PAD_X
  const cz = PAD_Z
  // octagonal slab with a chamfered edge
  b.cyl(cx, 0, cz, PAD_SLAB_R + 0.25, 0.06, '#7E7B73', { segs: 8, rTop: PAD_SLAB_R, surf: SURF.concrete, rot: [0, Math.PI / 8, 0] })
  b.cyl(cx, 0.06, cz, PAD_SLAB_R, PAD_TOP - 0.06, CONCRETE, { segs: 8, surf: SURF.concrete, rot: [0, Math.PI / 8, 0] })
  // soot scorch around the launch mount
  b.cyl(cx, PAD_TOP, cz, 3.6, 0.006, '#4A4743', { segs: 16, surf: SURF.concrete })
  b.cyl(cx, PAD_TOP + 0.006, cz, 2.2, 0.006, '#2F2D2B', { segs: 14, surf: SURF.concrete })
  // flame trench: dark channel east-west, low curbs outside the track corridor, deflector flares
  const tw = TRENCH.halfWidth
  const tl = TRENCH.halfLength
  b.box(cx, PAD_TOP + 0.017, cz, tl * 2, 0.012, tw * 2, '#1C1B1A', { surf: SURF.dark })
  for (const side of [-1, 1]) {
    for (const zs of [-1, 1]) {
      const x0 = cx + side * 2.7
      const x1 = cx + side * (tl - 0.2)
      b.box((x0 + x1) / 2, PAD_TOP + 0.22, cz + zs * (tw + 0.15), Math.abs(x1 - x0), 0.44, 0.3, '#9A978E', { surf: SURF.concrete })
    }
    // flared deflector walls at the trench exits
    for (const zs of [-1, 1]) {
      b.box(cx + side * (tl - 0.3), PAD_TOP + 0.4, cz + zs * (tw + 0.55), 0.3, 0.8, 1.2, '#A29F94', { rot: [0, zs * side * 0.5, 0], surf: SURF.concrete })
    }
    // stencil next to the trench
    const sw = 3.0
    b.quad(cx + side * 4.2, PAD_TOP + 0.015, cz + (tw + 0.75) * side, sw, sw / atlasAspect('flameTrench'), '#E8E2D6', ATLAS_UV.flameTrench, { rot: [-Math.PI / 2, 0, side > 0 ? Math.PI : 0], surf: SURF.paint })
  }
  // steel grate bridge under the rails (over the trench)
  for (let k = -6; k <= 6; k++) b.box(cx + k * 0.22, PAD_TOP + 0.03, cz, 0.06, 0.05, tw * 2 + 0.2, '#3B4244', { surf: SURF.metal })
  b.box(cx - 1.6, PAD_TOP + 0.04, cz, 0.3, 0.08, tw * 2 + 0.4, DARK, { surf: SURF.metal })
  b.box(cx + 1.6, PAD_TOP + 0.04, cz, 0.3, 0.08, tw * 2 + 0.4, DARK, { surf: SURF.metal })

  // umbilical mast
  const [mx, mz] = PAD_MAST
  latticeColumn(b, mx, mz, 1.3, 0, 14, RED, 0.9, 0.12)
  b.box(mx, 0.1, mz, 2.0, 0.2, 2.0, '#9A978E', { surf: SURF.concrete })
  b.box(mx, 14.05, mz, 1.6, 0.12, 1.6, GUN, { surf: SURF.metal })
  for (const y of [5, 9, 12.5]) {
    gratedDeck(b, mx - 0.9, mz - 0.9, mx + 0.9, mz + 0.9, y)
    railing(b, [mx - 0.9, mz - 0.9], [mx + 0.9, mz - 0.9], y)
    railing(b, [mx - 0.9, mz - 0.9], [mx - 0.9, mz + 0.9], y)
  }
  b.tube([mx + 0.5, 0, mz + 0.5], [mx + 0.5, 12, mz + 0.5], 0.08, YEL, 8, SURF.gloss)
  b.tube([mx + 0.3, 0, mz + 0.6], [mx + 0.3, 12, mz + 0.6], 0.08, '#E9E3D3', 8, SURF.gloss)
  const beacons: V3[] = []
  const aviation: V3[] = []
  b.cyl(mx, 14.11, mz, 0.18, 0.3, DARK, { segs: 8, surf: SURF.metal })
  b.sphere(mx, 14.55, mz, 0.2, '#FFB23F', { surf: glow(BLINK.padBeacon, 2.6), scale: [1, 1.2, 1], w: 10, h: 8 })
  beacons.push([mx, 14.55, mz])
  b.tube([mx - 0.4, 14.1, mz - 0.4], [mx - 0.4, 16.2, mz - 0.4], 0.03, '#3A3F40', 4, SURF.metal)
  b.sphere(mx - 0.4, 16.3, mz - 0.4, 0.11, '#FF3B2F', { surf: glow(BLINK.aviation, 3), w: 8, h: 6 })
  aviation.push([mx - 0.4, 16.3, mz - 0.4])
  // hinge points for the pad swing arms (aimed at the rocket on the mount)
  const toRocketYaw = Math.atan2(-(cz - mz), cx - mx) // rotation about Y mapping +X onto the direction
  const reach = Math.hypot(cx - mx, cz - mz) - 1.5
  const armHinges = [8.8, 11.2].map((y) => ({ pos: [mx + Math.cos(toRocketYaw) * 0.7, y, mz - Math.sin(toRocketYaw) * 0.7] as V3, length: reach - 0.7, connectedYaw: toRocketYaw }))

  // deluge water tower
  {
    const [wx, wz] = PAD_WATER_TOWER
    const legs: [number, number][] = [
      [-0.8, -0.8],
      [0.8, -0.8],
      [0.8, 0.8],
      [-0.8, 0.8],
    ]
    const ty = 6.6
    for (const [dx, dz] of legs) {
      b.tube([wx + dx * 1.15, 0, wz + dz * 1.15], [wx + dx, ty, wz + dz], 0.1, '#9AA3A5', 8, SURF.metal)
      b.box(wx + dx * 1.15, 0.12, wz + dz * 1.15, 0.5, 0.24, 0.5, '#9A978E', { surf: SURF.concrete })
    }
    for (const y of [2.2, 4.4]) {
      for (let i = 0; i < 4; i++) {
        const [ax, az] = legs[i]
        const [bx, bz] = legs[(i + 1) % 4]
        const k0 = 1.15 - (0.15 * y) / ty
        b.tube([wx + ax * k0, y - 1.1, wz + az * k0], [wx + bx * k0, y + 1.1, wz + bz * k0], 0.035, '#7D8789', 4, SURF.metal)
        b.tube([wx + ax * k0, y + 1.1, wz + az * k0], [wx + bx * k0, y - 1.1, wz + bz * k0], 0.035, '#7D8789', 4, SURF.metal)
      }
    }
    b.cyl(wx, ty, wz, 1.25, 2.7, '#9DBDB6', { segs: 20, surf: SURF.gloss })
    b.cyl(wx, ty + 2.7, wz, 1.32, 0.8, '#7FA19A', { rTop: 0.12, segs: 20, surf: SURF.gloss })
    b.cyl(wx, ty + 1.05, wz, 1.265, 0.5, '#E9E3D3', { segs: 20, open: true, surf: SURF.paint })
    // DELUGE band facing the plaza
    {
      const r = 1.28
      const hh = 0.5
      const w = hh * atlasAspect('deluge')
      const arc = w / r
      const g = b.own(new THREE.CylinderGeometry(r, r, hh, 10, 1, true, Math.PI * 1.8 - arc / 2, arc))
      b.geo(g, '#ffffff', new THREE.Matrix4().makeTranslation(wx, ty + 1.3, wz), SURF.paint, ATLAS_UV.deluge)
    }
    // catwalk ring + outlet pipe down to the trench
    b.torus(wx, ty - 0.05, wz, 1.55, 0.05, YEL, { surf: SURF.paint })
    b.torus(wx, ty + 1.0, wz, 1.55, 0.035, YEL, { surf: SURF.paint })
    b.tube([wx, ty, wz], [wx, 0.5, wz], 0.16, '#5E8F6C', 8, SURF.gloss)
    b.tube([wx, 0.5, wz], [cx + TRENCH.halfLength - 1.0, 0.5, cz - TRENCH.halfWidth - 0.4], 0.16, '#5E8F6C', 8, SURF.gloss)
    b.sphere(wx, ty + 3.6, wz, 0.18, '#FFB23F', { surf: glow(BLINK.padBeacon, 2.6), w: 10, h: 8 })
    beacons.push([wx, ty + 3.6, wz])
  }
  // rotating beacon posts by the track entrance
  for (const [bx, bz] of PAD_BEACONS) {
    b.cyl(bx, 0, bz, 0.09, 2.3, '#3A4245', { segs: 8, surf: SURF.metal })
    b.box(bx, 0.1, bz, 0.5, 0.2, 0.5, '#9A978E', { surf: SURF.concrete })
    b.cyl(bx, 2.3, bz, 0.2, 0.12, DARK, { segs: 10, surf: SURF.metal })
    b.sphere(bx, 2.55, bz, 0.2, '#FFB23F', { surf: glow(BLINK.padBeacon, 2.6), scale: [1, 1.25, 1], w: 10, h: 8 })
    beacons.push([bx, 2.55, bz])
  }
  // stowaway cushion inflator box + hose
  {
    const [x, z] = CUSHION
    const ix = x + 0.5
    const iz = z + 1.7
    b.box(ix, 0.32, iz, 1.0, 0.64, 0.7, '#E57D35', { surf: SURF.paint })
    b.box(ix, 0.66, iz, 1.05, 0.06, 0.75, DARK, { surf: SURF.metal })
    b.quad(ix, 0.36, iz + 0.352, 0.95, 0.95 / atlasAspect('inflator'), '#ffffff', ATLAS_UV.inflator, { surf: SURF.paint })
    b.tube([ix - 0.3, 0.2, iz - 0.36], [x, 0.15, z + 0.6], 0.06, '#2E3536', 6, SURF.rubber)
    b.cyl(x, 0, z, 0.9, 0.05, '#C9662C', { segs: 14, surf: SURF.fabric })
  }
  const geo = b.build()!
  b.dispose()
  return { geo, beacons, aviation, armHinges }
}

/** The inflatable cushion (origin at the bottom centre, full size; scaled per frame). */
export function buildCushion(): THREE.BufferGeometry {
  const b = new GeoBuilder()
  const { w, h, d } = CUSHION_SIZE
  const r = h / 2
  const S = noAO(SURF.fabric)
  b.box(0, r, 0, w - h, h, d - h, PALETTE.safety, { surf: S })
  for (const sx of [-1, 1]) {
    b.cyl(sx * (w / 2 - r), r, -(d / 2 - r), r, d - h, PALETTE.safety, { rot: [Math.PI / 2, 0, 0], segs: 14, surf: S })
    b.cyl(-(w / 2 - r), r, sx * (d / 2 - r), r, w - h, PALETTE.safety, { rot: [0, 0, -Math.PI / 2], segs: 14, surf: S })
    for (const sz of [-1, 1]) b.sphere(sx * (w / 2 - r), r, sz * (d / 2 - r), r, PALETTE.safety, { surf: S, w: 12, h: 8 })
  }
  b.box(0, h + 0.004, 0, w - h, 0.01, 0.35, YEL, { surf: S })
  b.box(0, h + 0.004, 0, 0.35, 0.01, d - h, YEL, { surf: S })
  const lw = w - h - 0.2
  b.quad(0, r, d / 2 + 0.002, lw, lw / atlasAspect('cushion'), '#ffffff', ATLAS_UV.cushion, { surf: S })
  const g = b.build()!
  b.dispose()
  return g
}

// ---------------------------------------------------------------------------
// Counter sign (local frame: board faces local -Z; built around the origin on the ground)
// ---------------------------------------------------------------------------

export function buildSignFrame(): { geo: THREE.BufferGeometry; lamps: V3[] } {
  const b = new GeoBuilder()
  const { w, h, bottom } = SIGN_BOARD
  const top = bottom + h
  const cy = bottom + h / 2
  // legs (I-beams) + footings
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 - 0.8)
    b.box(x, (top + 0.4) / 2, 0.32, 0.3, top + 0.4, 0.12, '#3A4245', { surf: SURF.metal })
    b.box(x, (top + 0.4) / 2, 0.32, 0.06, top + 0.4, 0.3, '#3A4245', { surf: SURF.metal })
    b.box(x, 0.15, 0.32, 0.9, 0.3, 0.9, '#9A978E', { surf: SURF.concrete })
    b.beam([x, 0.3, 0.32 + 0.3], [x, 1.6, 0.32], 0.08, 0.08, '#3A4245', SURF.metal)
  }
  // cabinet frame
  b.box(0, cy, 0.16, w + 0.36, h + 0.36, 0.3, '#262C2D', { surf: SURF.metal })
  b.box(0, top + 0.2, -0.05, w + 0.5, 0.1, 0.55, '#3A4245', { surf: SURF.metal })
  b.box(0, bottom - 0.24, -0.06, w + 0.36, 0.22, 0.06, '#ffffff', { surf: SURF.paint, uv: ATLAS_UV.hazard })
  // rivets on the frame
  for (let k = 0; k <= 12; k++) {
    const x = -w / 2 - 0.08 + ((w + 0.16) * k) / 12
    b.box(x, top + 0.1, 0.0, 0.05, 0.05, 0.03, '#6B7577', { surf: SURF.metal })
    b.box(x, bottom - 0.08, 0.0, 0.05, 0.05, 0.03, '#6B7577', { surf: SURF.metal })
  }
  // gooseneck lamps over the board
  const lamps: V3[] = []
  for (const lx of [-w / 3, 0, w / 3]) {
    b.tube([lx, top + 0.2, 0.05], [lx, top + 0.55, -0.35], 0.035, '#3A4245', 6, SURF.metal)
    b.tube([lx, top + 0.55, -0.35], [lx, top + 0.45, -0.75], 0.035, '#3A4245', 6, SURF.metal)
    b.cyl(lx, top + 0.3, -0.8, 0.2, 0.18, '#2A2F30', { rTop: 0.1, segs: 10, surf: SURF.metal })
    b.cyl(lx, top + 0.28, -0.8, 0.17, 0.02, '#FFF1D2', { segs: 10, surf: glow(BLINK.steady, 2.2) })
    lamps.push([lx, top + 0.26, -0.8])
  }
  const geo = b.build()!
  b.dispose()
  return { geo, lamps }
}

// ---------------------------------------------------------------------------
// Observation deck bench + assembly status kiosk (world)
// ---------------------------------------------------------------------------

export function buildDeckProps(): THREE.BufferGeometry {
  const b = new GeoBuilder()
  const wood = '#9A6B43'
  b.frame([BENCH.x, DECK_TOP, BENCH.z], [0, BENCH.yaw, 0], () => {
    const w = BENCH.w
    for (const sx of [-1, 1]) {
      b.box(sx * (w / 2 - 0.12), 0.22, 0, 0.06, 0.44, 0.48, '#3A4245', { surf: SURF.metal })
      b.box(sx * (w / 2 - 0.12), 0.62, 0.24, 0.06, 0.8, 0.06, '#3A4245', { surf: SURF.metal })
    }
    for (let k = 0; k < 4; k++) b.box(0, 0.45, -0.18 + k * 0.12, w, 0.04, 0.1, wood, { surf: SURF.paint })
    for (let k = 0; k < 2; k++) b.box(0, 0.68 + k * 0.17, 0.26, w, 0.12, 0.04, wood, { surf: SURF.paint })
    const pw = 0.9
    b.quad(0, 0.765, 0.235, pw, pw / atlasAspect('bench'), '#ffffff', ATLAS_UV.bench, { rot: [0, Math.PI, 0], surf: SURF.paint })
  })
  // assembly status kiosk by the tower
  b.frame([KIOSK[0], 0, KIOSK[1]], [0, 0, 0], () => {
    b.box(0, 0.5, 0, 0.42, 1.0, 0.32, '#3A4245', { surf: SURF.metal })
    b.box(0, 0.06, 0, 0.6, 0.12, 0.45, '#9A978E', { surf: SURF.concrete })
    b.box(0, 1.18, 0.02, 0.78, 0.52, 0.12, '#262C2D', { rot: [-0.35, 0, 0], surf: SURF.metal })
    b.quad(0, 1.19, 0.085, 0.7, 0.7 / atlasAspect('kiosk'), '#ffffff', ATLAS_UV.kiosk, { rot: [-0.35, 0, 0], surf: { rough: 0.5, metal: 0, emis: 0.55, chan: BLINK.steady } })
    b.sphere(0.3, 1.5, 0.0, 0.05, '#5DFF7A', { surf: glow(BLINK.aviation, 2.5), w: 8, h: 6 })
  })
  const g = b.build()!
  b.dispose()
  return g
}

// ---------------------------------------------------------------------------
// Transporter (local frame: forward -Z, origin on the track at ground level)
// ---------------------------------------------------------------------------

export const BOGIES: [number, number][] = [
  [-TRANSPORTER.gauge / 2, -1.9],
  [TRANSPORTER.gauge / 2, -1.9],
  [-TRANSPORTER.gauge / 2, 1.9],
  [TRANSPORTER.gauge / 2, 1.9],
]
export const TREAD = { length: 1.5, radius: 0.36, width: 0.62, y: 0.2 }

export interface TransporterBuild {
  geo: THREE.BufferGeometry
  beacons: V3[]
}

export function buildTransporter(): TransporterBuild {
  const b = new GeoBuilder()
  const L = TRANSPORTER.length
  const W = TRANSPORTER.width
  const top = DECK_Y
  const body = '#5C6669'
  // bogies: frames, road wheels, tread base (links are instanced separately)
  for (const [bx, bz] of BOGIES) {
    const ty = TREAD.y + TREAD.radius
    b.box(bx, ty, bz, TREAD.width - 0.12, TREAD.radius * 1.3, TREAD.length + 0.2, '#3A4144', { surf: SURF.metal })
    for (const dz of [-TREAD.length / 2, 0, TREAD.length / 2]) b.cyl(bx - TREAD.width / 2 + 0.02, ty, bz + dz, TREAD.radius * 0.82, TREAD.width - 0.04, '#2B3032', { rot: [0, 0, -Math.PI / 2], segs: 12, surf: SURF.metal })
    b.box(bx, ty + 0.55, bz, TREAD.width + 0.1, 0.45, TREAD.length + 0.5, '#ffffff', { surf: SURF.paint, uv: ATLAS_UV.hazard })
    // hydraulic leveling ram up to the deck
    b.cyl(bx, ty + 0.75, bz, 0.16, top - ty - 0.95, '#B8BFC0', { segs: 10, surf: SURF.metal })
  }
  // main deck girders
  b.box(0, top - 0.32, 0, W, 0.5, L, body, { surf: SURF.paint })
  b.box(0, top - 0.03, 0, W - 0.12, 0.06, L - 0.12, '#4A5356', { surf: SURF.metal })
  // hazard skirts around the deck
  b.box(0, top - 0.33, -L / 2 - 0.02, W, 0.36, 0.04, '#ffffff', { surf: SURF.paint, uv: ATLAS_UV.hazard })
  b.box(0, top - 0.33, L / 2 + 0.02, W, 0.36, 0.04, '#ffffff', { surf: SURF.paint, uv: ATLAS_UV.hazard })
  // launch mount ring with the flame hole
  b.cyl(0, top, 0, 1.45, 0.16, '#3A4144', { segs: 20, surf: SURF.metal })
  b.cyl(0, top + 0.002, 0, 1.12, 0.17, '#141617', { segs: 18, surf: SURF.dark })
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8
    b.box(Math.cos(a) * 1.3, top + 0.2, Math.sin(a) * 1.3, 0.22, 0.1, 0.22, YEL, { rot: [0, -a, 0], surf: SURF.paint })
  }
  // operator cab (front-left)
  b.frame([-W / 2 + 0.55, top, -L / 2 + 0.6], [0, 0, 0], () => {
    b.box(0, 0.85, 0, 0.95, 1.7, 1.0, '#E3DCC8', { surf: SURF.paint })
    b.box(0, 1.73, 0, 1.08, 0.08, 1.12, DARK, { surf: SURF.metal })
    b.box(0, 1.1, -0.505, 0.75, 0.55, 0.02, '#6F96A0', { surf: SURF.glass })
    b.box(-0.48, 1.1, 0, 0.02, 0.55, 0.7, '#6F96A0', { surf: SURF.glass })
    b.box(0.48, 1.1, 0, 0.02, 0.55, 0.7, '#6F96A0', { surf: SURF.glass })
  })
  // railings along the long edges (open where the crew climb on at the rear)
  railing(b, [-W / 2 + 0.06, -L / 2 + 1.25], [-W / 2 + 0.06, L / 2 - 0.15], top, YEL)
  railing(b, [W / 2 - 0.06, -L / 2 + 0.15], [W / 2 - 0.06, L / 2 - 0.15], top, YEL)
  // hose reels, toolbox, extinguisher
  b.cyl(W / 2 - 0.55, top + 0.37, -L / 2 + 0.45, 0.35, 0.3, '#C8453A', { rot: [Math.PI / 2, 0, 0], segs: 14, surf: SURF.paint })
  b.box(W / 2 - 0.6, top + 0.2, L / 2 - 0.6, 0.6, 0.4, 0.35, PALETTE.signalRed, { surf: SURF.paint })
  b.cyl(-W / 2 + 0.35, top, L / 2 - 0.35, 0.09, 0.55, '#C8302A', { segs: 8, surf: SURF.gloss })
  // name plates and the bumper sticker
  const pw = 2.3
  const ph = pw / atlasAspect('crawlerName')
  b.quad(-W / 2 - 0.005, top - 0.3, 0.3, pw, ph, '#ffffff', ATLAS_UV.crawlerName, { rot: [0, -Math.PI / 2, 0], surf: SURF.paint })
  b.quad(W / 2 + 0.005, top - 0.3, -0.3, pw, ph, '#ffffff', ATLAS_UV.crawlerName, { rot: [0, Math.PI / 2, 0], surf: SURF.paint })
  const hw = 1.5
  b.quad(0.6, top - 0.75, L / 2 + 0.05, hw, hw / atlasAspect('howsMyDriving'), '#ffffff', ATLAS_UV.howsMyDriving, { surf: SURF.paint })
  // amber beacons (cab roof + rear corner post)
  const beacons: V3[] = []
  const bPos: V3[] = [
    [-W / 2 + 0.55, top + 1.95, -L / 2 + 0.6],
    [W / 2 - 0.2, top + 1.35, L / 2 - 0.2],
  ]
  b.cyl(W / 2 - 0.2, top, L / 2 - 0.2, 0.05, 1.2, '#3A4245', { segs: 6, surf: SURF.metal })
  for (const p of bPos) {
    b.cyl(p[0], p[1] - 0.18, p[2], 0.14, 0.08, DARK, { segs: 10, surf: SURF.metal })
    b.sphere(p[0], p[1], p[2], 0.15, '#FFB23F', { surf: glow(BLINK.transporter, 2.6), scale: [1, 1.2, 1], w: 10, h: 8 })
    beacons.push(p)
  }
  // headlights on the front
  for (const sx of [-1.4, 1.4]) b.box(sx, top - 0.35, -L / 2 - 0.06, 0.32, 0.18, 0.06, '#FFF1D2', { surf: glow(BLINK.steady, 1.6) })
  const geo = b.build()!
  b.dispose()
  return { geo, beacons }
}

/** Hold-down clamp arm (local: hinge at origin on the deck, leaning in along -Z toward the rocket). */
export function buildClamp(): THREE.BufferGeometry {
  const b = new GeoBuilder()
  const S = noAO(SURF.paint)
  b.box(0, 0.1, 0, 0.4, 0.2, 0.4, '#3A4144', { surf: noAO(SURF.metal) })
  b.beam([0, 0.15, 0], [0, 1.0, -0.42], 0.22, 0.16, YEL, S)
  b.box(0, 1.02, -0.46, 0.3, 0.16, 0.18, '#2A2F30', { surf: noAO(SURF.metal) })
  b.cyl(-0.22, 0.1, 0, 0.12, 0.44, '#B8BFC0', { rot: [0, 0, -Math.PI / 2], segs: 8, surf: noAO(SURF.metal) })
  const g = b.build()!
  b.dispose()
  return g
}

/** One tread link plate (instanced around each bogie loop). */
export function buildTreadLink(): THREE.BufferGeometry {
  const b = new GeoBuilder()
  b.box(0, 0, 0, TREAD.width, 0.07, 0.2, '#262A2B', { surf: noAO(SURF.rubber) })
  b.box(0, -0.045, 0, TREAD.width - 0.1, 0.03, 0.08, '#1A1D1E', { surf: noAO(SURF.metal) })
  const g = b.build()!
  b.dispose()
  return g
}

/** Point on a tread loop (stadium) at distance d: returns local (y, z) and the angle of the plate. */
export function treadLoop(d: number, out: { y: number; z: number; a: number }): void {
  const L = TREAD.length
  const r = TREAD.radius
  const per = 2 * L + 2 * Math.PI * r
  let t = ((d % per) + per) % per
  const cy = TREAD.y + r
  if (t < L) {
    // bottom run, moving toward -Z (forward)
    out.z = L / 2 - t
    out.y = cy - r
    out.a = 0
    return
  }
  t -= L
  const arc = Math.PI * r
  if (t < arc) {
    const a = t / r
    out.z = -L / 2 - Math.sin(a) * r
    out.y = cy - Math.cos(a) * r
    out.a = -a
    return
  }
  t -= arc
  if (t < L) {
    out.z = -L / 2 + t
    out.y = cy + r
    out.a = Math.PI
    return
  }
  t -= L
  const a = t / r
  out.z = L / 2 + Math.sin(a) * r
  out.y = cy + Math.cos(a) * r
  out.a = Math.PI - a
}

export const TREAD_PERIMETER = 2 * TREAD.length + 2 * Math.PI * TREAD.radius
