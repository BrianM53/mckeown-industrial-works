/**
 * Building shells for every ZONES[*].building: walls with the door opening,
 * door dressing per type (roll-up / storefront+awning / glass+canopy), windows,
 * interior linings, trusses + lamps, gutters/downpipes, wall pipes, cable trays,
 * wall fans, signs and roofs (flat w/ parapet + units, sawtooth w/ skylights,
 * gable). Walls go into the shared static batch; roofs into per-building
 * batches so the roof cutaway can hide one building at a time.
 */
import * as THREE from 'three'
import { createRng } from '@/core/rng'
import type { DoorSide } from '@/world/layout'
import { PALETTE } from '@/world/palette'
import { BUILDINGS, sideFace, sideNormal, sideRange, sideYaw, wallBoxes, windowSpots, type BuildingInfo } from '../data/buildings'
import { POSTERS } from '../data/text'
import { Batch, prismGeometry, unitCylinder } from '../lib/batch'
import { buildingSignSpot, EMERGENCY_BEACONS, RIGHT, ZONE_BEACONS } from './beaconData'
import type { BuildCtx } from './types'

const STEEL = '#5B676B'
const DARK = '#2C3234'
const ALU = '#B4BBBD'
const CONCRETE = '#A19E93'
const PIPE_COLORS = ['#A95E39', '#4F7A5A', '#E9B63F', '#C7CCCB', '#4F86A8', '#8B3A2E']
const FULL: [number, number, number, number] = [0, 0, 1, 1]

/** Geometry helper for one face of a building (outer or inner). */
interface Face {
  side: DoorSide
  axis: 'x' | 'z'
  /** Coordinate of the surface (z for N/S, x for E/W). */
  face: number
  /** Unit normal pointing away from the surface into the air. */
  n: [number, number]
  yaw: number
}

function face(bi: BuildingInfo, side: DoorSide, inner: boolean): Face {
  const f = bi.def.footprint
  const t = bi.t
  const [nx, nz] = sideNormal(side)
  const s = inner ? -1 : 1
  const surf = inner ? (side === 'N' ? f.minZ + t : side === 'S' ? f.maxZ - t : side === 'W' ? f.minX + t : f.maxX - t) : sideFace(bi, side)
  return { side, axis: side === 'N' || side === 'S' ? 'x' : 'z', face: surf, n: [nx * s, nz * s], yaw: inner ? sideYaw(side) + Math.PI : sideYaw(side) }
}

function fp(fc: Face, along: number, d: number): [number, number] {
  return fc.axis === 'x' ? [along, fc.face + fc.n[1] * d] : [fc.face + fc.n[0] * d, along]
}

function fbox(b: Batch, key: string, fc: Face, along: number, y0: number, h: number, w: number, depth: number, col: THREE.ColorRepresentation, gap = 0): void {
  const [x, z] = fp(fc, along, gap + depth / 2)
  if (fc.axis === 'x') b.box(key, x, y0 + h / 2, z, w, h, depth, col)
  else b.box(key, x, y0 + h / 2, z, depth, h, w, col)
}

function fquad(b: Batch, key: string, fc: Face, along: number, yc: number, w: number, h: number, uv: [number, number, number, number], col: THREE.ColorRepresentation, gap = 0.012): void {
  const [x, z] = fp(fc, along, gap)
  b.plane(key, x, yc, z, w, h, fc.yaw, uv, col)
}

/** Occupancy tracker for wall-mounted items (keeps decor from overlapping windows/doors). */
class WallSlots {
  private occ = new Map<DoorSide, { a0: number; a1: number; y0: number; y1: number }[]>()
  constructor(private bi: BuildingInfo) {
    for (const s of ['N', 'S', 'E', 'W'] as DoorSide[]) this.occ.set(s, [])
    const [d0, d1] = bi.def.doorSpan
    this.reserve(bi.def.doorSide, d0 - 0.45, d1 + 0.45, 0, bi.style.doorHeight + 0.4)
    for (const w of windowSpots(bi)) this.reserve(w.side, w.along - w.w / 2 - 0.12, w.along + w.w / 2 + 0.12, w.y0 - 0.15, w.y0 + w.h + 0.15)
    for (const k of bi.style.keepClear) this.reserve(k.side, k.from, k.to, 0, bi.def.height)
  }
  reserve(side: DoorSide, a0: number, a1: number, y0: number, y1: number): void {
    this.occ.get(side)!.push({ a0, a1, y0, y1 })
  }
  free(side: DoorSide, a0: number, a1: number, y0: number, y1: number): boolean {
    return !this.occ.get(side)!.some((o) => a0 < o.a1 && a1 > o.a0 && y0 < o.y1 && y1 > o.y0)
  }
  /** Find a free span of width w at [y0, y1] nearest to `prefer`; reserves it. */
  find(side: DoorSide, w: number, y0: number, y1: number, prefer: number, margin = 0.25): number | null {
    const f = this.bi.def.footprint
    const lo = (side === 'N' || side === 'S' ? f.minX : f.minZ) + w / 2 + 0.7
    const hi = (side === 'N' || side === 'S' ? f.maxX : f.maxZ) - w / 2 - 0.7
    if (hi < lo) return null
    const cands: number[] = []
    for (let a = lo; a <= hi + 1e-6; a += 0.25) cands.push(a)
    cands.sort((p, q) => Math.abs(p - prefer) - Math.abs(q - prefer))
    for (const c of cands) {
      if (this.free(side, c - w / 2 - margin, c + w / 2 + margin, y0, y1)) {
        this.reserve(side, c - w / 2, c + w / 2, y0, y1)
        return c
      }
    }
    return null
  }
}

