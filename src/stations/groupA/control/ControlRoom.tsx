import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { events, type GameEventName } from '@/core/events'
import { useInteractable } from '@/core/interaction'
import { wrapAngle, yawToward } from '@/core/math'
import { createRng } from '@/core/rng'
import { runtime } from '@/core/runtime'
import { useSettings } from '@/state/settings'
import { useUIStore } from '@/state/ui'
import { factory } from '@/systems/factory'
import { ANCHORS, ZONES } from '@/world/layout'
import { WorkerModel } from '@/world/WorkerModel'
import { Builder } from '../lib/builder'
import { type AtlasItem, buildAtlas, canvasTexture, fitText, makeCanvas, rivets, roundRect, type Ctx } from '../lib/canvas'
import { C } from '../lib/materials'
import { BuiltMeshes, StaticColliders, useBuilt, type BoxCol, type CylCol } from '../lib/react'
import { drawScreen, type ScreenData, type ScreenKind } from './screens'
import { EventLog, PHASE_LABEL, Telemetry, describeEvent } from './telemetry'

/**
 * MANUFACTURING CONTROL ROOM — Harmony AI (zone 'control').
 * A mission-control style room: a 3×3 monitor wall plus console and desk
 * monitors (16 screens in ONE canvas atlas, redrawn ~4 Hz while the visitor
 * is nearby) showing live telemetry from the factory SIMULATION, every screen
 * labelled "SIMULATED FACTORY DATA"; status-light panels and blinking console
 * buttons; operator desks, chairs, mugs; the HARMONY AI sign. The main
 * console (ANCHORS.controlConsole) opens the Harmony panel.
 */
const IN = ZONES.control.building!.interior
const INTERACT = ANCHORS.controlConsole.interact as [number, number]
const CZ = ANCHORS.controlConsole.position[1]
const WALL_X = IN.minX // inner face of the west wall
const SCREEN_X = WALL_X + 0.16

// --- screen layout ------------------------------------------------------------
const ATLAS = 1024
const WALL_PX = { w: 340, h: 192 }
const SMALL_PX = { w: 252, h: 156 }
const WALL_KINDS: ScreenKind[] = ['overview', 'assembly', 'launch', 'rates', 'odds', 'counter', 'trend', 'log', 'qc']
const WALL_SIZE = { w: 2.0, h: 1.12 }
const WALL_COL_Z = [CZ + 2.1, CZ, CZ - 2.1] // viewer (facing west) left → right = south → north
const WALL_ROW_Y = [4.0, 2.82, 1.64]

interface ScreenSlot {
  kind: ScreenKind
  px: [number, number, number, number]
  /** World center + facing yaw + size. */
  pos: [number, number, number]
  w: number
  h: number
  tilt: number
}

const CONSOLE = { x0: -37.45, x1: -35.75, z0: CZ - 2.4, z1: CZ + 2.4, top: 0.78 }
/** Sloped button deck between the keyboards (east) and the monitor riser (west). */
const DECK = { x: -36.45, w: 0.6, slope: 0.25 }
/** Height of the deck's top surface at world x (rises toward the west). */
const deckY = (x: number) => CONSOLE.top + 0.125 + (DECK.x - x) * Math.tan(DECK.slope)
const MON_X = -37.0
const DESKS = [
  { x0: -42.45, x1: -41.2, z0: 8.2, z1: 11.6, chairZ: 9.9 },
  { x0: -42.45, x1: -41.2, z0: 14.4, z1: 17.8, chairZ: 16.1 },
]
const CHAIR_X = -40.35
const SPARE_CHAIR: [number, number] = [-34.75, 15.85]
const OPERATOR = { x: CHAIR_X, z: DESKS[0].chairZ, yaw: Math.PI / 2 }

