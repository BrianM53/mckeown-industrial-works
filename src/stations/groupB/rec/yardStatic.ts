import * as THREE from 'three'
import { PALETTE } from '@/world/palette'
import { Batch, type V3 } from '../shared/batch'
import type { UvRect } from '../shared/canvas'
import {
  BALL_CART,
  BALL_SPOT,
  BLEACHERS,
  COURT,
  FENCE,
  FENCE_H,
  FENCE_Z_NORTH,
  FLOOD_MASTS,
  GOAL,
  NET,
  PITCH,
  RULES_BOARD,
  SCOREBOARD,
  WATER_COOLER,
  YARD,
} from './layout'

/**
 * Recreation Yard static geometry, merged per material. Keys:
 *   paint / metal / matte / lamp (shared batch materials)
 *   chain  (chain-link fence mesh, alpha-tested)   net (goal + volleyball netting)
 *   turf / court / line (ground)                    sign / awning (canvas textures)
 */
const GALV = '#aab3b4'
const WHITE = '#efeee8'

export interface YardSigns {
  uv: Record<string, UvRect>
}

function fence(b: Batch): void {
  for (const seg of FENCE) {
    const [ax, az] = seg.a
    const [bx, bz] = seg.b
    const len = Math.hypot(bx - ax, bz - az)
    const n = Math.max(1, Math.round(len / 2.6))
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const x = ax + (bx - ax) * t
      const z = az + (bz - az) * t
      b.cyl('metal', x, 0, z, 0.045, FENCE_H + 0.05, GALV, 8)
      b.sphere('metal', x, FENCE_H + 0.06, z, 0.055, GALV, 8, 5)
      b.cyl('paint', x, 0, z, 0.1, 0.12, '#9a978d', 8)
    }
    b.cylBetween('metal', [ax, FENCE_H - 0.04, az], [bx, FENCE_H - 0.04, bz], 0.03, GALV, 6)
    b.cylBetween('metal', [ax, 0.08, az], [bx, 0.08, bz], 0.012, GALV, 4)
    // mesh panel (chain-link, tiles every 0.5 m)
    const yaw = Math.atan2(-(bz - az), bx - ax)
    b.quad('chain', (ax + bx) / 2, FENCE_H / 2 + 0.04, (az + bz) / 2, len, FENCE_H - 0.12, [0, yaw, 0], [0, 0, len / 0.5, (FENCE_H - 0.12) / 0.5])
  }
}

function bleachers(b: Batch): void {
  const r = BLEACHERS.rect
  const len = r.maxZ - r.minZ
  const cz = (r.minZ + r.maxZ) / 2
  const ALU = '#c3c9ca'
  for (let k = 0; k < BLEACHERS.tiers; k++) {
    const sx = seatX(k)
    const top = BLEACHERS.tierH * (k + 1)
    b.box('metal', sx, top - 0.025, cz, 0.34, 0.05, len, ALU)
    // footboard one tier down (feet rest here while seated)
    if (k > 0) b.box('metal', sx - 0.42, BLEACHERS.tierH * k - 0.02, cz, 0.32, 0.04, len, '#b2b9ba')
    // riser plate under the seat front
    b.box('paint', sx - 0.16, top - 0.2, cz, 0.02, 0.32, len, '#7e8a8c')
  }
  // frames
  for (const z of [r.minZ + 0.15, cz, r.maxZ - 0.15]) {
    for (let k = 0; k < BLEACHERS.tiers; k++) {
      const x = seatX(k)
      b.cylBetween('paint', [x, 0, z], [x, BLEACHERS.tierH * (k + 1) - 0.05, z], 0.035, '#5d686b', 6)
      if (k > 0) b.cylBetween('paint', [x - 0.42, 0, z], [x - 0.42, BLEACHERS.tierH * k - 0.04, z], 0.03, '#5d686b', 6)
    }
    b.cylBetween('paint', [r.minX + 0.2, 0.05, z], [r.maxX - 0.05, BLEACHERS.tierH * 3 - 0.05, z], 0.03, '#5d686b', 6)
    b.box('paint', (r.minX + r.maxX) / 2, 0.03, z, r.maxX - r.minX, 0.06, 0.12, '#4e585b')
  }
  // back + side guard rails
  b.cylBetween('metal', [r.maxX - 0.06, 2.35, r.minZ], [r.maxX - 0.06, 2.35, r.maxZ], 0.035, ALU, 6)
  for (const z of [r.minZ, r.maxZ]) {
    b.cylBetween('metal', [r.maxX - 0.06, 1.35, z], [r.maxX - 0.06, 2.35, z], 0.03, ALU, 6)
    b.cylBetween('metal', [r.minX + 0.7, 1.4, z], [r.maxX - 0.06, 2.35, z], 0.025, ALU, 6)
  }
}

