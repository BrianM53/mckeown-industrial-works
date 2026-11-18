/**
 * Decor rendering: features (tanks, silos, trucks, containers...), instanced
 * props, restricted-zone dressing, interior furniture/wall decor and ground
 * steam vents. Placement data comes from data/decor.ts (shared with colliders
 * and tests); this file only builds geometry into the batches.
 */
import * as THREE from 'three'
import { createRng } from '@/core/rng'
import type { DoorSide } from '@/world/layout'
import { ANCHORS } from '@/world/layout'
import { ENV_PALETTE, PALETTE } from '@/world/palette'
import { BUILDINGS, windowSpots, type BuildingInfo } from '../data/buildings'
import {
  BARRIERS,
  DOOR_BOLLARDS,
  EXEC_OFFICE,
  FEATURES,
  FURNITURE,
  PROPS,
  RESTRICTED_SIGNS,
  TRANSFORMER,
  WATER_TOWER_LEGS,
  barrelPositions,
  type Feature,
  type Furniture,
} from '../data/decor'
import { POSTERS } from '../data/text'
import type { Batch, Vec3 } from '../lib/batch'
import { addKit } from './kits'
import type { BuildCtx } from './types'

const STEEL = '#59656A'
const DARK = '#262C2E'
const RUBBER = ENV_PALETTE.rubber
const LAMP = new THREE.Color('#FFE4B5').multiplyScalar(3.0)
const PI = Math.PI

/** Local (model) → world transform helper: models face -Z, rotated by yaw. */
function frame(x: number, z: number, yaw: number) {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return (lx: number, ly: number, lz: number): Vec3 => [x + lx * c + lz * s, ly, z - lx * s + lz * c]
}

function lbox(b: Batch, key: string, L: ReturnType<typeof frame>, yaw: number, lx: number, ly: number, lz: number, w: number, h: number, d: number, col: THREE.ColorRepresentation, rx = 0, rz = 0): void {
  const [x, y, z] = L(lx, ly, lz)
  b.box(key, x, y, z, w, h, d, col, yaw, rx, rz)
}

function wheel(b: Batch, L: ReturnType<typeof frame>, lx: number, lz: number, r: number, side: number): void {
  const a = L(lx, r, lz)
  const c = L(lx + side * 0.3, r, lz)
  b.cylBetween('paint', a, c, r, RUBBER, 12)
  const h0 = L(lx + side * 0.31, r, lz)
  const h1 = L(lx + side * 0.33, r, lz)
  b.cylBetween('metal', h0, h1, r * 0.55, '#8D979A', 10)
}

function poster(ctx: BuildCtx, cell: string, x: number, y: number, z: number, w: number, h: number, yaw: number, key: 'poster' | 'sign' = 'poster'): void {
  const c = ctx.atlas.cells[cell]
  if (c) ctx.b.plane(key, x, y, z, w, h, yaw, c.uv)
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

export function addFeatures(ctx: BuildCtx): void {
  let tankSign = 0
  for (const f of FEATURES) {
    if (f.detail && !ctx.q.detail) continue
    switch (f.kind) {
      case 'tankV':
        tankV(ctx, f, tankSign++)
        break
      case 'silo':
        silo(ctx, f)
        break
      case 'sphereTank':
        sphereTank(ctx, f)
        break
      case 'bulletTank':
        bulletTank(ctx, f)
        break
      case 'waterTower':
        waterTower(ctx, f)
        break
      case 'container':
        container(ctx, f)
        break
      case 'trailer':
        trailer(ctx, f)
        break
      case 'boxTruck':
        boxTruck(ctx, f)
        break
      case 'van':
        van(ctx, f)
        break
      case 'dumpster':
        dumpster(ctx, f)
        break
      case 'acUnit':
        acUnit(ctx, f)
        break
      case 'generator':
        generator(ctx, f)
        break
      case 'cabinet':
        cabinet(ctx, f)
        break
      case 'gasCage':
        gasCage(ctx, f)
        break
      case 'pipeStack':
        pipeStack(ctx, f)
        break
      case 'tirePile':
        for (let k = 0; k < 5; k++) addKit(ctx, 'tire', f.x + (k === 4 ? 0.12 : 0), k * 0.24, f.z, k * 0.7, 1.15)
        break
      case 'scrapBin':
        scrapBin(ctx, f)
        break
      case 'picnic':
        picnic(ctx, f)
        break
      case 'spool':
        spool(ctx, f)
        break
      case 'bunker':
        bunker(ctx, f)
        break
      case 'wreckage':
        wreckage(ctx, f)
        break
      case 'floodMast':
        floodMast(ctx, f)
        break
      case 'windsock':
        windsock(ctx, f)
        break
      case 'barrels':
        for (const p of barrelPositions(f)) {
          addKit(ctx, 'barrel', p.x, 0, p.z, p.yaw, 1, f.color ?? PALETTE.signalBlue, p.tilt, 0)
          if (f.glow) ctx.b.cylY('glow', p.x, 0.885, p.z, 0.25, 0.012, new THREE.Color('#7CFF6B').multiplyScalar(2.2), 12)
        }
        if (f.glow) {
          const L = frame(f.x, f.z, 0)
          lbox(ctx.b, 'paint', L, 0, 0, 1.0, 0.95, 1.2, 0.5, 0.04, DARK)
          poster(ctx, 's:rndwaste', ...L(0, 1.0, 0.98), 1.12, 0.42, PI)
          ctx.b.cylY('paint', f.x - 0.55, 0, f.z + 0.95, 0.03, 1.25, DARK, 5)
          ctx.b.cylY('paint', f.x + 0.55, 0, f.z + 0.95, 0.03, 1.25, DARK, 5)
        }
        break
      case 'pallets':
        for (let k = 0; k < (f.layers ?? 3); k++) addKit(ctx, 'pallet', f.x, k * 0.144, f.z, (f.yaw ?? 0) + (k % 2 ? 0.04 : -0.03), 1, ['#ffffff', '#e8dfcf', '#d9cbb3'][k % 3])
        break
      case 'crates': {
        const rng = createRng(f.seed ?? 3)
        const L = frame(f.x, f.z, f.yaw ?? 0)
        for (let i = 0; i < (f.nx ?? 1); i++)
          for (let j = 0; j < (f.nz ?? 1); j++)
            for (let l = 0; l < (f.layers ?? 1); l++) {
              if (l > 0 && rng() < 0.25) continue
              const s = 0.86 + rng() * 0.12
              const [x, , z] = L((i - ((f.nx ?? 1) - 1) / 2) * 1.05, 0, (j - ((f.nz ?? 1) - 1) / 2) * 1.05)
              addKit(ctx, 'crate', x, l * 0.98, z, (f.yaw ?? 0) + (rng() - 0.5) * 0.12, s, ['#c8a77a', '#b98f5f', '#7E8F6A', '#A95E39'][Math.floor(rng() * 4)])
            }
        break
      }
      case 'propane':
        propane(ctx, f)
        break
      case 'bikeRack':
        bikeRack(ctx, f)
        break
    }
  }
}

function tankV(ctx: BuildCtx, f: Feature, n: number): void {
  const { b } = ctx
  const r = f.r ?? 1.5
  const h = f.h ?? 6
  const col = f.color ?? '#C9CBC4'
  b.cylY('concrete', f.x, 0, f.z, r + 0.25, 0.3, '#A29F94', 18)
  b.cylY('paint', f.x, 0.3, f.z, r, h - 0.3, col, 20)
  b.sphere('paint', f.x, h, f.z, r, col, 20, 8, 0.32)
  for (const y of [h * 0.35, h * 0.7]) b.cylY('paint', f.x, y, f.z, r + 0.02, 0.12, new THREE.Color(col).multiplyScalar(0.8), 20)
  // ladder + top railing
  const ax = f.x + r + 0.12
  for (const dz of [-0.22, 0.22]) b.cylBetween('metal', [ax, 0.3, f.z + dz], [ax, h + 0.2, f.z + dz], 0.025, PALETTE.hazard, 4)
  for (let y = 0.6; y < h; y += 0.35) b.box('metal', ax, y, f.z, 0.03, 0.03, 0.44, PALETTE.hazard)
  b.cylY('metal', f.x, h + 0.25, f.z, r * 0.9, 0.04, PALETTE.hazard, 18, undefined, true)
  // nozzle + pipe to ground
  b.cylBetween('metal', [f.x - r, 1.0, f.z], [f.x - r - 0.6, 1.0, f.z], 0.14, '#7C878A', 8)
  b.cylBetween('metal', [f.x - r - 0.6, 1.0, f.z], [f.x - r - 0.6, 0, f.z], 0.14, '#7C878A', 8)
  b.torus('metal', f.x - r - 0.35, 1.0, f.z + 0.2, 0.16, 0.025, '#C8302A', 'x')
  const sign = n === 0 ? 's:tank1' : n === 1 ? 's:tank2' : null
  if (sign) poster(ctx, sign, f.x, h * 0.5, f.z + r + 0.03, 1.3, 0.46, PI)
  if (n === 0) ctx.steam.push({ kind: 'valve', x: f.x, y: h + r * 0.32, z: f.z })
}

function silo(ctx: BuildCtx, f: Feature): void {
  const { b } = ctx
  const r = f.r ?? 1.7
  const h = f.h ?? 10
  const col = f.color ?? '#B8BCB6'
  for (const [dx, dz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ])
    b.cylY('paint', f.x + dx * r * 0.65, 0, f.z + dz * r * 0.65, 0.12, 3.6, STEEL, 6)
  b.cylY('paint', f.x, 1.5, f.z, 0.28, 2.0, col, 16, r)
  b.cylY('paint', f.x, 3.5, f.z, r, h - 3.5, col, 20)
  b.cylY('paint', f.x, h, f.z, r + 0.05, 1.2, new THREE.Color(col).multiplyScalar(0.85), 20, 0.25)
  for (let y = 4.5; y < h; y += 1.6) b.cylY('paint', f.x, y, f.z, r + 0.015, 0.06, new THREE.Color(col).multiplyScalar(0.78), 20)
  b.cylY('paint', f.x, 0.9, f.z, 0.22, 0.6, '#6E777A', 8)
  // catwalk across the tops
  b.box('grate', f.x, h + 1.25, f.z, 4.8, 0.06, 0.9, '#ffffff')
  for (const dz of [-0.45, 0.45]) b.box('metal', f.x, h + 2.25, f.z + dz, 4.8, 0.05, 0.05, PALETTE.hazard)
}

function sphereTank(ctx: BuildCtx, f: Feature): void {
  const { b } = ctx
  const r = f.r ?? 3
  const cy = r + 1.4
  const col = f.color ?? '#E7E4DA'
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * PI * 2
    b.cylY('paint', f.x + Math.cos(a) * r * 0.86, 0, f.z + Math.sin(a) * r * 0.86, 0.16, cy, STEEL, 6)
  }
  b.sphere('paint', f.x, cy, f.z, r, col, 22, 14)
  b.cylY('paint', f.x, cy - 0.12, f.z, r + 0.03, 0.24, '#B9B5AA', 22)
  b.cylY('metal', f.x, cy + r - 0.05, f.z, 0.5, 0.25, '#7C878A', 10)
  // spiral stair hint
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * PI * 0.9 - 0.4
    const y = (k / 10) * (cy + r * 0.7)
    b.box('metal', f.x + Math.cos(a) * (r + 0.4), y + 0.4, f.z + Math.sin(a) * (r + 0.4), 0.6, 0.05, 0.5, PALETTE.hazard, -a)
  }
}