function screenSlots(): ScreenSlot[] {
  const out: ScreenSlot[] = []
  WALL_KINDS.forEach((kind, i) => {
    const r = Math.floor(i / 3)
    const c = i % 3
    out.push({
      kind,
      px: [2 + c * (WALL_PX.w + 1), 2 + r * (WALL_PX.h + 1), WALL_PX.w, WALL_PX.h],
      pos: [SCREEN_X, WALL_ROW_Y[r], WALL_COL_Z[c]],
      w: WALL_SIZE.w,
      h: WALL_SIZE.h,
      tilt: 0,
    })
  })
  const smallKinds: ScreenKind[] = ['settings', 'readme', 'schedule', 'padcam', 'hoppers', 'history', 'belts']
  const smallPos: [number, number, number][] = [
    [MON_X + 0.02, 1.32, CZ + 1.55],
    [MON_X + 0.02, 1.32, CZ],
    [MON_X + 0.02, 1.32, CZ - 1.55],
    [-41.95, 1.27, DESKS[0].z0 + 2.45],
    [-41.95, 1.27, DESKS[0].z0 + 0.95],
    [-41.95, 1.27, DESKS[1].z0 + 2.45],
    [-41.95, 1.27, DESKS[1].z0 + 0.95],
  ]
  smallKinds.forEach((kind, i) => {
    const r = Math.floor(i / 4)
    const c = i % 4
    const consoleMon = i < 3
    out.push({
      kind,
      px: [2 + c * (SMALL_PX.w + 2), 2 + 3 * (WALL_PX.h + 1) + 4 + r * (SMALL_PX.h + 2), SMALL_PX.w, SMALL_PX.h],
      pos: smallPos[i],
      w: consoleMon ? 0.95 : 0.78,
      h: consoleMon ? 0.59 : 0.48,
      tilt: -0.12,
    })
  })
  return out
}
const SLOTS = screenSlots()

// --- static signage atlas -------------------------------------------------------

function drawBigSign(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = '#152022'
  roundRect(ctx, 0, 0, w, h, 14)
  ctx.fill()
  ctx.strokeStyle = '#638C88'
  ctx.lineWidth = 5
  roundRect(ctx, 6, 6, w - 12, h - 12, 10)
  ctx.stroke()
  ctx.textBaseline = 'middle'
  const a = 'HARMONY AI'
  const b = '  ·  MANUFACTURING CONTROL ROOM'
  let size = h * 0.56
  ctx.font = `700 ${size}px "MIWSA Barlow", "Barlow Condensed", sans-serif`
  let wa = ctx.measureText(a).width
  ctx.font = `600 ${size * 0.82}px "MIWSA Barlow", "Barlow Condensed", sans-serif`
  let wb = ctx.measureText(b).width
  const k = Math.min(1, (w - 80) / (wa + wb))
  size *= k
  wa *= k
  wb *= k
  const x0 = w / 2 - (wa + wb) / 2
  ctx.textAlign = 'left'
  ctx.fillStyle = '#e9f4f0'
  ctx.font = `700 ${size}px "MIWSA Barlow", "Barlow Condensed", sans-serif`
  ctx.fillText(a, x0, h * 0.53)
  ctx.fillStyle = '#7fd0c2'
  ctx.font = `600 ${size * 0.82}px "MIWSA Barlow", "Barlow Condensed", sans-serif`
  ctx.fillText(b, x0 + wa, h * 0.55)
}

function drawPanelLabel(text: string) {
  return (ctx: Ctx, w: number, h: number) => {
    ctx.fillStyle = '#20292b'
    roundRect(ctx, 0, 0, w, h, 6)
    ctx.fill()
    fitText(ctx, text, w / 2, h / 2 + 1, w - 14, h * 0.62, { color: '#d6efe9', tracking: 0.06 })
    rivets(ctx, 0, 0, w, h, 8, 3)
  }
}

function drawMugLogo(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = '#efe9dd'
  ctx.fillRect(0, 0, w, h)
  fitText(ctx, '#1 OPERATOR', w / 2, h / 2, w - 6, h * 0.5, { color: '#c8302a' })
}