/** Seat plank center x of bleacher tier k (spectators sit here). */
export function seatX(k: number): number {
  return BLEACHERS.rect.minX + 0.58 + 0.8 * k
}

function canopy(b: Batch): void {
  const r = BLEACHERS.rect
  const x0 = r.minX - 0.25
  const x1 = r.maxX + 0.05
  const y0 = 2.95
  const y1 = 3.45
  for (const z of [r.minZ - 0.05, r.maxZ + 0.05]) {
    b.cyl('paint', x0, 0, z, 0.07, y0, '#3f4a4d', 10)
    b.cyl('paint', x1, 0, z, 0.07, y1, '#3f4a4d', 10)
    b.cylBetween('paint', [x0, y0, z], [x1, y1, z], 0.06, '#3f4a4d', 8)
  }
  b.cylBetween('paint', [x0, y0, r.minZ - 0.05], [x0, y0, r.maxZ + 0.05], 0.06, '#3f4a4d', 8)
  b.cylBetween('paint', [x1, y1, r.minZ - 0.05], [x1, y1, r.maxZ + 0.05], 0.06, '#3f4a4d', 8)
  const w = Math.hypot(x1 - x0, y1 - y0)
  const pitch = Math.atan2(y1 - y0, x1 - x0)
  const len = r.maxZ - r.minZ + 0.5
  // fabric: plane facing up, tilted to the slope; stripes along z
  b.groupR([(x0 + x1) / 2, (y0 + y1) / 2 + 0.07, (r.minZ + r.maxZ) / 2], [0, 0, pitch], () => {
    b.quad('awning', 0, 0, 0, w + 0.3, len, [-Math.PI / 2, 0, 0], [0, 0, 1, len / 1.4])
    b.quad('awning', 0, -0.002, 0, w + 0.3, len, [Math.PI / 2, 0, 0], [0, 0, 1, len / 1.4])
  })
  // scalloped valance along the front edge (alternating panels)
  const n = Math.round(len / 0.7)
  for (let i = 0; i < n; i++) {
    const z = r.minZ - 0.25 + (len * (i + 0.5)) / n
    b.box('matte', x0 - 0.02, y0 - 0.1, z, 0.02, 0.24, len / n - 0.02, i % 2 ? '#f1e9d6' : PALETTE.safety)
  }
}

function goal(b: Batch): void {
  const { x, width, height } = GOAL
  const mz = GOAL.mouthZ
  const bz = GOAL.backZ
  const hw = width / 2
  for (const s of [-1, 1]) {
    b.cyl('paint', x + s * hw, 0, mz, GOAL.post, height + GOAL.post, WHITE, 12)
    b.cylBetween('paint', [x + s * hw, height, mz], [x + s * hw, 1.05, bz], 0.035, WHITE, 8)
    b.cylBetween('paint', [x + s * hw, 0.02, mz], [x + s * hw, 0.02, bz], 0.035, WHITE, 8)
    b.cylBetween('paint', [x + s * hw, 0.02, bz], [x + s * hw, 1.05, bz], 0.035, WHITE, 8)
  }
  b.cylBetween('paint', [x - hw, height, mz], [x + hw, height, mz], GOAL.post, WHITE, 12)
  b.cylBetween('paint', [x - hw, 1.05, bz], [x + hw, 1.05, bz], 0.035, WHITE, 8)
  b.cylBetween('paint', [x - hw, 0.02, bz], [x + hw, 0.02, bz], 0.035, WHITE, 8)
  // netting: back, top (sloped), sides
  const depth = mz - bz
  b.quad('net', x, 0.53, bz + 0.01, width, 1.05, [0, 0, 0], [0, 0, width / 0.2, 1.05 / 0.2])
  const topLen = Math.hypot(depth, height - 1.05)
  const tilt = Math.atan2(height - 1.05, depth)
  b.groupR([x, (height + 1.05) / 2, (mz + bz) / 2], [-Math.PI / 2 - tilt, 0, 0], () => b.quad('net', 0, 0, 0, width, topLen, [0, 0, 0], [0, 0, width / 0.2, topLen / 0.2]))
  const side = sideNetGeo(depth, height, 1.05)
  for (const s of [-1, 1]) b.geo('net', side, [x + s * hw, 0, bz], [0, 0, 0], [1, 1, 1], '#ffffff', true)
  // ground anchors
  for (const s of [-1, 1]) b.box('paint', x + s * hw, 0.015, bz, 0.12, 0.03, 0.12, '#55585a')
}

