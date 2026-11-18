import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { PROJECTS, getProject } from '@/content/projects'
import { events } from '@/core/events'
import { useInteractable } from '@/core/interaction'
import { runtime } from '@/core/runtime'
import { useUIStore } from '@/state/ui'
import { ZONES } from '@/world/layout'
import { PALETTE } from '@/world/palette'
import { Batch } from '../shared/batch'
import { BatchMeshes } from '../shared/BatchMeshes'
import { buildAtlas, fitText, grime, roundRectPath, type UvRect } from '../shared/canvas'
import { StaticColliders } from '../shared/colliders'
import { FONT_DISPLAY } from '../shared/fonts'
import { useInteriorGate, useQuality, useReducedMotion } from '../shared/hooks'
import { Wisps } from '../shared/Wisps'
import { indexScreen, projectScreen, terminalScreens, type CrtScreen } from './crt'
import { serverColliders } from './colliders'
import { COLD_AISLES, DOOR, FAN, RACK, RACK_ROWS, TERMINAL, kioskInteractPoint, kioskLayout, type KioskDef } from './layout'
import { Racks } from './Racks'
import { buildScreenAtlas, buildScreenGeometry, makeScreenMaterial, tickScreens, type ScreenPlacement } from './screens'

/**
 * SERVER HALL (spec §5.4): blinking rack rows, overhead cable trays, perforated
 * cold-aisle tiles with fog wisps, a CRT kiosk per GitHub project along the
 * central aisle, the main GitHub terminal and a giant caged cooling fan.
 */
const BEIGE = '#cbc2a4'
const BEIGE_DARK = '#a79f84'
const ZONE_BLUE = ZONES.server.color
const DARK = '#262c2f'

const FAN_JOKES = [
  'Cooling Fan, Model YES. Speed setting: also yes. Please do not feed the fan.',
  'The cage is there to protect the fan from visitors, not the other way round.',
  'It is not loud. It is enthusiastic.',
  'Maintenance log: "Fan works great." Every entry. In the same handwriting.',
  'Airflow rating: enough to dry forty hard hats at once. Do not test this.',
]

// ---------------------------------------------------------------------------
// Sign atlas
// ---------------------------------------------------------------------------

interface ServerSigns {
  texture: THREE.CanvasTexture
  uv: Record<string, UvRect>
}