function bulletTank(ctx: BuildCtx, f: Feature): void {
  const { b } = ctx
  const r = f.r ?? 1.4
  const len = f.len ?? 8
  const y = r + 0.6
  const col = f.color ?? '#D9D4C5'
  b.cylBetween('paint', [f.x - len / 2 + r, y, f.z], [f.x + len / 2 - r, y, f.z], r, col, 18)
  b.sphere('paint', f.x - len / 2 + r, y, f.z, r, col, 18, 10)
  b.sphere('paint', f.x + len / 2 - r, y, f.z, r, col, 18, 10)
  for (const dx of [-len / 3, len / 3]) b.boxB('concrete', f.x + dx, 0, f.z, 0.7, y - r * 0.4, r * 1.6, '#A29F94')
  b.cylY('metal', f.x, y + r - 0.1, f.z, 0.3, 0.45, '#7C878A', 10)
  b.cylY('metal', f.x + 1.4, y + r - 0.1, f.z, 0.12, 0.6, '#C8302A', 8)
  ctx.steam.push({ kind: 'valve', x: f.x + 1.4, y: y + r + 0.55, z: f.z })
}

function waterTower(ctx: BuildCtx, f: Feature): void {
  const { b } = ctx
  const ty = 11.2
  const r = 2.7
  for (const [dx, dz] of WATER_TOWER_LEGS) {
    b.cylBetween('paint', [f.x + dx, 0, f.z + dz], [f.x + dx * 0.72, ty, f.z + dz * 0.72], 0.17, STEEL, 8)
    b.cylY('concrete', f.x + dx, 0, f.z + dz, 0.4, 0.3, '#A29F94', 8)
  }
  // X bracing on each face
  const faces: [number, number, number, number][] = [
    [-1, -1, 1, -1],
    [1, -1, 1, 1],
    [1, 1, -1, 1],
    [-1, 1, -1, -1],
  ]
  for (const [ax, az, cx, cz] of faces) {
    for (const [y0, y1] of [
      [0.6, 5.6],
      [5.6, 10.6],
    ]) {
      const s0 = 1 - (0.28 * y0) / ty
      const s1 = 1 - (0.28 * y1) / ty
      b.cylBetween('metal', [f.x + ax * 1.8 * s0, y0, f.z + az * 1.8 * s0], [f.x + cx * 1.8 * s1, y1, f.z + cz * 1.8 * s1], 0.05, STEEL, 4)
      b.cylBetween('metal', [f.x + cx * 1.8 * s0, y0, f.z + cz * 1.8 * s0], [f.x + ax * 1.8 * s1, y1, f.z + az * 1.8 * s1], 0.05, STEEL, 4)
    }
  }
  b.cylY('paint', f.x, ty, f.z, r, 3.6, '#C9CBC4', 24)
  b.cylY('paint', f.x, ty + 3.6, f.z, r + 0.08, 1.5, '#8F969A', 24, 0.25)
  b.cylY('metal', f.x, ty - 0.1, f.z, r + 0.7, 0.08, DARK, 24)
  b.cylY('metal', f.x, ty + 0.9, f.z, r + 0.68, 0.04, PALETTE.hazard, 24, undefined, true)
  b.cylY('paint', f.x, 0, f.z, 0.35, ty, '#7C878A', 10)
  // painted name band facing the campus (west)
  const c = ctx.atlas.cells['watertower']
  if (c) {
    const g = new THREE.CylinderGeometry(r + 0.012, r + 0.012, 1.15, 24, 1, true, -PI / 2 - 0.75, 1.5)
    const m = new THREE.Matrix4().makeTranslation(f.x, ty + 1.85, f.z)
    ctx.b.add('poster', g, m, '#ffffff', 'keep', [1, 1], c.uv)
  }
}

function container(ctx: BuildCtx, f: Feature): void {
  const { b } = ctx
  const yaw = f.yaw ?? 0
  const L = frame(f.x, f.z, yaw)
  const cols = [f.color ?? '#A95E39', '#4F7A5A', '#C8B07A']
  const logo = (f.color ?? '').toUpperCase() === '#4F86A8' ? 'container:blue' : 'container:rust'
  for (let l = 0; l < (f.layers ?? 1); l++) {
    const col = cols[l % cols.length]
    const y0 = l * 2.6
    const dx = l * 0.18
    lbox(b, 'corr', L, yaw, dx, y0 + 1.3, 0, 6.06, 2.58, 2.44, col)
    // corner castings + door end
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const sy of [0, 1]) lbox(b, 'paint', L, yaw, dx + sx * 2.97, y0 + 0.1 + sy * 2.38, sz * 1.16, 0.18, 0.18, 0.18, DARK)
    lbox(b, 'paint', L, yaw, dx + 3.035, y0 + 1.3, 0, 0.02, 2.4, 2.3, new THREE.Color(col).multiplyScalar(0.8))
    for (const sz of [-0.6, -0.2, 0.2, 0.6]) {
      const a = L(dx + 3.06, y0 + 0.15, sz)
      const c2 = L(dx + 3.06, y0 + 2.45, sz)
      b.cylBetween('metal', a, c2, 0.025, '#8D979A', 4)
    }
    if (l === 0 || f.layers === 1) {
      for (const sz of [-1, 1]) {
        const p = L(dx, y0 + 1.35, sz * 1.235)
        poster(ctx, logo, p[0], p[1], p[2], 4.6, 1.98, yaw + (sz > 0 ? PI : 0))
      }
    }
  }
}

function trailer(ctx: BuildCtx, f: Feature): void {
  const { b } = ctx
  const yaw = f.yaw ?? 0
  const L = frame(f.x, f.z, yaw)
  // front at local -z
  lbox(b, 'paint', L, yaw, 0, 2.6, 0, 2.6, 2.85, 12.2, '#E5E2D9')
  lbox(b, 'paint', L, yaw, 0, 1.12, 0, 2.5, 0.12, 12.1, '#3A4244')
  for (const sx of [-1, 1]) lbox(b, 'paint', L, yaw, sx * 1.31, 1.05, 0, 0.04, 0.28, 12.2, '#C8302A')
  for (const z of [3.9, 5.2]) for (const sx of [-1, 1]) wheel(b, L, sx * 0.95, z, 0.52, sx)
  for (const sx of [-1, 1]) lbox(b, 'paint', L, yaw, sx * 0.85, 0.6, -4.2, 0.12, 1.2, 0.12, '#3A4244')
  lbox(b, 'paint', L, yaw, 0, 0.06, -4.2, 2.0, 0.08, 0.3, '#3A4244')
  lbox(b, 'paint', L, yaw, 0, 2.6, 6.11, 2.5, 2.7, 0.04, '#D6D2C6')
  lbox(b, 'paint', L, yaw, 0, 2.6, 6.13, 0.04, 2.7, 0.04, '#8D979A')
  lbox(b, 'paint', L, yaw, 0, 0.75, 6.1, 2.5, 0.2, 0.2, '#262C2E')
  for (const sx of [-1, 1]) {
    const p = L(sx * 1.315, 2.75, 0)
    poster(ctx, 'trailer', p[0], p[1], p[2], 10.5, 2.33, yaw + (sx > 0 ? -PI / 2 : PI / 2))
  }
  for (const sx of [-1, 1]) {
    const p = L(sx * 1.0, 0.82, 6.12)
    b.box('glow', p[0], p[1], p[2], 0.25, 0.12, 0.04, new THREE.Color('#ff2a1c').multiplyScalar(1.6), yaw)
  }
}

