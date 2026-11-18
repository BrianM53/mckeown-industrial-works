/**
 * Big static structures: welcome arch, overhead gantry sign, safety board,
 * production hall frame (columns + trusses + high-bay lamps), avenue pipe racks
 * (T-columns, pipes, branches into buildings), observation deck with ramp,
 * recreation-yard gateway and junction signposts.
 */
import * as THREE from 'three'
import { ZONES } from '@/world/layout'
import { PALETTE } from '@/world/palette'
import { ARCH, GANTRY, HALL, INCIDENT_BOARD, OBS_DECK, RACK, REC_GATE, WEST_RACK_EXTRA_Z } from '../data/decor'
import { SIGNPOSTS, bladesFor } from '../data/signposts'
import type { Batch } from '../lib/batch'
import { GANTRY_PANELS } from './signAtlas'
import type { BuildCtx } from './types'

const STEEL = '#4F5B61'
const DARK = '#262C2E'
const LAMP = new THREE.Color('#FFE4B5').multiplyScalar(3.4)
const PI = Math.PI

function quad(ctx: BuildCtx, key: 'sign' | 'poster', cell: string, x: number, y: number, z: number, w: number, h: number, yaw: number): void {
  const c = ctx.atlas.cells[cell]
  if (c) ctx.b.plane(key, x, y, z, w, h, yaw, c.uv)
}

function hazardSleeve(b: Batch, x: number, z: number, w: number, d: number, h = 1.2): void {
  b.box('hazard', x, h / 2, z, w + 0.04, h, d + 0.04, '#ffffff')
}

function highBay(b: Batch, x: number, y: number, z: number): void {
  b.cylBetween('metal', [x, y, z], [x, y - 0.9, z], 0.02, DARK, 4)
  b.cylY('paint', x, y - 1.3, z, 0.42, 0.42, '#5A6265', 12, 0.16)
  b.cylY('glow', x, y - 1.32, z, 0.36, 0.02, LAMP, 12)
}

export function addStructures(ctx: BuildCtx): void {
  addArch(ctx)
  addGantry(ctx)
  addHall(ctx)
  addRacks(ctx)
  addObsDeck(ctx)
  addRecGate(ctx)
  addSignposts(ctx)
}

function addArch(ctx: BuildCtx): void {
  const { b } = ctx
  const z = ARCH.z
  for (const sx of [-1, 1]) {
    const x = sx * ARCH.pillarX
    b.boxB('concrete', x, 0, z, ARCH.pillar + 0.2, 0.6, ARCH.pillar + 0.2, '#A29F94')
    b.boxB('brick', x, 0.6, z, ARCH.pillar, ARCH.height - 0.9, ARCH.pillar, '#8E4B3A')
    b.boxB('concrete', x, ARCH.height - 0.3, z, ARCH.pillar + 0.16, 0.3, ARCH.pillar + 0.16, '#B3B0A5')
    // lanterns on the inner faces
    for (const sz of [-1, 1]) {
      const lx = x - sx * (ARCH.pillar / 2 + 0.12)
      b.box('paint', lx, 3.3, z + sz * 0.18, 0.2, 0.36, 0.2, DARK)
      b.box('glow', lx, 3.3, z + sz * 0.18, 0.16, 0.26, 0.16, LAMP)
    }
  }
  // beam
  const y0 = ARCH.beamY0
  b.boxMinMax('paint', -ARCH.pillarX - 0.4, y0, z - 0.34, ARCH.pillarX + 0.4, ARCH.height - 0.05, z + 0.34, '#2B3133')
  quad(ctx, 'sign', 'arch', 0, (y0 + ARCH.height) / 2, z + 0.36, 10.2, 1.47, PI)
  quad(ctx, 'sign', 'arch', 0, (y0 + ARCH.height) / 2, z - 0.36, 10.2, 1.47, 0)
  // motto plaque hanging under the beam, facing the intake (north)
  const my = 4.75
  for (const x of [-1.8, 1.8]) b.cylBetween('metal', [x, y0, z - 0.25], [x, my + 0.36, z - 0.25], 0.025, DARK, 4)
  b.box('paint', 0, my, z - 0.25, 4.36, 0.82, 0.08, '#4A3B22')
  quad(ctx, 'poster', 'motto', 0, my, z - 0.30, 4.2, 0.7, 0)
  quad(ctx, 'poster', 'motto', 0, my, z - 0.20, 4.2, 0.7, PI)
  // underside light strip
  b.box('glow', 0, y0 - 0.01, z, 6, 0.02, 0.12, LAMP)
}