const STATIC_ITEMS: AtlasItem[] = [
  { key: 'sign', w: 1700, h: 116, draw: drawBigSign },
  { key: 'lbl:status-a', w: 300, h: 48, draw: drawPanelLabel('LINE STATUS A') },
  { key: 'lbl:status-b', w: 300, h: 48, draw: drawPanelLabel('LINE STATUS B') },
  { key: 'lbl:console', w: 360, h: 48, draw: drawPanelLabel('OPERATOR CONSOLE 1') },
  { key: 'mug', w: 96, h: 40, draw: drawMugLogo },
]

// --- geometry -------------------------------------------------------------------

function chair(b: Builder, x: number, z: number, yaw: number, color: string): void {
  b.push([x, 0, z], yaw)
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2
    b.tube('paint', [0, 0.08, 0], [Math.cos(a) * 0.3, 0.06, Math.sin(a) * 0.3], 0.022, C.charcoal, 6)
    b.sphere('dark', [Math.cos(a) * 0.3, 0.04, Math.sin(a) * 0.3], 0.035, C.rubber, 6, 4)
  }
  b.cyl('metal', 0, 0.08, 0, 0.03, 0.34, C.chrome, 8)
  b.rbox('dark', [0, 0.46, 0], [0.5, 0.09, 0.48], 0.04, color)
  b.rbox('dark', [0, 0.82, 0.25], [0.46, 0.56, 0.08], 0.04, color)
  b.box('paint', [0, 0.56, 0.23], [0.05, 0.22, 0.04], C.charcoal)
  for (const sx of [-1, 1]) b.box('paint', [sx * 0.26, 0.62, 0.02], [0.04, 0.04, 0.34], C.charcoal)
  b.pop()
}

function mug(b: Builder, x: number, y: number, z: number, color: string): void {
  b.cyl('paint', x, y, z, 0.045, 0.1, color, 12)
  b.torus('paint', [x + 0.05, y + 0.05, z], 0.028, 0.009, color, 'z', Math.PI * 2, 0, 5, 10)
  b.cyl('dark', x, y + 0.085, z, 0.038, 0.012, '#3a2416', 10)
}

function monitor(b: Builder, slot: ScreenSlot, standY0: number): void {
  const [x, y, z] = slot.pos
  b.push([x, y, z], Math.PI / 2, slot.tilt)
  b.rbox('paint', [0, 0, -0.035], [slot.w + 0.07, slot.h + 0.07, 0.06], 0.02, '#1b2021')
  b.pop()
  b.cyl('paint', x - 0.08, standY0, z, 0.025, y - standY0 - 0.1, C.charcoal, 8)
  b.box('paint', [x - 0.06, standY0 + 0.01, z], [0.22, 0.02, 0.3], C.charcoal)
}