function buildSigns(): ServerSigns {
  const rows = RACK_ROWS.map((r) => r.label)
  const atlas = buildAtlas(
    [
      {
        id: 'header',
        w: 1024,
        h: 192,
        draw: (ctx, w, h) => {
          ctx.fillStyle = '#16232c'
          ctx.fillRect(0, 0, w, h)
          ctx.fillStyle = ZONE_BLUE
          ctx.fillRect(0, 0, w, 14)
          ctx.fillRect(0, h - 14, w, 14)
          ctx.fillStyle = '#EAE3D2'
          fitText(ctx, 'SERVER HALL', w * 0.29, h / 2 + 4, w * 0.5, 120, FONT_DISPLAY, 700)
          ctx.fillStyle = PALETTE.hazard
          fitText(ctx, '— CODE ON GITHUB', w * 0.74, h / 2 + 4, w * 0.46, 92, FONT_DISPLAY, 700)
          grime(ctx, w, h, 3, 0.25)
        },
      },
      ...rows.map((label, i) => ({
        id: `row:${i}`,
        w: 256,
        h: 112,
        draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => {
          ctx.fillStyle = ZONE_BLUE
          ctx.fillRect(0, 0, w, h)
          ctx.strokeStyle = '#EAE3D2'
          ctx.lineWidth = 6
          ctx.strokeRect(6, 6, w - 12, h - 12)
          ctx.fillStyle = '#F4F0E6'
          fitText(ctx, label, w / 2, h / 2 + 3, w - 40, 72, FONT_DISPLAY, 700)
        },
      })),
      {
        id: 'fanplate',
        w: 512,
        h: 220,
        draw: (ctx, w, h) => {
          ctx.fillStyle = PALETTE.hazard
          ctx.fillRect(0, 0, w, h)
          ctx.fillStyle = '#1a1e1f'
          ctx.fillRect(0, 0, w, 64)
          ctx.fillStyle = PALETTE.hazard
          fitText(ctx, '⚠ CAUTION', w / 2, 34, w - 40, 54, FONT_DISPLAY, 700)
          ctx.fillStyle = '#1a1e1f'
          fitText(ctx, 'COOLING FAN', w / 2, 112, w - 40, 64, FONT_DISPLAY, 700)
          fitText(ctx, 'DO NOT FEED THE FAN', w / 2, 172, w - 40, 46, FONT_DISPLAY, 600)
          grime(ctx, w, h, 9, 0.6)
        },
      },
      {
        id: 'keepclear',
        w: 512,
        h: 128,
        draw: (ctx, w, h) => {
          ctx.clearRect(0, 0, w, h)
          ctx.fillStyle = 'rgba(233,182,63,0.92)'
          fitText(ctx, 'KEEP CLEAR', w / 2, h / 2 + 4, w - 24, 104, FONT_DISPLAY, 700)
        },
      },
      {
        id: 'kioskplate',
        w: 256,
        h: 64,
        draw: (ctx, w, h) => {
          ctx.fillStyle = '#e9e2cc'
          roundRectPath(ctx, 2, 2, w - 4, h - 4, 10)
          ctx.fill()
          ctx.fillStyle = '#3b4246'
          fitText(ctx, 'MIW TERMINAL', w / 2, h / 2 + 2, w - 30, 40, FONT_DISPLAY, 700)
        },
      },
    ],
    1024,
    4,
  )
  return { texture: atlas.texture, uv: atlas.uv }
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3(1, 1, 1)

function local(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Matrix4 {
  _e.set(rx, ry, rz)
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e), _s)
}

/** One kiosk in local space (front faces -Z). Returns the screen placement in world space. */
function addKiosk(b: Batch, signs: ServerSigns): THREE.Matrix4 {
  b.boxB('paint', 0, 0, 0, 0.76, 0.07, 0.54, DARK)
  b.boxB('paint', 0, 0.07, 0.03, 0.5, 0.8, 0.38, BEIGE)
  b.box('paint', 0, 0.64, -0.161, 0.505, 0.05, 0.012, ZONE_BLUE)
  for (let k = 0; k < 5; k++) b.box('paint', 0, 0.22 + k * 0.055, -0.161, 0.3, 0.016, 0.01, '#5f5946')
  b.boxB('paint', 0, 0.87, -0.04, 0.78, 0.045, 0.52, BEIGE_DARK)
  // keyboard on the shelf, tilted toward the user
  b.groupR([0, 0.93, -0.17], [-0.16, 0, 0], () => {
    b.box('matte', 0, 0, 0, 0.56, 0.035, 0.2, '#34332f')
    for (let r = 0; r < 4; r++) b.box('matte', 0, 0.022, -0.07 + r * 0.045, 0.5, 0.012, 0.032, r === 3 ? '#c9c0a6' : '#ded6bd')
  })
  // CRT housing, tilted back a little
  let screen = new THREE.Matrix4()
  b.groupR([0, 0.91, -0.02], [0.1, 0, 0], () => {
    b.box('paint', 0, 0.3, 0, 0.62, 0.52, 0.46, BEIGE)
    b.box('paint', 0, 0.29, 0.26, 0.44, 0.38, 0.16, BEIGE_DARK)
    b.box('paint', 0, 0.31, -0.231, 0.52, 0.4, 0.012, '#1a1d1e')
    b.box('glow', 0.25, 0.08, -0.236, 0.022, 0.022, 0.006, '#59ff86')
    b.quad('sign', -0.13, 0.075, -0.236, 0.2, 0.05, [0, Math.PI, 0], signs.uv.kioskplate)
    // ventilation ribs on the top
    for (let k = 0; k < 4; k++) b.box('paint', 0, 0.565, 0.02 + k * 0.08, 0.4, 0.012, 0.03, BEIGE_DARK)
    screen = b.currentMatrix().multiply(local(0, 0.31, -0.236, 0, Math.PI, 0))
  })
  // cable into the floor
  b.cylBetween('rubber', [0.16, 0.92, 0.3], [0.2, 0.02, 0.24], 0.016, '#1d1f20', 6)
  return screen
}