function addGantry(ctx: BuildCtx): void {
  const { b } = ctx
  const z = GANTRY.z
  const H = GANTRY.height
  for (const sx of [-1, 1]) {
    const x = sx * GANTRY.legX
    b.boxB('paint', x, 0, z, 0.38, H, 0.38, STEEL)
    b.boxB('concrete', x, 0, z, 0.7, 0.18, 0.7, '#A29F94')
    hazardSleeve(b, x, z, 0.38, 0.38)
    b.boxB('paint', x, H, z, 0.5, 0.12, 0.55, DARK)
  }
  // box truss
  const yb = GANTRY.beamY0 + 0.1
  const yt = H - 0.2
  for (const dz of [-0.24, 0.24]) {
    b.box('paint', 0, yb, z + dz, GANTRY.legX * 2, 0.12, 0.12, STEEL)
    b.box('paint', 0, yt, z + dz, GANTRY.legX * 2, 0.12, 0.12, STEEL)
    const n = 10
    for (let k = 0; k <= n; k++) {
      const x = -GANTRY.legX + (GANTRY.legX * 2 * k) / n
      b.box('paint', x, (yb + yt) / 2, z + dz, 0.08, yt - yb, 0.08, STEEL)
      if (k < n) {
        const x2 = -GANTRY.legX + (GANTRY.legX * 2 * (k + 1)) / n
        b.cylBetween('paint', [x, k % 2 ? yb : yt, z + dz], [x2, k % 2 ? yt : yb, z + dz], 0.035, STEEL, 4)
      }
    }
  }
  // direction panels (south face)
  const py = (GANTRY.beamY0 + 0.15 + H - 0.25) / 2
  const ph = 1.47
  GANTRY_PANELS.forEach((p, i) => {
    const x = (i - 1) * 4.18
    b.box('paint', x, py, z + 0.33, 4.1, ph + 0.08, 0.06, DARK)
    quad(ctx, 'sign', p.key, x, py, z + 0.37, 4.0, ph, PI)
  })
  // back (north face)
  b.box('paint', 0, py, z - 0.33, 4.6, 0.95, 0.06, DARK)
  quad(ctx, 'sign', 's:gantry:back', 0, py, z - 0.37, 4.5, 0.85, 0)
  // near-spawn direction signs hanging from the legs
  for (const [sx, key] of [
    [1, 's:spawn:personnel'],
    [-1, 's:spawn:maintenance'],
  ] as const) {
    const cx = sx * 5.0
    for (const dx of [-1.05, 1.05]) b.cylBetween('metal', [cx + dx, GANTRY.beamY0 + 0.05, z + 0.3], [cx + dx, 4.55, z + 0.3], 0.02, DARK, 4)
    b.box('paint', cx, 4.25, z + 0.3, 2.66, 0.55, 0.05, DARK)
    quad(ctx, 'sign', key, cx, 4.25, z + 0.335, 2.6, 0.49, PI)
  }
  // floodlights aimed at the intake
  for (const x of [-3, 3]) {
    b.box('paint', x, GANTRY.beamY0 - 0.05, z + 0.1, 0.5, 0.22, 0.34, DARK)
    b.box('glow', x, GANTRY.beamY0 - 0.165, z + 0.1, 0.42, 0.02, 0.28, LAMP)
  }
  // DAYS WITHOUT INCIDENT board (between the west leg and its own post)
  const ib = INCIDENT_BOARD
  b.cylY('paint', ib.postX, 0, ib.z, 0.07, ib.y1 + 0.1, STEEL, 8)
  const cx = (ib.x0 + ib.x1) / 2
  const w = ib.x1 - ib.x0
  b.box('paint', cx, (ib.y0 + ib.y1) / 2, ib.z, w, ib.y1 - ib.y0 + 0.1, 0.1, '#2F7D4A')
  quad(ctx, 'sign', 'incident', cx, (ib.y0 + ib.y1) / 2, ib.z + 0.056, w - 0.1, ib.y1 - ib.y0 - 0.06, PI)
  b.box('paint', cx, ib.y1 + 0.14, ib.z + 0.12, w, 0.06, 0.3, DARK)
}