function buildRoom(cells: Record<string, { uv: [number, number, number, number] }>): Builder {
  const b = new Builder()
  const uv = (k: string) => cells[k]?.uv ?? null
  const ry = Math.PI / 2 // facing east
  const zMid = CZ
  // ---- monitor wall: base cabinet, bezel frame, screen bezels ------------------
  const z0 = WALL_COL_Z[2] - WALL_SIZE.w / 2 - 0.12
  const z1 = WALL_COL_Z[0] + WALL_SIZE.w / 2 + 0.12
  b.box('paint', [WALL_X + 0.24, 0.42, zMid], [0.46, 0.84, z1 - z0], C.gunmetal)
  b.box('paint', [WALL_X + 0.48, 0.82, zMid], [0.04, 0.04, z1 - z0], C.teal)
  b.box('paint', [WALL_X + 0.07, 2.85, zMid], [0.12, 3.8, z1 - z0], '#141a1b')
  for (const slot of SLOTS.slice(0, 9)) b.box('paint', [SCREEN_X - 0.03, slot.pos[1], slot.pos[2]], [0.05, slot.h + 0.06, slot.w + 0.06], '#0b0f10')
  // ---- big sign (below the cable tray) --------------------------------------------
  b.box('paint', [WALL_X + 0.05, 5.1, zMid], [0.08, 0.74, 10.2], '#0f1617')
  b.plane('atlas', [WALL_X + 0.1, 5.1, zMid], 10.0, 0.68, '#ffffff', [0, ry, 0], uv('sign'))
  // ---- status light panels flanking the wall (above the env cabinets) -------------
  for (const [pz, key] of [
    [8.3, 'lbl:status-b'],
    [17.7, 'lbl:status-a'],
  ] as [number, string][]) {
    b.box('paint', [WALL_X + 0.08, 3.55, pz], [0.12, 2.1, 2.3], '#1b2223')
    b.box('paint', [WALL_X + 0.15, 3.55, pz], [0.02, 1.9, 2.1], '#0d1213')
    b.plane('atlas', [WALL_X + 0.17, 4.47, pz], 1.3, 0.2, '#ffffff', [0, ry, 0], uv(key))
  }
  // ---- main operator console (front faces east) ---------------------------------
  const c = CONSOLE
  b.rbox('paint', [(c.x0 + c.x1) / 2, 0.37, zMid], [c.x1 - c.x0, 0.74, c.z1 - c.z0], 0.03, C.gunmetal)
  b.box('paint', [c.x1 + 0.005, 0.42, zMid], [0.02, 0.5, c.z1 - c.z0 - 0.3], C.tealDark)
  b.box('paint', [(c.x0 + c.x1) / 2 + 0.03, c.top, zMid], [c.x1 - c.x0 + 0.12, 0.05, c.z1 - c.z0 + 0.06], C.charcoal)
  // sloped button deck (rises away from the operator) + monitor riser at the back
  b.box('paint', [DECK.x, c.top + 0.1, zMid], [DECK.w, 0.05, c.z1 - c.z0 - 0.2], '#2c3537', [0, 0, -DECK.slope])
  b.box('paint', [(c.x0 + DECK.x - DECK.w / 2) / 2, c.top + 0.1, zMid], [DECK.x - DECK.w / 2 - c.x0, 0.2, c.z1 - c.z0 - 0.1], C.gunmetal)
  b.plane('atlas', [c.x1 + 0.02, 0.62, zMid], 1.6, 0.21, '#ffffff', [0, ry, 0], uv('lbl:console'))
  for (const slot of SLOTS.slice(9, 12)) monitor(b, slot, c.top + 0.22)
  // keyboards + mice on the flat front zone
  for (const dz of [-1.55, 0, 1.55]) {
    b.box('paint', [c.x1 - 0.22, c.top + 0.04, zMid + dz], [0.18, 0.025, 0.55], '#1d2223')
    b.box('paint', [c.x1 - 0.22, c.top + 0.05, zMid + dz + 0.4], [0.1, 0.03, 0.06], '#1d2223')
  }
  mug(b, c.x1 - 0.2, c.top + 0.025, zMid - 2.05, '#efe9dd')
  mug(b, c.x1 - 0.24, c.top + 0.025, zMid + 2.05, '#C8553D')
  // ---- front-row operator desks (operators face west, monitors face them) --------
  for (const d of DESKS) {
    const dz = (d.z0 + d.z1) / 2
    b.rbox('paint', [(d.x0 + d.x1) / 2, 0.36, dz], [d.x1 - d.x0, 0.72, d.z1 - d.z0], 0.03, C.gunmetal)
    b.box('paint', [(d.x0 + d.x1) / 2 + 0.05, 0.74, dz], [d.x1 - d.x0 + 0.1, 0.04, d.z1 - d.z0 + 0.04], C.charcoal)
    b.box('paint', [d.x1 + 0.005, 0.4, dz], [0.02, 0.5, d.z1 - d.z0 - 0.3], C.tealDark)
    b.box('paint', [d.x1 - 0.18, 0.79, dz], [0.18, 0.025, 0.5], '#1d2223')
    mug(b, d.x1 - 0.2, 0.76, d.z0 + 0.35, '#4F86A8')
  }
  for (const slot of SLOTS.slice(12)) monitor(b, slot, 0.76)
  // chairs
  chair(b, CHAIR_X, DESKS[0].chairZ, Math.PI / 2, '#3E5A73')
  chair(b, CHAIR_X, DESKS[1].chairZ, Math.PI / 2 + 0.25, '#3E5A73')
  chair(b, SPARE_CHAIR[0], SPARE_CHAIR[1], -2.2, '#3E5A73')
  // cable bundle from the console riser down into a floor duct
  b.tube('dark', [MON_X - 0.2, 0.9, zMid - 0.4], [MON_X - 0.55, 0.05, zMid - 0.6], 0.04, C.rubber, 6)
  b.box('paint', [-38.6, 0.02, zMid - 0.6], [2.2, 0.04, 0.22], '#3a4244')
  return b
}