function addTerminal(b: Batch, signs: ServerSigns): THREE.Matrix4[] {
  const screens: THREE.Matrix4[] = []
  // desk
  b.boxB('paint', 0, 0, 0.06, 2.6, 0.78, 0.84, '#bdb497')
  b.boxB('paint', 0, 0, -0.34, 2.5, 0.09, 0.04, DARK)
  b.boxB('paint', 0, 0.78, 0, 2.72, 0.05, 1.02, '#6f6a5c')
  for (const x of [-0.65, 0, 0.65]) b.box('paint', x, 0.42, -0.37, 0.5, 0.46, 0.015, '#a9a084')
  b.box('paint', 0, 0.62, -0.38, 2.5, 0.05, 0.012, ZONE_BLUE)
  // sloped control panel with buttons
  b.groupR([0, 0.86, -0.3], [-0.42, 0, 0], () => {
    b.box('paint', 0, 0, 0, 2.3, 0.05, 0.34, '#373e41')
    const cols = ['#ff4b3e', '#ffc23f', '#59ff86', '#6fc8ff']
    for (let i = 0; i < 18; i++) {
      const x = -1.0 + i * 0.118
      b.box('glow', x, 0.03, -0.06, 0.05, 0.02, 0.05, cols[i % cols.length])
      b.box('paint', x, 0.03, 0.07, 0.035, 0.03, 0.035, '#c9c3b0')
    }
    b.box('matte', 0, 0.03, 0.02, 0.7, 0.025, 0.12, '#2a2928')
  })
  // three monitors
  const mon = (x: number, yaw: number, w: number, h: number) => {
    b.groupR([x, 0.83, 0.16], [0.06, yaw, 0], () => {
      b.box('paint', 0, h / 2 + 0.06, 0, w + 0.12, h + 0.12, 0.5, BEIGE)
      b.box('paint', 0, h / 2 + 0.06, 0.32, w * 0.7, h * 0.7, 0.2, BEIGE_DARK)
      b.box('paint', 0, h / 2 + 0.06, -0.252, w + 0.04, h + 0.04, 0.012, '#191c1d')
      b.boxB('paint', 0, -0.02, 0, w * 0.5, 0.04, 0.3, BEIGE_DARK)
      b.box('glow', w / 2, 0.035, -0.256, 0.022, 0.022, 0.006, '#59ff86')
      screens.push(b.currentMatrix().multiply(local(0, h / 2 + 0.06, -0.258, 0, Math.PI, 0)))
    })
  }
  mon(-0.98, -0.3, 0.52, 0.39)
  mon(0, 0, 0.74, 0.555)
  mon(0.98, 0.3, 0.52, 0.39)
  // header sign on posts
  for (const x of [-1.27, 1.27]) {
    b.cyl('metal', x, 0.81, 0.36, 0.045, 2.55, '#8d979a', 10)
    b.box('paint', x, 0.84, 0.36, 0.16, 0.04, 0.16, DARK)
  }
  b.box('paint', 0, 3.02, 0.36, 2.92, 0.66, 0.14, '#1d2830')
  b.quad('signLit', 0, 3.02, 0.288, 2.8, 0.525, [0, Math.PI, 0], signs.uv.header)
  b.quad('signLit', 0, 3.02, 0.432, 2.8, 0.525, [0, 0, 0], signs.uv.header)
  b.box('glow', 0, 3.39, 0.36, 2.6, 0.03, 0.03, '#9fd8ff')
  // cable bundle from the desk to the overhead tray
  b.cylBetween('rubber', [0.9, 0.8, 0.48], [0.9, 2.95, 0.6], 0.05, '#2a3a52', 8)
  b.cylBetween('rubber', [0.98, 0.8, 0.48], [1.0, 2.95, 0.62], 0.035, '#a8852a', 8)
  return screens
}