function volleyNet(b: Batch): void {
  const { x, z, half, top, bottom } = NET
  for (const s of [-1, 1]) {
    const px = x + s * half
    b.cyl('metal', px, 0, z, 0.055, top + 0.18, '#c9cfd0', 12)
    b.cyl('matte', px, 0.05, z, 0.11, 1.75, '#2d64b8', 14)
    b.box('paint', px, 0.02, z, 0.5, 0.04, 0.5, '#4b5254')
    // antenna (red/white rod) above the sideline
    for (let k = 0; k < 6; k++) b.cyl('matte', x + s * (half - 0.55), top - 0.05 + k * 0.15, z, 0.012, 0.15, k % 2 ? '#f2f2ec' : '#d9483b', 6)
  }
  b.quad('net', x, (top + bottom) / 2, z, half * 2 - 0.12, top - bottom, [0, 0, 0], [0, 0, (half * 2) / 0.12, (top - bottom) / 0.12])
  b.box('matte', x, top - 0.03, z, half * 2 - 0.12, 0.07, 0.012, '#f4f2ea')
  b.box('matte', x, bottom + 0.02, z, half * 2 - 0.12, 0.04, 0.01, '#f4f2ea')
  b.cylBetween('metal', [x - half, top, z], [x + half, top, z], 0.006, '#9aa1a3', 4)
}

function floodMast(b: Batch, x: number, z: number, cx: number, cz: number): void {
  const H = 7.6
  b.cyl('paint', x, 0, z, 0.3, 0.25, '#8f8d85', 10)
  b.cyl('metal', x, 0.25, z, 0.13, H - 0.25, '#8e999b', 10, 0.6)
  const yaw = Math.atan2(-(cx - x), -(cz - z))
  b.groupR([x, H, z], [0, yaw, 0], () => {
    b.box('paint', 0, 0, 0, 1.5, 0.08, 0.08, '#3f4a4d')
    b.box('paint', 0, 0.55, 0, 1.5, 0.08, 0.08, '#3f4a4d')
    for (const s of [-1, 1]) b.box('paint', s * 0.72, 0.27, 0, 0.06, 0.62, 0.06, '#3f4a4d')
    b.groupR([0, 0.28, -0.12], [-0.42, 0, 0], () => {
      for (const lx of [-0.38, 0.38])
        for (const ly of [-0.15, 0.15]) {
          b.box('paint', lx, ly, 0.06, 0.58, 0.26, 0.2, '#2e3537')
          b.box('lamp', lx, ly, -0.045, 0.5, 0.2, 0.02, new THREE.Color('#fff1cf').multiplyScalar(2.2))
        }
    })
    b.cylBetween('metal', [0, -0.05, 0], [0, -0.6, 0.05], 0.03, '#8e999b', 6)
  })
}

function scoreboard(b: Batch): void {
  const { x, z, w, h, y0 } = SCOREBOARD
  for (const s of [-1, 1]) {
    b.cyl('paint', x + 0.05, 0, z + s * (w / 2 - 0.25), 0.09, y0 + h + 0.2, '#3f4a4d', 10)
    b.cyl('paint', x + 0.05, 0, z + s * (w / 2 - 0.25), 0.22, 0.2, '#8f8d85', 10)
  }
  b.box('paint', x + 0.08, y0 + h / 2, z, 0.2, h + 0.16, w + 0.16, '#1e2427')
  b.box('paint', x - 0.03, y0 + h + 0.2, z, 0.08, 0.3, w * 0.62, ZONE_GREEN)
  b.box('paint', x - 0.02, y0 - 0.04, z, 0.06, 0.06, w + 0.16, PALETTE.hazard)
}

const ZONE_GREEN = '#3f6f3d'