// --- instanced indicator lights / buttons --------------------------------------------

interface Light {
  x: number
  y: number
  z: number
  sx: number
  sy: number
  sz: number
  color: THREE.Color
  /** Blink rate (Hz) or 0 = steady; phase. */
  hz: number
  ph: number
  on: boolean
}

function makeLights(): Light[] {
  const rng = createRng(4404)
  const palette = ['#6fe07a', '#6fe07a', '#6fe07a', '#ffb23f', '#ff4b3a', '#6fc8ff']
  const out: Light[] = []
  // status panels: 6 columns x 8 rows each
  for (const pz of [8.3, 17.7])
    for (let r = 0; r < 8; r++)
      for (let k = 0; k < 6; k++) {
        out.push({
          x: WALL_X + 0.17,
          y: 2.75 + r * 0.22,
          z: pz - 0.85 + k * 0.34,
          sx: 0.02,
          sy: 0.09,
          sz: 0.16,
          color: new THREE.Color(palette[Math.floor(rng() * palette.length)]),
          hz: rng() < 0.3 ? 0.5 + rng() * 2.5 : 0,
          ph: rng() * 10,
          on: rng() < 0.85,
        })
      }
  // console button deck: 4 rows x 16
  const c = CONSOLE
  for (let r = 0; r < 4; r++)
    for (let k = 0; k < 16; k++) {
      const along = c.z0 + 0.35 + k * ((c.z1 - c.z0 - 0.7) / 15)
      const bx = DECK.x + DECK.w / 2 - 0.08 - r * 0.145
      out.push({
        x: bx,
        y: deckY(bx) + 0.012,
        z: along,
        sx: 0.06,
        sy: 0.025,
        sz: 0.06,
        color: new THREE.Color(palette[Math.floor(rng() * palette.length)]),
        hz: rng() < 0.25 ? 0.7 + rng() * 2 : 0,
        ph: rng() * 10,
        on: rng() < 0.7,
      })
    }
  // desk button strips
  for (const d of DESKS)
    for (let k = 0; k < 10; k++) {
      out.push({
        x: d.x1 - 0.06,
        y: 0.775,
        z: d.z0 + 0.35 + k * ((d.z1 - d.z0 - 0.7) / 9),
        sx: 0.05,
        sy: 0.02,
        sz: 0.05,
        color: new THREE.Color(palette[Math.floor(rng() * palette.length)]),
        hz: rng() < 0.3 ? 1 + rng() * 2 : 0,
        ph: rng() * 10,
        on: rng() < 0.75,
      })
    }
  return out
}

const LIGHTS = makeLights()
const _m = new THREE.Matrix4()
const _c = new THREE.Color()
const OFF = new THREE.Color('#1b2324')

const OPERATOR_LOOK = { helmet: '#E9E6DE', vest: '#638C88', shirt: '#2f3b44', accessory: 'headset' as const, face: 'glasses' as const, stripe: '#d8dcd6' }

