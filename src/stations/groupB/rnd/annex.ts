/**
 * R&D Annex static dressing + colliders (pure builders, unit-tested):
 *  - the annex directory board just inside the door (→ 'rnd' panel),
 *  - the RIG 01 sign on the scanner gantry, floor safety markings,
 *  - generic ProjectStation benches for featured R&D projects without a
 *    bespoke machine (data-driven from PROJECTS; none today),
 *  - GROUPS.static collider definitions for every machine in the annex.
 */
import * as THREE from 'three'
import type { ProjectContent } from '@/content/types'
import type { Rect } from '@/core/types'
import { ZONES } from '@/world/layout'
import { PALETTE } from '@/world/palette'
import { Batch } from '../shared/batch'
import type { UvRect } from '../shared/canvas'
import { boxCollider, cylCollider, type ColliderDef } from '../shared/colliders'
import { BENCH, DNP, DNP_GEOM, INFO_BOARD, ROW_RIG, SCANNER, type BenchSlot } from './layout'

const PURPLE = ZONES.rnd.color
const STEEL = '#3d4649'
const FLOOR_Y = 0.02

/** Rotate a local (x, z) offset by `yaw` about +Y and add the origin (same convention as Object3D.rotation.y). */
export function localToWorld(o: { x: number; z: number; yaw: number }, lx: number, lz: number): { x: number; z: number } {
  const c = Math.cos(o.yaw)
  const s = Math.sin(o.yaw)
  return { x: o.x + lx * c + lz * s, z: o.z - lx * s + lz * c }
}

/** Gantry posts of the scanner (world). */
export function scannerPosts(): { x: number; z: number }[] {
  return [-1, 1].map((s) => localToWorld(SCANNER, s * 1.38, 0.62))
}

/** Ground footprint of the rowing rig (world, axis-aligned: the rig is yawed by ±90°). */
export function rowRigRect(): Rect {
  const a = localToWorld(ROW_RIG, -2.3, -ROW_RIG.half.z)
  const b = localToWorld(ROW_RIG, 2.25, ROW_RIG.half.z)
  return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) }
}

export interface BenchAssignment {
  project: ProjectContent
  slot: BenchSlot
}

/** Where the visitor stands to inspect a bench (in front of it). */
export function benchInteractPoint(slot: BenchSlot): { x: number; z: number } {
  return localToWorld(slot, 0, -(BENCH.d / 2 + 0.75))
}

/** One generic test bench (local frame, front −Z): workbench, pegboard, monitor with the project card, a prototype. */
function addBench(b: Batch, slot: BenchSlot, plate: UvRect | undefined, index: number): void {
  const { w, d } = BENCH
  const top = 0.9
  b.group(slot.x, 0, slot.z, slot.yaw, () => {
    // workbench
    b.boxB('matte', 0, top - 0.05, 0, w, 0.05, d, '#8a6a4a')
    b.box('paint', 0, top - 0.08, -d / 2 + 0.01, w, 0.06, 0.03, PURPLE)
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) b.boxB('paint', sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06), 0.06, top - 0.05, 0.06, STEEL)
    b.boxB('paint', 0, 0.18, 0, w - 0.14, 0.03, d - 0.14, '#4a5458')
    // pegboard + tools
    b.boxB('paint', 0, top, d / 2 - 0.02, w, 1.05, 0.03, '#c9b48f')
    for (let k = 0; k < 5; k++) b.cylBetween('metal', [-0.55 + k * 0.27, top + 0.75, d / 2 - 0.05], [-0.55 + k * 0.27, top + 0.45, d / 2 - 0.05], 0.012, '#9aa3a5', 6)
    b.box('paint', 0.45, top + 0.62, d / 2 - 0.06, 0.1, 0.32, 0.03, '#c8302a')
    // monitor with the project card
    b.boxB('paint', -0.32, top, 0.12, 0.2, 0.02, 0.14, '#1f2427')
    b.box('paint', -0.32, top + 0.13, 0.13, 0.04, 0.24, 0.04, '#1f2427')
    b.box('paint', -0.32, top + 0.33, 0.1, 0.66, 0.36, 0.04, '#1f2427')
    if (plate) b.quad('signLit', -0.32, top + 0.33, 0.078, 0.6, 0.3, [0, Math.PI, 0], plate)
    // "prototype" under test: a box with knobs, wired to the monitor
    b.boxB('paint', 0.38, top, -0.02, 0.36, 0.2, 0.26, '#3a4245')
    for (let k = 0; k < 3; k++) b.cyl('metal', 0.28 + k * 0.1, top + 0.2, -0.08, 0.025, 0.03, '#c3c9ca', 10)
    b.box('glow', 0.38, top + 0.1, -0.152, 0.05, 0.03, 0.006, '#59ff86')
    b.cylBetween('rubber', [0.2, top + 0.05, 0.05], [-0.2, top + 0.02, 0.1], 0.012, '#1d1f20', 6)
    // rig number plate on the bench front
    b.box('paint', -0.55, top - 0.08, -d / 2 - 0.005, 0.2, 0.05, 0.01, index % 2 ? PALETTE.hazard : '#e9e5da')
  })
}

