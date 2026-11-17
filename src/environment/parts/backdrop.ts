/**
 * Far industrial backdrop beyond the fence so the horizon never looks empty:
 * refinery columns + spheres, hyperboloid cooling towers with plumes, banded
 * smokestacks with drifting smoke, container cranes, warehouses, a gasholder,
 * pylons and a flare stack. Cheap Lambert + vertex colors; the fog does the haze.
 */
import * as THREE from 'three'
import { createRng } from '@/core/rng'
import type { BuildCtx } from './types'

const FAR = 'far'
const C = {
  steel: '#7A8486',
  dark: '#4A5357',
  rust: '#8F5A3E',
  concrete: '#A9A396',
  white: '#D8D4C8',
  red: '#B8473A',
  shed: '#7E7468',
  roof: '#5D6365',
}

let coolingGeo: THREE.BufferGeometry | null = null
function coolingTowerGeo(): THREE.BufferGeometry {
  if (coolingGeo) return coolingGeo
  const pts: THREE.Vector2[] = []
  for (let k = 0; k <= 12; k++) {
    const t = k / 12
    const y = t
    // hyperboloid-ish profile: narrow waist at ~70% height
    const r = 0.62 + 0.38 * Math.pow(Math.abs(t - 0.72) / 0.72, 1.6)
    pts.push(new THREE.Vector2(r, y))
  }
  coolingGeo = new THREE.LatheGeometry(pts, 28)
  return coolingGeo
}