function addHall(ctx: BuildCtx): void {
  const { b } = ctx
  const c = HALL.column
  for (const z of HALL.columnZ) {
    for (const sx of [-1, 1]) {
      const x = sx * HALL.x
      b.boxB('paint', x, 0, z, c, HALL.trussY1, c, STEEL)
      b.boxB('concrete', x, 0, z, c + 0.35, 0.2, c + 0.35, '#A29F94')
      hazardSleeve(b, x, z, c, c)
    }
    // truss
    const y0 = HALL.trussY0
    const y1 = HALL.trussY1
    const L = HALL.x * 2
    b.box('paint', 0, y0, z, L, 0.16, 0.16, STEEL)
    b.box('paint', 0, y1, z, L, 0.18, 0.18, STEEL)
    const n = 16
    for (let k = 0; k <= n; k++) {
      const x = -HALL.x + (L * k) / n
      b.box('paint', x, (y0 + y1) / 2, z, 0.1, y1 - y0, 0.1, STEEL)
      if (k < n) {
        const x2 = -HALL.x + (L * (k + 1)) / n
        b.cylBetween('paint', [x, k % 2 ? y0 : y1, z], [x2, k % 2 ? y1 : y0, z], 0.045, STEEL, 4)
      }
    }
    for (const x of [-13.2, -5.6, 5.6, 13.2]) highBay(b, x, y0 - 0.08, z)
  }
  // longitudinal ties + purlins
  const zs = HALL.columnZ
  const zMax = Math.max(...zs)
  const zMin = Math.min(...zs)
  for (const x of [-HALL.x, -9.6, 0, 9.6, HALL.x]) b.box('paint', x, HALL.trussY1 + 0.15, (zMax + zMin) / 2, 0.14, 0.14, zMax - zMin, STEEL)
  // production banner hanging from the first truss
  const bz = zMax - 0.12
  for (const dx of [-3.6, 3.6]) b.cylBetween('metal', [-9.6 + dx, HALL.trussY0 - 0.06, bz], [-9.6 + dx, 9.2, bz], 0.02, DARK, 4)
  b.box('paint', -9.6, 8.45, bz, 7.6, 1.5, 0.05, '#1F2525')
  quad(ctx, 'sign', 's:banner', -9.6, 8.45, bz + 0.03, 7.5, 1.4, PI)
  quad(ctx, 'sign', 's:banner', -9.6, 8.45, bz - 0.03, 7.5, 1.4, 0)
}

const PIPES: { off: number; r: number; color: string; insulated?: boolean }[] = [
  { off: 1.1, r: 0.2, color: '#A95E39' },
  { off: 2.15, r: 0.28, color: '#C7CCCB', insulated: true },
  { off: 3.1, r: 0.16, color: '#E9B63F' },
  { off: 4.05, r: 0.24, color: '#4F7A5A' },
  { off: 5.2, r: 0.32, color: '#4F86A8' },
]