/** The giant fan: static frame/housing/cage (world space). Rotor is separate. */
function addFanStatic(b: Batch, signs: ServerSigns): void {
  const { x, y, z, radius: R } = FAN
  const wallX = x + 0.02
  // wall plate + bolts
  b.boxMinMax('paint', wallX, y - 2.85, z - 2.85, wallX + 0.12, y + 2.85, z + 2.85, '#353d41')
  for (const dz of [-2.65, 2.65]) for (const dy of [-2.65, 2.65]) b.sphere('metal', wallX + 0.13, y + dy, z + dz, 0.05, '#9aa3a5', 8, 6)
  // motor housing visible behind the hub
  b.geo('paint', unitCylX(), [wallX + 0.4, y, z], [0, 0, Math.PI / 2], [0.55, 0.5, 0.55], '#2c3336')
  // venturi drum (outer + inner surface) and front ring
  b.geo('paint', unitCylOpen(), [wallX + 0.5, y, z], [0, 0, Math.PI / 2], [R + 0.06, 0.8, R + 0.06], '#4a5458')
  b.geo('paint', unitCylOpen(), [wallX + 0.5, y, z], [0, 0, Math.PI / 2], [R + 0.02, 0.8, -(R + 0.02)], '#272e31')
  b.torus('paint', wallX + 0.92, y, z, R + 0.06, 0.13, PALETTE.hazard, [0, Math.PI / 2, 0], 8, 48)
  b.torus('paint', wallX + 0.12, y, z, R + 0.1, 0.1, '#4a5458', [0, Math.PI / 2, 0], 6, 40)
  // cage: concentric rings + spokes
  const cx = FAN.cageX
  for (const r of [0.5, 0.95, 1.4, 1.85, 2.3]) b.torus('metal', cx, y, z, r, 0.022, '#aab3b5', [0, Math.PI / 2, 0], 5, Math.round(16 + r * 14))
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2
    b.cylBetween('metal', [cx, y + Math.sin(a) * 0.3, z + Math.cos(a) * 0.3], [cx - 0.1, y + Math.sin(a) * (R + 0.05), z + Math.cos(a) * (R + 0.05)], 0.018, '#aab3b5', 5)
  }
  b.geo('metal', unitCylX(), [cx, y, z], [0, 0, Math.PI / 2], [0.3, 0.06, 0.3], '#c3c9ca')
  // struts from the plate corners to the ring
  for (const dz of [-1, 1]) for (const dy of [-1, 1]) b.cylBetween('paint', [wallX + 0.1, y + dy * 2.6, z + dz * 2.6], [wallX + 0.85, y + dy * 1.85, z + dz * 1.85], 0.05, '#4a5458', 6)
  // caution plate on the wall beside the fan
  b.box('paint', wallX + 0.14, 1.35, z - 3.35, 0.03, 0.62, 1.32, DARK)
  b.quad('sign', wallX + 0.16, 1.35, z - 3.35, 1.24, 0.53, [0, Math.PI / 2, 0], signs.uv.fanplate)
  // floor: hazard band + KEEP CLEAR stencil in front of the fan
  b.boxMinMax('hazard', wallX + 0.1, 0.016, z - 2.95, FAN.cageX + 0.75, 0.024, z - 2.6, '#ffffff')
  b.boxMinMax('hazard', wallX + 0.1, 0.016, z + 2.6, FAN.cageX + 0.75, 0.024, z + 2.95, '#ffffff')
  b.boxMinMax('hazard', FAN.cageX + 0.45, 0.016, z - 2.6, FAN.cageX + 0.75, 0.024, z + 2.6, '#ffffff')
  b.quad('decal', FAN.cageX + 0.2, 0.026, z, 2.2, 0.55, [-Math.PI / 2, 0, Math.PI / 2], signs.uv.keepclear)
}