export function addBackdrop(ctx: BuildCtx): void {
  const { b, q, steam } = ctx
  const rng = createRng(777)

  const column = (x: number, z: number, r: number, h: number, col = C.steel) => {
    b.cylY(FAR, x, 0, z, r, h, col, 14)
    b.cylY(FAR, x, h, z, r, r * 0.8, col, 14, r * 0.25)
    for (let y = 7; y < h - 2; y += 7) b.cylY(FAR, x, y, z, r + 0.7, 0.18, C.dark, 14)
    b.cylBetween(FAR, [x + r + 0.3, 0, z], [x + r + 0.3, h, z], 0.12, C.dark, 4)
  }
  const sphereTank = (x: number, z: number, r: number) => {
    b.sphere(FAR, x, r + 2.4, z, r, C.white, 16, 10)
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2
      b.cylY(FAR, x + Math.cos(a) * r * 0.8, 0, z + Math.sin(a) * r * 0.8, 0.35, r + 2.4, C.dark, 6)
    }
  }
  const stackBanded = (x: number, z: number, r: number, h: number, smoke: boolean) => {
    const bands = 7
    for (let k = 0; k < bands; k++) {
      const y0 = (h * k) / bands
      const r0 = r * (1 - 0.25 * (k / bands))
      const r1 = r * (1 - 0.25 * ((k + 1) / bands))
      b.cylY(FAR, x, y0, z, r0, h / bands, k % 2 ? C.white : C.red, 14, r1)
    }
    b.cylY(FAR, x, h, z, r * 0.85, 0.6, C.dark, 14)
    b.box('farGlow', x, h * 0.92, z + r * 0.78, 0.5, 0.5, 0.2, new THREE.Color('#ff3b2f').multiplyScalar(2))
    if (smoke) steam.push({ kind: 'smoke', x, y: h + 0.6, z })
  }
  const shed = (x: number, z: number, w: number, d: number, h: number, teeth: boolean) => {
    b.boxB(FAR, x, 0, z, w, h, d, C.shed)
    if (teeth) {
      const n = Math.max(2, Math.round(w / 6))
      for (let k = 0; k < n; k++) b.box(FAR, x - w / 2 + (w * (k + 0.5)) / n, h + 1.1, z, w / n - 0.5, 2.2, d, C.roof, 0, 0, 0.35)
    } else b.boxB(FAR, x, h, z, w + 0.6, 0.4, d + 0.6, C.roof)
  }
  const pylon = (x: number, z: number, h: number) => {
    for (const [dx, dz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ])
      b.cylBetween(FAR, [x + dx * 2.2, 0, z + dz * 2.2], [x + dx * 0.4, h, z + dz * 0.4], 0.12, C.dark, 4)
    for (const y of [h * 0.62, h * 0.8, h * 0.95]) b.box(FAR, x, y, z, 9, 0.25, 0.4, C.dark)
  }
  const stsCrane = (x: number, z: number, yaw: number) => {
    const s = Math.sin(yaw)
    const c = Math.cos(yaw)
    const P = (lx: number, y: number, lz: number): [number, number, number] => [x + lx * c + lz * s, y, z - lx * s + lz * c]
    for (const lx of [-6, 6])
      for (const lz of [-5, 5]) b.cylBetween(FAR, P(lx, 0, lz), P(lx * 0.8, 34, lz), 0.6, C.red, 6)
    b.cylBetween(FAR, P(-7, 34, 0), P(7, 34, 0), 0.9, C.red, 6)
    b.cylBetween(FAR, P(0, 36, -28), P(0, 36, 40), 0.9, C.red, 6)
    b.cylBetween(FAR, P(0, 50, -5), P(0, 36, -28), 0.25, C.dark, 4)
    b.cylBetween(FAR, P(0, 50, -5), P(0, 36, 38), 0.25, C.dark, 4)
    b.cylBetween(FAR, P(0, 34, -5), P(0, 50, -5), 0.7, C.red, 6)
    b.boxB(FAR, ...P(0, 30, 2), 4, 3, 4, C.white)
  }
  const towerCrane = (x: number, z: number, h: number, yaw: number) => {
    b.boxB(FAR, x, 0, z, 1.6, h, 1.6, C.steel)
    const s = Math.sin(yaw)
    const c = Math.cos(yaw)
    b.cylBetween(FAR, [x - 12 * c, h + 0.5, z + 12 * s], [x + 38 * c, h + 0.5, z - 38 * s], 0.5, '#D9B13B', 4)
    b.boxB(FAR, x - 10 * c, h - 1, z + 10 * s, 3, 2, 3, C.concrete)
    b.cylBetween(FAR, [x, h + 7, z], [x + 30 * c, h + 0.6, z - 30 * s], 0.08, C.dark, 3)
    b.cylBetween(FAR, [x, h + 7, z], [x - 10 * c, h + 0.6, z + 10 * s], 0.08, C.dark, 3)
    b.boxB(FAR, x, h, z, 1.8, 7, 1.8, '#D9B13B')
    b.cylBetween(FAR, [x + 26 * c, h, z - 26 * s], [x + 26 * c, h - 14, z - 26 * s], 0.05, C.dark, 3)
  }

  // --- north: refinery -----------------------------------------------------
  column(-34, -140, 2.4, 38)
  column(-22, -154, 3.0, 46)
  column(-10, -138, 1.8, 30)
  column(-2, -160, 2.2, 36, C.rust)
  sphereTank(14, -150, 7)
  sphereTank(30, -144, 6)
  for (const [x, z, r, h] of [
    [-52, -128, 9, 10],
    [-70, -150, 10, 12],
    [48, -168, 8, 9],
  ])
    b.cylY(FAR, x, 0, z, r, h, C.concrete, 20)
  for (let k = 0; k < 4; k++) b.box(FAR, -30 + k * 18, 8, -132, 18, 0.6, 2.4, C.dark)
  // flare stack (flame animated by <Flare>)
  b.cylY(FAR, 40, 0, -176, 0.8, 62, C.steel, 8, 0.6)
  for (let y = 10; y < 60; y += 12) b.cylY(FAR, 40, y, -176, 1.6, 0.2, C.dark, 8)

  // --- cooling towers with plumes --------------------------------------------
  for (const [x, z, r, h] of [
    [-96, -186, 18, 50],
    [-56, -206, 16, 44],
  ]) {
    b.geo(FAR, coolingTowerGeo(), [x, 0, z], [0, 0, 0], [r, h, r], C.concrete)
    steam.push({ kind: 'cooling', x, y: h + 1, z })
  }

  // --- smokestacks -------------------------------------------------------------
  stackBanded(62, -132, 2.4, 70, true)
  stackBanded(80, -144, 2.2, 64, true)
  stackBanded(-112, -82, 2.6, 72, true)
  stackBanded(118, -58, 2.0, 55, q.particles > 100)

  // --- east: port cranes + sheds -----------------------------------------------
  stsCrane(136, -18, 0.3)
  stsCrane(152, 18, 0.3)
  shed(100, 20, 34, 22, 11, true)
  shed(104, 60, 40, 24, 12, true)
  shed(96, -30, 24, 18, 9, false)

  // --- south: low warehouses past the highway, pylons -------------------------
  for (let k = 0; k < 6; k++) shed(-90 + k * 34 + rng() * 6, 125 + rng() * 14, 22 + rng() * 10, 16, 7 + rng() * 4, k % 2 === 0)
  for (let z = -120; z <= 120; z += 48) pylon(-72, z, 34)
  for (let x = -60; x <= 150; x += 52) pylon(x, 170, 30)

  // --- west (sun side, backlit): tower cranes, gasholder, silos ---------------
  towerCrane(-86, 56, 38, 0.6)
  towerCrane(-118, -24, 44, -0.4)
  {
    const x = -128
    const z = 20
    b.cylY(FAR, x, 0, z, 14, 18, C.concrete, 24)
    b.cylY(FAR, x, 18, z, 14, 1.5, C.dark, 24, 13)
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2
      b.cylY(FAR, x + Math.cos(a) * 15, 0, z + Math.sin(a) * 15, 0.4, 28, C.dark, 4)
    }
    for (const y of [9, 18, 27]) b.cylY(FAR, x, y, z, 15.2, 0.4, C.dark, 24, undefined, true)
  }
  for (let k = 0; k < 4; k++) {
    b.cylY(FAR, -100 + k * 7, 4, 96, 3, 16, C.white, 14)
    b.cylY(FAR, -100 + k * 7, 0, 96, 0.6, 4, C.dark, 6)
  }
  shed(-98, 128, 30, 18, 8, true)
}