function addRacks(ctx: BuildCtx): void {
  const { b } = ctx
  const y = RACK.armY
  const rackSides: { sx: number; zs: number[] }[] = [
    { sx: -1, zs: [...HALL.columnZ, ...WEST_RACK_EXTRA_Z] },
    { sx: 1, zs: [...HALL.columnZ] },
  ]
  for (const { sx, zs } of rackSides) {
    const x0 = sx * HALL.x
    const zsSorted = [...zs].sort((a, c) => c - a)
    for (const z of zs) {
      if (!HALL.columnZ.includes(z)) {
        b.boxB('paint', x0, 0, z, 0.36, 6.2, 0.36, STEEL)
        b.boxB('concrete', x0, 0, z, 0.7, 0.2, 0.7, '#A29F94')
        hazardSleeve(b, x0, z, 0.36, 0.36)
      }
      // arm over the avenue + knee brace
      const xEnd = x0 + sx * RACK.armLen
      b.box('paint', (x0 + xEnd) / 2, y, z, RACK.armLen, 0.22, 0.24, STEEL)
      b.cylBetween('paint', [x0, y - 1.3, z], [x0 + sx * 1.5, y - 0.1, z], 0.06, STEEL, 6)
      b.box('paint', xEnd, y - 0.25, z, 0.2, 0.5, 0.24, STEEL)
    }
    const zTop = zsSorted[0] + 0.25
    const zBot = zsSorted[zsSorted.length - 1] - 0.25
    for (const p of PIPES) {
      const x = x0 + sx * p.off
      const py = y + 0.11 + p.r
      b.cylBetween('metal', [x, py, zTop], [x, py, zBot], p.r, p.color, p.r > 0.25 ? 12 : 10)
      // flanges at every support + end caps
      for (const z of zs) b.cylBetween('metal', [x, py, z - 0.05], [x, py, z + 0.05], p.r + 0.05, p.color, 10)
      if (p.insulated) for (let z = zBot + 1; z < zTop; z += 1.2) b.cylBetween('metal', [x, py, z - 0.03], [x, py, z + 0.03], p.r + 0.02, '#8E9496', 10)
    }
    // pipe bridge truss over the north road (west rack only)
    if (sx < 0) {
      const za = -15.4
      const zb = -25.0
      for (const xx of [x0 - 0.6, x0 - 5.6]) {
        b.box('paint', xx, y - 0.9, (za + zb) / 2, 0.12, 0.12, za - zb, STEEL)
        const n = 6
        for (let k = 0; k < n; k++) {
          const z1 = za - ((za - zb) * k) / n
          const z2 = za - ((za - zb) * (k + 1)) / n
          b.cylBetween('paint', [xx, k % 2 ? y - 0.9 : y, z1], [xx, k % 2 ? y : y - 0.9, z2], 0.04, STEEL, 4)
        }
      }
    }
  }
  // Branches into the buildings (above head height). They enter the wall beside
  // the entrance sign + zone beacon, never through them, and clear the light poles.
  const branches: { from: number; to: number; z: number; y: number; color: string; r: number }[] = [
    { from: -HALL.x - 4.05, to: -30, z: 7.8, y: RACK.armY + 0.35, color: '#4F7A5A', r: 0.16 },
    { from: -HALL.x - 2.15, to: -30, z: -13.6, y: RACK.armY + 0.4, color: '#C7CCCB', r: 0.2 },
    { from: -HALL.x - 5.2, to: -30, z: -37.0, y: RACK.armY + 0.45, color: '#4F86A8', r: 0.2 },
    { from: HALL.x + 1.1, to: 30, z: 15.2, y: RACK.armY + 0.32, color: '#A95E39', r: 0.14 },
  ]
  for (const br of branches) {
    const yRack = RACK.armY + 0.11 + br.r
    b.cylBetween('metal', [br.from, yRack, br.z], [br.from, br.y, br.z], br.r, br.color, 8)
    b.sphere('metal', br.from, br.y, br.z, br.r * 1.05, br.color, 8, 6)
    b.cylBetween('metal', [br.from, br.y, br.z], [br.to, br.y, br.z], br.r, br.color, 8)
    b.cylBetween('metal', [br.to - Math.sign(br.to) * 0.12, br.y, br.z], [br.to, br.y, br.z], br.r + 0.08, br.color, 8)
  }
}