function boxTruck(ctx: BuildCtx, f: Feature): void {
  const { b } = ctx
  const yaw = f.yaw ?? 0
  const L = frame(f.x, f.z, yaw)
  const col = f.color ?? '#D9483B'
  // cab at local -z
  lbox(b, 'paint', L, yaw, 0, 1.55, -2.55, 2.4, 1.9, 2.1, col)
  lbox(b, 'paint', L, yaw, 0, 2.28, -2.86, 2.3, 0.75, 1.3, '#1F2627', 0.35, 0)
  for (const sx of [-1, 1]) lbox(b, 'paint', L, yaw, sx * 1.21, 2.15, -2.45, 0.02, 0.6, 1.1, '#2A3436')
  lbox(b, 'paint', L, yaw, 0, 0.7, -3.62, 2.3, 0.45, 0.12, '#3A4244')
  for (const sx of [-0.85, 0.85]) {
    const p = L(sx, 1.0, -3.62)
    b.box('glow', p[0], p[1], p[2], 0.32, 0.16, 0.04, new THREE.Color('#fff4d8').multiplyScalar(2), yaw)
  }
  // box body
  lbox(b, 'paint', L, yaw, 0, 2.15, 1.0, 2.5, 2.9, 5.2, '#E9E6DC')
  lbox(b, 'paint', L, yaw, 0, 0.62, 0.5, 2.2, 0.25, 7.0, '#2C3234')
  for (const z of [-2.4, 2.1, 2.9]) for (const sx of [-1, 1]) wheel(b, L, sx * 0.95, z, 0.48, sx)
  const logo = col === '#E9B63F' ? 'truck:yellow' : 'truck:red'
  for (const sx of [-1, 1]) {
    const p = L(sx * 1.265, 2.2, 1.0)
    poster(ctx, logo, p[0], p[1], p[2], 4.9, 1.68, yaw + (sx > 0 ? -PI / 2 : PI / 2))
  }
}

function van(ctx: BuildCtx, f: Feature): void {
  const { b } = ctx
  const yaw = f.yaw ?? 0
  const L = frame(f.x, f.z, yaw)
  const col = f.color ?? '#D9D4C5'
  lbox(b, 'paint', L, yaw, 0, 1.25, 0.45, 2.05, 1.9, 4.1, col)
  lbox(b, 'paint', L, yaw, 0, 0.95, -2.05, 2.0, 1.1, 1.05, col)
  lbox(b, 'paint', L, yaw, 0, 1.75, -1.75, 1.95, 0.75, 0.9, '#1F2627', 0.6, 0)
  for (const sx of [-1, 1]) lbox(b, 'paint', L, yaw, sx * 1.03, 1.65, -0.9, 0.02, 0.55, 1.3, '#2A3436')
  lbox(b, 'paint', L, yaw, 0, 0.75, -0.2, 2.07, 0.12, 5.2, PALETTE.signalBlue)
  for (const z of [-1.65, 1.75]) for (const sx of [-1, 1]) wheel(b, L, sx * 0.88, z, 0.38, sx)
}

function dumpster(ctx: BuildCtx, f: Feature): void {
  const { b } = ctx
  const yaw = f.yaw ?? 0
  const L = frame(f.x, f.z, yaw)
  const col = f.color ?? '#3E6B4F'
  lbox(b, 'paint', L, yaw, 0, 0.72, 0, 1.9, 1.15, 1.3, col)
  lbox(b, 'paint', L, yaw, 0, 1.33, -0.05, 1.95, 0.06, 1.38, new THREE.Color(col).multiplyScalar(0.7), -0.08, 0)
  lbox(b, 'paint', L, yaw, 0, 0.9, -0.67, 1.7, 0.18, 0.08, new THREE.Color(col).multiplyScalar(0.8))
  for (const sx of [-0.75, 0.75]) for (const sz of [-0.5, 0.5]) lbox(b, 'paint', L, yaw, sx, 0.08, sz, 0.12, 0.16, 0.12, DARK)
  lbox(b, 'paint', L, yaw, 0.6, 1.0, -0.66, 0.4, 0.2, 0.02, '#F1ECE0')
}

function acUnit(ctx: BuildCtx, f: Feature): void {
  const { b } = ctx
  b.boxB('concrete', f.x, 0, f.z, 1.5, 0.12, 1.5, '#A29F94')
  b.boxB('paint', f.x, 0.12, f.z, 1.3, 0.95, 1.3, '#B8BDB8')
  for (let k = 0; k < 6; k++) b.box('paint', f.x - 0.66, 0.35 + k * 0.12, f.z, 0.02, 0.05, 1.1, '#6E777A')
  b.cylY('paint', f.x, 1.07, f.z, 0.5, 0.08, DARK, 16, undefined, true)
  ctx.spinners.push({ kind: 'fan', x: f.x, y: 1.1, z: f.z, yaw: 0, vertical: true, radius: 0.46, speed: 9 })
  b.cylBetween('metal', [f.x + 0.66, 0.4, f.z + 0.3], [f.x + 1.2, 0.4, f.z + 0.3], 0.03, '#8D979A', 6)
}

function generator(ctx: BuildCtx, f: Feature): void {
  const { b } = ctx
  const yaw = f.yaw ?? 0
  const L = frame(f.x, f.z, yaw)
  lbox(b, 'concrete', L, yaw, 0, 0.08, 0, 2.4, 0.16, 1.4, '#A29F94')
  lbox(b, 'paint', L, yaw, 0, 0.88, 0, 2.2, 1.45, 1.2, '#D9B13B')
  for (let k = 0; k < 5; k++) lbox(b, 'paint', L, yaw, -0.7 + k * 0.35, 0.95, -0.61, 0.12, 0.9, 0.02, '#8F7A2C')
  const p = L(0.75, 1.6, 0.2)
  b.cylY('metal', p[0], p[1], p[2], 0.08, 0.7, '#4A5154', 8)
  lbox(b, 'paint', L, yaw, -0.7, 1.15, 0.61, 0.5, 0.4, 0.04, '#2A3133')
  const g = L(-0.82, 1.22, 0.64)
  b.box('glow', g[0], g[1], g[2], 0.05, 0.05, 0.02, new THREE.Color('#5dff7a').multiplyScalar(2), yaw)
}

function cabinet(ctx: BuildCtx, f: Feature): void {
  const { b } = ctx
  const yaw = f.yaw ?? 0
  const L = frame(f.x, f.z, yaw)
  lbox(b, 'paint', L, yaw, 0, 1.0, 0, 1.4, 2.0, 0.6, '#8E979A')
  lbox(b, 'paint', L, yaw, 0, 1.0, -0.31, 0.02, 1.9, 0.02, '#5A6265')
  const p = L(-0.35, 1.5, -0.315)
  poster(ctx, 'bolt', p[0], p[1], p[2], 0.32, 0.32, yaw)
  const top = L(0.4, 2.0, 0)
  b.cylY('metal', top[0], 2.0, top[2], 0.05, 1.2, '#7A8487', 6)
}

function gasCage(ctx: BuildCtx, f: Feature): void {
  const { b } = ctx
  const yaw = f.yaw ?? 0
  const L = frame(f.x, f.z, yaw)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) lbox(b, 'paint', L, yaw, sx * 0.97, 1.05, sz * 0.67, 0.06, 2.1, 0.06, '#5A6265')
  for (const y of [0.1, 1.05, 2.08]) {
    lbox(b, 'paint', L, yaw, 0, y, -0.67, 1.94, 0.05, 0.05, '#5A6265')
    lbox(b, 'paint', L, yaw, 0, y, 0.67, 1.94, 0.05, 0.05, '#5A6265')
  }
  for (let k = 0; k < 9; k++) lbox(b, 'metal', L, yaw, -0.9 + k * 0.225, 1.05, -0.67, 0.02, 2.0, 0.02, '#8D979A')
  lbox(b, 'paint', L, yaw, 0, 2.12, 0, 2.0, 0.04, 1.4, '#5A6265')
  const cols = ['#5DBB63', '#9AA3A5', '#E57D35', '#4F86A8', '#5DBB63', '#C8302A']
  cols.forEach((c, i) => {
    const p = L(-0.7 + (i % 3) * 0.7, 0, -0.25 + Math.floor(i / 3) * 0.5)
    addKit(ctx, 'cylinder', p[0], 0, p[2], i, 1, c)
  })
}

function pipeStack(ctx: BuildCtx, f: Feature): void {
  const { b } = ctx
  const L = frame(f.x, f.z, f.yaw ?? 0)
  for (const lz of [-1.8, 0, 1.8]) lbox(b, 'paint', L, f.yaw ?? 0, 0, 0.06, lz, 2.6, 0.12, 0.16, '#7A5A3A')
  const r = 0.22
  const layers = [5, 4, 3]
  layers.forEach((n, l) => {
    for (let k = 0; k < n; k++) {
      const lx = (k - (n - 1) / 2) * (r * 2.02)
      const y = 0.12 + r + l * r * 1.75
      const a = L(lx, y, -2.4)
      const c = L(lx, y, 2.4)
      b.cylBetween('metal', a, c, r, k % 2 ? '#A95E39' : '#8C949A', 10, true)
      b.cylBetween('paint', a, c, r * 0.8, DARK, 10)
    }
  })
}

