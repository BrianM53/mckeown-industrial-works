import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { audio } from '@/audio/api'
import { registerDebug } from '@/core/debug'
import { events } from '@/core/events'
import { useInteractable } from '@/core/interaction'
import { runtime } from '@/core/runtime'
import type { Vec3 } from '@/core/types'
import { useGameStore } from '@/state/game'
import { useSettings } from '@/state/settings'
import { useUIStore } from '@/state/ui'
import { director } from '@/systems/director'
import { ANCHORS } from '@/world/layout'
import { Builder, type V3 } from '../lib/builder'
import { canvasTexture, makeCanvas, type Atlas } from '../lib/canvas'
import { C } from '../lib/materials'
import { ConfettiPool, PuffPool } from '../lib/particles'
import { BuiltMeshes, useBuilt, useDisposable } from '../lib/react'
import { SHEET_PX, drawSheet } from './art'
import { type Cue, type PrintVariant, blankPose, cuesBetween, isShredPrint, poseAt, timeline } from './resumeSequence'

/**
 * RÉSUMÉ-O-MATIC 3000 (Personnel Office, ANCHORS.resumePrinter, facing west).
 *
 * Pressing E ("Print") opens the résumé panel IMMEDIATELY; the machine then
 * performs in the world behind it: motors whir, a giant sheet feeds onto the
 * output tray, the overhead stamp arm winds up and slams APPROVED FOR
 * EMPLOYMENT, and the stamped copy stays in the tray. Every third print the
 * first copy is sucked up the glass pneumatic tube into the SHRED-O-MATIC
 * (an ambient gag, so it goes through the director and respects the
 * "ambient events" setting).
 *
 * Local frame: model faces -Z (front), origin on the floor at the anchor.
 */
const ORIGIN = ANCHORS.resumePrinter.position as [number, number]
const YAW = ANCHORS.resumePrinter.yaw
const INTERACT = ANCHORS.resumePrinter.interact as [number, number]

// --- key dimensions (local, meters) -----------------------------------------
const HINGE: V3 = [0, 2.55, -0.85]
const ARM_LEN = 1.625
const PHI_REST = 3.49
const PHI_IMPACT = 0.378
const TRAY_Y = 1.03
const SHEET_W = 0.56
const SHEET_D = 0.72
const SHEET_REST_Z = -1.45
const SHEET_START_Z = -0.62
const SLOT_Y = 1.09
const HOOD: V3 = [0.62, 1.58, -1.42]
const TUBE_PATH: V3[] = [HOOD, [0.62, 2.78, -1.42], [1.25, 2.78, -0.62], [1.25, 2.78, 0.05], [1.25, 2.47, 0.05]]
const SHREDDER: V3 = [1.25, 2.2, 0.05]
const DRUM = { x: 1.25, z: 0.05, y0: 0.22, h: 1.7, r: 0.24 }
const CHIMNEY_TOP: V3 = [-0.6, 4.02, 0.2]
const GAUGES: V3[] = [
  [-0.52, 2.22, -0.965],
  [0, 2.22, -0.965],
  [0.52, 2.22, -0.965],
]
const PISTONS: V3[] = [
  [-1.27, 0, -0.5],
  [-1.27, 0, 0.3],
]
const BEACONS: V3[] = [
  [-0.66, 2.5, -0.74],
  [0.66, 2.5, -0.74],
]

// --- palette ------------------------------------------------------------------
const BODY = '#D9D0B8'
const TEAL = '#5E8C88'
const TEAL_DARK = '#466B68'
const YELLOW = C.hazard