function addObsDeck(ctx: BuildCtx): void {
  const { b } = ctx
  const d = OBS_DECK
  const r = d.rect
  const h = d.height
  const cx = (r.minX + r.maxX) / 2
  const cz = (r.minZ + r.maxZ) / 2
  b.box('paint', cx, h - 0.12, cz, r.maxX - r.minX, 0.2, r.maxZ - r.minZ, DARK)
  b.box('grate', cx, h - 0.01, cz, r.maxX - r.minX - 0.05, 0.02, r.maxZ - r.minZ - 0.05, '#ffffff')
  // skirt hides the solid collider volume
  b.box('paint', cx, (h - 0.2) / 2, cz, r.maxX - r.minX - 0.1, h - 0.2, r.maxZ - r.minZ - 0.1, '#3A4143')
  for (const x of [r.minX + 0.15, r.maxX - 0.15]) for (const z of [r.minZ + 0.15, cz, r.maxZ - 0.15]) b.boxB('paint', x, 0, z, 0.16, h, 0.16, STEEL)
  // landing + ramp
  const L = d.landing
  b.box('paint', (L.minX + L.maxX) / 2, h - 0.12, (L.minZ + L.maxZ) / 2, L.maxX - L.minX, 0.2, L.maxZ - L.minZ, DARK)
  b.box('grate', (L.minX + L.maxX) / 2, h - 0.01, (L.minZ + L.maxZ) / 2, L.maxX - L.minX - 0.04, 0.02, L.maxZ - L.minZ - 0.04, '#ffffff')
  b.box('paint', (L.minX + L.maxX) / 2, (h - 0.2) / 2, (L.minZ + L.maxZ) / 2, L.maxX - L.minX - 0.08, h - 0.2, L.maxZ - L.minZ - 0.08, '#3A4143')
  const rp = d.ramp
  const len = Math.abs(rp.z1 - rp.z0)
  const slope = Math.atan2(h, len)
  const hyp = Math.hypot(len, h)
  const rx = (rp.minX + rp.maxX) / 2
  b.box('grate', rx, h / 2 + 0.005, (rp.z0 + rp.z1) / 2, rp.maxX - rp.minX, 0.04, hyp, '#ffffff', 0, slope)
  for (const x of [rp.minX + 0.05, rp.maxX - 0.05]) b.box('paint', x, h / 2 - 0.08, (rp.z0 + rp.z1) / 2, 0.1, 0.22, hyp, DARK, 0, slope)
  // railings (hazard yellow)
  const rail = (a: [number, number], c: [number, number], y0: number, y1: number) => {
    b.cylBetween('metal', [a[0], y0 + 1.05, a[1]], [c[0], y1 + 1.05, c[1]], 0.04, PALETTE.hazard, 6)
    b.cylBetween('metal', [a[0], y0 + 0.55, a[1]], [c[0], y1 + 0.55, c[1]], 0.03, PALETTE.hazard, 6)
    const n = Math.max(1, Math.round(Math.hypot(c[0] - a[0], c[1] - a[1]) / 1.2))
    for (let k = 0; k <= n; k++) {
      const t = k / n
      const x = a[0] + (c[0] - a[0]) * t
      const z = a[1] + (c[1] - a[1]) * t
      const yy = y0 + (y1 - y0) * t
      b.cylBetween('metal', [x, yy, z], [x, yy + 1.05, z], 0.03, PALETTE.hazard, 6)
    }
  }
  rail([L.minX, r.minZ], [r.maxX, r.minZ], h, h)
  rail([r.maxX, r.minZ], [r.maxX, r.maxZ], h, h)
  rail([r.minX, r.maxZ], [r.maxX, r.maxZ], h, h)
  rail([r.minX, r.maxZ], [r.minX, L.maxZ + 0.1], h, h)
  rail([L.minX, L.minZ], [L.minX, L.maxZ], h, h)
  rail([rp.minX, rp.z0], [rp.minX, rp.z1], 0, h)
  // coin-operated binoculars + sign
  b.cylY('paint', 2, h, r.minZ + 0.45, 0.07, 1.0, STEEL, 8)
  b.box('paint', 2, h + 1.15, r.minZ + 0.45, 0.46, 0.2, 0.3, '#3B6E8F')
  b.cylBetween('paint', [1.9, h + 1.18, r.minZ + 0.32], [1.9, h + 1.18, r.minZ + 0.18], 0.06, DARK, 8)
  b.cylBetween('paint', [2.1, h + 1.18, r.minZ + 0.32], [2.1, h + 1.18, r.minZ + 0.18], 0.06, DARK, 8)
  b.box('paint', 2, h + 0.8, r.maxZ + 0.02, 2.0, 0.62, 0.05, DARK)
  quad(ctx, 'sign', 's:obs', 2, h + 0.8, r.maxZ + 0.05, 1.94, 0.56, PI)
}