export function addBuildings(ctx: BuildCtx): void {
  for (const bi of BUILDINGS) addBuilding(ctx, bi)
}

function addBuilding(ctx: BuildCtx, bi: BuildingInfo): void {
  const { b, atlas } = ctx
  const rng = createRng(bi.id.length * 977 + bi.def.footprint.minX * 13)
  const f = bi.def.footprint
  const i = bi.def.interior
  const H = bi.def.height
  const st = bi.style
  const wallKey = st.wall
  const [d0, d1] = bi.def.doorSpan
  const doorSide = bi.def.doorSide
  const dc = (d0 + d1) / 2
  const span = d1 - d0
  const doorH = st.doorHeight
  const slots = new WallSlots(bi)
  const outer = (s: DoorSide) => face(bi, s, false)
  const inner = (s: DoorSide) => face(bi, s, true)
  const sides: DoorSide[] = ['N', 'S', 'E', 'W']
  const trimDark = new THREE.Color(st.trimColor).multiplyScalar(0.55)

  // --- walls ---------------------------------------------------------------
  for (const w of wallBoxes(bi)) b.boxMinMax(wallKey, w.rect.minX, w.y0, w.rect.minZ, w.rect.maxX, w.y1, w.rect.maxZ, st.wallColor)

  // --- plinth, corners, eave band ----------------------------------------
  for (const s of sides) {
    const fc = outer(s)
    const [lo, hi] = s === 'N' || s === 'S' ? [f.minX - 0.07, f.maxX + 0.07] : [f.minZ, f.maxZ]
    const pieces: [number, number][] = s === doorSide ? [[lo, d0], [d1, hi]] : [[lo, hi]]
    for (const [a, c] of pieces) if (c - a > 0.05) fbox(b, 'concrete', fc, (a + c) / 2, 0, 0.55, c - a, 0.07, CONCRETE)
    fbox(b, 'paint', fc, (lo + hi) / 2, H - 0.34, 0.34, hi - lo + 0.14, 0.1, trimDark)
  }
  for (const [cx, cz] of [
    [f.minX, f.minZ],
    [f.maxX, f.minZ],
    [f.minX, f.maxZ],
    [f.maxX, f.maxZ],
  ])
    b.box('paint', cx, H / 2, cz, 0.3, H, 0.3, st.trimColor)

  // --- door ---------------------------------------------------------------
  const of = outer(doorSide)
  const inf = inner(doorSide)
  fbox(b, 'paint', of, dc, doorH, 0.3, span + 0.56, 0.14, st.trimColor)
  fbox(b, 'hazard', of, d0 - 0.14, 0, doorH, 0.28, 0.14, '#ffffff')
  fbox(b, 'hazard', of, d1 + 0.14, 0, doorH, 0.28, 0.14, '#ffffff')
  if (st.door === 'rollup') {
    // partly lowered curtain (slats) in the opening, drum on the inside
    for (let k = 0; k < 4; k++) {
      const y = doorH - 0.24 - k * 0.235
      fbox(b, k === 3 ? 'hazard' : 'paint', of, dc, y, 0.2, span, 0.07, k === 3 ? '#ffffff' : '#7E8A8F', -bi.t / 2 - 0.035)
    }
    fbox(b, 'paint', inf, dc, doorH + 0.02, 0.6, span + 0.5, 0.6, '#5E686C', 0.02)
    fbox(b, 'paint', inf, d0 + 0.08, 0, doorH, 0.16, 0.18, DARK, 0.02)
    fbox(b, 'paint', inf, d1 - 0.08, 0, doorH, 0.16, 0.18, DARK, 0.02)
  } else if (st.door === 'glass') {
    // canopy + tie rods + downlights, aluminium frame inside the opening
    fbox(b, 'paint', of, dc, doorH + 0.32, 0.2, span + 1.3, 1.55, st.trimColor)
    fbox(b, 'paint', of, dc, doorH + 0.22, 0.32, span + 1.3, 0.08, trimDark, 1.5)
    for (const a of [d0 - 0.4, d1 + 0.4]) {
      const [x0, z0] = fp(of, a, 1.45)
      const [x1, z1] = fp(of, a, 0.02)
      b.cylBetween('metal', [x0, doorH + 0.5, z0], [x1, doorH + 1.55, z1], 0.03, ALU, 6)
    }
    for (const a of [dc - span * 0.25, dc + span * 0.25]) {
      const [x, z] = fp(of, a, 0.85)
      b.box('glow', x, doorH + 0.21, z, 0.32, 0.02, 0.32, new THREE.Color('#FFE6BE').multiplyScalar(2.6))
    }
    fbox(b, 'metal', of, d0 + 0.05, 0, doorH, 0.1, 0.12, ALU, -0.2)
    fbox(b, 'metal', of, d1 - 0.05, 0, doorH, 0.1, 0.12, ALU, -0.2)
    fbox(b, 'metal', of, dc, doorH - 0.12, 0.12, span, 0.12, ALU, -0.2)
  } else if (st.door === 'storefront') {
    // striped awning sloping out over the open front + valance
    const depth = 1.75
    const yTop = doorH + 0.32
    const yLow = doorH - 0.12
    const slope = Math.atan2(yTop - yLow, depth)
    const len = Math.hypot(depth, yTop - yLow)
    const n = 12
    const stripeW = (span + 0.8) / n
    for (let k = 0; k < n; k++) {
      const a = d0 - 0.4 + stripeW * (k + 0.5)
      const [x, z] = fp(of, a, depth / 2)
      const col = k % 2 ? PALETTE.cream : bi.zone.color
      // rotate so the fabric slopes down away from the wall
      const rx = of.axis === 'z' ? 0 : of.n[1] > 0 ? slope : -slope
      const rz = of.axis === 'z' ? (of.n[0] > 0 ? -slope : slope) : 0
      const wx = of.axis === 'z' ? len : stripeW
      const wz = of.axis === 'z' ? stripeW : len
      b.box('paint', x, (yTop + yLow) / 2, z, wx, 0.05, wz, col, 0, rx, rz)
      // scalloped valance
      const [vx, vz] = fp(of, a, depth + 0.02)
      if (of.axis === 'z') b.box('paint', vx, yLow - 0.16, vz, 0.04, 0.32, stripeW * 0.92, col)
      else b.box('paint', vx, yLow - 0.16, vz, stripeW * 0.92, 0.32, 0.04, col)
    }
    for (const a of [d0 - 0.3, dc, d1 + 0.3]) {
      const [x0, z0] = fp(of, a, depth - 0.05)
      const [x1, z1] = fp(of, a, 0.02)
      b.cylBetween('metal', [x0, yLow + 0.02, z0], [x1, yTop + 0.55, z1], 0.035, STEEL, 6)
    }
    fbox(b, 'metal', of, d0 + 0.05, 0, doorH, 0.12, 0.12, STEEL, -0.15)
    fbox(b, 'metal', of, d1 - 0.05, 0, doorH, 0.12, 0.12, STEEL, -0.15)
  }

  // --- windows ------------------------------------------------------------
  for (const w of windowSpots(bi)) {
    const fo = outer(w.side)
    const fi = inner(w.side)
    const yc = w.y0 + w.h / 2
    const dim = 0.72 + rng() * 0.38
    fquad(b, 'window', fo, w.along, yc, w.w, w.h, FULL, new THREE.Color('#ffffff').multiplyScalar(dim), 0.02)
    const fr = '#2C3234'
    fbox(b, 'paint', fo, w.along, w.y0 + w.h - 0.02, 0.09, w.w + 0.14, 0.07, fr)
    fbox(b, 'paint', fo, w.along, w.y0 - 0.06, 0.08, w.w + 0.14, 0.07, fr)
    fbox(b, 'paint', fo, w.along - w.w / 2 - 0.03, w.y0, w.h, 0.08, 0.07, fr)
    fbox(b, 'paint', fo, w.along + w.w / 2 + 0.03, w.y0, w.h, 0.08, 0.07, fr)
    fbox(b, 'concrete', fo, w.along, w.y0 - 0.17, 0.11, w.w + 0.3, 0.17, CONCRETE)
    if (st.wall === 'brick') fbox(b, 'concrete', fo, w.along, w.y0 + w.h + 0.06, 0.16, w.w + 0.3, 0.05, CONCRETE)
    fquad(b, 'window', fi, w.along, yc, w.w, w.h, FULL, new THREE.Color('#C4DBFF').multiplyScalar(1.15), 0.07)
  }

  // --- interior lining, wainscot, trusses, lamps ---------------------------
  for (const w of wallBoxes(bi)) {
    const fi = inner(w.side)
    const r = w.rect
    let a0 = fi.axis === 'x' ? r.minX : r.minZ
    let a1 = fi.axis === 'x' ? r.maxX : r.maxZ
    if (fi.axis === 'x') {
      a0 = Math.max(a0, i.minX)
      a1 = Math.min(a1, i.maxX)
    }
    if (a1 - a0 < 0.05) continue
    const y0 = w.y0
    const y1 = Math.min(w.y1, H - 0.05)
    fbox(b, 'brick', fi, (a0 + a1) / 2, y0, y1 - y0, a1 - a0, 0.04, st.liningColor)
    if (w.kind === 'wall') {
      fbox(b, 'paint', fi, (a0 + a1) / 2, 0, 1.15, a1 - a0, 0.05, st.wainscotColor, 0.04)
      fbox(b, 'paint', fi, (a0 + a1) / 2, 1.15, 0.06, a1 - a0, 0.07, DARK, 0.04)
    }
  }
  const spanX = i.maxX - i.minX
  const spanZ = i.maxZ - i.minZ
  const beamsAlongX = spanX < spanZ // beams span the short dimension
  const nBeams = Math.max(2, Math.round((beamsAlongX ? spanZ : spanX) / 4.2))
  for (let k = 1; k <= nBeams; k++) {
    const t = k / (nBeams + 1)
    const yb = H - 0.45
    if (beamsAlongX) {
      const z = i.minZ + spanZ * t
      b.box('paint', (i.minX + i.maxX) / 2, yb, z, spanX, 0.32, 0.18, STEEL)
      for (const u of [0.3, 0.7]) addLamp(b, i.minX + spanX * u, yb - 0.16, z)
    } else {
      const x = i.minX + spanX * t
      b.box('paint', x, yb, (i.minZ + i.maxZ) / 2, 0.18, 0.32, spanZ, STEEL)
      for (const u of [0.3, 0.7]) addLamp(b, x, yb - 0.16, i.minZ + spanZ * u)
    }
  }

  // --- sign + gooseneck lamps --------------------------------------------
  const ss = buildingSignSpot(bi)
  slots.reserve(doorSide, ss.along - ss.w / 2 - 1.0, ss.along + ss.w / 2 + 1.0, ss.y0 - 0.2, ss.y0 + ss.h + 1.1)
  fbox(b, 'paint', of, ss.along, ss.y0 - 0.08, ss.h + 0.16, ss.w + 0.18, 0.1, '#1B2020', 0.02)
  const cell = atlas.cells[`bldg:${bi.id}`]
  if (cell) fquad(b, 'sign', of, ss.along, ss.y0 + ss.h / 2, ss.w, ss.h, cell.uv, '#ffffff', 0.125)
  const nLamps = Math.max(2, Math.round(ss.w / 2.8))
  for (let k = 0; k < nLamps; k++) {
    const a = ss.along - ss.w / 2 + (ss.w * (k + 0.5)) / nLamps
    const yb = ss.y0 + ss.h + 0.5
    const [x0, z0] = fp(of, a, 0.02)
    const [x1, z1] = fp(of, a, 0.55)
    b.cylBetween('metal', [x0, yb - 0.25, z0], [x1, yb, z1], 0.025, DARK, 5)
    b.cylBetween('paint', [x1, yb + 0.02, z1], [x1, yb - 0.16, z1], 0.11, DARK, 8)
    b.box('glow', x1, yb - 0.17, z1, 0.15, 0.02, 0.15, new THREE.Color('#FFE2B0').multiplyScalar(3))
  }

  // --- beacon brackets (bulbs are instanced by <Beacons>) -------------------
  for (const bc of [...ZONE_BEACONS, ...EMERGENCY_BEACONS]) {
    if (bc.building !== bi.id) continue
    b.cylY('paint', bc.x, bc.y - 0.3, bc.z, 0.11, 0.16, DARK, 8)
    const [wx, wz] = fp(of, of.axis === 'x' ? bc.x : bc.z, 0)
    b.cylBetween('metal', [wx, bc.y - 0.42, wz], [bc.x, bc.y - 0.24, bc.z], 0.03, DARK, 5)
  }

  // --- number stencil, posters, panels, extinguisher ------------------------
  const numCell = atlas.cells[`num:${bi.id}`]
  if (numCell) {
    for (const s of ['S', 'W', 'N', 'E'] as DoorSide[]) {
      if (s === doorSide) continue
      const [lo, hi] = sideRange(bi, s)
      const a = slots.find(s, 3.0, 2.2, 3.8, (lo + hi) / 2)
      if (a !== null) {
        fquad(b, 'poster', outer(s), a, 3.0, 3.0, 1.5, numCell.uv, '#ffffff', 0.02)
        break
      }
    }
  }
  const nPosters = 2
  for (let k = 0; k < nPosters; k++) {
    const p = POSTERS[Math.floor(rng() * POSTERS.length)]
    const pc = atlas.cells[`poster:${p.id}`]
    if (!pc) continue
    const prefer = k === 0 ? d0 - 1.6 : d1 + 1.6
    const a = slots.find(doorSide, 0.72, 1.25, 2.3, prefer, 0.15)
    if (a === null) continue
    fbox(b, 'paint', of, a, 1.27, 1.0, 0.74, 0.03, '#d8d2c2', 0.01)
    fquad(b, 'poster', of, a, 1.77, 0.68, 0.95, pc.uv, '#ffffff', 0.045)
  }
  {
    const a = slots.find(doorSide, 0.8, 0.9, 2.2, d1 + 2.6)
    if (a !== null) {
      fbox(b, 'paint', of, a, 1.0, 1.1, 0.75, 0.22, '#8E979A')
      fbox(b, 'paint', of, a + 0.2, 0.98, 0.04, 0.06, 0.04, '#E9B63F', 0.22)
      const [x, z] = fp(of, a, 0.08)
      b.cylBetween('metal', [x, 2.1, z], [x, H - 0.4, z], 0.035, '#7A8487', 6)
    }
    const e = slots.find(doorSide, 0.5, 0.8, 1.7, d0 - 2.4)
    if (e !== null) {
      fbox(b, 'paint', of, e, 0.85, 0.8, 0.5, 0.2, '#C8302A')
      fbox(b, 'glow', of, e, 1.42, 0.12, 0.36, 0.01, new THREE.Color('#ffffff').multiplyScalar(1.4), 0.2)
    }
  }

  // --- downpipes (+ gutters on pitched roofs) -------------------------------
  const corners: [DoorSide, number][] = [
    ['N', f.minX + 0.45],
    ['N', f.maxX - 0.45],
    ['S', f.minX + 0.45],
    ['S', f.maxX - 0.45],
  ]
  for (const [s, a] of corners) {
    if (!slots.free(s, a - 0.15, a + 0.15, 0, H)) continue
    slots.reserve(s, a - 0.15, a + 0.15, 0, H)
    const fc = outer(s)
    const [x, z] = fp(fc, a, 0.14)
    b.cylY('metal', x, 0.32, z, 0.075, H - 0.5, '#7C878A', 8)
    const [x2, z2] = fp(fc, a, 0.42)
    b.cylBetween('metal', [x, 0.36, z], [x2, 0.1, z2], 0.075, '#7C878A', 8)
    for (let y = 1.2; y < H - 0.5; y += 1.6) b.box('paint', x, y, z, 0.2, 0.06, 0.2, DARK)
    if (bi.def.roof === 'flat') fbox(b, 'paint', fc, a, H - 0.75, 0.22, 0.34, 0.3, DARK)
  }
  if (bi.def.roof !== 'flat') for (const s of ['N', 'S'] as DoorSide[]) b.box('metal', ...gutter(outer(s), f, H, s), '#8A9497')

  // --- wall pipes with valves + cable tray + wall fans ---------------------
  const pipeSide = (['S', 'N', 'W', 'E'] as DoorSide[]).find((s) => s !== doorSide)!
  const pipeCol = PIPE_COLORS[Math.floor(rng() * PIPE_COLORS.length)]
  {
    const [lo, hi] = sideRange(bi, pipeSide)
    const a = slots.find(pipeSide, 0.5, 0, H - 0.6, lo + (hi - lo) * 0.3)
    if (a !== null) {
      const fc = outer(pipeSide)
      const [x, z] = fp(fc, a, 0.28)
      const yTop = Math.min(H - 0.9, 4.4)
      b.cylY('metal', x, 0, z, 0.13, yTop, pipeCol, 10)
      for (let y = 0.6; y < yTop; y += 1.4) b.cylY('metal', x, y, z, 0.18, 0.08, pipeCol, 10)
      // valve wheel at hand height
      const [vx, vz] = fp(fc, a, 0.48)
      b.cylBetween('metal', [x, 1.35, z], [vx, 1.35, vz], 0.04, '#666', 6)
      b.torus('metal', vx, 1.35, vz, 0.22, 0.03, '#C8302A', fc.axis === 'x' ? 'z' : 'x')
      // horizontal run along the wall
      const runLen = Math.min(5.5, (hi - lo) * 0.45)
      const dir = a + runLen < hi - 0.8 ? 1 : -1
      if (slots.free(pipeSide, Math.min(a, a + dir * runLen), Math.max(a, a + dir * runLen), yTop - 0.3, yTop + 0.3)) {
        slots.reserve(pipeSide, Math.min(a, a + dir * runLen), Math.max(a, a + dir * runLen), yTop - 0.3, yTop + 0.3)
        const [x2, z2] = fp(fc, a + dir * runLen, 0.28)
        b.cylBetween('metal', [x, yTop, z], [x2, yTop, z2], 0.13, pipeCol, 10)
        b.sphere('metal', x, yTop, z, 0.15, pipeCol, 8, 6)
        for (let k = 1; k * 1.8 < runLen; k++) {
          const [fx, fz] = fp(fc, a + dir * k * 1.8, 0.28)
          b.cylBetween('metal', [fx - (fc.axis === 'x' ? 0.04 : 0), yTop, fz - (fc.axis === 'z' ? 0.04 : 0)], [fx + (fc.axis === 'x' ? 0.04 : 0), yTop, fz + (fc.axis === 'z' ? 0.04 : 0)], 0.19, pipeCol, 10)
          const [bx2, bz2] = fp(fc, a + dir * k * 1.8, 0.1)
          b.box('paint', bx2, yTop - 0.18, bz2, 0.08, 0.36, 0.08, DARK)
        }
      }
    }
  }
  const traySide = (['N', 'S', 'E', 'W'] as DoorSide[]).filter((s) => s !== doorSide).sort((p, q) => {
    const [a0, a1] = sideRange(bi, p)
    const [b0, b1] = sideRange(bi, q)
    return b1 - b0 - (a1 - a0)
  })[0]
  {
    const [lo, hi] = sideRange(bi, traySide)
    const yT = H - 1.25
    if (slots.free(traySide, lo + 0.6, hi - 0.6, yT - 0.2, yT + 0.2)) {
      slots.reserve(traySide, lo + 0.6, hi - 0.6, yT - 0.2, yT + 0.2)
      const fc = outer(traySide)
      fbox(b, 'metal', fc, (lo + hi) / 2, yT, 0.12, hi - lo - 1.2, 0.42, '#8D979A', 0.05)
      for (let a = lo + 0.8; a < hi - 0.6; a += 1.5) fbox(b, 'paint', fc, a, yT - 0.14, 0.14, 0.06, 0.48, DARK)
    }
  }
  if (bi.style.wall === 'corr' && (bi.id === 'maintenance' || bi.id === 'warehouse' || bi.id === 'server' || bi.id === 'rnd')) {
    for (const s of (['W', 'N', 'S', 'E'] as DoorSide[]).filter((q) => q !== doorSide)) {
      const [lo, hi] = sideRange(bi, s)
      const a = slots.find(s, 1.5, H - 3.2, H - 1.5, (lo + hi) / 2 + (rng() - 0.5) * 3)
      if (a === null) continue
      const fc = outer(s)
      fbox(b, 'paint', fc, a, H - 3.1, 1.4, 1.4, 0.32, '#4A5357')
      const [x, z] = fp(fc, a, 0.36)
      b.torus('metal', x, H - 2.4, z, 0.6, 0.05, '#2A2F31', fc.axis === 'x' ? 'z' : 'x')
      ctx.spinners.push({ kind: 'fan', x, y: H - 2.4, z, yaw: fc.yaw, vertical: false, radius: 0.58, speed: 5 + rng() * 3 })
      break
    }
  }

  // wall packs over the door corners
  for (const a of [d0 - 0.6, d1 + 0.6]) {
    const [x, z] = fp(of, a, 0.18)
    b.box('paint', x, doorH + 0.75, z, of.axis === 'x' ? 0.38 : 0.36, 0.26, of.axis === 'x' ? 0.36 : 0.38, DARK)
    const [gx, gz] = fp(of, a, 0.2)
    b.box('glow', gx, doorH + 0.615, gz, 0.26, 0.02, 0.26, new THREE.Color('#FFE6BE').multiplyScalar(2.4))
  }

  // --- roof -----------------------------------------------------------------
  const rb = new Batch({ corr: 1.6, paint: 3, window: 2, brick: 1.6 })
  ctx.roofs.set(bi.id, rb)
  if (bi.def.roof === 'flat') flatRoof(ctx, rb, bi, rng)
  else if (bi.def.roof === 'sawtooth') sawtoothRoof(ctx, rb, bi, rng)
  else gableRoof(ctx, rb, bi, rng)
}