/** All static annex dressing as one batch (keys: paint/metal/matte/rubber/glow/lamp/hazard + sign/signLit). */
export function buildAnnexStatic(uv: Record<string, UvRect>, benches: BenchAssignment[]): Map<string, THREE.BufferGeometry> {
  const b = new Batch()
  // --- directory board (free-standing, angled toward the door) ---
  b.group(INFO_BOARD.x, 0, INFO_BOARD.z, INFO_BOARD.yaw, () => {
    const { w, h, y0 } = INFO_BOARD
    for (const s of [-1, 1]) {
      b.box('paint', s * (w / 2 + 0.03), (y0 + h + 0.1) / 2, 0.01, 0.06, y0 + h + 0.1, 0.06, STEEL)
      b.box('paint', s * (w / 2 + 0.03), 0.02, 0.01, 0.1, 0.04, 0.42, '#2a3033')
    }
    b.box('paint', 0, y0 + h / 2, 0.02, w + 0.08, h + 0.08, 0.04, PURPLE)
    b.quad('sign', 0, y0 + h / 2, -0.002, w, h, [0, Math.PI, 0], uv.info)
    b.box('paint', 0, y0 + h + 0.1, 0.0, w + 0.16, 0.06, 0.14, '#2a3033')
    b.box('lamp', 0, y0 + h + 0.065, -0.045, w * 0.8, 0.012, 0.03, '#fff3d6')
  })
  // --- RIG 01 sign on top of the scanner gantry (faces the visitor) ---
  b.group(SCANNER.x, 0, SCANNER.z, SCANNER.yaw, () => {
    for (const s of [-1, 1]) b.box('paint', s * 0.95, 3.76, 0.62, 0.06, 0.14, 0.06, STEEL)
    b.box('paint', 0, 4.03, 0.62, 2.52, 0.42, 0.05, '#1d2830')
    b.quad('sign', 0, 4.03, 0.59, 2.44, 0.357, [0, Math.PI, 0], uv.scanner)
  })
  // --- floor safety markings (paint, kept below the 0.045 decal ceiling) ---
  b.geo('paint', ringGeo(), [SCANNER.x, FLOOR_Y + 0.008, SCANNER.z], [Math.PI / 2, 0, 0], [1, 1, 0.12], PALETTE.hazard)
  const r = rowRigRect()
  const pad = 0.2
  const t = 0.07
  const R = { minX: r.minX - pad, maxX: r.maxX + pad, minZ: r.minZ - pad, maxZ: r.maxZ + pad }
  b.boxMinMax('paint', R.minX, FLOOR_Y, R.minZ, R.maxX, FLOOR_Y + 0.012, R.minZ + t, PALETTE.hazard)
  b.boxMinMax('paint', R.minX, FLOOR_Y, R.maxZ - t, R.maxX, FLOOR_Y + 0.012, R.maxZ, PALETTE.hazard)
  b.boxMinMax('paint', R.minX, FLOOR_Y, R.minZ, R.minX + t, FLOOR_Y + 0.012, R.maxZ, PALETTE.hazard)
  b.boxMinMax('paint', R.maxX - t, FLOOR_Y, R.minZ, R.maxX, FLOOR_Y + 0.012, R.maxZ, PALETTE.hazard)
  // purple walkway arrow from the door toward the rigs
  for (let k = 0; k < 3; k++) {
    const x = -33.2 - k * 1.1
    b.geo('paint', chevronGeo(), [x, FLOOR_Y + 0.006, -33], [-Math.PI / 2, 0, Math.PI / 2], [0.55, 0.55, 1], PURPLE)
  }
  // --- generic project benches ---
  benches.forEach((a, i) => addBench(b, a.slot, uv[`bench:${a.project.id}`], i))
  return b.build()
}

