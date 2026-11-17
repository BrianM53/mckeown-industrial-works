import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { Rect } from '@/core/types'
import type { QualityTier } from '@/core/types'
import { PATHS, RESTRICTED_ZONES, ZONES, type PathDef } from '@/world/layout'
import { ENV_PALETTE, PALETTE } from '@/world/palette'
import { BUILDINGS, doorApproach, type BuildingInfo } from '../data/buildings'
import { disjointUnion, rectsOverlap, subtractIntervals } from '../data/rects'
import { Batch } from '../lib/batch'
import { decalMaterial, envMats } from '../lib/envMaterials'
import { QUALITY } from '../config'
import { getFloorAtlas, type FloorAtlas } from './floorAtlas'

/**
 * Ground: concrete slab (procedural variation in the shader), asphalt roads,
 * worn floor paint (zone bands, walkways, intake mat), lane lines, hazard strips,
 * stencils/arrows/stains (one mask atlas) and building interior floors.
 * Layers are separated by small y offsets + polygonOffset (no z-fighting).
 */
const Y = { asphalt: 0.012, interior: 0.014, fill: 0.022, line: 0.027, hazard: 0.027, decal: 0.033 }

const LANE_KINDS: PathDef['kind'][] = ['aisle', 'avenue', 'road', 'spur', 'walkway']

const PARKING: Rect = { minX: 17.4, maxX: 30, minZ: 23.5, maxZ: 39.8 }
const APRON: Rect = { minX: -30, maxX: -18.2, minZ: 23.5, maxZ: 39.8 }
const GATE_ROAD: Rect = { minX: -4.6, maxX: 4.6, minZ: 39.8, maxZ: 640 }
const HIGHWAY: Rect = { minX: -700, maxX: 700, minZ: 92, maxZ: 104 }

const FLOOR_TILE: Record<string, number> = { carpet: 0.6, epoxy: 2.4, tile: 0.5, raised: 0.6, lab: 0.6, wood: 0.9, concrete: 3 }

interface GroundGeo {
  asphalt: THREE.BufferGeometry | null
  fill: THREE.BufferGeometry | null
  line: THREE.BufferGeometry | null
  hazard: THREE.BufferGeometry | null
  decal: THREE.BufferGeometry | null
  interior: THREE.BufferGeometry | null
  wet: THREE.BufferGeometry | null
}

function zoneColorFor(p: PathDef): string {
  const id = p.id.replace('spur-', '')
  const z = (ZONES as Record<string, { color: string }>)[id]
  return z ? z.color : PALETTE.hazard
}

/** Line along an axis-aligned segment (u across, v along with 2 m tiling). */
function lineQuad(b: Batch, key: string, axis: 'x' | 'z', fixed: number, a0: number, a1: number, width: number, color: THREE.ColorRepresentation, y: number): void {
  const len = a1 - a0
  if (len < 0.05) return
  const mid = (a0 + a1) / 2
  if (axis === 'x') b.floorQuad(key, mid, y, fixed, width, len, -Math.PI / 2, null, color, [1, len / 2])
  else b.floorQuad(key, fixed, y, mid, width, len, 0, null, color, [1, len / 2])
}

function fillRect(b: Batch, key: string, r: Rect, color: THREE.ColorRepresentation, y: number, tile = 3): void {
  const w = r.maxX - r.minX
  const d = r.maxZ - r.minZ
  if (w <= 0.01 || d <= 0.01) return
  b.floorQuad(key, (r.minX + r.maxX) / 2, y, (r.minZ + r.maxZ) / 2, w, d, 0, null, color, [w / tile, d / tile])
}

function decal(b: Batch, atlas: FloorAtlas, cell: string, x: number, z: number, w: number, d: number, yaw: number, color: THREE.ColorRepresentation): void {
  const c = atlas.cells[cell]
  if (!c) return
  b.floorQuad('decal', x, Y.decal, z, w, d, yaw, c.uv, color)
}

/** Text stencil sized from the atlas cell aspect: `h` = letter band depth (m). */
function stencil(b: Batch, atlas: FloorAtlas, cell: string, x: number, z: number, h: number, yaw: number, color: THREE.ColorRepresentation, maxW = 99): void {
  const c = atlas.cells[cell]
  if (!c) return
  let w = (c.w / c.h) * h
  let hh = h
  if (w > maxW) {
    hh = (h * maxW) / w
    w = maxW
  }
  b.floorQuad('decal', x, Y.decal, z, w, hh, yaw, c.uv, color)
}