function rulesBoard(b: Batch): void {
  const { x, z, w, h, y0 } = RULES_BOARD
  for (const s of [-1, 1]) b.cyl('paint', x + 0.06, 0, z + s * (w / 2 - 0.05), 0.045, y0 + h + 0.15, '#3f4a4d', 8)
  b.box('paint', x + 0.04, y0 + h / 2, z, 0.06, h + 0.1, w + 0.1, '#2b4a2c')
  b.box('paint', x + 0.04, y0 + h + 0.1, z, 0.16, 0.05, w + 0.2, '#2b4a2c')
}

function furniture(b: Batch): void {
  // water cooler on a stand
  const [wx, wz] = WATER_COOLER
  b.boxB('paint', wx, 0, wz, 0.5, 0.75, 0.45, '#5f6b6e')
  b.cyl('matte', wx, 0.75, wz, 0.21, 0.5, PALETTE.safety, 16)
  b.cyl('matte', wx, 1.25, wz, 0.22, 0.04, '#f4f2ea', 16)
  b.cyl('matte', wx - 0.23, 0.95, wz, 0.035, 0.12, '#f4f2ea', 8)
  b.cyl('paint', wx + 0.18, 0, wz + 0.32, 0.17, 0.48, '#3a6b45', 10, 0.9)
  // ball cart (wire basket with spare balls)
  const [cx, cz] = BALL_CART
  b.boxB('metal', cx, 0.12, cz, 0.7, 0.04, 0.5, GALV)
  for (const s of [-1, 1]) {
    b.cylBetween('metal', [cx - 0.33, 0.14, cz + s * 0.23], [cx - 0.33, 0.85, cz + s * 0.23], 0.012, GALV, 4)
    b.cylBetween('metal', [cx + 0.33, 0.14, cz + s * 0.23], [cx + 0.33, 0.85, cz + s * 0.23], 0.012, GALV, 4)
    b.cylBetween('metal', [cx - 0.33, 0.85, cz + s * 0.23], [cx + 0.33, 0.85, cz + s * 0.23], 0.012, GALV, 4)
    b.cylBetween('metal', [cx + s * 0.33, 0.85, cz - 0.23], [cx + s * 0.33, 0.85, cz + 0.23], 0.012, GALV, 4)
    b.cylBetween('metal', [cx - 0.33, 0.5, cz + s * 0.23], [cx + 0.33, 0.5, cz + s * 0.23], 0.01, GALV, 4)
  }
  for (const [dx, dz] of [
    [-0.18, -0.08],
    [0.16, 0.06],
    [0.0, -0.1],
  ])
    for (const wz2 of [-0.2, 0.2]) b.cyl('rubber', cx + dx * 2, 0, cz + wz2, 0.06, 0.12, '#1d1f20', 8)
  b.sphere('matte', cx - 0.15, 0.27, cz - 0.08, 0.105, '#f2c230', 12, 8)
  b.sphere('matte', cx + 0.12, 0.27, cz + 0.07, 0.105, '#2d64b8', 12, 8)
  b.sphere('matte', cx - 0.02, 0.45, cz - 0.02, 0.105, '#f5f3ec', 12, 8)
  // cone stack by the gate
  for (let k = 0; k < 3; k++) b.cyl('matte', 31.25, 0.06 * k, -11.95, 0.17, 0.42, PALETTE.safety, 12, 0.15)
  b.box('matte', 31.25, 0.012, -11.95, 0.38, 0.024, 0.38, PALETTE.safety)
}