let cylX: THREE.BufferGeometry | null = null
let cylOpen: THREE.BufferGeometry | null = null
const unitCylX = () => (cylX ??= new THREE.CylinderGeometry(1, 1, 1, 28))
const unitCylOpen = () => (cylOpen ??= new THREE.CylinderGeometry(1, 1, 1, 40, 1, true))

/** Rotor in local space (axis = +X, origin at the hub). */
function buildRotor(): Map<string, THREE.BufferGeometry> {
  const b = new Batch()
  const blades = 7
  for (let k = 0; k < blades; k++) {
    const a = (k / blades) * Math.PI * 2
    b.groupR([0, 0, 0], [a, 0, 0], () => {
      // blade: radial along +Y, twisted (pitch) about its own axis
      b.groupR([0, 1.38, 0], [0, 0.42, 0], () => {
        b.box('metal', 0, 0, 0, 0.05, 1.95, 0.62, '#7f8a8d')
        b.box('metal', 0.002, 0.88, 0, 0.055, 0.16, 0.6, PALETTE.hazard)
      })
    })
  }
  b.geo('paint', unitCylX(), [0, 0, 0], [0, 0, Math.PI / 2], [0.46, 0.34, 0.46], '#2f3639')
  b.sphere('paint', 0.12, 0, 0, 0.36, PALETTE.safety, 14, 10, [0.6, 1, 1])
  return b.build()
}

// ---------------------------------------------------------------------------
// Floor: perforated cold-aisle tiles + aisle edge lines
// ---------------------------------------------------------------------------

let perfMat: THREE.MeshStandardMaterial | null = null
function perforatedMaterial(): THREE.MeshStandardMaterial {
  if (perfMat) return perfMat
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#c3ccd0'
  ctx.fillRect(0, 0, 128, 128)
  ctx.fillStyle = '#5d676c'
  ctx.fillRect(0, 0, 128, 3)
  ctx.fillRect(0, 0, 3, 128)
  ctx.fillStyle = '#2a3236'
  for (let y = 12; y < 124; y += 9) for (let x = 12; x < 124; x += 9) ctx.fillRect(x, y, 5, 5)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 4
  perfMat = new THREE.MeshStandardMaterial({ map: tex, color: '#d9e6ec', roughness: 0.55, metalness: 0.35, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })
  perfMat.name = 'stations-b:perforated'
  return perfMat
}

function perforatedFloor(): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = []
  for (const r of COLD_AISLES) {
    const w = r.maxX - r.minX
    const d = r.maxZ - r.minZ
    const g = new THREE.PlaneGeometry(w, d)
    const uv = g.getAttribute('uv') as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / 0.6), uv.getY(i) * (d / 0.6))
    g.rotateX(-Math.PI / 2)
    g.translate((r.minX + r.maxX) / 2, 0.022, (r.minZ + r.maxZ) / 2)
    geos.push(g)
  }
  // simple merge (two quads)
  const out = new THREE.BufferGeometry()
  const pos: number[] = []
  const nor: number[] = []
  const uvs: number[] = []
  const idx: number[] = []
  let o = 0
  for (const g of geos) {
    const p = g.getAttribute('position')
    const n = g.getAttribute('normal')
    const u = g.getAttribute('uv')
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i))
      nor.push(n.getX(i), n.getY(i), n.getZ(i))
      uvs.push(u.getX(i), u.getY(i))
    }
    const gi = g.index!
    for (let i = 0; i < gi.count; i++) idx.push(gi.getX(i) + o)
    o += p.count
    g.dispose()
  }
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  out.setIndex(idx)
  out.computeBoundingSphere()
  return out
}