function buildStatic(atlas: Atlas): Builder {
  const b = new Builder()
  const cell = (k: string) => atlas.cells[k]?.uv ?? null
  // skid + hazard edge
  b.rbox('paint', [0, 0.11, -0.15], [3.1, 0.22, 2.0], 0.03, C.charcoal)
  b.box('hazard', [0, 0.11, -1.155], [3.1, 0.16, 0.02], '#ffffff')
  for (const x of [-1.45, 1.45]) for (const z of [-1.05, 0.75]) b.cyl('metal', x, 0.22, z, 0.035, 0.03, C.steelLight, 8)
  // main cabinet
  b.rbox('paint', [-0.05, 1.085, -0.15], [2.0, 1.73, 1.7], 0.07, BODY)
  // teal side panels with louvers
  for (const sx of [-1, 1]) {
    const x = sx < 0 ? -1.06 : 0.96
    b.box('paint', [x, 1.0, -0.15], [0.03, 1.2, 1.35], TEAL)
    for (let k = 0; k < 5; k++) b.box('dark', [x + sx * 0.02, 0.62 + k * 0.1, -0.15], [0.02, 0.035, 1.0], C.charcoal)
  }
  // front: lower teal door, rivets, kick plate
  b.box('paint', [-0.05, 0.55, -1.005], [1.75, 0.55, 0.03], TEAL)
  b.box('paint', [-0.05, 0.27, -1.012], [1.8, 0.07, 0.03], C.charcoal)
  for (const x of [-0.85, 0.75]) b.box('metal', [x, 0.55, -1.03], [0.04, 0.32, 0.03], C.chrome)
  for (let k = 0; k < 9; k++) {
    const x = -0.95 + k * 0.225
    b.sphere('metal', [x, 1.9, -1.0], 0.018, C.brass, 6, 4)
    b.sphere('metal', [x, 0.33, -1.0], 0.018, C.brass, 6, 4)
  }
  // mouth housing + slot + output tray
  b.rbox('paint', [0, 1.13, -1.06], [1.06, 0.3, 0.16], 0.03, C.charcoal)
  b.box('dark', [0, SLOT_Y, -1.142], [0.86, 0.05, 0.01], C.black)
  b.box('metal', [0, TRAY_Y - 0.012, -1.45], [0.86, 0.025, 0.82], C.steelLight)
  for (const sx of [-1, 1]) b.box('metal', [sx * 0.44, TRAY_Y + 0.02, -1.45], [0.03, 0.08, 0.82], C.brass)
  b.box('metal', [0, TRAY_Y + 0.015, -1.865], [0.9, 0.06, 0.03], C.brass)
  for (const sx of [-1, 1]) b.tube('metal', [sx * 0.34, TRAY_Y - 0.03, -1.78], [sx * 0.34, 0.6, -1.02], 0.022, C.steel, 6)
  // nameplate
  b.plane('sign', [0, 1.52, -1.023], 1.4, 0.3, '#ffffff', [0, Math.PI, 0], cell('nameplate'))
  // control box (front right from the visitor's view = local -x) with PRINT label + lamp sockets
  b.rbox('paint', [-0.74, 1.16, -1.1], [0.36, 0.42, 0.22], 0.03, YELLOW)
  b.box('hazard', [-0.74, 0.96, -1.215], [0.36, 0.06, 0.01], '#ffffff')
  b.cyl('paint', -0.74, 1.37, -1.1, 0.11, 0.03, C.charcoal, 16)
  b.plane('sign', [-0.74, 1.2, -1.212], 0.26, 0.09, '#ffffff', [0, Math.PI, 0], cell('print'))
  for (const x of [-0.82, -0.66]) {
    b.cyl('paint', x, 1.07, -1.21, 0.035, 0.01, C.charcoal, 10)
    b.tube('dark', [x, 1.07, -1.212], [x, 1.07, -1.24], 0.026, '#2a2f30', 10)
  }
  // upper housing (print head) + gauges
  b.rbox('paint', [0, 2.22, -0.25], [1.7, 0.56, 1.4], 0.06, TEAL)
  b.box('paint', [0, 1.97, -0.25], [1.76, 0.05, 1.46], TEAL_DARK)
  for (let i = 0; i < 3; i++) {
    const g = GAUGES[i]
    b.plane('sign', [g[0], g[1], g[2] - 0.006], 0.25, 0.25, '#ffffff', [0, Math.PI, 0], cell(`gauge:${i}`))
    b.torus('metal', [g[0], g[1], g[2] - 0.01], 0.135, 0.022, C.brass, 'z', Math.PI * 2, 0, 6, 24)
    b.cylAxis('metal', [g[0], g[1], g[2] + 0.02], 'z', 0.14, 0.05, C.brassDark, 20)
  }
  // stamp hinge brackets
  for (const sx of [-1, 1]) {
    b.box('paint', [sx * 0.2, 2.6, -0.82], [0.05, 0.36, 0.3], C.charcoal)
    b.box('paint', [sx * 0.2, 2.53, -0.67], [0.05, 0.1, 0.25], C.charcoal)
  }
  b.cylAxis('metal', HINGE, 'x', 0.05, 0.46, C.chrome, 12)
  // paper roll brackets + paper web into the head
  for (const sx of [-1, 1]) {
    b.tube('paint', [sx * 0.74, 2.5, -0.05], [sx * 0.74, 2.98, 0.2], 0.035, C.charcoal, 8)
    b.tube('paint', [sx * 0.74, 2.5, 0.45], [sx * 0.74, 2.98, 0.2], 0.035, C.charcoal, 8)
    b.cylAxis('metal', [sx * 0.74, 2.98, 0.2], 'x', 0.07, 0.06, C.brass, 12)
  }
  b.box('paint', [0, 2.6, -0.07], [1.16, 0.3, 0.01], C.paper, [0.55, 0, 0])
  // chimney with rain cap
  b.cyl('metal', CHIMNEY_TOP[0], 2.5, CHIMNEY_TOP[2], 0.1, 1.38, C.gunmetal, 12)
  for (const y of [2.8, 3.4]) b.cyl('metal', CHIMNEY_TOP[0], y, CHIMNEY_TOP[2], 0.125, 0.06, C.brass, 12)
  b.cyl('metal', CHIMNEY_TOP[0], 3.93, CHIMNEY_TOP[2], 0.2, 0.12, C.gunmetal, 12, 0.02)
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2
    b.tube('metal', [CHIMNEY_TOP[0] + Math.cos(a) * 0.09, 3.86, CHIMNEY_TOP[2] + Math.sin(a) * 0.09], [CHIMNEY_TOP[0] + Math.cos(a) * 0.15, 3.94, CHIMNEY_TOP[2] + Math.sin(a) * 0.15], 0.01, C.charcoal, 4)
  }
  // beacons: bases (domes are dynamic)
  for (const p of BEACONS) b.cyl('paint', p[0], p[1], p[2], 0.09, 0.07, C.charcoal, 12)
  // pistons (barrels) + hoses + pressure tank on the right side
  for (const p of PISTONS) {
    b.cyl('paint', p[0], 0.22, p[2], 0.12, 1.08, C.safety, 14)
    b.cyl('metal', p[0], 1.27, p[2], 0.135, 0.05, C.brass, 14)
    b.cyl('metal', p[0], 0.22, p[2], 0.14, 0.06, C.steel, 14)
    b.tube('dark', [p[0], 0.5, p[2]], [-1.06, 0.62, p[2] + 0.12], 0.035, C.rubber, 8)
  }
  b.cylAxis('metal', [-1.27, 2.04, -0.1], 'y', 0.035, 0.42, C.chrome, 8)
  b.cylAxis('paint', [-1.27, 1.86, -0.1], 'z', 0.05, 0.12, C.charcoal, 10)
  // suction hood + glass pneumatic tube to the shredder
  b.cyl('metal', HOOD[0], HOOD[1], HOOD[2], 0.16, 0.16, C.brass, 16, 0.07, true)
  b.box('paint', [HOOD[0], 1.74, -1.2], [0.05, 0.05, 0.42], C.charcoal)
  for (let i = 0; i < TUBE_PATH.length - 1; i++) {
    const a = i === 0 ? ([HOOD[0], HOOD[1] + 0.16, HOOD[2]] as V3) : TUBE_PATH[i]
    b.tube('glass', a, TUBE_PATH[i + 1], 0.07, '#ffffff', 14, undefined, true)
    b.sphere('metal', TUBE_PATH[i + 1], 0.085, C.brass, 12, 8)
  }
  // shredder collection drum (glass) + rings + label
  b.cyl('glass', DRUM.x, DRUM.y0, DRUM.z, DRUM.r, DRUM.h, '#ffffff', 18, undefined, true)
  for (const y of [DRUM.y0, DRUM.y0 + DRUM.h - 0.04]) b.cyl('metal', DRUM.x, y, DRUM.z, DRUM.r + 0.02, 0.05, C.brass, 18)
  b.plane('sign', [DRUM.x, 0.62, DRUM.z - DRUM.r - 0.025], 0.36, 0.17, '#ffffff', [0, Math.PI, 0], cell('drum'))
  return b
}