function scrapBin(ctx: BuildCtx, f: Feature): void {
  const { b } = ctx
  const yaw = f.yaw ?? 0
  const L = frame(f.x, f.z, yaw)
  const col = '#A95E39'
  lbox(b, 'paint', L, yaw, 0, 0.06, 0, 1.8, 0.12, 1.3, col)
  for (const sz of [-1, 1]) lbox(b, 'paint', L, yaw, 0, 0.7, sz * 0.62, 1.8, 1.3, 0.06, col)
  for (const sx of [-1, 1]) lbox(b, 'paint', L, yaw, sx * 0.88, 0.7, 0, 0.06, 1.3, 1.25, col)
  const rng = createRng(Math.round(f.x * 10 + f.z))
  for (let k = 0; k < 7; k++) lbox(b, 'paint', L, yaw, (rng() - 0.5) * 1.2, 1.0 + rng() * 0.45, (rng() - 0.5) * 0.8, 0.2 + rng() * 0.5, 0.08 + rng() * 0.2, 0.15 + rng() * 0.4, ['#7D8A8C', '#5A6265', '#A95E39', '#9AA3A5'][k % 4], rng() * 0.6, rng() * 0.6)
}

function picnic(ctx: BuildCtx, f: Feature): void {
  const { b } = ctx
  const yaw = f.yaw ?? 0
  const L = frame(f.x, f.z, yaw)
  const wood = '#A8784C'
  lbox(b, 'paint', L, yaw, 0, 0.74, 0, 1.9, 0.06, 0.78, wood)
  for (const sz of [-1, 1]) lbox(b, 'paint', L, yaw, 0, 0.44, sz * 0.66, 1.9, 0.05, 0.3, wood)
  for (const sx of [-0.7, 0.7]) {
    lbox(b, 'paint', L, yaw, sx, 0.37, 0, 0.08, 0.06, 1.62, '#6E5034')
    for (const sz of [-1, 1]) lbox(b, 'paint', L, yaw, sx, 0.37, sz * 0.35, 0.07, 0.78, 0.07, '#6E5034', sz * 0.45, 0)
  }
  if (f.z > 37) {
    const top = L(0, 0, 0)
    b.cylY('metal', top[0], 0, top[2], 0.03, 2.4, '#C9CED0', 6)
    b.cylY('paint', top[0], 2.15, top[2], 1.25, 0.35, PALETTE.cream, 12, 0.06)
    b.cylY('paint', top[0], 2.08, top[2], 1.26, 0.08, '#C8553D', 12)
  }
  if (f.x > 14 && f.x < 16) {
    const s = L(0, 1.5, 1.2)
    b.cylY('paint', s[0] - 0.5, 0, s[2], 0.03, 1.9, DARK, 5)
    b.cylY('paint', s[0] + 0.5, 0, s[2], 0.03, 1.9, DARK, 5)
    poster(ctx, 's:sigh', s[0], 1.62, s[2] + 0.02, 1.2, 0.43, PI, 'sign')
  }
}

function spool(ctx: BuildCtx, f: Feature): void {
  const { b } = ctx
  for (const dx of [-0.42, 0.42]) b.cylBetween('paint', [f.x + dx - 0.04, 0.85, f.z], [f.x + dx + 0.04, 0.85, f.z], 0.85, '#A8784C', 16)
  b.cylBetween('paint', [f.x - 0.42, 0.85, f.z], [f.x + 0.42, 0.85, f.z], 0.55, '#1D1F20', 14)
}

function bunker(ctx: BuildCtx, f: Feature): void {
  const { b } = ctx
  const yaw = f.yaw ?? 0
  const L = frame(f.x, f.z, yaw)
  lbox(b, 'concrete', L, yaw, 0, 1.6, 0, 6.5, 3.2, 6.0, '#9A968A')
  lbox(b, 'concrete', L, yaw, 0, 3.35, 0, 6.0, 0.3, 5.5, '#8A867B')
  // slit windows on the south face (local +z = toward the plaza when yaw 0 means front faces -z; we face south)
  for (const lx of [-2.0, 0, 2.0]) {
    const p = L(lx, 2.3, 3.01)
    b.plane('window', p[0], p[1], p[2], 1.4, 0.22, yaw + PI, [0, 0, 1, 1], new THREE.Color('#ffffff').multiplyScalar(0.7))
  }
  lbox(b, 'paint', L, yaw, 2.4, 1.1, 3.02, 1.1, 2.1, 0.08, '#5A6265')
  lbox(b, 'hazard', L, yaw, 2.4, 2.25, 3.05, 1.2, 0.18, 0.06, '#ffffff')
  const s = L(-0.6, 1.25, 3.04)
  poster(ctx, 's:bunker', s[0], s[1], s[2], 2.4, 0.86, yaw + PI, 'sign')
  const m = L(-2.4, 3.5, -1.8)
  b.cylY('metal', m[0], 3.5, m[2], 0.06, 3.0, '#8D979A', 6)
  dishSmall(b, m[0], 6.5, m[2])
  for (let k = 0; k < 8; k++) {
    const p = L(-3.6 + (k % 4) * 0.62, 0.2 + Math.floor(k / 4) * 0.3, 3.4)
    b.box('paint', p[0], p[1], p[2], 0.6, 0.28, 0.4, '#8C7A5A', yaw + (k % 2) * 0.1)
  }
}

function dishSmall(b: Batch, x: number, y: number, z: number): void {
  b.cylY('paint', x, y, z, 0.5, 0.25, '#D6D8D2', 12, 0.05)
}

function wreckage(ctx: BuildCtx, f: Feature): void {
  const { b } = ctx
  const L = frame(f.x, f.z, f.yaw ?? 0)
  const yaw = f.yaw ?? 0
  // nose cone stuck in the ground
  const nc = L(-0.8, 0, 0.2)
  b.geo('paint', coneGeo(), [nc[0], 0.7, nc[2]], [0.5, 0.4, 0.3], [0.65, 1.6, 0.65], '#E9E6DC')
  // fins + panels + a scorched tank section
  lbox(b, 'paint', L, yaw, 0.9, 0.5, -0.6, 1.2, 0.06, 0.9, '#C8302A', 0.4, 0.9)
  lbox(b, 'paint', L, yaw, 1.4, 0.3, 0.8, 1.0, 0.06, 0.8, '#E9E6DC', -0.3, 0.2)
  lbox(b, 'paint', L, yaw, -1.5, 0.15, -0.9, 1.1, 0.05, 0.7, '#7D8A8C', 0.1, -0.15)
  const t0 = L(0.2, 0.5, 0.4)
  const t1 = L(1.6, 0.6, -0.2)
  b.cylBetween('paint', t0, t1, 0.48, '#3A3634', 12, true)
  addKit(ctx, 'barrel', f.x + 1.6, 0, f.z + 1.0, 0.4, 1, '#3A3634', 1.2, 0.2)
  const s = L(-1.2, 0, 1.6)
  b.cylY('paint', s[0] - 0.55, 0, s[2], 0.03, 1.5, DARK, 5)
  b.cylY('paint', s[0] + 0.55, 0, s[2], 0.03, 1.5, DARK, 5)
  poster(ctx, 's:lostfound', s[0], 1.2, s[2] + 0.02, 1.3, 0.46, PI, 'sign')
}

let cone: THREE.BufferGeometry | null = null
function coneGeo(): THREE.BufferGeometry {
  if (!cone) cone = new THREE.ConeGeometry(1, 1, 14)
  return cone
}

function floodMast(ctx: BuildCtx, f: Feature): void {
  const { b } = ctx
  const h = 14
  b.cylY('concrete', f.x, 0, f.z, 0.55, 0.35, '#A29F94', 10)
  b.cylY('paint', f.x, 0.35, f.z, 0.22, h - 0.35, STEEL, 10, 0.14)
  // face the launch pad
  const yaw = Math.atan2(-(16 - f.x), -(-34 - f.z))
  const L = frame(f.x, f.z, yaw)
  lbox(b, 'paint', L, yaw, 0, h, -0.25, 2.4, 0.12, 0.12, DARK)
  lbox(b, 'paint', L, yaw, 0, h + 0.75, -0.25, 2.4, 0.12, 0.12, DARK)
  for (const lx of [-0.8, 0.8])
    for (const ly of [h + 0.18, h + 0.62]) {
      lbox(b, 'paint', L, yaw, lx, ly + 0.12, -0.45, 0.7, 0.42, 0.3, '#3A4244')
      const p = L(lx, ly + 0.12, -0.61)
      b.plane('glow', p[0], p[1], p[2], 0.6, 0.34, yaw, [0, 0, 1, 1], LAMP)
    }
  for (let y = 1; y < h; y += 0.4) {
    const p = L(0, y, 0.26)
    b.box('metal', p[0], p[1], p[2], 0.36, 0.03, 0.03, '#8D979A', yaw)
  }
}

function windsock(ctx: BuildCtx, f: Feature): void {
  const { b } = ctx
  b.cylY('metal', f.x, 0, f.z, 0.07, 6, '#C9CED0', 8)
  b.torus('metal', f.x + 0.25, 5.85, f.z, 0.25, 0.02, DARK, 'x')
  for (let k = 0; k < 5; k++) {
    const x0 = f.x + 0.25 + k * 0.42
    const r0 = 0.25 - k * 0.035
    const r1 = 0.25 - (k + 1) * 0.035
    b.cylBetween('paint', [x0, 5.85 - k * 0.07, f.z], [x0 + 0.42, 5.85 - (k + 1) * 0.07, f.z], (r0 + r1) / 2, k % 2 ? '#F1ECE0' : PALETTE.safety, 10, true)
  }
}

function propane(ctx: BuildCtx, f: Feature): void {
  const { b } = ctx
  const yaw = f.yaw ?? 0
  const L = frame(f.x, f.z, yaw)
  const a = L(-0.85, 0.85, 0)
  const c = L(0.85, 0.85, 0)
  b.cylBetween('paint', a, c, 0.55, '#ECE8DE', 14)
  b.sphere('paint', a[0], a[1], a[2], 0.55, '#ECE8DE', 12, 8)
  b.sphere('paint', c[0], c[1], c[2], 0.55, '#ECE8DE', 12, 8)
  for (const lx of [-0.6, 0.6]) lbox(b, 'paint', L, yaw, lx, 0.15, 0, 0.12, 0.3, 0.8, DARK)
  const v = L(0, 1.4, 0)
  b.cylY('metal', v[0], 1.38, v[2], 0.18, 0.18, '#8D979A', 10)
}