/** Cable trays over the rack rows (separate mesh: the camera may fade it). */
function buildTrays(): Map<string, THREE.BufferGeometry> {
  const b = new Batch()
  const Y = 2.48
  const TRAY = '#c99a2e'
  const tray = (x0: number, z0: number, x1: number, z1: number, y: number) => {
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0)
    const half = 0.17
    const lo = alongX ? Math.min(x0, x1) : Math.min(z0, z1)
    const hi = alongX ? Math.max(x0, x1) : Math.max(z0, z1)
    const fixed = alongX ? z0 : x0
    // side rails
    for (const s of [-1, 1]) {
      if (alongX) b.boxMinMax('paint', lo, y - 0.05, fixed + s * half - 0.015, hi, y + 0.05, fixed + s * half + 0.015, TRAY)
      else b.boxMinMax('paint', fixed + s * half - 0.015, y - 0.05, lo, fixed + s * half + 0.015, y + 0.05, hi, TRAY)
    }
    // rungs
    const n = Math.max(1, Math.floor((hi - lo) / 0.3))
    for (let i = 0; i <= n; i++) {
      const a = lo + ((hi - lo) * i) / n
      if (alongX) b.box('paint', a, y - 0.045, fixed, 0.025, 0.012, half * 2, TRAY)
      else b.box('paint', fixed, y - 0.045, a, half * 2, 0.012, 0.025, TRAY)
    }
    // cable bundles laid in the tray
    const cols = ['#2f6fb5', '#e0b13a', '#c24a3a', '#3d9a5b', '#2a2d30']
    cols.forEach((c, k) => {
      const off = (k - 2) * 0.055
      if (alongX) b.cylBetween('rubber', [lo, y - 0.015, fixed + off], [hi, y - 0.015, fixed + off], 0.024, c, 6)
      else b.cylBetween('rubber', [fixed + off, y - 0.015, lo], [fixed + off, y - 0.015, hi], 0.024, c, 6)
    })
  }
  for (const row of RACK_ROWS) tray(row.x, row.z0 + 0.1, row.x, row.z1 - 0.1, Y)
  // east-west trunks over each block, hung from the roof trusses
  const trunkZ = { N: (RACK_ROWS[0].z0 + RACK_ROWS[0].z1) / 2, S: (RACK_ROWS[3].z0 + RACK_ROWS[3].z1) / 2 }
  for (const z of [trunkZ.N, trunkZ.S]) {
    tray(-37.5, z, -31.3, z, Y + 0.32)
    for (const x of [-37.2, -33.5, -31.6]) b.cylBetween('metal', [x, Y + 0.38, z], [x, INTERIOR_TOP, z], 0.012, '#8d979a', 4)
    // drops from the trunk into each row tray
    for (const row of RACK_ROWS.filter((r) => Math.abs((r.z0 + r.z1) / 2 - z) < 2.5))
      b.cylBetween('rubber', [row.x, Y + 0.3, z], [row.x, Y + 0.02, z + 0.02], 0.04, '#2f6fb5', 6)
  }
  // crossing over the aisle near the terminal (to the main terminal's cable riser)
  tray(-37.6, trunkZ.N, -37.6, trunkZ.S, Y + 0.62)
  for (const z of [trunkZ.N, trunkZ.S]) b.cylBetween('metal', [-37.6, Y + 0.32, z], [-37.6, Y + 0.62, z], 0.03, '#8d979a', 6)
  return b.build()
}