/** Colliders (world AABBs). */
export const CONTROL_BOXES: BoxCol[] = [
  { c: [(CONSOLE.x0 + CONSOLE.x1) / 2, 0.95, CZ], h: [(CONSOLE.x1 - CONSOLE.x0) / 2 + 0.05, 0.95, (CONSOLE.z1 - CONSOLE.z0) / 2] },
  ...DESKS.map((d) => ({ c: [(d.x0 + d.x1) / 2, 0.8, (d.z0 + d.z1) / 2] as [number, number, number], h: [(d.x1 - d.x0) / 2 + 0.05, 0.8, (d.z1 - d.z0) / 2] as [number, number, number] })),
  // monitor wall base cabinet
  { c: [WALL_X + 0.25, 0.45, CZ], h: [0.25, 0.45, 3.25] },
]
export const CONTROL_CYLS: CylCol[] = [
  { c: [CHAIR_X, 0.5, DESKS[0].chairZ], r: 0.36, hh: 0.5 },
  { c: [CHAIR_X, 0.5, DESKS[1].chairZ], r: 0.33, hh: 0.5 },
  { c: [SPARE_CHAIR[0], 0.5, SPARE_CHAIR[1]], r: 0.33, hh: 0.5 },
]

const LOG_EVENTS: GameEventName[] = ['rocket:stage', 'rocket:complete', 'rocket:rollout', 'rocket:countdown', 'rocket:ignition', 'rocket:liftoff', 'rocket:outcome', 'rocket:reset', 'factory:params', 'nightshift:start', 'nightshift:end', 'osha:tackle']