function bikeRack(ctx: BuildCtx, f: Feature): void {
  const { b } = ctx
  for (let k = 0; k < 4; k++) b.torus('metal', f.x + k * 0.5 - 0.75, 0.45, f.z, 0.42, 0.03, '#9AA3A5', 'z')
  // one bicycle (somebody bikes to the rocket factory)
  const x = f.x - 0.5
  const z = f.z + 0.35
  for (const dx of [-0.52, 0.52]) b.torus('paint', x + dx, 0.34, z, 0.33, 0.025, RUBBER, 'z')
  b.cylBetween('paint', [x - 0.52, 0.34, z], [x, 0.62, z], 0.02, PALETTE.signalBlue, 4)
  b.cylBetween('paint', [x + 0.52, 0.34, z], [x, 0.62, z], 0.02, PALETTE.signalBlue, 4)
  b.cylBetween('paint', [x, 0.62, z], [x - 0.05, 0.86, z], 0.02, PALETTE.signalBlue, 4)
  b.cylBetween('paint', [x + 0.45, 0.82, z], [x + 0.52, 0.34, z], 0.02, PALETTE.signalBlue, 4)
}

// ---------------------------------------------------------------------------
// Instanced props
// ---------------------------------------------------------------------------

export function addProps(ctx: BuildCtx): void {
  for (const p of PROPS) {
    const yaw = p.yaw ?? 0
    switch (p.kind) {
      case 'pole':
        addKit(ctx, 'pole', p.x, 0, p.z, yaw)
        addKit(ctx, 'lens', p.x, 0, p.z, yaw)
        break
      case 'cone':
        addKit(ctx, 'cone', p.x, 0, p.z, yaw + p.x * 3.1)
        break
      default:
        addKit(ctx, p.kind, p.x, 0, p.z, yaw)
    }
  }
  for (const [x, z] of DOOR_BOLLARDS) addKit(ctx, 'bollard', x, 0, z, 0)
}

// ---------------------------------------------------------------------------
// Restricted zones
// ---------------------------------------------------------------------------

export function addRestricted(ctx: BuildCtx): void {
  const { b } = ctx
  // Barrier posts + sagging chains. Thin parts use open, low-segment cylinders:
  // caps are invisible at this size and the zones carry ~45 posts / spans.
  for (const bar of BARRIERS) {
    for (const [x, z] of bar.posts) {
      b.cylY('concrete', x, 0, z, 0.2, 0.08, '#A29F94', 8, 0.17)
      b.cylY('paint', x, 0.08, z, 0.05, 0.96, PALETTE.hazard, 6, undefined, true)
      for (const y of [0.32, 0.72]) b.cylY('paint', x, y, z, 0.055, 0.18, DARK, 6, undefined, true)
      b.sphere('paint', x, 1.05, z, 0.07, PALETTE.hazard, 6, 4)
    }
    for (const s of bar.spans) {
      const n = 6
      const sag = 0.16
      for (let k = 0; k < n; k++) {
        const t0 = k / n
        const t1 = (k + 1) / n
        const y0 = 0.96 - sag * 4 * t0 * (1 - t0)
        const y1 = 0.96 - sag * 4 * t1 * (1 - t1)
        b.cylBetween('paint', [s.a[0] + (s.b[0] - s.a[0]) * t0, y0, s.a[1] + (s.b[1] - s.a[1]) * t0], [s.a[0] + (s.b[0] - s.a[0]) * t1, y1, s.a[1] + (s.b[1] - s.a[1]) * t1], 0.03, k % 2 ? DARK : PALETTE.hazard, 4, true)
      }
    }
  }
  for (const s of RESTRICTED_SIGNS) {
    const L = frame(s.x, s.z, s.yaw)
    for (const lx of [-0.55, 0.55]) {
      const p = L(lx, 0, 0.03)
      b.cylY('paint', p[0], 0, p[2], 0.035, 2.25, DARK, 6)
    }
    lbox(b, 'paint', L, s.yaw, 0, 1.65, 0.03, 1.3, 0.94, 0.04, '#E8E4D8')
    const p = L(0, 1.65, 0.0)
    poster(ctx, `restricted:${s.zone}`, p[0], p[1], p[2], 1.26, 0.9, s.yaw)
  }
  // transformer
  const t = TRANSFORMER
  b.boxB('concrete', t.x, 0, t.z, t.w + 0.6, 0.18, t.d + 0.6, '#A29F94')
  b.boxB('paint', t.x, 0.18, t.z, t.w, t.h - 0.18, t.d, '#6F7F78')
  for (let k = 0; k < 7; k++) {
    const x = t.x - t.w / 2 + 0.25 + k * 0.25
    b.box('paint', x, 1.1, t.z - t.d / 2 - 0.16, 0.05, 1.5, 0.32, '#5E6D66')
    b.box('paint', x, 1.1, t.z + t.d / 2 + 0.16, 0.05, 1.5, 0.32, '#5E6D66')
  }
  b.boxB('paint', t.x, t.h, t.z, t.w - 0.2, 0.08, t.d - 0.2, '#56645E')
  const bushings: Vec3[] = []
  for (let k = 0; k < 3; k++) {
    const x = t.x - 0.6 + k * 0.6
    for (let d = 0; d < 5; d++) b.cylY('paint', x, t.h + 0.08 + d * 0.13, t.z, 0.11 - d * 0.008, 0.1, '#7A4A30', 10)
    b.cylY('metal', x, t.h + 0.75, t.z, 0.03, 0.2, '#C9CED0', 6)
    bushings.push([x, t.h + 0.95, t.z])
  }
  const [px, pz] = t.pole
  b.cylY('paint', px, 0, pz, 0.14, 7.5, '#6B4F35', 8, 0.11)
  b.box('paint', px, 7.0, pz, 1.8, 0.12, 0.14, '#6B4F35')
  for (let k = 0; k < 3; k++) {
    const ix = px - 0.7 + k * 0.7
    b.cylY('paint', ix, 7.06, pz, 0.05, 0.22, '#7A4A30', 6)
    b.cylBetween('metal', bushings[k], [ix, 7.28, pz], 0.012, DARK, 3)
  }
  for (const [x, z, yaw] of [
    [t.x, t.z - t.d / 2 - 0.33, 0],
    [t.x, t.z + t.d / 2 + 0.33, PI],
    [t.x - t.w / 2 - 0.01, t.z, PI / 2],
  ] as Vec3[])
    poster(ctx, 'bolt', x, 1.75, z, 0.42, 0.42, yaw)
  // wet paint dressing: roller, tray, cans, plaque
  b.cylBetween('paint', [-16.3, 0.07, -3.1], [-16.9, 0.07, -3.4], 0.07, '#E9E6DC', 10)
  b.cylBetween('metal', [-16.6, 0.1, -3.25], [-15.3, 0.55, -2.4], 0.02, '#C9CED0', 4)
  b.boxB('paint', -18.4, 0.02, -5.5, 0.5, 0.06, 0.38, '#2E9C6E')
  b.cylY('paint', -18.9, 0, -3.0, 0.14, 0.26, '#C9CED0', 10)
  b.cylBetween('paint', [-18.2, 0.13, -3.6], [-18.45, 0.13, -3.85], 0.13, '#C9CED0', 10)
  b.cylY('glow', -18.9, 0.255, -3.0, 0.12, 0.01, new THREE.Color('#2E9C6E'), 10)
  poster(ctx, 's:wetsince', -15.08, 0.78, -6.0, 0.7, 0.25, -PI / 2)
}

// ---------------------------------------------------------------------------
// Interiors
// ---------------------------------------------------------------------------

function interiorWallFree(bi: BuildingInfo, side: DoorSide, a0: number, a1: number, y0: number, y1: number): boolean {
  for (const w of windowSpots(bi)) if (w.side === side && a0 < w.along + w.w / 2 + 0.15 && a1 > w.along - w.w / 2 - 0.15 && y0 < w.y0 + w.h + 0.1 && y1 > w.y0 - 0.1) return false
  if (side === bi.def.doorSide) {
    const [d0, d1] = bi.def.doorSpan
    if (a0 < d1 + 0.3 && a1 > d0 - 0.3 && y0 < bi.style.doorHeight + 0.7) return false
  }
  return true
}

/** Place a quad on an interior wall (facing into the room). */
function interiorQuad(ctx: BuildCtx, bi: BuildingInfo, side: DoorSide, along: number, yc: number, w: number, h: number, cell: string, key: 'poster' | 'sign' = 'poster', backing = true): boolean {
  if (!interiorWallFree(bi, side, along - w / 2, along + w / 2, yc - h / 2, yc + h / 2)) return false
  const i = bi.def.interior
  const off = 0.1
  const [x, z, yaw] =
    side === 'N' ? [along, i.minZ + off, PI] : side === 'S' ? [along, i.maxZ - off, 0] : side === 'W' ? [i.minX + off, along, -PI / 2] : [i.maxX - off, along, PI / 2]
  if (backing) {
    const bx = side === 'N' || side === 'S' ? w + 0.06 : 0.03
    const bz = side === 'N' || side === 'S' ? 0.03 : w + 0.06
    const [qx, qz] = side === 'N' ? [x, z - 0.02] : side === 'S' ? [x, z + 0.02] : side === 'W' ? [x - 0.02, z] : [x + 0.02, z]
    ctx.b.box('paint', qx, yc, qz, bx, h + 0.06, bz, '#2E3436')
  }
  poster(ctx, cell, x, yc, z, w, h, yaw, key)
  return true
}