function gutter(fc: Face, f: { minX: number; maxX: number; minZ: number; maxZ: number }, H: number, s: DoorSide): [number, number, number, number, number, number] {
  void s
  if (fc.axis === 'x') return [(f.minX + f.maxX) / 2, H - 0.05, fc.face + fc.n[1] * 0.12, f.maxX - f.minX + 0.3, 0.16, 0.2]
  return [fc.face + fc.n[0] * 0.12, H - 0.05, (f.minZ + f.maxZ) / 2, 0.2, 0.16, f.maxZ - f.minZ + 0.3]
}

function addLamp(b: Batch, x: number, y: number, z: number): void {
  b.cylBetween('metal', [x, y, z], [x, y - 0.75, z], 0.015, DARK, 4)
  b.cylY('paint', x, y - 1.02, z, 0.36, 0.28, '#3A4244', 10, 0.12)
  b.cylY('glow', x, y - 1.04, z, 0.3, 0.02, new THREE.Color('#FFE4B5').multiplyScalar(3.2), 10)
}

// ---------------------------------------------------------------------------
// Roofs
// ---------------------------------------------------------------------------

function hvac(ctx: BuildCtx, rb: Batch, bi: BuildingInfo, x: number, y: number, z: number, rot: boolean): void {
  const w = rot ? 1.3 : 2.3
  const d = rot ? 2.3 : 1.3
  rb.boxB('paint', x, y, z, w, 1.25, d, '#9AA3A5')
  rb.boxB('paint', x, y + 1.25, z, w + 0.06, 0.06, d + 0.06, '#7E878A')
  // louvers
  for (let k = 0; k < 4; k++) rb.box('paint', x + (rot ? w / 2 + 0.01 : -w / 2 + 0.35 + k * 0.5), y + 0.62, z + (rot ? -d / 2 + 0.35 + k * 0.5 : d / 2 + 0.01), rot ? 0.02 : 0.32, 0.8, rot ? 0.32 : 0.02, '#4E575A')
  const fx = x + (rot ? 0 : -w / 4)
  const fz = z + (rot ? -d / 4 : 0)
  rb.cylY('paint', fx, y + 1.25, fz, 0.52, 0.2, '#353B3D', 14, undefined, true)
  ctx.spinners.push({ kind: 'fan', x: fx, y: y + 1.38, z: fz, yaw: 0, vertical: true, radius: 0.48, speed: 7 + (x % 3), building: bi.id })
  // duct into the roof
  rb.boxB('paint', x + (rot ? 0 : w / 4), y - 0.05, z + (rot ? d / 4 : 0), 0.5, 0.3, 0.5, '#868F92')
}