function pathAxis(p: PathDef): 'x' | 'z' {
  if (p.arrow) return Math.abs(p.arrow[0]) > Math.abs(p.arrow[1]) ? 'x' : 'z'
  return p.rect.maxX - p.rect.minX >= p.rect.maxZ - p.rect.minZ ? 'x' : 'z'
}

function buildGround(atlas: FloorAtlas): GroundGeo {
  const b = new Batch()
  const white = new THREE.Color(ENV_PALETTE.laneWhite)
  const yellow = new THREE.Color(ENV_PALETTE.laneYellow)

  // ---- asphalt -------------------------------------------------------------
  const asphaltRects = [...PATHS.filter((p) => p.kind === 'avenue' || p.kind === 'road').map((p) => p.rect), PARKING, APRON, GATE_ROAD, HIGHWAY]
  for (const r of disjointUnion(asphaltRects)) fillRect(b, 'asphalt', r, ENV_PALETTE.asphalt, Y.asphalt)

  // ---- lane lines (clipped where other paths join) ---------------------------
  const lanes = PATHS.filter((p) => LANE_KINDS.includes(p.kind))
  for (const p of lanes) {
    const axis = pathAxis(p)
    const r = p.rect
    const lo = axis === 'x' ? r.minX : r.minZ
    const hi = axis === 'x' ? r.maxX : r.maxZ
    const sideLo = axis === 'x' ? r.minZ : r.minX
    const sideHi = axis === 'x' ? r.maxZ : r.maxX
    const inset = p.kind === 'spur' ? 0.18 : 0.25
    const width = p.kind === 'aisle' ? 0.16 : p.kind === 'walkway' ? 0.1 : 0.13
    const col = p.kind === 'aisle' ? yellow : p.kind === 'spur' ? new THREE.Color(zoneColorFor(p)) : white
    for (const fixed of [sideLo + inset, sideHi - inset]) {
      const band: Rect =
        axis === 'x' ? { minX: lo, maxX: hi, minZ: fixed - 0.4, maxZ: fixed + 0.4 } : { minX: fixed - 0.4, maxX: fixed + 0.4, minZ: lo, maxZ: hi }
      const cuts: [number, number][] = []
      for (const q of PATHS) {
        if (q === p || q.kind === 'plaza') continue
        if (!rectsOverlap(band, q.rect, -0.01)) continue
        // a parallel overlapping lane (e.g. walkway inside the production zone) only cuts where it crosses
        cuts.push(axis === 'x' ? [q.rect.minX, q.rect.maxX] : [q.rect.minZ, q.rect.maxZ])
      }
      for (const bd of BUILDINGS) if (rectsOverlap(band, bd.def.footprint)) cuts.push(axis === 'x' ? [bd.def.footprint.minX, bd.def.footprint.maxX] : [bd.def.footprint.minZ, bd.def.footprint.maxZ])
      for (const [a, c] of subtractIntervals(lo, hi, cuts, 0.4)) lineQuad(b, 'line', axis, fixed, a, c, width, col, Y.line)
    }
    // dashed center lines on two-way roads
    if (p.kind === 'road') {
      const fixed = (sideLo + sideHi) / 2
      const band: Rect = axis === 'x' ? { minX: lo, maxX: hi, minZ: fixed - 0.4, maxZ: fixed + 0.4 } : { minX: fixed - 0.4, maxX: fixed + 0.4, minZ: lo, maxZ: hi }
      const cuts: [number, number][] = []
      for (const q of PATHS) {
        if (q === p || q.kind === 'plaza') continue
        if (rectsOverlap(band, q.rect)) cuts.push(axis === 'x' ? [q.rect.minX - 1.2, q.rect.maxX + 1.2] : [q.rect.minZ - 1.2, q.rect.maxZ + 1.2])
      }
      for (const [a, c] of subtractIntervals(lo + 1, hi - 1, cuts, 1)) {
        for (let s = a; s < c - 0.6; s += 4.2) lineQuad(b, 'line', axis, fixed, s, Math.min(c, s + 2.2), 0.12, yellow, Y.line)
      }
    }
  }

  // ---- walkways: green fill + pedestrian stencils -----------------------------
  for (const p of PATHS.filter((q) => q.kind === 'walkway')) {
    const r = p.rect
    fillRect(b, 'fill', { minX: r.minX + 0.3, maxX: r.maxX - 0.3, minZ: r.minZ + 0.2, maxZ: r.maxZ - 0.2 }, ENV_PALETTE.walkway, Y.fill)
    const cx = (r.minX + r.maxX) / 2
    for (const z of [r.maxZ - 2.2, (r.minZ + r.maxZ) / 2, r.minZ + 2.2]) decal(b, atlas, 'ped', cx, z, 1.1, 1.1, 0, white)
    stencil(b, atlas, 'walkway', cx, r.maxZ - 4.4, 0.45, 0, white, 2.2)
  }

  // ---- building thresholds: zone band + hazard strip + interior floor ---------
  for (const bd of BUILDINGS) buildThreshold(b, bd)

  // ---- intake: welcome mat, spawn ring, stencils -------------------------------
  const teal = '#3E6E6A'
  fillRect(b, 'fill', { minX: -2.6, maxX: 2.6, minZ: 27.4, maxZ: 38.9 }, teal, Y.fill, 2)
  for (const x of [-2.6, 2.6]) lineQuad(b, 'line', 'z', x, 27.4, 38.9, 0.12, PALETTE.cream, Y.line)
  lineQuad(b, 'line', 'x', 27.4, -2.6, 2.6, 0.12, PALETTE.cream, Y.line)
  decal(b, atlas, 'spawn', 0, 32, 2.7, 2.7, 0, PALETTE.cream)
  stencil(b, atlas, 'intake', 0, 28.9, 0.95, 0, PALETTE.cream, 4.9)
  decal(b, atlas, 'chevrons', 0, 25.6, 1.4, 1.75, 0, white)
  stencil(b, atlas, 'mainAisle', 0, 23.9, 0.5, 0, yellow, 3.2)

  // ---- main aisle / production -----------------------------------------------
  stencil(b, atlas, 'production', 0, 18.0, 0.62, 0, white, 5.2)
  for (const z of [14.6, 7.0, 0.8]) decal(b, atlas, 'arrow', 0, z, 0.75, 1.5, 0, white)
  stencil(b, atlas, 'lookUp', 0, 12.6, 0.42, 0, yellow, 2.4)
  stencil(b, atlas, 'towerPlaza', 0, -3.6, 0.55, 0, white, 4.2)

  // ---- avenues: arrows + junction stencils -------------------------------------
  for (const z of [16.5, 4.2, -3.5, -15.0, -28.0, -40.5]) decal(b, atlas, 'arrow', -23, z, 0.8, 1.6, 0, white)
  for (const z of [16.5, 4.2, -6.2]) decal(b, atlas, 'arrow', 23, z, 0.8, 1.6, 0, white)
  stencil(b, atlas, 'junction:toWest', -8.4, 21.5, 0.55, Math.PI / 2, white, 3.4)
  stencil(b, atlas, 'junction:toEast', 8.4, 21.5, 0.55, -Math.PI / 2, white, 3.4)
  stencil(b, atlas, 'slow', -23, 18.2, 0.6, 0, white, 2)
  stencil(b, atlas, 'slow', 23, 18.2, 0.6, 0, white, 2)
  stencil(b, atlas, 'launchView', 2, -23.6, 0.5, 0, white, 3.6)

  // ---- spurs: arrows + destination names --------------------------------------
  for (const p of PATHS.filter((q) => q.kind === 'spur' && q.arrow)) {
    const id = p.id.replace('spur-', '')
    const r = p.rect
    const [ax, az] = p.arrow!
    const yaw = Math.atan2(-ax, -az)
    const cx = (r.minX + r.maxX) / 2
    const cz = (r.minZ + r.maxZ) / 2
    const col = zoneColorFor(p)
    const bd = BUILDINGS.find((x) => x.id === id)
    // arrow toward the door, set back from the zone band
    const back = bd ? 0.55 : 0
    decal(b, atlas, 'arrow', cx - ax * back, cz - az * back, 0.62, 1.25, yaw, white)
    if (atlas.cells[`zone:${id}`]) {
      // name stencil just before the spur, on the avenue side, reading toward the door
      const sx = cx - ax * ((r.maxX - r.minX) / 2 + 0.9)
      const sz = cz - az * ((r.maxZ - r.minZ) / 2 + 0.9)
      if (id !== 'personnel' && id !== 'maintenance') stencil(b, atlas, `zone:${id}`, sx, sz, 0.55, yaw, col, 3.4)
    }
  }
  // Intake spurs: names on the spur itself (narrow plaza edge)
  stencil(b, atlas, 'zone:personnel', 4.6, 27.2, 0.42, -Math.PI / 2, ZONES.personnel.color, 2.2)
  stencil(b, atlas, 'zone:maintenance', -4.6, 27.2, 0.42, Math.PI / 2, ZONES.maintenance.color, 2.2)

  // ---- parking lot stalls ---------------------------------------------------------
  for (const x of [21.2, 24.1, 27.3]) lineQuad(b, 'line', 'z', x, 33.0, 39.5, 0.1, white, Y.line)
  lineQuad(b, 'line', 'x', 33.0, 21.2, 30, 0.1, white, Y.line)
  stencil(b, atlas, 'ceo', 22.65, 37.6, 0.38, Math.PI, PALETTE.hazard, 2.5)
  stencil(b, atlas, 'loading', -23.9, 37.6, 0.5, Math.PI, white, 3.6)

  // ---- restricted zone floors ---------------------------------------------------
  for (const rz of RESTRICTED_ZONES) {
    if (rz.shape.kind === 'rect') {
      const r = rz.shape.rect
      const t = 0.45
      hazardStrip(b, 'x', r.minZ + t / 2, r.minX, r.maxX, t)
      hazardStrip(b, 'x', r.maxZ - t / 2, r.minX, r.maxX, t)
      hazardStrip(b, 'z', r.minX + t / 2, r.minZ + t, r.maxZ - t, t)
      hazardStrip(b, 'z', r.maxX - t / 2, r.minZ + t, r.maxZ - t, t)
      const inner = { minX: r.minX + t, maxX: r.maxX - t, minZ: r.minZ + t, maxZ: r.maxZ - t }
      if (rz.id === 'wet-paint') {
        b.floorQuad('wet', (inner.minX + inner.maxX) / 2, Y.fill, (inner.minZ + inner.maxZ) / 2, inner.maxX - inner.minX, inner.maxZ - inner.minZ, 0, null, '#ffffff')
      } else fillRect(b, 'fill', inner, '#4B4944', Y.fill, 1.5)
    } else {
      const [cx, cz] = rz.shape.center
      const R = rz.shape.radius
      hazardRing(b, cx, cz, R - 0.55, R + 0.05)
      decal(b, atlas, 'hatchDisc', cx, cz, (R - 0.6) * 2, (R - 0.6) * 2, 0.3, PALETTE.hazard)
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + (k * Math.PI) / 2
        const rr = R + 0.85
        stencil(b, atlas, 'blast', cx + Math.sin(a) * rr, cz + Math.cos(a) * rr, 0.5, a, PALETTE.signalRed, 3)
      }
    }
  }
  // wet footprints walking out of the paint (someone ignored the sign)
  decal(b, atlas, 'footprints', -14.1, -4.4, 0.62, 1.7, -Math.PI / 2 + 0.15, '#2E9C6E')
  decal(b, atlas, 'footprints', -12.4, -4.1, 0.62, 1.7, -Math.PI / 2 + 0.3, '#3C8C6A')

  // ---- stains -------------------------------------------------------------------
  const stains: [number, number, number, number][] = [
    [-12.4, 28.4, 1.5, 0],
    [-15.7, 29.9, 1.1, 1],
    [-9.4, 26.2, 0.8, 2],
    [25.6, 31.6, 1.4, 3],
    [-20.1, 30.7, 1.6, 0],
    [-5.4, 8.2, 0.9, 1],
    [6.1, -10.6, 1.2, 2],
    [-23.6, -2.0, 1.3, 3],
    [22.1, -1.0, 1.0, 0],
    [-38.4, 31.1, 1.6, 2],
    [18.9, 21.0, 1.1, 1],
  ]
  for (const [x, z, s, i] of stains) decal(b, atlas, `stain${i}`, x, z, s, s * 0.85, i * 1.3, '#3F3B35')
  // warehouse practice area
  stencil(b, atlas, 'practice', -38.6, 30, 0.55, Math.PI / 2, PALETTE.hazard, 6.4)
  decal(b, atlas, 'forklift', -35.2, 30, 1.2, 1.2, Math.PI / 2, PALETTE.hazard)
  // maintenance bay: keep the forklift lane clear
  stencil(b, atlas, 'keepClear', -8.6, 29, 0.42, -Math.PI / 2, PALETTE.hazard, 2.6)

  const built = b.build()
  return {
    asphalt: built.get('asphalt') ?? null,
    fill: built.get('fill') ?? null,
    line: built.get('line') ?? null,
    hazard: built.get('hazard') ?? null,
    decal: built.get('decal') ?? null,
    interior: built.get('interior') ?? null,
    wet: built.get('wet') ?? null,
  }

  function hazardStrip(bb: Batch, axis: 'x' | 'z', fixed: number, a0: number, a1: number, width: number): void {
    const len = a1 - a0
    if (len <= 0.02) return
    const mid = (a0 + a1) / 2
    // u across (width), v along: hazard texture stripes run diagonally
    if (axis === 'x') bb.floorQuad('hazard', mid, Y.hazard, fixed, width, len, -Math.PI / 2, null, '#ffffff', [width / 0.9, len / 0.9])
    else bb.floorQuad('hazard', fixed, Y.hazard, mid, width, len, 0, null, '#ffffff', [width / 0.9, len / 0.9])
  }

  function hazardRing(bb: Batch, cx: number, cz: number, r0: number, r1: number): void {
    const segs = 72
    const ring = new THREE.RingGeometry(r0, r1, segs, 1)
    // UVs: u around the circumference (stripes), v across
    const uv = ring.getAttribute('uv') as THREE.BufferAttribute
    const pos = ring.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const a = Math.atan2(y, x)
      const rad = Math.hypot(x, y)
      uv.setXY(i, ((a + Math.PI) * ((r0 + r1) / 2)) / 0.6, (rad - r0) / 0.6)
    }
    ring.rotateX(-Math.PI / 2)
    bb.geo('hazard', ring, [cx, Y.hazard, cz], [0, 0, 0], [1, 1, 1], '#ffffff', 'keep')
  }

  function buildThreshold(bb: Batch, bd: BuildingInfo): void {
    const z = bd.zone
    const band = doorApproach(bd, 1.25)
    fillRect(bb, 'fill', band, z.color, Y.fill, 2)
    const strip = doorApproach(bd, 0.32)
    const vertical = bd.def.doorSide === 'E' || bd.def.doorSide === 'W'
    if (vertical) hazardStrip(bb, 'z', (strip.minX + strip.maxX) / 2, strip.minZ, strip.maxZ, strip.maxX - strip.minX)
    else hazardStrip(bb, 'x', (strip.minZ + strip.maxZ) / 2, strip.minX, strip.maxX, strip.maxZ - strip.minZ)
    // interior floor
    const i = bd.def.interior
    const tile = FLOOR_TILE[bd.style.floor] ?? 1
    const w = i.maxX - i.minX
    const d = i.maxZ - i.minZ
    bb.floorQuad('interior', (i.minX + i.maxX) / 2, Y.interior, (i.minZ + i.maxZ) / 2, w, d, 0, null, bd.style.floorColor, [w / tile, d / tile])
  }
}