export function addInteriors(ctx: BuildCtx): void {
  const { b } = ctx
  for (const f of FURNITURE) furniture(ctx, f)

  // wall decor per building
  const bi = (id: string) => BUILDINGS.find((x) => x.id === id)
  const posterIds = POSTERS.map((p) => p.id)
  const put = (id: string, side: DoorSide, along: number, yc: number, w: number, h: number, cell: string, key: 'poster' | 'sign' = 'poster') => {
    const B = bi(id)
    if (B) interiorQuad(ctx, B, side, along, yc, w, h, cell, key)
  }
  // Personnel
  put('personnel', 'N', 13.85, 2.1, 1.3, 0.46, 's:serving', 'sign')
  put('personnel', 'S', 13.4, 1.8, 0.68, 0.95, 'poster:signin')
  put('personnel', 'N', 11.6, 1.8, 0.68, 0.95, 'poster:priority')
  // Maintenance
  put('maintenance', 'N', -15.3, 1.75, 2.9, 1.05, 'pegboard')
  put('maintenance', 'S', -11.5, 1.9, 0.68, 0.95, 'poster:forklift')
  put('maintenance', 'W', 29.0, 2.0, 0.68, 0.95, 'poster:lift')
  put('maintenance', 'N', -9.8, 1.9, 0.68, 0.95, 'poster:hang')
  {
    // lift: top beam + arms + capacity sign
    b.box('paint', -16.9, 3.75, 29, 0.32, 0.22, 5.2, PALETTE.hazard)
    for (const z of [26.6, 31.4])
      for (const dx of [0.6, 1.2]) b.box('paint', -16.9 + dx, 0.55, z + (z < 29 ? 0.55 : -0.55), 1.1, 0.08, 0.12, '#C8302A')
    poster(ctx, 's:lift', -16.67, 2.4, 26.6, 0.9, 0.32, -PI / 2, 'sign')
    // chain hoist from the truss
    b.cylBetween('metal', [-14.2, 6.0, 29], [-14.2, 3.2, 29], 0.02, '#8D979A', 4)
    b.box('paint', -14.2, 3.05, 29, 0.25, 0.3, 0.2, PALETTE.hazard)
    b.torus('metal', -14.2, 2.75, 29, 0.09, 0.02, DARK, 'z')
  }
  // Warehouse
  put('warehouse', 'W', 30.0, 5.9, 0.68, 0.95, 'poster:running')
  // Break room posters (motivational)
  const brPosters = ['synergy', 'teamwork', 'attitude', 'microwave', 'coffee', 'qc']
  const brSpots: [DoorSide, number][] = [
    ['N', 37.2],
    ['N', 41.6],
    ['E', 27.0],
    ['S', 36.6],
    ['W', 26.0],
    ['S', 32.2],
  ]
  brSpots.forEach(([side, along], k) => put('breakroom', side, along, 1.85, 0.68, 0.95, `poster:${brPosters[k % brPosters.length]}`))
  // Control room & server hall & R&D & radio
  put('control', 'N', -34.5, 2.0, 0.68, 0.95, 'poster:qc')
  put('control', 'S', -41.5, 2.0, 0.68, 0.95, 'poster:eyes')
  put('server', 'S', -34.0, 2.0, 0.68, 0.95, 'poster:ears')
  put('server', 'N', -42.0, 2.0, 0.68, 0.95, 'poster:doors')
  put('rnd', 'S', -35.0, 1.95, 2.3, 1.15, 'whiteboard')
  put('rnd', 'N', -42.2, 2.0, 0.68, 0.95, 'poster:eyes')
  put('radio', 'E', 13.6, 2.2, 0.68, 0.95, 'poster:ears')
  // Unlit studio plate (poster material: no glow). The live ON AIR light is stations-a's.
  put('radio', 'W', 11.0, 4.15, 1.1, 0.4, 'onair', 'poster')
  void posterIds

  // acoustic foam on the radio booth walls
  {
    const B = bi('radio')!
    const i = B.def.interior
    for (const side of ['N', 'S'] as DoorSide[]) {
      for (let a = i.minX + 0.8; a < i.maxX - 0.6; a += 0.62)
        for (let y = 1.5; y < 4.2; y += 0.62) {
          if (!interiorWallFree(B, side, a - 0.3, a + 0.3, y - 0.3, y + 0.3)) continue
          if (a > 36.4 && a < 41 && side === 'N' && y < 2.0) continue
          const z = side === 'N' ? i.minZ + 0.1 : i.maxZ - 0.1
          b.box('paint', a, y, z, 0.56, 0.56, 0.08, (Math.round(a * 3 + y * 5) % 2 ? '#3A3F48' : '#2F333B'))
        }
    }
  }
  // server hall wall AC units + cable trays
  {
    const B = bi('server')!
    const i = B.def.interior
    for (const x of [-43, -38.5, -34]) {
      b.box('paint', x, 4.6, i.minZ + 0.25, 1.6, 0.6, 0.4, '#C9CED0')
      b.box('glow', x + 0.6, 4.75, i.minZ + 0.46, 0.05, 0.05, 0.02, new THREE.Color('#5dff7a').multiplyScalar(2))
      b.box('paint', x, 4.6, i.maxZ - 0.25, 1.6, 0.6, 0.4, '#C9CED0')
    }
    for (const z of [i.minZ + 0.35, i.maxZ - 0.35]) b.box('metal', (i.minX + i.maxX) / 2, 5.9, z, i.maxX - i.minX - 0.4, 0.1, 0.5, '#8D979A')
  }
  // control room cable tray + ceiling lights strip
  {
    const B = bi('control')!
    const i = B.def.interior
    b.box('metal', i.minX + 0.35, 5.6, (i.minZ + i.maxZ) / 2, 0.5, 0.1, i.maxZ - i.minZ - 0.4, '#8D979A')
  }

  addExecOffice(ctx)
}