function stack(ctx: BuildCtx, rb: Batch, bi: BuildingInfo, x: number, y: number, z: number, h: number, r: number, steam: boolean): void {
  rb.cylY('paint', x, y, z, r, h, '#6E777A', 10)
  rb.cylY('paint', x, y + h, z, r * 1.6, 0.08, '#4A5154', 10)
  rb.cylY('paint', x, y + h + 0.22, z, r * 1.7, 0.08, '#4A5154', 10, r * 0.4)
  for (let k = 0; k < 3; k++) rb.cylBetween('metal', [x, y + h * 0.55, z], [x + Math.cos(k * 2.1) * 0.9, y + 0.02, z + Math.sin(k * 2.1) * 0.9], 0.015, '#3A4042', 4)
  if (steam) ctx.steam.push({ kind: 'exhaust', x, y: y + h + 0.3, z, building: bi.id })
}

function flatRoof(ctx: BuildCtx, rb: Batch, bi: BuildingInfo, rng: () => number): void {
  const f = bi.def.footprint
  const H = bi.def.height
  const st = bi.style
  const top = H + 0.18
  rb.boxMinMax('paint', f.minX + 0.05, H - 0.1, f.minZ + 0.05, f.maxX - 0.05, top, f.maxZ - 0.05, '#6E7476')
  // parapet + coping
  const ph = 0.85
  const pt = 0.25
  const pc = st.wallColor
  const pk = st.wall === 'brick' ? 'brick' : 'corr'
  rb.boxMinMax(pk, f.minX, H, f.minZ, f.maxX, top + ph, f.minZ + pt, pc)
  rb.boxMinMax(pk, f.minX, H, f.maxZ - pt, f.maxX, top + ph, f.maxZ, pc)
  rb.boxMinMax(pk, f.minX, H, f.minZ + pt, f.minX + pt, top + ph, f.maxZ - pt, pc)
  rb.boxMinMax(pk, f.maxX - pt, H, f.minZ + pt, f.maxX, top + ph, f.maxZ - pt, pc)
  const cc = '#B9B6AA'
  rb.boxMinMax('paint', f.minX - 0.05, top + ph, f.minZ - 0.05, f.maxX + 0.05, top + ph + 0.08, f.minZ + pt + 0.05, cc)
  rb.boxMinMax('paint', f.minX - 0.05, top + ph, f.maxZ - pt - 0.05, f.maxX + 0.05, top + ph + 0.08, f.maxZ + 0.05, cc)
  rb.boxMinMax('paint', f.minX - 0.05, top + ph, f.minZ + pt, f.minX + pt + 0.05, top + ph + 0.08, f.maxZ - pt, cc)
  rb.boxMinMax('paint', f.maxX - pt - 0.05, top + ph, f.minZ + pt, f.maxX + 0.05, top + ph + 0.08, f.maxZ - pt, cc)
  // roof membrane seams
  for (let x = f.minX + 2; x < f.maxX - 1; x += 2) rb.boxMinMax('paint', x - 0.03, top, f.minZ + pt, x + 0.03, top + 0.03, f.maxZ - pt, '#5E6466')
  // units
  const w = f.maxX - f.minX
  const d = f.maxZ - f.minZ
  const nUnits = w * d > 150 ? 2 : 1
  for (let k = 0; k < nUnits; k++) {
    const x = f.minX + w * (0.3 + 0.4 * k) + (rng() - 0.5) * 1.2
    const z = f.minZ + d * (0.35 + rng() * 0.3)
    hvac(ctx, rb, bi, x, top, z, d > w)
  }
  stack(ctx, rb, bi, f.minX + w * 0.82, top, f.minZ + d * 0.22, 1.5, 0.2, true)
  stack(ctx, rb, bi, f.minX + w * 0.14, top, f.minZ + d * 0.78, 1.0, 0.14, false)
  rb.boxB('paint', f.minX + w * 0.6, top, f.minZ + d * 0.82, 1.0, 0.45, 1.0, '#7E878A')
  if (bi.id === 'control' || bi.id === 'radio') dish(rb, f.minX + w * 0.2, top, f.minZ + d * 0.3, bi.id === 'radio' ? 0.9 : 1.2)
  if (bi.id === 'rnd') {
    const x = f.minX + w * 0.25
    const z = f.minZ + d * 0.5
    rb.cylY('paint', x, top, z, 0.35, 0.5, '#5B6366', 10)
    rb.cylY('metal', x, top + 0.5, z, 0.12, 2.0, '#8D979A', 8)
    ctx.spinners.push({ kind: 'radar', x, y: top + 2.5, z, yaw: 0, vertical: true, radius: 1.3, speed: 0.6, building: bi.id })
    stack(ctx, rb, bi, f.minX + w * 0.55, top, f.minZ + d * 0.2, 2.6, 0.16, true)
    stack(ctx, rb, bi, f.minX + w * 0.62, top, f.minZ + d * 0.2, 2.6, 0.16, false)
  }
  if (bi.id === 'personnel' || bi.id === 'breakroom') {
    // little antenna + flag for the offices
    const x = f.minX + w * 0.5
    const z = f.minZ + d * 0.5
    rb.cylY('metal', x, top, z, 0.05, 3.4, '#9AA3A5', 6)
  }
}