function addRecGate(ctx: BuildCtx): void {
  const { b } = ctx
  const g = REC_GATE
  for (const z of [g.z0, g.z1]) {
    b.cylY('paint', g.x, 0, z, 0.12, g.height, ZONES.rec.color, 10)
    b.cylY('concrete', g.x, 0, z, 0.3, 0.2, '#A29F94', 10)
  }
  const zc = (g.z0 + g.z1) / 2
  const w = Math.abs(g.z1 - g.z0)
  b.box('paint', g.x, 3.08, zc, 0.12, 0.7, w - 0.2, '#2B4A2C')
  quad(ctx, 'sign', 's:recgate', g.x - 0.065, 3.08, zc, w - 0.5, 0.62, PI / 2)
  quad(ctx, 'sign', 's:recgate', g.x + 0.065, 3.08, zc, w - 0.5, 0.62, -PI / 2)
}

function addSignposts(ctx: BuildCtx): void {
  const { b } = ctx
  for (const post of SIGNPOSTS) {
    const [px, pz] = post.position
    b.cylY('paint', px, 0, pz, 0.07, 3.1, '#3A4245', 8)
    b.cylY('concrete', px, 0, pz, 0.22, 0.12, '#A29F94', 10)
    b.cylY('paint', px, 3.1, pz, 0.1, 0.06, DARK, 8)
    const blades = bladesFor(post)
    const top = 2.85
    blades.forEach((bl, i) => {
      const y = top - i * 0.34
      const w = 1.5
      const h = 0.26
      const off = 0.09 + w / 2
      const cx = px + bl.dir[0] * off
      const cz = pz + bl.dir[1] * off
      // right-hand normal of the blade direction
      const nx = Math.cos(bl.yaw)
      const nz = -Math.sin(bl.yaw)
      const front = ctx.atlas.cells[`blade:${bl.zone}:right`]
      const back = ctx.atlas.cells[`blade:${bl.zone}:left`]
      if (front) b.plane('sign', cx + nx * 0.012, y, cz + nz * 0.012, w, h, bl.yaw - PI / 2, front.uv)
      if (back) b.plane('sign', cx - nx * 0.012, y, cz - nz * 0.012, w, h, bl.yaw + PI / 2, back.uv)
      b.cylBetween('metal', [px, y, pz], [px + bl.dir[0] * 0.12, y, pz + bl.dir[1] * 0.12], 0.04, DARK, 6)
    })
  }
}