function furniture(ctx: BuildCtx, f: Furniture): void {
  const { b } = ctx
  const r = f.rect
  const cx = (r.minX + r.maxX) / 2
  const cz = (r.minZ + r.maxZ) / 2
  const w = r.maxX - r.minX
  const d = r.maxZ - r.minZ
  const yaw = f.yaw ?? 0
  const rng = createRng(Math.round(cx * 31 + cz * 17))
  switch (f.kind) {
    case 'filing': {
      const n = Math.max(1, Math.round(w / 0.85))
      for (let k = 0; k < n; k++) {
        const x = r.minX + (w * (k + 0.5)) / n
        b.boxB('paint', x, 0, cz, w / n - 0.04, f.h, d, '#B9B7AB')
        for (let dr = 0; dr < 4; dr++) b.box('paint', x, 0.2 + dr * 0.32, r.maxZ + 0.005, w / n - 0.14, 0.26, 0.01, '#A9A79B')
        for (let dr = 0; dr < 4; dr++) b.box('metal', x, 0.3 + dr * 0.32, r.maxZ + 0.02, 0.16, 0.03, 0.03, '#6E777A')
      }
      break
    }
    case 'desk': {
      b.boxB('paint', cx, 0, cz, w, f.h - 0.04, d, '#7A5A3A')
      b.boxB('paint', cx, f.h - 0.04, cz, w + 0.06, 0.04, d + 0.06, '#A8784C')
      b.boxB('paint', cx - 0.3, f.h, cz - 0.05, 0.55, 0.36, 0.05, '#1F2627')
      b.box('glow', cx - 0.3, f.h + 0.19, cz - 0.02, 0.5, 0.3, 0.005, new THREE.Color('#9fd4e0').multiplyScalar(1.2))
      b.boxB('paint', cx + 0.5, f.h, cz, 0.3, 0.05, 0.22, '#E8E4D8')
      // the take-a-number dispenser
      b.cylY('paint', r.maxX + 0.35, 0, cz + 0.4, 0.04, 1.0, DARK, 6)
      b.box('paint', r.maxX + 0.35, 1.08, cz + 0.4, 0.22, 0.2, 0.14, '#C8302A')
      break
    }
    case 'chairs': {
      const n = Math.max(1, Math.round(w / 0.8))
      for (let k = 0; k < n; k++) {
        const x = r.minX + (w * (k + 0.5)) / n
        b.boxB('paint', x, 0.42, cz, 0.5, 0.06, 0.48, '#3E5A73')
        b.box('paint', x, 0.72, r.maxZ - 0.04, 0.5, 0.55, 0.06, '#3E5A73')
        for (const dx of [-0.2, 0.2]) b.boxB('metal', x + dx, 0, cz, 0.04, 0.42, 0.4, '#7E878A')
      }
      break
    }
    case 'cooler': {
      b.boxB('paint', cx, 0, cz, 0.42, 0.95, 0.42, '#E8E4D8')
      b.cylY('paint', cx, 0.95, cz, 0.17, 0.42, '#8FC3E0', 12)
      b.box('glow', cx, 0.7, cz + 0.212, 0.06, 0.06, 0.01, new THREE.Color('#ff4b3a').multiplyScalar(1.5))
      break
    }
    case 'workbench': {
      b.boxB('paint', cx, f.h - 0.06, cz, w, 0.06, d, '#A8784C')
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.boxB('paint', cx + sx * (w / 2 - 0.08), 0, cz + sz * (d / 2 - 0.08), 0.08, f.h - 0.06, 0.08, '#3A4244')
      b.boxB('paint', cx, 0.25, cz, w - 0.2, 0.04, d - 0.1, '#3A4244')
      b.boxB('paint', r.minX + 0.4, f.h, cz + 0.1, 0.2, 0.18, 0.28, '#3E5A73')
      for (let k = 0; k < 4; k++) b.boxB('paint', r.minX + 1.2 + k * 0.4, f.h, cz + (rng() - 0.5) * 0.3, 0.25, 0.05 + rng() * 0.12, 0.12, ['#C8302A', '#7E878A', '#E9B63F', '#4F86A8'][k])
      break
    }
    case 'toolchest': {
      b.boxB('paint', cx, 0.1, cz, w, f.h - 0.1, d, '#C8302A')
      for (let k = 0; k < 6; k++) b.box('metal', cx, 0.28 + k * 0.15, r.maxZ + 0.01, w - 0.15, 0.025, 0.02, '#C9CED0')
      for (const sx of [-1, 1]) b.cylBetween('paint', [cx + sx * (w / 2 - 0.08), 0.05, cz - 0.1], [cx + sx * (w / 2 - 0.08), 0.05, cz + 0.1], 0.05, RUBBER, 8)
      break
    }
    case 'compressor': {
      b.cylY('paint', cx, 0.1, cz, 0.3, 1.25, '#C8302A', 14)
      b.sphere('paint', cx, 1.35, cz, 0.3, '#C8302A', 12, 6, 0.4)
      b.boxB('paint', cx + 0.2, 1.45, cz, 0.35, 0.25, 0.3, '#3A4244')
      b.cylBetween('metal', [cx - 0.2, 1.2, cz + 0.28], [cx - 0.2, 1.2, cz + 0.36], 0.07, '#E8E4D8', 10)
      break
    }
    case 'liftPost': {
      b.boxB('paint', cx, 0, cz, w, f.h, d, PALETTE.hazard)
      b.boxB('paint', cx, 0, cz, w + 0.25, 0.04, d + 0.25, DARK)
      break
    }
    case 'shelf': {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.boxB('metal', cx + sx * (w / 2 - 0.03), 0, cz + sz * (d / 2 - 0.03), 0.05, f.h, 0.05, '#4F86A8')
      for (let k = 0; k < 4; k++) {
        const y = 0.1 + k * 0.6
        b.boxB('metal', cx, y, cz, w, 0.03, d, '#8D979A')
        let x = r.minX + 0.1
        while (x < r.maxX - 0.4) {
          const bw = 0.25 + rng() * 0.45
          b.boxB('paint', x + bw / 2, y + 0.03, cz, bw - 0.04, 0.2 + rng() * 0.25, d - 0.1, ['#B98F5F', '#7E8F6A', '#C8302A', '#4F86A8', '#E9B63F'][Math.floor(rng() * 5)])
          x += bw
        }
      }
      break
    }
    case 'drums':
      for (let k = 0; k < 2; k++) addKit(ctx, 'barrel', r.minX + 0.35 + k * 0.68, 0, cz, rng() * 3, 1, ['#2C3234', '#3E6B4F'][k])
      break
    case 'tires':
      for (let k = 0; k < 4; k++) addKit(ctx, 'tire', cx, k * 0.24, cz, k * 0.6, 1.1)
      break
    case 'rack': {
      const along = w > d ? 'x' : 'z'
      const len = along === 'x' ? w : d
      const dep = along === 'x' ? d : w
      const bays = Math.max(1, Math.round(len / 2.75))
      const levels = [0.0, 1.65, 3.3]
      for (let k = 0; k <= bays; k++) {
        const a = (along === 'x' ? r.minX : r.minZ) + (len * k) / bays
        for (const s of [-1, 1]) {
          const off = (dep / 2 - 0.05) * s
          if (along === 'x') b.boxB('paint', a, 0, cz + off, 0.09, f.h, 0.09, '#3B6E8F')
          else b.boxB('paint', cx + off, 0, a, 0.09, f.h, 0.09, '#3B6E8F')
        }
        // cross bracing between front/back uprights
        if (along === 'x') b.cylBetween('paint', [a, 0.3, cz - dep / 2 + 0.05], [a, f.h - 0.3, cz + dep / 2 - 0.05], 0.025, '#3B6E8F', 4)
        else b.cylBetween('paint', [cx - dep / 2 + 0.05, 0.3, a], [cx + dep / 2 - 0.05, f.h - 0.3, a], 0.025, '#3B6E8F', 4)
      }
      for (const y of [1.6, 3.25, 4.85]) {
        for (const s of [-1, 1]) {
          const off = (dep / 2 - 0.05) * s
          if (along === 'x') b.box('paint', cx, y, cz + off, w, 0.12, 0.07, PALETTE.safety)
          else b.box('paint', cx + off, y, cz, 0.07, 0.12, d, PALETTE.safety)
        }
      }
      for (let k = 0; k < bays; k++)
        for (const ly of levels) {
          if (rng() < 0.18) continue
          const a = (along === 'x' ? r.minX : r.minZ) + (len * (k + 0.5)) / bays
          const yb = ly === 0 ? 0 : ly + 0.01
          for (const sub of [-0.62, 0.62]) {
            if (rng() < 0.2) continue
            const [x, z] = along === 'x' ? [a + sub, cz] : [cx, a + sub]
            addKit(ctx, 'pallet', x, yb, z, along === 'x' ? 0 : PI / 2, [0.95, 1, 0.9])
            const s = 0.75 + rng() * 0.2
            addKit(ctx, 'crate', x, yb + 0.144, z, (rng() - 0.5) * 0.1, [s, 0.6 + rng() * 0.6, s], ['#c8a77a', '#b98f5f', '#7E8F6A', '#C9C3B3', '#4F86A8'][Math.floor(rng() * 5)])
          }
        }
      break
    }
    case 'vending': {
      const cols = ['#B5302A', '#2F5E80', '#5A3E28']
      b.boxB('paint', cx, 0, cz, w - 0.04, f.h, d, cols[(f.v ?? 0) % 3])
      poster(ctx, `vending:${f.v ?? 0}`, cx, f.h / 2 + 0.02, r.maxZ + 0.006, w - 0.12, f.h - 0.12, PI, 'sign')
      break
    }
    case 'counter': {
      b.boxB('paint', cx, 0, cz, w, f.h - 0.05, d, '#7A8C8A')
      b.boxB('paint', cx, f.h - 0.05, cz, w + 0.04, 0.05, d + 0.04, '#D8D2C2')
      b.boxB('paint', r.minX + 0.5, f.h, cz - 0.05, 0.55, 0.32, 0.4, '#E8E4D8')
      b.box('paint', r.minX + 0.45, f.h + 0.16, r.maxZ - 0.09, 0.32, 0.2, 0.01, '#1F2627')
      b.boxB('paint', r.maxX - 0.6, f.h, cz - 0.05, 0.28, 0.42, 0.3, '#262C2E')
      b.cylY('paint', r.maxX - 0.6, f.h + 0.02, cz + 0.06, 0.06, 0.14, '#C9CED0', 8)
      b.box('glow', r.maxX - 0.6, f.h + 0.36, r.maxZ - 0.04, 0.04, 0.04, 0.01, new THREE.Color('#ff4b3a').multiplyScalar(2))
      break
    }
    case 'fridge': {
      b.boxB('paint', cx, 0, cz, w - 0.02, f.h, d, '#E8E4D8')
      b.box('metal', r.minX + 0.12, 1.1, r.maxZ + 0.02, 0.03, 0.5, 0.03, '#9AA3A5')
      b.box('paint', cx + 0.1, 1.3, r.maxZ + 0.005, 0.18, 0.24, 0.005, '#E9B63F')
      break
    }
    case 'table': {
      b.cylY('paint', cx, 0, cz, 0.28, 0.04, DARK, 10)
      b.cylY('metal', cx, 0.04, cz, 0.04, 0.68, '#9AA3A5', 6)
      b.cylY('paint', cx, 0.72, cz, 0.55, 0.04, '#E8E4D8', 16)
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * PI * 2 + 0.4
        const x = cx + Math.cos(a) * 0.82
        const z = cz + Math.sin(a) * 0.82
        b.boxB('paint', x, 0.44, z, 0.42, 0.05, 0.42, ['#C8553D', '#638C88', '#E9B63F', '#4F86A8'][k], -a)
        b.box('paint', x + Math.cos(a) * 0.2, 0.72, z + Math.sin(a) * 0.2, 0.42, 0.5, 0.05, ['#C8553D', '#638C88', '#E9B63F', '#4F86A8'][k], -a + PI / 2)
        b.cylY('metal', x, 0, z, 0.025, 0.44, '#9AA3A5', 5)
      }
      break
    }
    case 'sofa': {
      const col = f.kind === 'sofa' && cz > 30 ? '#6B4A6E' : '#7A3E36'
      b.boxB('paint', cx, 0.08, cz, w, 0.36, d, col)
      b.box('paint', cx, 0.62, yaw === 0 ? r.maxZ - 0.12 : r.minZ + 0.12, w, 0.6, 0.24, col)
      for (const sx of [-1, 1]) b.boxB('paint', cx + sx * (w / 2 - 0.12), 0.08, cz, 0.24, 0.55, d, new THREE.Color(col).multiplyScalar(0.85))
      for (let k = 0; k < 3; k++) b.boxB('paint', r.minX + 0.45 + k * ((w - 0.9) / 2), 0.44, cz - 0.05, 0.62, 0.12, d - 0.35, new THREE.Color(col).multiplyScalar(1.12))
      break
    }
    case 'plantPot':
      addKit(ctx, 'plant', cx, 0, cz, rng() * 3, 1.1)
      break
    case 'glassWall': {
      const along = w > d ? 'x' : 'z'
      const len = along === 'x' ? w : d
      const gh = EXEC_OFFICE.glassHeight
      const top = EXEC_OFFICE.podHeight
      // modular in-plant office pod: aluminium frame + mullions + glass + walnut fascia band
      const n = Math.max(1, Math.round(len / 1.25))
      for (let k = 0; k <= n; k++) {
        const a = (along === 'x' ? r.minX : r.minZ) + (len * k) / n
        if (along === 'x') b.boxB('metal', a, 0, cz, 0.06, gh, 0.08, '#B4BBBD')
        else b.boxB('metal', cx, 0, a, 0.08, gh, 0.06, '#B4BBBD')
      }
      if (along === 'x') {
        b.box('glass', cx, gh / 2, cz, w, gh, 0.02, '#ffffff')
        b.boxB('metal', cx, 0, cz, w, 0.08, 0.1, '#B4BBBD')
        b.boxB('metal', cx, gh, cz, w, 0.08, 0.1, '#B4BBBD')
        b.boxB('paint', cx, gh + 0.08, cz, w + 0.08, top - gh - 0.08, 0.14, '#4A3428')
        b.boxB('metal', cx, top - 0.06, cz, w + 0.1, 0.06, 0.18, '#C9B27A')
      } else {
        b.box('glass', cx, gh / 2, cz, 0.02, gh, d, '#ffffff')
        b.boxB('metal', cx, 0, cz, 0.1, 0.08, d, '#B4BBBD')
        b.boxB('metal', cx, gh, cz, 0.1, 0.08, d, '#B4BBBD')
        b.boxB('paint', cx, gh + 0.08, cz, 0.14, top - gh - 0.08, d + 0.08, '#4A3428')
        b.boxB('metal', cx, top - 0.06, cz, 0.18, 0.06, d + 0.1, '#C9B27A')
      }
      break
    }
    case 'cabinetTall': {
      const along = d > w ? 'z' : 'x'
      const n = Math.max(1, Math.round((along === 'z' ? d : w) / 0.65))
      for (let k = 0; k < n; k++) {
        const a = (along === 'z' ? r.minZ : r.minX) + ((along === 'z' ? d : w) * (k + 0.5)) / n
        if (along === 'z') {
          b.boxB('paint', cx, 0, a, w, f.h, (d / n) * 0.96, '#8E979A')
          for (let l = 0; l < 4; l++) b.box('glow', r.maxX + 0.005, 1.4 + l * 0.12, a + 0.2, 0.01, 0.03, 0.03, new THREE.Color(l % 2 ? '#5dff7a' : '#ffb23f').multiplyScalar(2))
        } else b.boxB('paint', a, 0, cz, (w / n) * 0.96, f.h, d, '#8E979A')
      }
      break
    }
    case 'cylinders':
      for (let k = 0; k < 3; k++) addKit(ctx, 'cylinder', r.minX + 0.2 + (k % 2) * 0.4, 0, r.minZ + 0.2 + Math.floor(k / 2) * 0.4, k, [1.4, 1.1, 1.4], k === 1 ? '#5DBB63' : '#C8302A')
      break
    case 'labBench': {
      b.boxB('paint', cx, 0, cz, w, f.h - 0.05, d, '#E8E4D8')
      b.boxB('paint', cx, f.h - 0.05, cz, w + 0.04, 0.05, d + 0.04, '#2E3436')
      for (let k = 0; k < 5; k++) b.cylY('glow', r.minX + 0.4 + k * 0.8, f.h, cz + (rng() - 0.5) * 0.2, 0.05 + rng() * 0.04, 0.16 + rng() * 0.2, new THREE.Color(['#7CFF6B', '#6FC8FF', '#FFB23F', '#C86BFF', '#7CFF6B'][k]).multiplyScalar(1.2), 8)
      b.boxB('paint', r.maxX - 0.5, f.h, cz, 0.3, 0.45, 0.3, '#3A4244')
      break
    }
    case 'fumeHood': {
      b.boxB('paint', cx, 0, cz, w, f.h, d, '#D6D8D2')
      b.box('glass', cx, 1.3, yaw === 0 ? r.maxZ + 0.01 : r.minZ - 0.01, w - 0.2, 0.9, 0.02, '#ffffff')
      b.boxB('metal', cx, f.h, cz, 0.35, 6.0 - f.h - 0.2, 0.35, '#B4BBBD')
      break
    }
    case 'records': {
      b.boxB('paint', cx, 0, cz, w, f.h, d, '#6B4A30')
      for (let k = 0; k < 3; k++) {
        const y = 0.12 + k * 0.5
        let x = r.minX + 0.08
        while (x < r.maxX - 0.1) {
          b.boxB('paint', x + 0.03, y, r.maxZ + 0.01, 0.04, 0.32, 0.02, `hsl(${Math.floor(rng() * 360)},45%,${40 + Math.floor(rng() * 25)}%)`)
          x += 0.06
        }
      }
      break
    }
  }
}