/** Ground: turf pitch, clay court, painted lines. */
function ground(b: Batch): void {
  const tp = { minX: PITCH.minX - 0.5, maxX: PITCH.maxX + 0.5, minZ: Math.max(FENCE_Z_NORTH + 0.1, PITCH.minZ - 0.25), maxZ: PITCH.maxZ + 0.5 }
  const tw = tp.maxX - tp.minX
  const td = tp.maxZ - tp.minZ
  b.quad('turf', (tp.minX + tp.maxX) / 2, 0.016, (tp.minZ + tp.maxZ) / 2, tw, td, [-Math.PI / 2, 0, 0], [0, 0, tw / 2, td / 2])
  const cp = { minX: COURT.minX - 0.6, maxX: COURT.maxX + 0.6, minZ: COURT.minZ - 0.6, maxZ: COURT.maxZ + 0.4 }
  const cw = cp.maxX - cp.minX
  const cd = cp.maxZ - cp.minZ
  b.quad('court', (cp.minX + cp.maxX) / 2, 0.017, (cp.minZ + cp.maxZ) / 2, cw, cd, [-Math.PI / 2, 0, 0], [0, 0, cw / 3, cd / 3])
  const Y = 0.022
  const line = (x0: number, z0: number, x1: number, z1: number, wdt = 0.08) => {
    const len = Math.hypot(x1 - x0, z1 - z0)
    const yaw = Math.atan2(-(z1 - z0), x1 - x0)
    b.geo('line', LINE_GEO, [(x0 + x1) / 2, Y, (z0 + z1) / 2], [0, yaw, 0], [len + wdt, 1, wdt], WHITE)
  }
  const rect = (r: { minX: number; maxX: number; minZ: number; maxZ: number }) => {
    line(r.minX, r.minZ, r.maxX, r.minZ)
    line(r.minX, r.maxZ, r.maxX, r.maxZ)
    line(r.minX, r.minZ, r.minX, r.maxZ)
    line(r.maxX, r.minZ, r.maxX, r.maxZ)
  }
  rect(PITCH)
  // goal area box + penalty spot (the ball spot) + top of the box arc
  rect({ minX: GOAL.x - 3.2, maxX: GOAL.x + 3.2, minZ: GOAL.mouthZ, maxZ: GOAL.mouthZ + 2.4 })
  const spot = new THREE.CircleGeometry(0.16, 16)
  spot.rotateX(-Math.PI / 2)
  b.geo('line', spot, [BALL_SPOT[0], Y + 0.001, BALL_SPOT[1]], [0, 0, 0], [1, 1, 1], WHITE)
  const arc = new THREE.RingGeometry(1.6, 1.68, 24, 1, Math.PI * 0.1, Math.PI * 0.8)
  arc.rotateX(-Math.PI / 2)
  b.geo('line', arc, [GOAL.x, Y, PITCH.maxZ], [0, 0, 0], [1, 1, 1], WHITE)
  // volleyball court: boundary, center line, attack lines
  rect(COURT)
  line(COURT.minX, NET.z, COURT.maxX, NET.z, 0.06)
  line(COURT.minX, NET.z - 2.4, COURT.maxX, NET.z - 2.4, 0.06)
  line(COURT.minX, NET.z + 2.0, COURT.maxX, NET.z + 2.0, 0.06)
}

/** Goal side net: trapezoid in the YZ plane from the back (z=0, height h1) to the mouth (z=depth, height h0). */
function sideNetGeo(depth: number, h0: number, h1: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  const pos = [0, 0, 0, 0, 0, depth, 0, h0, depth, 0, h1, 0]
  const uv = [0, 0, depth / 0.2, 0, depth / 0.2, h0 / 0.2, 0, h1 / 0.2]
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0], 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex([0, 1, 2, 0, 2, 3])
  return g
}

const LINE_GEO = (() => {
  const g = new THREE.PlaneGeometry(1, 1)
  g.rotateX(-Math.PI / 2)
  return g
})()

export function buildYard(signs: YardSigns): Map<string, THREE.BufferGeometry> {
  const b = new Batch()
  fence(b)
  bleachers(b)
  canopy(b)
  goal(b)
  volleyNet(b)
  const cx = (YARD.minX + YARD.maxX) / 2
  const cz = (YARD.minZ + YARD.maxZ) / 2
  for (const [x, z] of FLOOD_MASTS) floodMast(b, x, z, cx, cz)
  scoreboard(b)
  rulesBoard(b)
  furniture(b)
  ground(b)
  // league banner on the north fence behind the goal
  const by = 1.9
  b.quad('sign', GOAL.x, by, FENCE_Z_NORTH + 0.06, 4.6, 0.92, [0, 0, 0], signs.uv.banner)
  for (const dx of [-2.2, 2.2]) for (const dy of [-0.4, 0.4]) b.sphere('metal', GOAL.x + dx, by + dy, FENCE_Z_NORTH + 0.07, 0.02, GALV, 6, 4)
  // rules board face
  const rbd = RULES_BOARD
  b.quad('sign', rbd.x - 0.005, rbd.y0 + rbd.h / 2, rbd.z, rbd.w, rbd.h, [0, -Math.PI / 2, 0], signs.uv.rules)
  return b.build()
}

/** Scoreboard face placement (for the dynamic canvas mesh). */
export function scoreboardFace(): { pos: V3; yaw: number; w: number; h: number } {
  const s = SCOREBOARD
  return { pos: [s.x - 0.03, s.y0 + s.h / 2, s.z], yaw: -Math.PI / 2, w: s.w, h: s.h }
}