function buildArm(): Builder {
  // arm-local: hinge at origin, arm points along -Y, stamp face at -ARM_LEN
  const b = new Builder()
  b.cylAxis('metal', [0, 0, 0], 'x', 0.13, 0.3, C.brass, 16)
  b.torus('metal', [0.16, 0, 0], 0.1, 0.025, C.chrome, 'x', Math.PI * 2, 0, 6, 16)
  b.rbox('paint', [0, -0.62, 0], [0.16, 1.15, 0.16], 0.03, YELLOW)
  b.box('hazard', [0, -0.25, 0], [0.17, 0.18, 0.17], '#ffffff')
  b.cylAxis('metal', [0, -0.75, 0.1], 'y', 0.035, 0.7, C.chrome, 8)
  b.cylAxis('paint', [0, -0.95, 0.1], 'y', 0.055, 0.35, C.charcoal, 10)
  return b
}

function buildHead(): Builder {
  // head-local: stamp face (pad) at y = 0, facing -Y; arm socket above
  const b = new Builder()
  b.rbox('paint', [0, 0.14, 0], [0.54, 0.2, 0.38], 0.03, C.woodDark)
  b.box('paint', [0, 0.032, 0], [0.5, 0.05, 0.34], '#2a1d16')
  b.box('dark', [0, 0.012, 0], [0.48, 0.024, 0.32], '#B0261F')
  b.cyl('paint', 0, 0.24, 0, 0.07, 0.24, C.wood, 12)
  b.sphere('paint', [0, 0.52, 0], 0.11, C.woodDark, 14, 10, 0.9)
  b.box('metal', [0, 0.24, 0], [0.56, 0.035, 0.4], C.brass)
  return b
}

function buildPistonRod(): Builder {
  const b = new Builder()
  b.cyl('metal', 0, 0, 0, 0.045, 0.62, C.chrome, 10)
  b.cyl('paint', 0, 0.62, 0, 0.07, 0.08, C.charcoal, 12)
  return b
}

function buildRocker(): Builder {
  const b = new Builder()
  b.rbox('paint', [0, 0, 0], [0.08, 0.1, 1.0], 0.02, C.charcoal)
  b.cylAxis('metal', [0, 0, 0], 'x', 0.06, 0.14, C.brass, 12)
  return b
}

function buildShredder(atlas: Atlas): Builder {
  const b = new Builder()
  const uv = atlas.cells.shred?.uv ?? null
  b.rbox('paint', [0, 0, 0], [0.56, 0.48, 0.6], 0.05, YELLOW)
  b.box('dark', [0, -0.26, 0], [0.5, 0.06, 0.5], C.black)
  b.cyl('metal', 0, 0.24, 0, 0.11, 0.05, C.brass, 14)
  b.cylAxis('paint', [0.3, 0.05, 0.1], 'x', 0.12, 0.08, C.charcoal, 14)
  b.plane('sign', [0, 0.02, -0.305], 0.5, 0.11, '#ffffff', [0, Math.PI, 0], uv)
  return b
}

function buildBeaconDomes(): Builder {
  const b = new Builder()
  for (const p of BEACONS) b.sphere('beacon', [p[0], p[1] + 0.07, p[2]], 0.085, '#ffffff', 14, 10, 1.35)
  return b
}

function buildButton(): Builder {
  const b = new Builder()
  b.cyl('paint', 0, 0, 0, 0.06, 0.05, '#B0261F', 16)
  b.sphere('paint', [0, 0.05, 0], 0.075, '#D4352B', 16, 8, 0.45)
  return b
}