function addExecOffice(ctx: BuildCtx): void {
  const { b } = ctx
  const r = EXEC_OFFICE.rect
  // plush carpet
  b.boxB('paint', (r.minX + r.maxX) / 2, 0.012, (r.minZ + r.maxZ) / 2, r.maxX - r.minX - 0.1, 0.02, r.maxZ - r.minZ - 0.1, '#7A1F2A')
  // the single giant pie chart (on an easel, facing the glass / west)
  const [ax, az] = ANCHORS.executiveOffice.position
  const cy = 1.6
  const R = 1.05
  b.cylBetween('paint', [ax + 0.06, cy, az], [ax + 0.22, cy, az], R, '#F4EFE2', 40)
  for (const [lx, lz] of [
    [0.45, -0.7],
    [0.45, 0.7],
    [0.95, 0],
  ])
    b.cylBetween('metal', [ax + 0.2, cy + 0.3, az], [ax + lx, 0, az + lz], 0.03, '#C9B27A', 5)
  const pc = ctx.atlas.cells['pie']
  if (pc) b.plane('sign', ax + 0.045, cy, az, R * 2 * 0.98, R * 2 * 0.98, PI / 2, pc.uv)
  poster(ctx, 's:pietitle', ax + 0.04, cy + R + 0.27, az, 1.8, 0.4, PI / 2, 'sign')
  // pod ceiling (the exec suite is a sealed modular office inside the break room)
  const top = EXEC_OFFICE.podHeight
  const pcx = (r.minX + r.maxX) / 2
  const pcz = (r.minZ + r.maxZ) / 2
  b.boxB('paint', pcx, top, pcz, r.maxX - r.minX + 0.1, 0.1, r.maxZ - r.minZ + 0.1, '#D9D3C6')
  // rooftop: a very serious executive air conditioner + an antenna for synergy reception
  b.boxB('metal', pcx + 0.6, top + 0.1, pcz + 0.4, 1.3, 0.75, 1.0, '#9AA3A5')
  b.box('paint', pcx - 0.08, top + 0.48, pcz + 0.4, 0.02, 0.5, 0.7, DARK)
  b.cylY('metal', pcx - 1.2, top + 0.1, pcz - 1.3, 0.025, 1.1, '#B4BBBD', 5)
  b.box('glow', pcx - 1.2, top + 1.22, pcz - 1.3, 0.06, 0.06, 0.06, new THREE.Color('#ff3b2f').multiplyScalar(2))
  // spotlight under the pod ceiling, aimed at the chart
  b.cylY('paint', ax - 1.2, top - 0.3, az, 0.2, 0.3, DARK, 10, 0.12)
  b.cylY('glow', ax - 1.2, top - 0.32, az, 0.16, 0.02, new THREE.Color('#fff2d6').multiplyScalar(3), 10)
  // locked glass door + keypad + sign (on the west glass wall)
  const d = EXEC_OFFICE.door
  const dz = (d.z0 + d.z1) / 2
  b.boxB('metal', d.x - 0.05, 0, d.z0, 0.06, 2.4, 0.06, '#B4BBBD')
  b.boxB('metal', d.x - 0.05, 0, d.z1, 0.06, 2.4, 0.06, '#B4BBBD')
  b.boxB('metal', d.x - 0.05, 2.4, dz, 0.06, 0.06, d.z1 - d.z0, '#B4BBBD')
  b.cylBetween('metal', [d.x - 0.12, 0.9, d.z1 - 0.2], [d.x - 0.12, 1.4, d.z1 - 0.2], 0.02, '#D9C38F', 6)
  b.box('paint', d.x - 0.06, 1.3, d.z0 - 0.35, 0.04, 0.22, 0.14, '#1C1F22')
  b.box('glow', d.x - 0.085, 1.36, d.z0 - 0.35, 0.01, 0.03, 0.06, new THREE.Color('#ff3b2f').multiplyScalar(2.4))
  poster(ctx, 's:exec', d.x - 0.03, 1.75, dz, 1.2, 0.4, PI / 2, 'sign')
}

// ---------------------------------------------------------------------------
// Ground steam vents (grates flush with the floor; steam is pooled sprites)
// ---------------------------------------------------------------------------

export const GROUND_VENTS: [number, number][] = [
  [-21.8, 7.5],
  [24.2, -2.6],
  [-15.5, 22.6],
  [9.2, -16.5],
]

export function addVents(ctx: BuildCtx): void {
  for (const [x, z] of GROUND_VENTS) {
    ctx.b.box('paint', x, 0.03, z, 1.05, 0.03, 1.05, DARK)
    ctx.b.box('grate', x, 0.05, z, 0.85, 0.02, 0.85, '#ffffff')
    ctx.steam.push({ kind: 'vent', x, y: 0.1, z })
  }
}