export function ControlRoom({ shadows, lowTier }: { shadows: boolean; lowTier: boolean }) {
  const reduced = useSettings((s) => s.reducedMotion)
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced

  const statics = useMemo(() => buildAtlas(STATIC_ITEMS, 2048, { scale: lowTier ? 0.6 : 1, anisotropy: 8 }), [lowTier])
  const staticMat = useMemo(() => new THREE.MeshStandardMaterial({ map: statics.texture, emissiveMap: statics.texture, emissive: '#ffffff', emissiveIntensity: 0.18, roughness: 0.5 }), [statics])
  const meshes = useBuilt(() => buildRoom(statics.cells), [statics])

  // live screen atlas
  const screens = useMemo(() => {
    const scale = lowTier ? 0.5 : 1
    const canvas = makeCanvas(ATLAS * scale, ATLAS * scale)
    const ctx = canvas.getContext('2d')!
    const tex = canvasTexture(canvas, { anisotropy: 4 })
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: new THREE.Color(0.92, 0.95, 0.95) })
    const b = new Builder()
    for (const s of SLOTS) {
      const [px, py, pw, ph] = s.px
      const uv: [number, number, number, number] = [px / ATLAS, 1 - (py + ph) / ATLAS, (px + pw) / ATLAS, 1 - py / ATLAS]
      b.push(s.pos, Math.PI / 2, s.tilt)
      b.plane('screen', [0, 0, 0], s.w, s.h, '#ffffff', [0, 0, 0], uv)
      b.pop()
    }
    const geo = b.build()[0].geometry
    return { canvas, ctx, tex, mat, geo, scale }
  }, [lowTier])

  const lights = useMemo(() => {
    const geo = new THREE.BoxGeometry(1, 1, 1)
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff' })
    const mesh = new THREE.InstancedMesh(geo, mat, LIGHTS.length)
    LIGHTS.forEach((l, i) => {
      _m.makeScale(l.sx, l.sy, l.sz).setPosition(l.x, l.y, l.z)
      mesh.setMatrixAt(i, _m)
      mesh.setColorAt(i, l.on ? _c.copy(l.color).multiplyScalar(1.6) : OFF)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.setUsage(THREE.DynamicDrawUsage)
    return { geo, mat, mesh }
  }, [])

  useEffect(
    () => () => {
      statics.texture.dispose()
      staticMat.dispose()
      screens.tex.dispose()
      screens.mat.dispose()
      screens.geo.dispose()
      lights.geo.dispose()
      lights.mat.dispose()
      lights.mesh.dispose()
    },
    [statics, staticMat, screens, lights],
  )

  // telemetry + event log (subscribed for the module's lifetime, even when far away)
  const tel = useMemo(() => new Telemetry(), [])
  const log = useMemo(() => {
    const l = new EventLog(14)
    const s = factory.state
    l.push(s.t, 'SHIFT START · LINES ONLINE', 'good')
    l.push(s.t, `R-${s.rocket.id} ${PHASE_LABEL[s.rocket.phase]}`, 'info')
    l.push(s.t, `HISTORY: ${s.counters.successes} LAUNCHES / ${s.counters.disassemblies} DISASSEMBLIES`, 'warn')
    return l
  }, [])
  useEffect(() => {
    const offs = LOG_EVENTS.map((name) =>
      events.on(name, (p) => {
        const d = describeEvent(name, p as Parameters<typeof describeEvent>[1])
        if (d) log.push(factory.state.t, d.text, d.level)
      }),
    )
    return () => offs.forEach((o) => o())
  }, [log])

  const st = useRef({ acc: 10, time: 0, drawn: false })
  const screenData = useMemo<ScreenData>(() => ({ s: factory.state, tel, log, time: 0, blackout: false }), [tel, log])

  useInteractable({
    id: 'station:harmony-console',
    label: 'Control Room Dashboard (Harmony AI)',
    verb: 'Inspect',
    radius: 2.5,
    priority: 0.2,
    getPosition: () => ({ x: INTERACT[0], y: 0, z: INTERACT[1] }),
    onInteract: () => useUIStore.getState().openPanel('harmony'),
  })

  useFrame((_, rawDt) => {
    const dt = Math.min(Math.max(rawDt, 0), 0.1)
    const k = st.current
    k.time += dt
    tel.tick(dt, factory.state)
    const p = runtime.player.position
    const inside = runtime.world.interior === 'control'
    const near = inside || Math.hypot(p.x - ZONES.control.center[0], p.z - ZONES.control.center[1]) < 34
    if (!near && k.drawn) return
    k.acc += dt
    const interval = lowTier ? 0.5 : 0.25
    if (k.acc < interval && k.drawn) return
    k.acc = 0
    k.drawn = true
    const ctx = screens.ctx
    const blackout = runtime.lighting.level < 0.55
    ctx.save()
    ctx.setTransform(screens.scale, 0, 0, screens.scale, 0, 0)
    const data = screenData
    data.s = factory.state
    data.time = reducedRef.current ? Math.floor(k.time / 2) * 2 : k.time
    data.blackout = blackout
    for (const slot of SLOTS) drawScreen(ctx, slot.kind, slot.px[0], slot.px[1], slot.px[2], slot.px[3], data)
    ctx.restore()
    screens.tex.needsUpdate = true
    // blink indicator lights (gentle steady state with reduced motion)
    const mesh = lights.mesh
    const t = k.time
    for (let i = 0; i < LIGHTS.length; i++) {
      const l = LIGHTS[i]
      let on = l.on
      if (l.hz > 0 && !reducedRef.current) on = Math.sin(t * l.hz * Math.PI * 2 + l.ph) > -0.2
      mesh.setColorAt(i, on ? _c.copy(l.color).multiplyScalar(blackout ? 0.9 : 1.6) : OFF)
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  const opLook = useMemo(() => OPERATOR_LOOK, [])
  const opLookYaw = () => {
    const p = runtime.player.position
    const d = Math.hypot(p.x - OPERATOR.x, p.z - OPERATOR.z)
    if (d > 5.5) return 0
    return wrapAngle(yawToward(OPERATOR, p) - OPERATOR.yaw)
  }

  return (
    <group name="control-room">
      <BuiltMeshes meshes={meshes} shadows={shadows} materialFor={(key) => (key === 'atlas' ? staticMat : undefined)} />
      <mesh geometry={screens.geo} material={screens.mat} />
      <primitive object={lights.mesh} />
      <WorkerModel position={[OPERATOR.x, 0.02, OPERATOR.z]} rotation-y={OPERATOR.yaw} look={opLook} anim="sit" seed={11} lookYaw={opLookYaw} castShadow={false} />
      <StaticColliders name="control-colliders" boxes={CONTROL_BOXES} cyls={CONTROL_CYLS} />
    </group>
  )
}