// --- shared geometries / temps -------------------------------------------------
const _v = new THREE.Vector3()
const _w = new THREE.Vector3()
const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const _s = new THREE.Vector3(1, 1, 1)
const _e = new THREE.Euler()
const Z_AXIS = new THREE.Vector3(0, 0, 1)
const FACE_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0))
const SHEET_ROT = new THREE.Euler(-Math.PI / 2, 0, Math.PI)

const TUBE_LEN = (() => {
  const seg: number[] = []
  let total = 0
  for (let i = 0; i < TUBE_PATH.length - 1; i++) {
    const a = TUBE_PATH[i]
    const c = TUBE_PATH[i + 1]
    const l = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2])
    seg.push(l)
    total += l
  }
  return { seg, total }
})()

function tubePoint(t: number, out: THREE.Vector3): THREE.Vector3 {
  let d = Math.min(1, Math.max(0, t)) * TUBE_LEN.total
  for (let i = 0; i < TUBE_LEN.seg.length; i++) {
    const l = TUBE_LEN.seg[i]
    if (d <= l || i === TUBE_LEN.seg.length - 1) {
      const k = l > 0 ? Math.min(1, d / l) : 0
      const a = TUBE_PATH[i]
      const c = TUBE_PATH[i + 1]
      return out.set(a[0] + (c[0] - a[0]) * k, a[1] + (c[1] - a[1]) * k, a[2] + (c[2] - a[2]) * k)
    }
    d -= l
  }
  const last = TUBE_PATH[TUBE_PATH.length - 1]
  return out.set(last[0], last[1], last[2])
}

/** Local machine point → world (for positional sounds). */
function worldOf(p: V3): Vec3 {
  const c = Math.cos(YAW)
  const s = Math.sin(YAW)
  return [ORIGIN[0] + p[0] * c + p[2] * s, p[1], ORIGIN[1] - p[0] * s + p[2] * c]
}
const SND_HEAD = worldOf([0, 1.6, -1.1])
const SND_STAMP = worldOf([0, 1.1, -1.45])
const SND_SHRED = worldOf(SHREDDER)
const SND_HOOD = worldOf(HOOD)

interface SeqState {
  /** Debug: hold the sequence at this time (screenshots / tests). */
  freeze: number | null
  running: boolean
  variant: PrintVariant
  t: number
  prints: number
  /** Stamped copies resting in the tray (visual stack). */
  stack: number
  pressT: number
  idlePuffIn: number
  puffIn: number
  drumFill: number
  confettiIn: number
}