let _ring: THREE.BufferGeometry | null = null
let _chev: THREE.BufferGeometry | null = null
function ringGeo(): THREE.BufferGeometry {
  if (!_ring) _ring = new THREE.TorusGeometry(1.78, 0.05, 4, 56)
  return _ring
}
function chevronGeo(): THREE.BufferGeometry {
  if (!_chev) {
    const s = new THREE.Shape()
    s.moveTo(-0.5, -0.35)
    s.lineTo(0, 0.15)
    s.lineTo(0.5, -0.35)
    s.lineTo(0.5, -0.05)
    s.lineTo(0, 0.45)
    s.lineTo(-0.5, -0.05)
    s.closePath()
    _chev = new THREE.ShapeGeometry(s)
  }
  return _chev
}

/** Static colliders (GROUPS.static) for everything the annex adds. */
export function annexColliders(benches: BenchAssignment[]): ColliderDef[] {
  const out: ColliderDef[] = []
  out.push(cylCollider('rnd:scanner', SCANNER.x, SCANNER.z, SCANNER.trackR + 0.1, 1.05))
  scannerPosts().forEach((p, i) => out.push(cylCollider(`rnd:scanner-post:${i}`, p.x, p.z, 0.2, 3.75)))
  out.push(cylCollider('rnd:scanner-cart', SCANNER.monitor.x, SCANNER.monitor.z, 0.42, 1.7))
  out.push(boxCollider('rnd:row-rig', rowRigRect(), 0, 2.55))
  out.push(cylCollider('rnd:dnp-1', DNP.b1.x, DNP.b1.z, 0.33, 1.6))
  const hb = DNP_GEOM.bollardHalf + 0.06
  out.push(boxCollider('rnd:dnp-2', { minX: DNP.b2.x - hb, maxX: DNP.b2.x + hb, minZ: DNP.b2.z - hb, maxZ: DNP.b2.z + hb }, 0, 1.35))
  out.push({
    id: 'rnd:info-board',
    shape: 'box',
    x: INFO_BOARD.x,
    y: (INFO_BOARD.y0 + INFO_BOARD.h + 0.15) / 2,
    z: INFO_BOARD.z,
    hx: INFO_BOARD.w / 2 + 0.08,
    hy: (INFO_BOARD.y0 + INFO_BOARD.h + 0.15) / 2,
    hz: 0.12,
    yaw: INFO_BOARD.yaw,
  })
  for (const a of benches) {
    out.push({ id: `rnd:bench:${a.project.id}`, shape: 'box', x: a.slot.x, y: 0.75, z: a.slot.z, hx: BENCH.w / 2, hy: 0.75, hz: BENCH.d / 2, yaw: a.slot.yaw })
  }
  return out
}