let dishGeo: THREE.BufferGeometry | null = null
function dish(rb: Batch, x: number, y: number, z: number, r: number): void {
  if (!dishGeo) {
    const pts: THREE.Vector2[] = []
    for (let k = 0; k <= 8; k++) {
      const t = k / 8
      pts.push(new THREE.Vector2(t, t * t * 0.45))
    }
    dishGeo = new THREE.LatheGeometry(pts, 16)
  }
  rb.cylY('paint', x, y, z, 0.12, 0.9, '#8D979A', 6)
  rb.geo('paint', dishGeo, [x, y + 1.0, z], [-0.8, 2.4, 0], [r, r, r], '#D6D8D2')
  rb.cylBetween('metal', [x, y + 1.0, z], [x + Math.sin(2.4) * 0.5 * r, y + 1.6 * r, z + Math.cos(2.4) * 0.5 * r], 0.02, '#555', 4)
}

function sawtoothRoof(ctx: BuildCtx, rb: Batch, bi: BuildingInfo, rng: () => number): void {
  const f = bi.def.footprint
  const H = bi.def.height
  const st = bi.style
  const d = f.maxZ - f.minZ
  const n = Math.max(2, Math.round(d / 3.8))
  const p = d / n
  const rise = 1.9
  const len = f.maxX - f.minX
  const prism = prismGeometry(
    [
      [0, 0],
      [0, rise],
      [p, 0],
    ],
    len + 0.2,
  )
  for (let k = 0; k < n; k++) {
    const z0 = f.minZ + k * p
    rb.geo('corr', prism, [(f.minX + f.maxX) / 2, H, z0], [0, 0, 0], [1, 1, 1], st.roofColor)
    // north-facing glazing (glows like the windows)
    const nGl = Math.max(1, Math.round(len / 2.2))
    const gw = (len - 0.6) / nGl
    for (let g = 0; g < nGl; g++) {
      const x = f.minX + 0.3 + gw * (g + 0.5)
      rb.plane('window', x, H + rise * 0.52, z0 - 0.015, gw - 0.12, rise * 0.78, 0, FULL, new THREE.Color('#ffffff').multiplyScalar(0.8))
    }
    rb.box('paint', (f.minX + f.maxX) / 2, H + rise + 0.04, z0 + 0.05, len + 0.3, 0.1, 0.22, '#3E4547')
    // whirlybird on every other tooth
    if (k % 2 === 1) {
      const x = f.minX + len * (0.3 + rng() * 0.4)
      const zz = z0 + p * 0.55
      const yy = H + rise * (1 - 0.55) + 0.05
      rb.cylY('paint', x, yy, zz, 0.22, 0.35, '#7E878A', 10)
      ctx.spinners.push({ kind: 'turbine', x, y: yy + 0.35, z: zz, yaw: 0, vertical: true, radius: 0.3, speed: 2.2 + rng(), building: bi.id })
    }
  }
  // end fascia
  rb.boxMinMax('paint', f.minX - 0.12, H - 0.2, f.minZ - 0.12, f.maxX + 0.12, H + 0.05, f.maxZ + 0.12, '#40484A')
  stack(ctx, rb, bi, f.minX + len * 0.85, H + 0.4, f.minZ + d * 0.7, 2.2, 0.22, true)
}