export function Ground({ quality }: { quality: QualityTier }) {
  const cfg = QUALITY[quality]
  const atlas = getFloorAtlas(cfg.atlasScale, cfg.anisotropy)
  const geo = useMemo(() => buildGround(atlas), [atlas])
  const slab = useMemo(() => {
    const g = new THREE.PlaneGeometry(104, 92)
    g.rotateX(-Math.PI / 2)
    g.translate(0, 0, -4)
    return g
  }, [])
  const far = useMemo(() => {
    const g = new THREE.PlaneGeometry(1500, 1500)
    g.rotateX(-Math.PI / 2)
    g.translate(0, -0.05, 0)
    return g
  }, [])
  useEffect(
    () => () => {
      slab.dispose()
      far.dispose()
      Object.values(geo).forEach((g) => g?.dispose())
    },
    [geo, slab, far],
  )
  const decalMat = decalMaterial(atlas.texture, `floor${cfg.atlasScale}`)
  return (
    <group name="env-ground">
      <mesh geometry={slab} material={envMats.ground()} receiveShadow />
      <mesh geometry={far} material={envMats.groundFar()} />
      {geo.asphalt && <mesh geometry={geo.asphalt} material={envMats.asphalt()} receiveShadow />}
      {geo.interior && <mesh geometry={geo.interior} material={envMats.floorTile()} receiveShadow />}
      {geo.fill && <mesh geometry={geo.fill} material={envMats.paintFill()} receiveShadow />}
      {geo.wet && <mesh geometry={geo.wet} material={envMats.wetPaint()} receiveShadow />}
      {geo.line && <mesh geometry={geo.line} material={envMats.paintLine()} receiveShadow />}
      {geo.hazard && <mesh geometry={geo.hazard} material={envMats.hazardFloor()} receiveShadow />}
      {geo.decal && <mesh geometry={geo.decal} material={decalMat} receiveShadow />}
    </group>
  )
}
