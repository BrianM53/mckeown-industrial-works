/**
 * Perimeter: corrugated wall along WORLD_BOUNDS (WorldBase owns the colliders),
 * posts + barbed wire on the outside, inward-facing lamps, a closed main gate
 * behind the spawn with a guard booth, flagpoles and the access road lights.
 */
import * as THREE from 'three'
import { createRng } from '@/core/rng'
import { WORLD_BOUNDS } from '@/world/layout'
import type { BuildCtx } from './types'

const WALL_H = 3.2
const STEEL = '#525E63'
const DARK = '#262C2E'
const LAMP = new THREE.Color('#FFE4B5').multiplyScalar(3.0)
export const GATE = { x0: -4.6, x1: 4.6, z: WORLD_BOUNDS.maxZ }
export const FLAGPOLES: [number, number][] = [
  [7.6, 42.8],
  [9.4, 42.8],
  [11.2, 42.8],
]

const PANEL_COLORS = ['#6E7A7C', '#76817F', '#687374', '#7D8684', '#5F6B6E', '#8A6A50']

export function addPerimeter(ctx: BuildCtx): void {
  const { b } = ctx
  const B = WORLD_BOUNDS
  const rng = createRng(4242)
  const t = 0.16
  type Run = { axis: 'x' | 'z'; fixed: number; a0: number; a1: number; out: number }
  const runs: Run[] = [
    { axis: 'x', fixed: B.minZ, a0: B.minX, a1: B.maxX, out: -1 },
    { axis: 'x', fixed: B.maxZ, a0: B.minX, a1: GATE.x0, out: 1 },
    { axis: 'x', fixed: B.maxZ, a0: GATE.x1, a1: B.maxX, out: 1 },
    { axis: 'z', fixed: B.minX, a0: B.minZ, a1: B.maxZ, out: -1 },
    { axis: 'z', fixed: B.maxX, a0: B.minZ, a1: B.maxZ, out: 1 },
  ]
  for (const r of runs) {
    const len = r.a1 - r.a0
    const n = Math.max(1, Math.round(len / 4))
    const pw = len / n
    for (let k = 0; k < n; k++) {
      const a = r.a0 + pw * (k + 0.5)
      const roll = rng()
      const col = roll < 0.12 ? PANEL_COLORS[5] : PANEL_COLORS[Math.floor(rng() * 5)]
      const c = r.fixed + (r.out * t) / 2
      if (r.axis === 'x') b.box('corr', a, WALL_H / 2, c, pw - 0.02, WALL_H, t, col)
      else b.box('corr', c, WALL_H / 2, a, t, WALL_H, pw - 0.02, col)
      // post on the outside every panel joint
      const pa = r.a0 + pw * k
      const po = r.fixed + r.out * (t + 0.11)
      if (r.axis === 'x') b.boxB('paint', pa, 0, po, 0.16, WALL_H + 0.5, 0.2, STEEL)
      else b.boxB('paint', po, 0, pa, 0.2, WALL_H + 0.5, 0.16, STEEL)
      // barbed-wire arm (angled outward)
      const [ax, az] = r.axis === 'x' ? [pa, po] : [po, pa]
      const [bx, bz] = r.axis === 'x' ? [pa, po + r.out * 0.45] : [po + r.out * 0.45, pa]
      b.cylBetween('metal', [ax, WALL_H + 0.45, az], [bx, WALL_H + 0.85, bz], 0.025, DARK, 4)
      // inward lamp every 3rd post
      if (k % 3 === 1) {
        const li = r.fixed - r.out * 0.55
        const [lx, lz] = r.axis === 'x' ? [pa, li] : [li, pa]
        const [sx, sz] = r.axis === 'x' ? [pa, r.fixed] : [r.fixed, pa]
        b.cylBetween('metal', [sx, WALL_H + 0.1, sz], [lx, WALL_H + 0.35, lz], 0.035, DARK, 5)
        b.box('paint', lx, WALL_H + 0.32, lz, 0.4, 0.16, 0.4, DARK)
        b.box('glow', lx, WALL_H + 0.235, lz, 0.32, 0.02, 0.32, LAMP)
      }
    }
    // top rail + kick plate (inner face) + barbed wires
    const ci = r.fixed + r.out * 0.01
    if (r.axis === 'x') {
      b.box('paint', (r.a0 + r.a1) / 2, WALL_H + 0.04, r.fixed + (r.out * t) / 2, len, 0.08, t + 0.06, DARK)
      b.box('concrete', (r.a0 + r.a1) / 2, 0.2, ci - r.out * 0.03, len, 0.4, 0.06, '#8F8C82')
    } else {
      b.box('paint', r.fixed + (r.out * t) / 2, WALL_H + 0.04, (r.a0 + r.a1) / 2, t + 0.06, 0.08, len, DARK)
      b.box('concrete', ci - r.out * 0.03, 0.2, (r.a0 + r.a1) / 2, 0.06, 0.4, len, '#8F8C82')
    }
    for (let w = 0; w < 3; w++) {
      const o = r.fixed + r.out * (t + 0.11 + 0.15 * (w + 1))
      const y = WALL_H + 0.55 + w * 0.13
      if (r.axis === 'x') b.cylBetween('metal', [r.a0, y, o], [r.a1, y, o], 0.012, '#3A3F41', 3)
      else b.cylBetween('metal', [o, y, r.a0], [o, y, r.a1], 0.012, '#3A3F41', 3)
    }
  }

  // --- main gate (closed) ----------------------------------------------------
  const gz = GATE.z + 0.08
  for (const x of [GATE.x0 - 0.3, GATE.x1 + 0.3]) {
    b.boxB('paint', x, 0, gz, 0.55, 3.9, 0.55, '#3A4447')
    b.boxB('paint', x, 3.9, gz, 0.65, 0.12, 0.65, DARK)
    b.box('paint', x, 4.15, gz, 0.3, 0.36, 0.3, DARK)
    b.box('glow', x, 4.15, gz, 0.24, 0.28, 0.24, LAMP)
    b.box('hazard', x, 0.6, gz, 0.6, 1.2, 0.6, '#ffffff')
  }
  const gx0 = GATE.x0
  const gx1 = GATE.x1
  const gh = 2.7
  for (const [a, c] of [
    [gx0, 0.05],
    [-0.05, gx1],
  ] as [number, number][]) {
    b.box('paint', (a + c) / 2, 0.12, gz, c - a, 0.1, 0.1, '#3A4447')
    b.box('paint', (a + c) / 2, gh, gz, c - a, 0.1, 0.1, '#3A4447')
    b.box('paint', (a + c) / 2, gh / 2, gz, c - a, 0.08, 0.08, '#3A4447')
    for (let x = a + 0.12; x < c - 0.05; x += 0.24) b.box('metal', x, gh / 2 + 0.05, gz, 0.035, gh - 0.1, 0.035, '#7E888B')
    b.cylBetween('paint', [a + 0.1, 0.2, gz], [c - 0.1, gh - 0.1, gz], 0.04, '#3A4447', 4)
  }
  b.box('metal', 0, 0.03, gz, GATE.x1 - GATE.x0 + 1.2, 0.06, 0.16, '#4A5254')
  // sign on the gate facing the intake
  const gc = ctx.atlas.cells['s:gate']
  if (gc) {
    b.box('paint', 0, 1.65, gz - 0.06, 2.3, 0.86, 0.04, DARK)
    b.plane('sign', 0, 1.65, gz - 0.09, 2.2, 0.78, 0, gc.uv)
    b.plane('sign', 0, 1.65, gz - 0.03, 2.2, 0.78, Math.PI, gc.uv)
  }
  // guard booth outside (empty; the guard is on a very long break)
  const bx = -7.6
  const bz = 42.6
  b.boxB('paint', bx, 0, bz, 2.4, 2.6, 2.2, '#C9C3B3')
  b.boxB('paint', bx, 2.6, bz, 2.8, 0.18, 2.6, '#3E4547')
  b.plane('window', bx + 1.21, 1.6, bz, 1.7, 0.9, -Math.PI / 2, [0, 0, 1, 1], '#ffffff')
  b.plane('window', bx, 1.6, bz - 1.11, 1.8, 0.9, 0, [0, 0, 1, 1], '#ffffff')
  b.box('paint', bx - 0.5, 1.05, bz + 1.11, 0.85, 2.0, 0.04, '#5E686C')
  b.boxB('paint', bx + 1.7, 0, bz - 0.7, 0.25, 1.1, 0.25, '#3E4547')
  b.box('hazard', bx + 1.7 + 2.0, 1.0, bz - 0.7, 4.0, 0.12, 0.12, '#ffffff')

  // flagpoles (flags are animated by <Flags>)
  for (const [x, z] of FLAGPOLES) {
    b.cylY('metal', x, 0, z, 0.06, 9.2, '#C9CED0', 8, 0.04)
    b.sphere('metal', x, 9.25, z, 0.09, '#D9C38F', 8, 6)
    b.cylY('concrete', x, 0, z, 0.35, 0.25, '#A29F94', 10)
  }

  // fence signs on the inner faces
  const signs: [string, number, number, number][] = [
    ['s:fence1', -20, B.minZ + 0.03, Math.PI],
    ['s:fence2', 18, B.minZ + 0.03, Math.PI],
    ['s:fence3', B.maxX - 0.03, 22, Math.PI / 2],
    ['s:fence1', B.minX + 0.03, 2, -Math.PI / 2],
    ['s:hardhat', 14.5, B.maxZ - 0.03, 0],
    ['s:fence2', B.maxX - 0.03, -30, Math.PI / 2],
  ]
  for (const [key, x, z, yaw] of signs) {
    const c = ctx.atlas.cells[key]
    if (!c) continue
    // yaw = facing direction (into the campus)
    const fy = yaw
    b.plane('sign', x - Math.sin(fy) * 0.02, 1.95, z - Math.cos(fy) * 0.02, 1.5, 0.54, fy, c.uv)
  }

  // access road lights outside the gate
  for (let z = 52; z < 220; z += 26) {
    for (const sx of [-1, 1]) {
      const x = sx * 6.2
      b.cylY('far', x, 0, z, 0.12, 7.5, '#5A6266', 6)
      b.box('far', x - sx * 0.8, 7.5, z, 1.6, 0.12, 0.12, '#5A6266')
      b.box('farGlow', x - sx * 1.5, 7.4, z, 0.5, 0.06, 0.3, LAMP)
    }
  }
}