function gableRoof(ctx: BuildCtx, rb: Batch, bi: BuildingInfo, rng: () => number): void {
  const f = bi.def.footprint
  const H = bi.def.height
  const st = bi.style
  // ridge runs perpendicular to the door side (door on a gable end)
  const ridgeAlongX = bi.def.doorSide === 'E' || bi.def.doorSide === 'W'
  const along = ridgeAlongX ? f.maxX - f.minX : f.maxZ - f.minZ
  const across = ridgeAlongX ? f.maxZ - f.minZ : f.maxX - f.minX
  const rise = across * 0.2
  const slope = Math.atan2(rise, across / 2)
  const half = Math.hypot(across / 2, rise) + 0.45
  const cx = (f.minX + f.maxX) / 2
  const cz = (f.minZ + f.maxZ) / 2
  const o = 0.4
  for (const s of [-1, 1]) {
    const mid = (across / 4) * s
    if (ridgeAlongX) rb.box('corr', cx, H + rise / 2 + 0.06, cz + mid + s * 0.2, along + o * 2, 0.12, half, st.roofColor, 0, s * slope, 0)
    else rb.box('corr', cx + mid + s * 0.2, H + rise / 2 + 0.06, cz, half, 0.12, along + o * 2, st.roofColor, 0, 0, -s * slope)
  }
  // ridge cap
  if (ridgeAlongX) rb.box('paint', cx, H + rise + 0.1, cz, along + o * 2, 0.16, 0.36, '#4A5154')
  else rb.box('paint', cx, H + rise + 0.1, cz, 0.36, 0.16, along + o * 2, '#4A5154')
  // gable-end triangles (wall color)
  const tri = prismGeometry(
    [
      [-across / 2, 0],
      [across / 2, 0],
      [0, rise],
    ],
    bi.t,
  )
  const key = st.wall === 'brick' ? 'brick' : 'corr'
  if (ridgeAlongX) {
    rb.geo(key, tri, [f.minX + bi.t / 2, H, cz], [0, 0, 0], [1, 1, 1], st.wallColor)
    rb.geo(key, tri, [f.maxX - bi.t / 2, H, cz], [0, 0, 0], [1, 1, 1], st.wallColor)
  } else {
    rb.geo(key, tri, [cx, H, f.minZ + bi.t / 2], [0, Math.PI / 2, 0], [1, 1, 1], st.wallColor)
    rb.geo(key, tri, [cx, H, f.maxZ - bi.t / 2], [0, Math.PI / 2, 0], [1, 1, 1], st.wallColor)
  }
  // ridge whirlybirds + a vent stack
  for (let k = 0; k < 3; k++) {
    const a = -along / 2 + (along * (k + 0.5)) / 3
    const x = ridgeAlongX ? cx + a : cx
    const z = ridgeAlongX ? cz : cz + a
    const y = H + rise + 0.12
    rb.cylY('paint', x, y, z, 0.24, 0.3, '#7E878A', 10)
    ctx.spinners.push({ kind: 'turbine', x, y: y + 0.3, z, yaw: 0, vertical: true, radius: 0.32, speed: 2 + rng() * 1.5, building: bi.id })
  }
  stack(ctx, rb, bi, ridgeAlongX ? cx - along * 0.3 : cx + across * 0.22, H + rise * 0.55, ridgeAlongX ? cz + across * 0.22 : cz - along * 0.3, 1.8, 0.18, true)
}

export { unitCylinder }