const INTERIOR_TOP = (ZONES.server.building?.height ?? 8.5) - 0.3

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function useServerBuild() {
  return useMemo(() => {
    const signs = buildSigns()
    const kiosks = kioskLayout()
    const b = new Batch()
    const placements: ScreenPlacement[] = []
    const screens: CrtScreen[] = []
    // kiosks
    const total = PROJECTS.length
    for (const k of kiosks) {
      let s: CrtScreen
      if (k.content.kind === 'project') {
        const p = getProject(k.content.projectId)!
        s = projectScreen(p, k.content.index, total)
      } else s = indexScreen()
      const id = `${k.id}`
      screens.push({ ...s, id })
      b.group(k.x, 0, k.z, k.yaw, () => {
        const m = addKiosk(b, signs)
        placements.push({ id, matrix: m, w: 0.46, h: 0.345 })
      })
    }
    // row end caps: labels above the kiosks + side panels
    for (const row of RACK_ROWS) {
      const endZ = row.block === 'N' ? row.z1 : row.z0
      const out = row.block === 'N' ? 1 : -1
      const i = RACK_ROWS.indexOf(row)
      b.box('paint', row.x, 1.06 + 0.06, endZ + out * 0.012, RACK.d + 0.02, RACK.h - 0.02, 0.02, '#1f2629')
      b.quad('sign', row.x, 1.92, endZ + out * 0.026, 0.62, 0.27, [0, out > 0 ? 0 : Math.PI, 0], signs.uv[`row:${i}`])
      b.box('glow', row.x, 2.18, endZ + out * 0.03, RACK.d - 0.1, 0.02, 0.01, ZONE_BLUE)
    }
    // main terminal
    let termScreens: THREE.Matrix4[] = []
    b.group(TERMINAL.x, 0, TERMINAL.z, TERMINAL.yaw, () => {
      termScreens = addTerminal(b, signs)
    })
    terminalScreens().forEach((s, i) => {
      screens.push(s)
      const big = i === 1
      placements.push({ id: s.id, matrix: termScreens[i], w: big ? 0.7 : 0.48, h: big ? 0.525 : 0.36 })
    })
    // fan (static)
    addFanStatic(b, signs)
    // aisle edge lines (thin painted strips)
    for (const z of [-11.0, -7.0]) b.boxMinMax('paint', -37.3, 0.015, z - 0.05, DOOR.x - 0.6, 0.021, z + 0.05, PALETTE.hazard)
    // a couple of floor tiles lifted for "maintenance" (with a cone): pure set dressing in the corridor
    b.boxMinMax('paint', -31.9, 0.015, -15.25, -31.3, 0.03, -14.75, '#11161a')
    b.cyl('matte', -31.0, 0, -14.1, 0.16, 0.48, PALETTE.safety, 12, 0.15)
    b.box('matte', -31.0, 0.012, -14.1, 0.36, 0.024, 0.36, PALETTE.safety)

    const geos = b.build()
    const atlas = buildScreenAtlas(screens)
    const screenGeo = buildScreenGeometry(placements, atlas)
    const screenMat = makeScreenMaterial(atlas.texture)
    const signMat = new THREE.MeshStandardMaterial({ map: signs.texture, emissiveMap: signs.texture, emissive: '#ffffff', emissiveIntensity: 0.32, roughness: 0.6, metalness: 0.05 })
    signMat.name = 'stations-b:server-signs'
    const signLit = new THREE.MeshBasicMaterial({ map: signs.texture, toneMapped: false })
    signLit.name = 'stations-b:server-signs-lit'
    const decalMat = new THREE.MeshBasicMaterial({ map: signs.texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })
    decalMat.name = 'stations-b:server-decal'
    const rotor = buildRotor()
    const trays = buildTrays()
    const floor = perforatedFloor()
    return { geos, kiosks, screenGeo, screenMat, signMat, signLit, decalMat, signTex: signs.texture, atlasTex: atlas.texture, rotor, trays, floor }
  }, [])
}

function KioskInteract({ k }: { k: KioskDef }) {
  const p = kioskInteractPoint(k)
  const project = k.content.kind === 'project' ? getProject(k.content.projectId) : undefined
  useInteractable({
    id: k.id,
    verb: project ? 'Read' : 'Browse',
    label: project ? project.name : 'Repository Index',
    radius: 1.9,
    priority: 0.2,
    getPosition: () => ({ x: p.x, y: 0, z: p.z }),
    onInteract: () => {
      events.emit('sfx', { name: 'scanner-beep', position: [k.x, 1.3, k.z], volume: 0.6 })
      if (project) useUIStore.getState().openPanel('project', { projectId: project.id })
      else useUIStore.getState().openPanel('github')
    },
  })
  return null
}