export function ResumeMachine({ atlas, signMaterial, shadows }: { atlas: Atlas; signMaterial: THREE.Material; shadows: boolean }) {
  const quality = useGameStore((s) => s.quality)
  const reduced = useSettings((s) => s.reducedMotion)
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced

  const staticMeshes = useBuilt(() => buildStatic(atlas), [atlas])
  const armMeshes = useBuilt(buildArm, [])
  const headMeshes = useBuilt(buildHead, [])
  const rodMeshes = useBuilt(buildPistonRod, [])
  const rockerMeshes = useBuilt(buildRocker, [])
  const shredMeshes = useBuilt(() => buildShredder(atlas), [atlas])
  const domeMeshes = useBuilt(buildBeaconDomes, [])
  const buttonMeshes = useBuilt(buildButton, [])

  // dynamic materials (owned here)
  const beaconMat = useDisposable(useMemo(() => new THREE.MeshStandardMaterial({ color: '#ffb23f', emissive: '#ff9a1f', emissiveIntensity: 0.25, roughness: 0.25, transparent: true, opacity: 0.92 }), []))
  const lampMats = useMemo(
    () => ({
      ready: new THREE.MeshBasicMaterial({ color: new THREE.Color('#5dff7a').multiplyScalar(2.2) }),
      busy: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb23f').multiplyScalar(2.4) }),
    }),
    [],
  )
  useEffect(
    () => () => {
      lampMats.ready.dispose()
      lampMats.busy.dispose()
    },
    [lampMats],
  )

  // sheets: plain / stamped textures
  const sheets = useMemo(() => {
    const mk = (stamped: boolean) => {
      const c = makeCanvas(SHEET_PX.w, SHEET_PX.h)
      drawSheet(c.getContext('2d')!, SHEET_PX.w, SHEET_PX.h, stamped)
      return canvasTexture(c, { anisotropy: 8 })
    }
    const plain = mk(false)
    const stamped = mk(true)
    const geo = new THREE.PlaneGeometry(SHEET_W, SHEET_D)
    const plainMat = new THREE.MeshStandardMaterial({ map: plain, roughness: 0.92, metalness: 0, side: THREE.DoubleSide })
    const stampedMat = new THREE.MeshStandardMaterial({ map: stamped, roughness: 0.92, metalness: 0, side: THREE.DoubleSide })
    return { plain, stamped, geo, plainMat, stampedMat }
  }, [])
  useEffect(
    () => () => {
      sheets.plain.dispose()
      sheets.stamped.dispose()
      sheets.geo.dispose()
      sheets.plainMat.dispose()
      sheets.stampedMat.dispose()
    },
    [sheets],
  )

  const small = useMemo(() => {
    const needle = new THREE.BoxGeometry(0.105, 0.012, 0.008).translate(0.04, 0, 0)
    const needleMesh = new THREE.InstancedMesh(needle, new THREE.MeshStandardMaterial({ color: '#B0261F', roughness: 0.5 }), 3)
    const reflector = new THREE.BoxGeometry(0.11, 0.07, 0.025)
    const reflMesh = new THREE.InstancedMesh(reflector, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd27a').multiplyScalar(2) }), 2)
    const ball = new THREE.SphereGeometry(0.07, 9, 7)
    const roller = new THREE.CylinderGeometry(0.045, 0.045, 0.84, 12).rotateZ(Math.PI / 2)
    const roll = new THREE.CylinderGeometry(0.36, 0.36, 1.3, 24).rotateZ(Math.PI / 2)
    const rollCap = new THREE.CylinderGeometry(0.4, 0.4, 0.03, 24).rotateZ(Math.PI / 2)
    const stack = new THREE.BoxGeometry(SHEET_W, 1, SHEET_D)
    const fill = new THREE.CylinderGeometry(DRUM.r - 0.02, DRUM.r - 0.02, 1, 16).translate(0, 0.5, 0)
    const lamp = new THREE.SphereGeometry(0.03, 10, 8)
    const paperMat = new THREE.MeshStandardMaterial({ color: '#f4efe2', roughness: 0.9 })
    const rubberMat = new THREE.MeshStandardMaterial({ color: '#1c1f20', roughness: 0.85 })
    const fillMat = new THREE.MeshStandardMaterial({ color: '#efe6cf', roughness: 0.95 })
    const brassMat = new THREE.MeshStandardMaterial({ color: C.brass, roughness: 0.3, metalness: 0.85 })
    for (const m of [needleMesh, reflMesh]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      m.frustumCulled = false
    }
    // sensible initial poses (the frame loop skips work while the visitor is far away)
    const init = new THREE.Matrix4()
    GAUGES.forEach((g, i) => {
      init.compose(new THREE.Vector3(g[0], g[1], g[2] - 0.035), FACE_Q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(Z_AXIS, -Math.PI * 0.95)), new THREE.Vector3(1, 1, 1))
      needleMesh.setMatrixAt(i, init)
    })
    init.makeScale(0, 0, 0)
    for (let i = 0; i < 2; i++) reflMesh.setMatrixAt(i, init)
    return { needle, needleMesh, reflector, reflMesh, ball, roller, roll, rollCap, stack, fill, lamp, paperMat, rubberMat, fillMat, brassMat }
  }, [])
  useEffect(
    () => () => {
      const s = small
      for (const g of [s.needle, s.reflector, s.ball, s.roller, s.roll, s.rollCap, s.stack, s.fill, s.lamp]) g.dispose()
      for (const m of [s.paperMat, s.rubberMat, s.fillMat, s.brassMat]) m.dispose()
      ;(s.needleMesh.material as THREE.Material).dispose()
      ;(s.reflMesh.material as THREE.Material).dispose()
      s.needleMesh.dispose()
      s.reflMesh.dispose()
    },
    [small],
  )

  const puffs = useMemo(() => new PuffPool(28), [])
  const confetti = useMemo(() => new ConfettiPool(quality === 'low' ? 24 : 48), [quality])
  useDisposable(puffs)
  useDisposable(confetti)

  // refs to dynamic objects
  const armRef = useRef<THREE.Group>(null)
  const headRef = useRef<THREE.Group>(null)
  const rodRefs = useRef<(THREE.Group | null)[]>([])
  const rockerRef = useRef<THREE.Group>(null)
  const rollRef = useRef<THREE.Group>(null)
  const rollerRef = useRef<THREE.Mesh>(null)
  const keeperRef = useRef<THREE.Mesh>(null)
  const decoyRef = useRef<THREE.Mesh>(null)
  const stackRef = useRef<THREE.Mesh>(null)
  const ballRef = useRef<THREE.Mesh>(null)
  const shredRef = useRef<THREE.Group>(null)
  const fillRef = useRef<THREE.Mesh>(null)
  const buttonRef = useRef<THREE.Group>(null)
  const readyRef = useRef<THREE.Mesh>(null)
  const busyRef = useRef<THREE.Mesh>(null)

  const seq = useRef<SeqState>({ freeze: null, running: false, variant: 'normal', t: 0, prints: 0, stack: 0, pressT: -1, idlePuffIn: 2, puffIn: 0, drumFill: 0.95, confettiIn: 0 })
  const cueBuf = useRef<Cue[]>([])
  const poseBuf = useMemo(blankPose, [])
  const clock = useRef({ t: 0, gauge: [0.12, 0.3, 0.2], gaugeVel: [0, 0, 0] })

  const start = (force?: PrintVariant) => {
    const s = seq.current
    if (s.running) return
    s.prints++
    let variant: PrintVariant = 'normal'
    if (force) variant = force
    else if (isShredPrint(s.prints)) {
      const tl = timeline('shred')
      // ambient gag: honours the visitor's "ambient events" setting and global pacing
      if (director.request({ id: 'gag:resume-shredder', kind: 'ambient', cooldown: 20, duration: tl.duration })) variant = 'shred'
    }
    s.variant = variant
    s.t = 0
    s.running = true
    s.pressT = 0
    s.confettiIn = 0
  }

  useInteractable({
    id: 'station:resume',
    label: 'Résumé-O-Matic 3000',
    verb: 'Print',
    radius: 2.5,
    priority: 0.2,
    getPosition: () => ({ x: INTERACT[0], y: 0, z: INTERACT[1] }),
    onInteract: () => {
      // The machine sequence starts first (the director must decide the gag
      // before the panel suppresses ambient events), then the résumé opens
      // in the same tick: reading is never delayed.
      start()
      useUIStore.getState().openPanel('resume')
    },
  })

  useEffect(() => {
    const s = seq.current
    const off = registerDebug('stationsA', {
      /** Start a print without opening the panel ('normal' | 'shred'). */
      print: (variant?: PrintVariant) => start(variant === 'shred' || variant === 'normal' ? variant : undefined),
      /** Hold the print sequence at time t (seconds); null resumes. */
      freezePrint: (t: number | null) => {
        s.freeze = typeof t === 'number' && Number.isFinite(t) ? t : null
      },
      printState: () => ({ running: s.running, variant: s.variant, t: s.t, prints: s.prints, stack: s.stack }),
    })
    return () => {
      off()
      if (s.running && s.variant === 'shred') director.end('gag:resume-shredder')
      s.running = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useFrame((_, rawDt) => {
    const dt = Math.min(Math.max(rawDt, 0), 0.1)
    const s = seq.current
    const ck = clock.current
    ck.t += dt
    const level = runtime.lighting.level
    const red = reducedRef.current
    const p = runtime.player.position
    const near = Math.hypot(p.x - ORIGIN[0], p.z - ORIGIN[1]) < 40

    // --- sequence time + cues ------------------------------------------------
    let pose = poseAt(s.variant, s.running ? s.t : 99, poseBuf)
    if (s.running) {
      const t0 = s.t
      s.t = s.freeze ?? s.t + dt
      pose = poseAt(s.variant, s.t, poseBuf)
      for (const c of cuesBetween(s.variant, t0, s.t, cueBuf.current)) {
        switch (c.kind) {
          case 'whir':
            audio.play('printer-whir', { position: SND_HEAD, volume: 0.9 })
            break
          case 'whoosh':
            audio.play('tube-whoosh', { position: SND_HOOD })
            break
          case 'shred':
            audio.play('printer-whir', { position: SND_SHRED, rate: 1.9, volume: 1 })
            audio.play('machine-clank', { position: SND_SHRED, volume: 0.6 })
            break
          case 'stamp':
            audio.play('print-stamp', { position: SND_STAMP })
            events.emit('achievement', { id: 'resume-printed' })
            s.stack = Math.min(s.stack + 1, 14)
            // paper dust from under the stamp
            for (let k = 0; k < (red ? 3 : 7); k++) {
              const a = (k / 7) * Math.PI * 2
              puffs.spawn(Math.cos(a) * 0.3, TRAY_Y + 0.05, SHEET_REST_Z + Math.sin(a) * 0.3, Math.cos(a) * 0.6, 0.25, Math.sin(a) * 0.6, 0.12, 0.42, 0.9, 0.45, 1.2)
            }
            break
          case 'done':
            s.running = false
            if (s.variant === 'shred') director.end('gag:resume-shredder')
            break
        }
      }
    }

    if (!near && !s.running) {
      puffs.update(dt, level)
      confetti.update(dt)
      return
    }

    const motor = pose.motor

    // --- stamp arm --------------------------------------------------------------
    const phi = PHI_REST + pose.arm * (PHI_IMPACT - PHI_REST)
    if (armRef.current) armRef.current.rotation.x = phi
    if (headRef.current) {
      const sq = pose.squash
      headRef.current.scale.set(1 + 0.1 * sq, 1 - 0.18 * sq, 1 + 0.1 * sq)
    }

    // --- rollers, paper roll, pistons + rocker --------------------------------
    const spin = motor * dt
    if (rollRef.current) rollRef.current.rotation.x -= spin * 2.2
    if (rollerRef.current) rollerRef.current.rotation.x -= spin * 16
    const pumpPhase = ck.t * 9
    const amp = motor * 0.09
    const offA = Math.sin(pumpPhase) * amp
    const offB = -offA
    if (rodRefs.current[0]) rodRefs.current[0].position.y = 1.15 + offA
    if (rodRefs.current[1]) rodRefs.current[1].position.y = 1.15 + offB
    if (rockerRef.current) rockerRef.current.rotation.x = Math.atan2(offB - offA, 0.8)

    // --- sheets -----------------------------------------------------------------
    // s.stack = stamped copies resting in the tray. Before the stamp lands the
    // new copy feeds on top of all of them; afterwards it IS the top copy.
    const below = s.running && !pose.stamped ? s.stack : Math.max(0, s.stack - 1)
    const stackTop = below * 0.006
    if (stackRef.current) {
      stackRef.current.visible = below > 0
      const h = Math.max(0.002, stackTop)
      stackRef.current.scale.y = h
      stackRef.current.position.set(0, TRAY_Y + h / 2, SHEET_REST_Z)
    }
    const keeper = keeperRef.current
    if (keeper) {
      const f = s.running ? pose.keeperFeed : s.stack > 0 ? 1 : 0
      keeper.visible = f > 0.001
      keeper.position.set(0, SLOT_Y + (TRAY_Y + 0.006 + stackTop - SLOT_Y) * f, SHEET_START_Z + (SHEET_REST_Z - SHEET_START_Z) * f)
      keeper.material = s.running && !pose.stamped ? sheets.plainMat : sheets.stampedMat
    }
    const decoy = decoyRef.current
    if (decoy) {
      const show = s.running && s.variant === 'shred' && pose.decoyFeed > 0.001 && pose.suck < 0.98
      decoy.visible = show
      if (show) {
        const f = pose.decoyFeed
        const k = pose.suck
        const top = stackTop
        const bx = 0
        const by = SLOT_Y + (TRAY_Y + 0.008 + top - SLOT_Y) * f
        const bz = SHEET_START_Z + (SHEET_REST_Z - SHEET_START_Z) * f
        const flutter = red ? 0 : Math.sin(ck.t * 30) * 0.35 * k * (1 - k)
        decoy.position.set(bx + (HOOD[0] - bx) * k, by + (HOOD[1] - 0.05 - by) * k + Math.sin(k * Math.PI) * 0.18, bz + (HOOD[2] - bz) * k)
        decoy.rotation.set(SHEET_ROT.x + k * 1.2 + flutter, k * 2.5, SHEET_ROT.z + flutter * 0.6)
        const sc = 1 - 0.85 * k
        decoy.scale.set(sc, sc * (1 - 0.4 * k), 1)
      }
    }
    const ball = ballRef.current
    if (ball) {
      ball.visible = pose.tube >= 0
      if (ball.visible) {
        tubePoint(pose.tube, _v)
        ball.position.copy(_v)
        ball.rotation.x += dt * 14
      }
    }

    // --- shredder + confetti + drum ----------------------------------------------
    const sh = shredRef.current
    if (sh) {
      const j = pose.shred * (red ? 0.004 : 0.018)
      sh.position.set(SHREDDER[0] + Math.sin(ck.t * 61) * j, SHREDDER[1] + Math.abs(Math.sin(ck.t * 47)) * j, SHREDDER[2] + Math.cos(ck.t * 53) * j)
    }
    if (pose.shred > 0.2) {
      s.confettiIn -= dt
      if (s.confettiIn <= 0) {
        s.confettiIn = 0.07
        const n = quality === 'low' ? 2 : 4
        confetti.burst(n, SHREDDER[0], SHREDDER[1] - 0.28, SHREDDER[2], 0.12, -0.3, DRUM.y0 + s.drumFill)
        if (!red && Math.sin(ck.t * 13) > 0.6) confetti.burst(1, SHREDDER[0], SHREDDER[1] + 0.3, SHREDDER[2], 1.2, 2.2, 0.24)
        s.drumFill = Math.min(DRUM.h - 0.12, s.drumFill + 0.004)
      }
    }
    if (fillRef.current) {
      fillRef.current.scale.y = s.drumFill
    }

    // --- gauges -----------------------------------------------------------------
    const nm = small.needleMesh
    const targets = [0.15 + motor * 0.6 + (red ? 0 : Math.sin(ck.t * 23) * 0.04 * motor), 0.35 + Math.sin(ck.t * 0.7) * 0.25 + motor * 0.3, pose.stamped && s.running ? 0.97 : 0.2 + motor * 0.4]
    for (let i = 0; i < 3; i++) {
      const g = ck.gauge
      g[i] += (targets[i] - g[i]) * (1 - Math.exp(-dt * (i === 2 ? 5 : 3)))
      const v = Math.min(1, Math.max(0, g[i] + (i === 2 && pose.stamped && s.running && !red ? Math.sin(ck.t * 40) * 0.015 : 0)))
      const theta = Math.PI * 0.75 + Math.PI * 1.5 * v
      _q2.setFromAxisAngle(Z_AXIS, -theta)
      _q.copy(FACE_Q).multiply(_q2)
      const gp = GAUGES[i]
      _m.compose(_w.set(gp[0], gp[1], gp[2] - 0.035), _q, _s)
      nm.setMatrixAt(i, _m)
    }
    nm.instanceMatrix.needsUpdate = true

    // --- beacons + lamps + button --------------------------------------------------
    const on = pose.beacons && s.running
    const rm = small.reflMesh
    for (let i = 0; i < 2; i++) {
      const bp = BEACONS[i]
      const ang = red ? 0 : ck.t * 9 + i * 1.3
      _e.set(0, ang, 0)
      _q.setFromEuler(_e)
      _m.compose(_w.set(bp[0], bp[1] + 0.13, bp[2]), _q, on ? _s : _v.set(0.0001, 0.0001, 0.0001))
      rm.setMatrixAt(i, _m)
    }
    rm.instanceMatrix.needsUpdate = true
    const pulse = red ? 0.75 : 0.45 + 0.55 * Math.abs(Math.sin(ck.t * 9))
    beaconMat.emissiveIntensity = on ? 1.4 + 1.6 * pulse : 0.12
    if (readyRef.current) readyRef.current.visible = !s.running
    if (busyRef.current) busyRef.current.visible = s.running && (red || Math.sin(ck.t * 12) > -0.2)
    if (buttonRef.current) {
      if (s.pressT >= 0) s.pressT += dt
      const pressed = s.pressT >= 0 && s.pressT < 0.3
      buttonRef.current.position.y = 1.4 - (pressed ? 0.035 : 0)
      if (s.pressT > 0.3) s.pressT = -1
    }

    // --- chimney + puffs ---------------------------------------------------------
    if (motor > 0.25) {
      s.puffIn -= dt
      if (s.puffIn <= 0) {
        s.puffIn = red ? 0.5 : 0.22
        puffs.spawn(CHIMNEY_TOP[0], CHIMNEY_TOP[1], CHIMNEY_TOP[2], (Math.sin(ck.t * 3.1) * 0.1), 0.9 + motor * 0.6, 0.05, 0.16, 0.7 + motor * 0.4, 2.2, 0.55)
      }
    } else if (quality !== 'low') {
      s.idlePuffIn -= dt
      if (s.idlePuffIn <= 0) {
        s.idlePuffIn = 4.5 + ((Math.sin(ck.t * 12.9898) * 43758.5453) % 1 + 1) * 2.5
        puffs.spawn(CHIMNEY_TOP[0], CHIMNEY_TOP[1], CHIMNEY_TOP[2], 0.05, 0.6, 0.02, 0.12, 0.5, 2.4, 0.35)
      }
    }
    puffs.update(dt, level)
    confetti.update(dt)
  })

  const sign = (key: string) => (key === 'sign' ? signMaterial : key === 'beacon' ? beaconMat : undefined)

  return (
    <group name="resume-o-matic" position={[ORIGIN[0], 0, ORIGIN[1]]} rotation-y={YAW}>
      <BuiltMeshes meshes={staticMeshes} shadows={shadows} materialFor={sign} />
      {/* stamp arm (rotates about the hinge) */}
      <group position={HINGE}>
        <group ref={armRef} rotation-x={PHI_REST}>
          <BuiltMeshes meshes={armMeshes} shadows={shadows} />
          <group position={[0, -ARM_LEN, 0]} rotation-x={-PHI_IMPACT}>
            <group ref={headRef}>
              <BuiltMeshes meshes={headMeshes} shadows={shadows} />
            </group>
          </group>
        </group>
      </group>
      {/* paper roll */}
      <group ref={rollRef} position={[0, 2.98, 0.2]}>
        <mesh geometry={small.roll} material={small.paperMat} castShadow={shadows} />
        <mesh geometry={small.rollCap} material={small.brassMat} position={[0.66, 0, 0]} />
        <mesh geometry={small.rollCap} material={small.brassMat} position={[-0.66, 0, 0]} />
      </group>
      <mesh ref={rollerRef} geometry={small.roller} material={small.rubberMat} position={[0, SLOT_Y + 0.06, -1.13]} />
      {/* pistons + walking beam */}
      {PISTONS.map((pp, i) => (
        <group
          key={i}
          ref={(el) => {
            rodRefs.current[i] = el
          }}
          position={[pp[0], 1.15, pp[2]]}
        >
          <BuiltMeshes meshes={rodMeshes} shadows={false} />
        </group>
      ))}
      <group ref={rockerRef} position={[-1.27, 1.86, -0.1]}>
        <BuiltMeshes meshes={rockerMeshes} shadows={false} />
      </group>
      {/* sheets */}
      <mesh ref={stackRef} geometry={small.stack} material={small.paperMat} visible={false} />
      <mesh ref={keeperRef} geometry={sheets.geo} material={sheets.stampedMat} rotation={SHEET_ROT} visible={false} />
      <mesh ref={decoyRef} geometry={sheets.geo} material={sheets.plainMat} rotation={SHEET_ROT} visible={false} />
      <mesh ref={ballRef} geometry={small.ball} material={small.paperMat} visible={false} />
      {/* shredder (shakes) + drum fill */}
      <group ref={shredRef} position={SHREDDER}>
        <BuiltMeshes meshes={shredMeshes} shadows={shadows} materialFor={sign} />
      </group>
      <mesh ref={fillRef} geometry={small.fill} material={small.fillMat} position={[DRUM.x, DRUM.y0 + 0.03, DRUM.z]} scale-y={0.95} />
      {/* gauges, beacons, lamps, button */}
      <primitive object={small.needleMesh} />
      <primitive object={small.reflMesh} />
      <BuiltMeshes meshes={domeMeshes} shadows={false} receive={false} materialFor={sign} />
      <mesh ref={readyRef} geometry={small.lamp} material={lampMats.ready} position={[-0.66, 1.07, -1.245]} />
      <mesh ref={busyRef} geometry={small.lamp} material={lampMats.busy} position={[-0.82, 1.07, -1.245]} visible={false} />
      <group ref={buttonRef} position={[-0.74, 1.4, -1.1]}>
        <BuiltMeshes meshes={buttonMeshes} shadows={false} />
      </group>
      <primitive object={puffs.mesh} />
      <primitive object={confetti.mesh} />
    </group>
  )
}

/** Colliders for the machine (world space AABBs). */
export const RESUME_MACHINE_BOXES = (() => {
  const toWorld = (lx0: number, lx1: number, lz0: number, lz1: number, y0: number, y1: number) => {
    const c = Math.round(Math.cos(YAW))
    const s = Math.round(Math.sin(YAW))
    const xs = [lx0 * c + lz0 * s, lx1 * c + lz1 * s]
    const zs = [-lx0 * s + lz0 * c, -lx1 * s + lz1 * c]
    const minX = ORIGIN[0] + Math.min(...xs)
    const maxX = ORIGIN[0] + Math.max(...xs)
    const minZ = ORIGIN[1] + Math.min(...zs)
    const maxZ = ORIGIN[1] + Math.max(...zs)
    return { c: [(minX + maxX) / 2, (y0 + y1) / 2, (minZ + maxZ) / 2] as [number, number, number], h: [(maxX - minX) / 2, (y1 - y0) / 2, (maxZ - minZ) / 2] as [number, number, number] }
  }
  return [
    // body, skid, side gear (pistons / drum) and the upper housing
    toWorld(-1.55, 1.55, -1.18, 0.85, 0, 3.3),
    // output tray (waist height; keeps the worker from wearing it)
    toWorld(-0.46, 0.46, -1.9, -1.18, 0.85, 1.12),
  ]
})()