function TerminalInteract() {
  useInteractable({
    id: 'server:terminal',
    verb: 'Browse',
    label: 'GitHub Terminal',
    radius: 2.6,
    priority: 0.3,
    getPosition: () => ({ x: TERMINAL.interact.x, y: 0, z: TERMINAL.interact.z }),
    onInteract: () => {
      events.emit('sfx', { name: 'scanner-beep', position: [TERMINAL.x, 1.2, TERMINAL.z], volume: 0.7 })
      useUIStore.getState().openPanel('github')
    },
  })
  return null
}

function FanInteract() {
  const n = useRef(0)
  useInteractable({
    id: 'server:fan',
    verb: 'Inspect',
    label: 'Giant Cooling Fan',
    radius: 2.4,
    getPosition: () => ({ x: FAN.interact.x, y: 0, z: FAN.interact.z }),
    onInteract: () => {
      const text = FAN_JOKES[n.current % FAN_JOKES.length]
      n.current++
      events.emit('toast', { text, kind: 'info', duration: 5.5 })
      events.emit('sfx', { name: 'machine-clank', position: [FAN.cageX, 1.5, FAN.z], volume: 0.5 })
    },
  })
  return null
}

function FanRotor({ geos }: { geos: Map<string, THREE.BufferGeometry> }) {
  const ref = useRef<THREE.Group>(null)
  const reduced = useReducedMotion()
  const speed = useRef(4.2)
  useFrame((_, dt) => {
    const g = ref.current
    if (!g || !g.parent?.visible) return
    const level = Number.isFinite(runtime.lighting.level) ? runtime.lighting.level : 1
    const target = (reduced ? 1.6 : 4.2) * (0.2 + 0.8 * Math.min(1, Math.max(0, level)))
    speed.current += (target - speed.current) * Math.min(1, dt * 0.8)
    g.rotation.x = (g.rotation.x + speed.current * Math.min(dt, 0.1)) % (Math.PI * 2)
  })
  return (
    <group position={[FAN.x + 0.62, FAN.y, FAN.z]}>
      <group ref={ref}>
        <BatchMeshes geos={geos} shadows={false} name="fan-rotor" />
      </group>
    </group>
  )
}

function Screens({ geo, mat }: { geo: THREE.BufferGeometry; mat: THREE.ShaderMaterial }) {
  const reduced = useReducedMotion()
  useFrame(() => tickScreens(reduced))
  return <mesh geometry={geo} material={mat} name="server-screens" renderOrder={1} />
}

export function ServerHall() {
  const root = useRef<THREE.Group>(null)
  const quality = useQuality()
  const built = useServerBuild()
  const colliders = useMemo(() => serverColliders(), [])
  useInteriorGate(root, 'server', { x: DOOR.x, z: (DOOR.z0 + DOOR.z1) / 2, side: 'E' })

  useEffect(
    () => () => {
      built.screenGeo.dispose()
      built.screenMat.dispose()
      built.signMat.dispose()
      built.signLit.dispose()
      built.decalMat.dispose()
      built.signTex.dispose()
      built.atlasTex.dispose()
      built.floor.dispose()
    },
    [built],
  )

  const wisps = quality === 'low' ? 0 : quality === 'high' ? 22 : 14

  return (
    <group name="stations-b:server-hall">
      <group ref={root}>
        <BatchMeshes geos={built.geos} shadows={false} materials={{ sign: built.signMat, signLit: built.signLit, decal: built.decalMat }} name="server" />
        <group userData={{ cameraFade: true }} name="server-trays">
          <BatchMeshes geos={built.trays} shadows={false} name="server-trays" />
        </group>
        <mesh geometry={built.floor} material={perforatedMaterial()} receiveShadow name="server-perforated" />
        <Screens geo={built.screenGeo} mat={built.screenMat} />
        <Racks />
        <FanRotor geos={built.rotor} />
        <Wisps areas={COLD_AISLES} count={wisps} rise={1.5} size={0.75} opacity={0.26} />
      </group>
      <StaticColliders defs={colliders} name="stations-b:server-colliders" />
      {built.kiosks.map((k) => (
        <KioskInteract key={k.id} k={k} />
      ))}
      <TerminalInteract />
      <FanInteract />
    </group>
  )
}

