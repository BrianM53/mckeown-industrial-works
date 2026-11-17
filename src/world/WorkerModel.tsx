import { useEffect, useMemo, useRef } from 'react'
import type { ThreeElements } from '@react-three/fiber'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { gaitFrequency } from '@/player/gait'
import { PALETTE } from './palette'

/**
 * Shared procedural worker character (player, NPCs, rocket crew, OSHA inspector).
 * ~1.9 m to the top of the hard hat, feet at local y=0, faces -Z (set group
 * rotation.y = yaw).
 *
 *   <WorkerModel position={[x, 0, z]} rotation-y={yaw}
 *     look={{ helmet: '#E9B63F', vest: '#E57D35', accessory: 'clipboard', face: 'mustache' }}
 *     anim={() => state.anim}      // 'idle' | 'walk' | 'run' | 'work' | 'wave' | 'point' | 'panic' | 'cheer'
 *                                  // | 'kick' | 'carry' | 'sit' | 'sleep' | 'tumble' | 'tackle'
 *     speed={() => state.speed}    // m/s, drives the walk/run cadence (feet don't skate)
 *     lookYaw={() => headYaw}      // optional glance (rad, relative to the body), e.g. at the visitor
 *     seed={7} />                  // desyncs idle breathing / fidgets between workers
 *
 * Rendering: ONE skinned mesh per worker (one draw call + one shadow call).
 * The body is built from chunky primitives merged into a single geometry with
 * baked vertex colors (cached per look — reuse a handful of looks) and rigidly
 * skinned to a 13-bone skeleton. A shared material reads per-vertex
 * roughness/emissive, so hi-vis vests and reflective stripes pop without extra
 * materials. Idle workers fidget (look around, tip the hard hat, check a
 * watch, stretch, shift weight).
 *
 * Animation is procedural: joint angles damp toward per-state targets every
 * frame, so state changes blend smoothly. Pass getters for `anim`/`speed`/
 * `opacity`/`lookYaw` to change them per frame without React re-renders.
 *
 * Owner: player module (may improve visuals/animations; must keep the props API).
 */
export type WorkerAnim =
  | 'idle'
  | 'walk'
  | 'run'
  | 'work'
  | 'wave'
  | 'panic'
  | 'tumble'
  | 'sit'
  | 'sleep'
  | 'carry'
  | 'cheer'
  | 'point'
  | 'kick'
  | 'tackle'

export type WorkerAccessory = 'none' | 'clipboard' | 'wrench' | 'headset' | 'whistle' | 'mug' | 'tablet'

export interface WorkerLook {
  helmet: string
  vest: string
  shirt: string
  pants: string
  skin: string
  boots: string
  accessory: WorkerAccessory
  /** Optional reflective stripe color on the vest. */
  stripe: string
  /** Optional accent on the hard-hat ridge + a reflective band (the player's is orange). */
  helmetStripe?: string
  /** Work-glove color (defaults to tan leather). */
  gloves?: string
  /** Optional face detail. */
  face?: 'plain' | 'mustache' | 'glasses' | 'beard'
}

export const DEFAULT_LOOK: WorkerLook = {
  helmet: PALETTE.hazard,
  vest: PALETTE.safety,
  shirt: '#4b5b66',
  pants: '#2f3b44',
  skin: '#c99a76',
  boots: '#3a2a1f',
  accessory: 'none',
  stripe: '#d8dcd6',
}

type GroupProps = ThreeElements['group']

export interface WorkerModelProps extends Omit<GroupProps, 'children'> {
  look?: Partial<WorkerLook>
  anim?: WorkerAnim | (() => WorkerAnim)
  /** Ground speed in m/s (drives walk/run cadence). */
  speed?: number | (() => number)
  /** Per-instance variation seed. */
  seed?: number
  castShadow?: boolean
  /** 0..1 (dithered). Omit for a fully opaque worker sharing the common material. */
  opacity?: number | (() => number)
  /**
   * Optional head/torso glance, radians relative to the body facing (+ = toward the
   * worker's left). null/NaN = no override. E.g. NPCs looking at the visitor.
   */
  lookYaw?: number | null | (() => number | null)
}

// ---------------------------------------------------------------------------
// Skeleton (bind pose, absolute positions; feet at origin, facing -Z)
// ---------------------------------------------------------------------------

const B = {
  root: 0,
  hips: 1,
  spine: 2,
  neck: 3,
  head: 4,
  shL: 5,
  elL: 6,
  shR: 7,
  elR: 8,
  thL: 9,
  knL: 10,
  thR: 11,
  knR: 12,
} as const
type BoneId = (typeof B)[keyof typeof B]

const HIPS_Y = 0.93
/** [parent, absolute bind position] */
const BONES: Array<[number, [number, number, number]]> = [
  [-1, [0, 0, 0]], // root
  [B.root, [0, HIPS_Y, 0]], // hips
  [B.hips, [0, 1.05, 0]], // spine
  [B.spine, [0, 1.52, 0]], // neck
  [B.neck, [0, 1.6, 0]], // head
  [B.spine, [-0.285, 1.445, 0]], // shoulder L
  [B.shL, [-0.305, 1.17, 0.01]], // elbow L
  [B.spine, [0.285, 1.445, 0]], // shoulder R
  [B.shR, [0.305, 1.17, 0.01]], // elbow R
  [B.hips, [-0.105, 0.9, 0]], // thigh L
  [B.thL, [-0.105, 0.49, 0]], // knee L
  [B.hips, [0.105, 0.9, 0]], // thigh R
  [B.thR, [0.105, 0.49, 0]], // knee R
]

// ---------------------------------------------------------------------------
// Geometry builder (cached per look)
// ---------------------------------------------------------------------------

interface Part {
  geo: THREE.BufferGeometry
  bone: BoneId
  color: THREE.Color
  rough: number
  emis: number
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _s = new THREE.Vector3()
const _p = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const _dir = new THREE.Vector3()

function col(hex: string, mul = 1): THREE.Color {
  const c = new THREE.Color()
  try {
    c.setStyle(hex)
  } catch {
    c.set('#888888')
  }
  if (mul !== 1) c.multiplyScalar(mul)
  return c
}

class PartList {
  parts: Part[] = []
  add(
    geo: THREE.BufferGeometry,
    bone: BoneId,
    color: THREE.Color,
    pos: [number, number, number],
    opts: { rot?: [number, number, number]; scale?: [number, number, number]; rough?: number; emis?: number } = {},
  ): void {
    const g = geo.clone()
    _e.set(...(opts.rot ?? [0, 0, 0]))
    _q.setFromEuler(_e)
    _s.set(...(opts.scale ?? [1, 1, 1]))
    _p.set(...pos)
    g.applyMatrix4(_m.compose(_p, _q, _s))
    this.parts.push({ geo: g, bone, color, rough: opts.rough ?? 0.8, emis: opts.emis ?? 0 })
  }
  /** A capsule spanning two points. */
  limb(a: [number, number, number], b: [number, number, number], radius: number, bone: BoneId, color: THREE.Color, rough = 0.85): void {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    const geo = new THREE.CapsuleGeometry(radius, Math.max(0.01, len - radius * 0.6), 3, 10)
    _dir.set(a[0] - b[0], a[1] - b[1], a[2] - b[2]).normalize()
    _q.setFromUnitVectors(_up, _dir)
    _p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)
    geo.applyMatrix4(_m.compose(_p, _q, _s.set(1, 1, 1)))
    this.parts.push({ geo, bone, color, rough, emis: 0 })
  }
}

const geoCache = new Map<string, THREE.BufferGeometry>()

function lookKey(l: WorkerLook): string {
  return [l.helmet, l.vest, l.shirt, l.pants, l.skin, l.boots, l.accessory, l.stripe, l.helmetStripe ?? '', l.gloves ?? '', l.face ?? ''].join('|')
}

function buildWorkerGeometry(look: WorkerLook): THREE.BufferGeometry {
  const P = new PartList()
  const c = {
    helmet: col(look.helmet),
    helmetAccent: look.helmetStripe ? col(look.helmetStripe) : col(look.helmet, 0.82),
    vest: col(look.vest),
    vestDark: col(look.vest, 0.78),
    stripe: col(look.stripe),
    shirt: col(look.shirt),
    pants: col(look.pants),
    skin: col(look.skin),
    skinDark: col(look.skin, 0.88),
    boots: col(look.boots),
    sole: col('#1d1a17'),
    gloves: col(look.gloves ?? '#8a6a45'),
    glovesDark: col(look.gloves ?? '#8a6a45', 0.8),
    belt: col('#2a211b'),
    metal: col('#c9c3b0'),
    eye: col('#1b1c1e'),
    badge: col('#efe8d6'),
    leather: col('#6b4a2e'),
    hair: col('#3b2a20'),
  }

  // --- primitives (shared shapes, cloned per part) ---
  const rbox = (w: number, h: number, d: number, r = 0.04) => new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3))
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)
  const sphere = (r: number, ws = 10, hs = 8) => new THREE.SphereGeometry(r, ws, hs)
  const cyl = (rt: number, rb: number, h: number, seg = 12, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open)

  // --- legs ---
  for (const side of [-1, 1] as const) {
    const x = 0.105 * side
    const th = side < 0 ? B.thL : B.thR
    const kn = side < 0 ? B.knL : B.knR
    P.limb([x, 0.92, 0], [x, 0.47, 0], 0.108, th, c.pants)
    P.limb([x, 0.5, 0], [x, 0.17, 0], 0.096, kn, c.pants)
    // chunky steel-toe work boots with a contrasting sole and laces
    P.add(rbox(0.195, 0.18, 0.25, 0.05), kn, c.boots, [x, 0.12, -0.005], { rough: 0.6 })
    P.add(rbox(0.19, 0.125, 0.16, 0.05), kn, c.boots, [x, 0.07, -0.13], { rough: 0.6 })
    P.add(box(0.205, 0.04, 0.35), kn, c.sole, [x, 0.02, -0.05], { rough: 0.9 })
    P.add(box(0.07, 0.012, 0.09), kn, c.badge, [x, 0.168, -0.11], { rot: [-0.5, 0, 0], rough: 0.8 })
    P.add(cyl(0.108, 0.108, 0.055, 12), kn, c.boots, [x, 0.215, 0], { rough: 0.7 })
  }

  // --- pelvis / belt ---
  P.add(rbox(0.37, 0.22, 0.25, 0.05), B.hips, c.pants, [0, 0.95, 0])
  P.add(box(0.385, 0.055, 0.262), B.hips, c.belt, [0, 1.04, 0], { rough: 0.6 })
  P.add(box(0.075, 0.045, 0.02), B.hips, c.metal, [0, 1.04, -0.135], { rough: 0.3, emis: 0.04 })
  P.add(rbox(0.085, 0.13, 0.095, 0.02), B.hips, c.leather, [0.22, 0.965, 0.025], { rough: 0.7 })

  // --- torso: shirt, hi-vis vest, reflective stripes ---
  P.add(rbox(0.4, 0.47, 0.245, 0.06), B.spine, c.shirt, [0, 1.285, 0])
  P.add(rbox(0.445, 0.4, 0.29, 0.06), B.spine, c.vest, [0, 1.265, 0], { rough: 0.7, emis: 0.2 })
  P.add(box(0.075, 0.385, 0.012), B.spine, c.shirt, [0, 1.27, -0.149])
  for (const y of [1.15, 1.285]) P.add(box(0.452, 0.042, 0.297), B.spine, c.stripe, [0, y, 0], { rough: 0.38, emis: 0.42 })
  for (const sx of [-0.115, 0.115]) {
    P.add(box(0.042, 0.4, 0.01), B.spine, c.stripe, [sx, 1.265, -0.148], { rough: 0.38, emis: 0.42 })
    P.add(box(0.042, 0.4, 0.01), B.spine, c.stripe, [sx, 1.265, 0.148], { rough: 0.38, emis: 0.42 })
    P.add(box(0.13, 0.035, 0.29), B.spine, c.vest, [sx * 1.17, 1.468, 0], { rough: 0.7, emis: 0.2 })
  }
  P.add(box(0.085, 0.07, 0.012), B.spine, c.vestDark, [-0.12, 1.37, -0.152], { rough: 0.8 })
  P.add(box(0.07, 0.045, 0.008), B.spine, c.badge, [0.12, 1.385, -0.152], { rough: 0.5, emis: 0.05 })
  P.add(new THREE.TorusGeometry(0.085, 0.028, 6, 14), B.spine, c.shirt, [0, 1.495, 0], { rot: [Math.PI / 2, 0, 0] })

  // --- neck & head ---
  P.add(cyl(0.06, 0.065, 0.12, 10), B.neck, c.skin, [0, 1.56, 0], { rough: 0.7 })
  P.add(sphere(0.148, 16, 12), B.head, c.skin, [0, 1.705, 0], { scale: [1, 1.06, 1], rough: 0.7 })
  P.add(sphere(0.03, 8, 6), B.head, c.skinDark, [0, 1.685, -0.147], { rough: 0.7 })
  for (const sx of [-1, 1]) {
    P.add(sphere(0.02, 8, 6), B.head, c.eye, [0.052 * sx, 1.722, -0.132], { scale: [1, 1.2, 0.6], rough: 0.3 })
    P.add(sphere(0.036, 8, 6), B.head, c.skin, [0.147 * sx, 1.7, 0.005], { scale: [0.55, 1, 0.9], rough: 0.7 })
  }
  if (look.face === 'mustache') {
    P.add(rbox(0.11, 0.028, 0.035, 0.012), B.head, c.hair, [0, 1.655, -0.138], { rough: 0.9 })
  } else if (look.face === 'beard') {
    P.add(sphere(0.12, 12, 8), B.head, c.hair, [0, 1.625, -0.035], { scale: [1.1, 0.75, 1.0], rough: 0.95 })
  } else if (look.face === 'glasses') {
    for (const sx of [-1, 1]) P.add(new THREE.TorusGeometry(0.03, 0.007, 4, 12), B.head, c.eye, [0.052 * sx, 1.722, -0.142], { rough: 0.3 })
    P.add(box(0.04, 0.008, 0.008), B.head, c.eye, [0, 1.726, -0.146], { rough: 0.3 })
  }

  // --- hard hat: dome, brim with front peak, ridge (+ reflective band) ---
  P.add(new THREE.SphereGeometry(0.172, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2), B.head, c.helmet, [0, 1.765, 0], {
    scale: [1.02, 0.92, 1.1],
    rough: 0.32,
  })
  P.add(cyl(0.2, 0.21, 0.024, 22), B.head, c.helmet, [0, 1.768, -0.022], { scale: [1, 1, 1.15], rough: 0.32 })
  // ridge arc from front to back over the crown (stops short of the brim so it never reads as a horn)
  P.add(new THREE.TorusGeometry(0.163, 0.019, 6, 16, Math.PI * 0.74), B.head, c.helmetAccent, [0, 1.765, 0], {
    rot: [0, Math.PI / 2, Math.PI * 0.13],
    scale: [1.02, 0.92, 1.1],
    rough: 0.35,
    emis: look.helmetStripe ? 0.18 : 0,
  })
  if (look.helmetStripe) {
    P.add(cyl(0.1712, 0.1712, 0.032, 22, true), B.head, c.helmetAccent, [0, 1.797, 0], { scale: [1.02, 1, 1.1], rough: 0.35, emis: 0.22 })
  }

  // --- arms (upper arm on shoulder bone, forearm + glove on elbow bone) ---
  for (const side of [-1, 1] as const) {
    const sh = side < 0 ? B.shL : B.shR
    const el = side < 0 ? B.elL : B.elR
    const x0 = 0.285 * side
    const x1 = 0.305 * side
    const x2 = 0.315 * side
    P.limb([x0, 1.47, 0], [x1, 1.15, 0.01], 0.075, sh, c.shirt)
    P.limb([x1, 1.19, 0.01], [x2, 0.95, 0], 0.066, el, c.shirt)
    P.add(cyl(0.073, 0.07, 0.06, 10), el, c.glovesDark, [x2, 0.955, 0], { rough: 0.8 })
    P.add(sphere(0.072, 10, 8), el, c.gloves, [x2 + 0.003 * side, 0.885, -0.006], { scale: [0.85, 1.1, 1], rough: 0.75 })
  }

  // --- accessories ---
  const handL: [number, number, number] = [-0.318, 0.885, -0.006]
  const handR: [number, number, number] = [0.318, 0.885, -0.006]
  const off = (h: [number, number, number], dx: number, dy: number, dz: number): [number, number, number] => [h[0] + dx, h[1] + dy, h[2] + dz]
  switch (look.accessory) {
    case 'clipboard':
      P.add(box(0.2, 0.27, 0.016), B.elL, col('#8d6a43'), off(handL, 0.04, -0.02, -0.11), { rot: [0.35, 0, 0], rough: 0.8 })
      P.add(box(0.17, 0.21, 0.004), B.elL, c.badge, off(handL, 0.04, -0.035, -0.12), { rot: [0.35, 0, 0], rough: 0.9 })
      P.add(box(0.06, 0.025, 0.02), B.elL, c.metal, off(handL, 0.04, 0.1, -0.075), { rot: [0.35, 0, 0], rough: 0.3 })
      break
    case 'tablet':
      P.add(box(0.2, 0.28, 0.018), B.elL, col('#2b3134'), off(handL, 0.04, -0.02, -0.11), { rot: [0.35, 0, 0], rough: 0.4 })
      P.add(box(0.17, 0.24, 0.004), B.elL, col('#7fd6e8'), off(handL, 0.04, -0.023, -0.122), { rot: [0.35, 0, 0], rough: 0.2, emis: 0.9 })
      break
    case 'wrench':
      P.add(box(0.036, 0.3, 0.022), B.elR, c.metal, off(handR, 0, -0.11, -0.03), { rough: 0.3, emis: 0.03 })
      P.add(new THREE.TorusGeometry(0.036, 0.014, 6, 12, Math.PI * 1.6), B.elR, c.metal, off(handR, 0, -0.29, -0.03), { rot: [0, 0, -Math.PI * 0.3], rough: 0.3 })
      break
    case 'mug':
      P.add(cyl(0.045, 0.042, 0.1, 12), B.elR, col('#efe9dd'), off(handR, 0, -0.02, -0.075), { rough: 0.4 })
      P.add(new THREE.TorusGeometry(0.028, 0.009, 5, 10), B.elR, col('#efe9dd'), off(handR, 0.045, -0.02, -0.075), { rot: [0, Math.PI / 2, 0], rough: 0.4 })
      break
    case 'headset':
      for (const sx of [-1, 1]) P.add(cyl(0.052, 0.052, 0.045, 12), B.head, col('#2b2f31'), [0.158 * sx, 1.7, 0.005], { rot: [0, 0, Math.PI / 2], rough: 0.5 })
      P.add(box(0.012, 0.012, 0.14), B.head, col('#2b2f31'), [-0.15, 1.655, -0.07], { rot: [0.35, 0.25, 0], rough: 0.5 })
      P.add(sphere(0.016, 8, 6), B.head, col('#2b2f31'), [-0.125, 1.635, -0.135], { rough: 0.5 })
      break
    case 'whistle':
      P.add(new THREE.TorusGeometry(0.1, 0.008, 4, 18), B.spine, col('#c0392b'), [0, 1.43, -0.06], { rot: [1.2, 0, 0], rough: 0.7 })
      P.add(rbox(0.065, 0.032, 0.035, 0.012), B.spine, col('#d9a53b'), [0, 1.36, -0.165], { rough: 0.3, emis: 0.05 })
      break
    default:
      break
  }

  const geo = mergeParts(P.parts)
  for (const p of P.parts) p.geo.dispose()
  return geo
}

function mergeParts(parts: Part[]): THREE.BufferGeometry {
  let vCount = 0
  let iCount = 0
  for (const p of parts) {
    const n = p.geo.getAttribute('position').count
    vCount += n
    iCount += p.geo.index ? p.geo.index.count : n
  }
  const pos = new Float32Array(vCount * 3)
  const nor = new Float32Array(vCount * 3)
  const colr = new Float32Array(vCount * 3)
  const rough = new Float32Array(vCount)
  const emis = new Float32Array(vCount)
  const skinIndex = new Uint16Array(vCount * 4)
  const skinWeight = new Float32Array(vCount * 4)
  const index = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount)
  let vo = 0
  let io = 0
  for (const p of parts) {
    const pa = p.geo.getAttribute('position')
    const na = p.geo.getAttribute('normal')
    const n = pa.count
    for (let i = 0; i < n; i++) {
      const v = vo + i
      pos[v * 3] = pa.getX(i)
      pos[v * 3 + 1] = pa.getY(i)
      pos[v * 3 + 2] = pa.getZ(i)
      if (na) {
        nor[v * 3] = na.getX(i)
        nor[v * 3 + 1] = na.getY(i)
        nor[v * 3 + 2] = na.getZ(i)
      }
      colr[v * 3] = p.color.r
      colr[v * 3 + 1] = p.color.g
      colr[v * 3 + 2] = p.color.b
      rough[v] = p.rough
      emis[v] = p.emis
      skinIndex[v * 4] = p.bone
      skinWeight[v * 4] = 1
    }
    if (p.geo.index) {
      const idx = p.geo.index
      for (let i = 0; i < idx.count; i++) index[io + i] = idx.getX(i) + vo
      io += idx.count
    } else {
      for (let i = 0; i < n; i++) index[io + i] = vo + i
      io += n
    }
    vo += n
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  g.setAttribute('color', new THREE.BufferAttribute(colr, 3))
  g.setAttribute('aRough', new THREE.BufferAttribute(rough, 1))
  g.setAttribute('aEmis', new THREE.BufferAttribute(emis, 1))
  g.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4))
  g.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4))
  g.setIndex(new THREE.BufferAttribute(index, 1))
  g.computeBoundingBox()
  g.computeBoundingSphere()
  return g
}

/** Number of skeleton bones (skinIndex values are < this). */
export const WORKER_BONE_COUNT = BONES.length

/** Cached merged worker geometry for a full look (shared by every worker wearing it). */
export function getWorkerGeometry(look: WorkerLook): THREE.BufferGeometry {
  const key = lookKey(look)
  let g = geoCache.get(key)
  if (!g) {
    g = buildWorkerGeometry(look)
    geoCache.set(key, g)
  }
  return g
}

// ---------------------------------------------------------------------------
// Material: vertex colors + per-vertex roughness / emissive (one shader for all workers)
// ---------------------------------------------------------------------------

function makeWorkerMaterial(dithered: boolean): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.04 })
  m.name = dithered ? 'worker-dithered' : 'worker'
  if (dithered) m.alphaHash = true
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aRough;\nattribute float aEmis;\nvarying float vRough;\nvarying float vEmis;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvRough = aRough;\nvEmis = aEmis;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vRough;\nvarying float vEmis;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRough;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vEmis;')
  }
  m.customProgramCacheKey = () => (dithered ? 'miw-worker-d' : 'miw-worker')
  return m
}

let sharedMaterial: THREE.MeshStandardMaterial | null = null
function getSharedMaterial(): THREE.MeshStandardMaterial {
  if (!sharedMaterial) sharedMaterial = makeWorkerMaterial(false)
  return sharedMaterial
}

// ---------------------------------------------------------------------------
// Rig (per instance)
// ---------------------------------------------------------------------------

interface Rig {
  mesh: THREE.SkinnedMesh
  bones: THREE.Bone[]
  skeleton: THREE.Skeleton
  ownMaterial: THREE.MeshStandardMaterial | null
}

const BOUNDS = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.75)

function createRig(geometry: THREE.BufferGeometry, dithered: boolean): Rig {
  const ownMaterial = dithered ? makeWorkerMaterial(true) : null
  const mesh = new THREE.SkinnedMesh(geometry, ownMaterial ?? getSharedMaterial())
  const bones: THREE.Bone[] = BONES.map(() => new THREE.Bone())
  BONES.forEach(([parent, abs], i) => {
    const pb = parent >= 0 ? BONES[parent][1] : [0, 0, 0]
    bones[i].position.set(abs[0] - pb[0], abs[1] - pb[1], abs[2] - pb[2])
    if (parent >= 0) bones[parent].add(bones[i])
  })
  mesh.add(bones[0])
  mesh.updateMatrixWorld(true)
  const skeleton = new THREE.Skeleton(bones)
  mesh.bind(skeleton)
  mesh.boundingSphere = BOUNDS.clone()
  mesh.name = 'worker'
  return { mesh, bones, skeleton, ownMaterial }
}

// ---------------------------------------------------------------------------
// Procedural animation
// ---------------------------------------------------------------------------

const POSE_KEYS = [
  'rootY',
  'hipsY',
  'hipsRx',
  'hipsRy',
  'hipsRz',
  'spineRx',
  'spineRy',
  'spineRz',
  'headRx',
  'headRy',
  'headRz',
  'shLx',
  'shLy',
  'shLz',
  'elL',
  'elLz',
  'shRx',
  'shRy',
  'shRz',
  'elR',
  'elRz',
  'thLx',
  'thLz',
  'knL',
  'thRx',
  'thRz',
  'knR',
] as const
type PoseKey = (typeof POSE_KEYS)[number]
type Pose = Record<PoseKey, number>

function neutralPose(p: Pose): Pose {
  for (const k of POSE_KEYS) p[k] = 0
  p.shLz = -0.07
  p.shRz = 0.07
  p.elL = 0.14
  p.elR = 0.14
  return p
}

/** Fidget catalogue for idle workers. */
const FIDGETS = ['look', 'hat', 'watch', 'stretch', 'shift'] as const
type Fidget = (typeof FIDGETS)[number]

interface AnimState {
  t: number
  phase: number
  spin: number
  wasTumble: boolean
  cur: Pose
  tgt: Pose
  fidget: Fidget | null
  fidgetStart: number
  fidgetEnd: number
  nextFidget: number
  rng: number
}

function rand(s: AnimState): number {
  // xorshift-ish LCG; deterministic per seed
  s.rng = (s.rng * 1664525 + 1013904223) >>> 0
  return s.rng / 4294967296
}

function resolve<T>(v: T | (() => T) | undefined, fallback: T): T {
  if (v === undefined) return fallback
  return typeof v === 'function' ? (v as () => T)() : v
}

function envelope(t: number, start: number, end: number, fade = 0.35): number {
  if (t <= start || t >= end) return 0
  const a = Math.min(1, (t - start) / fade)
  const b = Math.min(1, (end - t) / fade)
  const w = Math.min(a, b)
  return w * w * (3 - 2 * w)
}

function computePose(s: AnimState, a: WorkerAnim, v: number, seed: number, dt: number): void {
  const T = neutralPose(s.tgt)
  const t = s.t
  switch (a) {
    case 'walk':
    case 'run':
    case 'carry': {
      const run = a === 'run'
      const moving = a !== 'carry' || v > 0.2
      const vEff = a === 'carry' ? Math.max(v, 0) : Math.max(v, run ? 3.5 : 1.3)
      if (moving) s.phase += dt * Math.PI * 2 * gaitFrequency(vEff)
      const ph = s.phase
      const sn = Math.sin(ph)
      const cs = Math.cos(ph)
      const legA = run ? 0.82 : 0.5
      const knee = run ? 1.45 : 0.75
      if (moving) {
        T.thLx = sn * legA
        T.thRx = -sn * legA
        T.knL = knee * Math.max(0, cs) + 0.06
        T.knR = knee * Math.max(0, -cs) + 0.06
        T.hipsY = -sn * sn * (run ? 0.055 : 0.032) + (run ? 0.02 : 0)
        T.hipsRy = -sn * 0.1
        T.spineRy = sn * 0.18
      }
      const lean = run ? 0.2 : 0.06
      T.spineRx = -lean
      T.headRx = lean * 0.6
      if (a === 'carry') {
        T.shLx = 1.05
        T.shRx = 1.05
        T.shLz = 0.12
        T.shRz = -0.12
        T.elL = 0.85
        T.elR = 0.85
        T.spineRx = 0.06
      } else {
        const armA = run ? 0.75 : 0.42
        T.shLx = -sn * armA
        T.shRx = sn * armA
        T.elL = run ? 1.3 : 0.3 + Math.max(0, -sn) * 0.25
        T.elR = run ? 1.3 : 0.3 + Math.max(0, sn) * 0.25
        T.shLz = run ? -0.16 : -0.08
        T.shRz = run ? 0.16 : 0.08
      }
      break
    }
    case 'work': {
      s.phase += dt * 7
      const w = Math.sin(s.phase)
      T.spineRx = -0.18
      T.headRx = -0.3
      T.shRx = 1.15 + w * 0.32
      T.elR = 1.05 + w * 0.4
      T.shLx = 0.95
      T.elL = 1.25
      T.shLz = 0.1
      T.shRz = -0.1
      T.hipsY = -0.015 - Math.abs(w) * 0.008
      break
    }
    case 'wave': {
      // upper arm out to the side, forearm up, hand waving in the frontal plane
      T.shRz = 1.3
      T.shRx = 0.12
      T.elR = 0
      T.elRz = 1.8 + Math.sin(t * 9) * 0.42
      T.headRz = 0.08
      T.spineRz = -0.04
      break
    }
    case 'point': {
      T.shRx = 1.45
      T.shRz = 0.12
      T.elR = 0.05
      T.spineRy = 0.16
      T.headRy = 0.08
      T.shLz = -0.1
      break
    }
    case 'panic': {
      s.phase += dt * 15
      const p = s.phase
      T.shLz = -2.35 + Math.sin(p) * 0.45
      T.shRz = 2.35 + Math.cos(p) * 0.45
      T.elL = 0.6 + Math.sin(p * 1.3) * 0.4
      T.elR = 0.6 + Math.cos(p * 1.3) * 0.4
      T.thLx = Math.sin(p) * 0.75
      T.thRx = -Math.sin(p) * 0.75
      T.knL = 0.9 * Math.max(0, Math.cos(p)) + 0.1
      T.knR = 0.9 * Math.max(0, -Math.cos(p)) + 0.1
      T.hipsY = Math.abs(Math.sin(p)) * 0.06
      T.headRy = Math.sin(t * 10) * 0.5
      T.spineRx = 0.08
      break
    }
    case 'cheer': {
      s.phase += dt * 8
      const p = Math.sin(s.phase)
      T.shLz = -2.7
      T.shRz = 2.7
      T.elL = 0.35 + Math.max(0, p) * 0.7
      T.elR = 0.35 + Math.max(0, -p) * 0.7
      T.rootY = Math.max(0, Math.sin(s.phase * 0.5)) * 0.14
      T.knL = 0.25
      T.knR = 0.25
      T.headRx = 0.25
      break
    }
    case 'kick': {
      s.phase += dt * 10
      const k = Math.sin(s.phase)
      T.thRx = k > 0 ? 1.35 : -0.55
      T.knR = k > 0 ? 0.15 : 0.9
      T.shLx = 0.7
      T.shLz = -0.5
      T.shRx = -0.45
      T.spineRx = 0.12
      break
    }
    case 'tackle': {
      T.hipsRx = -1.28
      T.rootY = -0.38
      T.shLx = 2.85
      T.shRx = 2.85
      T.shLz = 0.15
      T.shRz = -0.15
      T.elL = 0.1
      T.elR = 0.1
      T.thLx = -0.12
      T.thRx = 0.18
      T.knL = 0.3
      T.knR = 0.15
      T.headRx = 0.9
      break
    }
    case 'sit': {
      T.rootY = -0.45
      T.thLx = 1.5
      T.thRx = 1.5
      T.knL = 1.5
      T.knR = 1.5
      T.shLx = 0.55
      T.shRx = 0.55
      T.elL = 0.75
      T.elR = 0.75
      T.spineRx = -0.06
      T.headRy = Math.sin(t * 0.35 + seed) * 0.3
      break
    }
    case 'sleep': {
      T.hipsRx = Math.PI / 2
      T.rootY = -HIPS_Y + 0.15
      T.shLz = -0.25
      T.shRz = 0.25
      T.elL = 0.3
      T.elR = 0.3
      T.thLz = -0.08
      T.thRz = 0.08
      T.knL = 0.25
      T.knR = 0.05
      T.headRy = 0.35
      T.spineRx = Math.sin(t * 1.4) * 0.025
      break
    }
    case 'tumble': {
      s.spin += dt * 10.5
      const fl = Math.sin(t * 14)
      T.rootY = 0.12 + Math.abs(Math.sin(s.spin * 0.5)) * 0.28
      T.shLz = -1.7 + fl * 0.35
      T.shRz = 1.7 - fl * 0.35
      T.elL = 0.5
      T.elR = 0.5
      T.thLz = -0.45
      T.thRz = 0.45
      T.thLx = 0.4 + fl * 0.3
      T.thRx = 0.4 - fl * 0.3
      T.knL = 0.7
      T.knR = 0.7
      T.headRx = 0.3
      break
    }
    case 'idle':
    default: {
      // breathing + slow weight shift
      T.hipsY = Math.sin(t * 1.7 + seed) * 0.005
      T.spineRx = Math.sin(t * 1.7 + seed) * 0.015
      T.hipsRz = Math.sin(t * 0.33 + seed * 2.1) * 0.025
      T.thLz = -T.hipsRz
      T.thRz = -T.hipsRz
      T.headRy = Math.sin(t * 0.37 + seed) * 0.12
      T.shLz = -0.08 - Math.sin(t * 1.7 + seed) * 0.015
      T.shRz = 0.08 + Math.sin(t * 1.7 + seed) * 0.015
      T.elL = 0.18
      T.elR = 0.18
      applyFidget(s, T, t)
      break
    }
  }
  if (a !== 'idle') {
    s.fidget = null
    s.nextFidget = Math.max(s.nextFidget, t + 2 + rand(s) * 3)
  }
}

function applyFidget(s: AnimState, T: Pose, t: number): void {
  if (!s.fidget && t >= s.nextFidget) {
    s.fidget = FIDGETS[Math.floor(rand(s) * FIDGETS.length) % FIDGETS.length]
    s.fidgetStart = t
    s.fidgetEnd = t + 1.4 + rand(s) * 1.0
  }
  if (!s.fidget) return
  const w = envelope(t, s.fidgetStart, s.fidgetEnd)
  const u = (t - s.fidgetStart) / Math.max(0.01, s.fidgetEnd - s.fidgetStart)
  switch (s.fidget) {
    case 'look':
      T.headRy += w * (u < 0.5 ? 0.75 : -0.75)
      T.spineRy += w * (u < 0.5 ? 0.12 : -0.12)
      break
    case 'hat':
      // tip / adjust the hard hat
      T.shRx += w * 2.35
      T.shRz += w * -0.25
      T.elR += w * 1.35
      T.headRx += w * -0.1
      break
    case 'watch':
      T.shLx += w * 0.55
      T.shLz += w * 0.3
      T.elL += w * 1.6
      T.headRx += w * -0.42
      T.headRy += w * 0.18
      break
    case 'stretch':
      T.shLz += w * -2.55
      T.shRz += w * 2.55
      T.elL += w * 0.2
      T.elR += w * 0.2
      T.spineRx += w * 0.14
      T.headRx += w * 0.3
      break
    case 'shift':
      T.hipsRz += w * 0.07
      T.thLz -= w * 0.07
      T.thRz -= w * 0.07
      T.spineRz += w * -0.06
      break
  }
  if (t >= s.fidgetEnd) {
    s.fidget = null
    s.nextFidget = t + 4 + rand(s) * 6
  }
}

/** Animations in which a head glance (lookYaw) makes sense. */
const LOOK_ANIMS = new Set<WorkerAnim>(['idle', 'walk', 'run', 'work', 'point', 'carry', 'sit', 'wave', 'cheer'])

function applyPose(bones: THREE.Bone[], p: Pose, extraSpin: number): void {
  const root = bones[B.root]
  root.position.y = p.rootY
  const hips = bones[B.hips]
  hips.position.y = HIPS_Y + p.hipsY
  hips.rotation.set(p.hipsRx + extraSpin, p.hipsRy, p.hipsRz)
  bones[B.spine].rotation.set(p.spineRx, p.spineRy, p.spineRz)
  bones[B.head].rotation.set(p.headRx, p.headRy, p.headRz)
  bones[B.shL].rotation.set(p.shLx, p.shLy, p.shLz)
  bones[B.elL].rotation.set(p.elL, 0, p.elLz)
  bones[B.shR].rotation.set(p.shRx, p.shRy, p.shRz)
  bones[B.elR].rotation.set(p.elR, 0, p.elRz)
  bones[B.thL].rotation.set(p.thLx, 0, p.thLz)
  bones[B.knL].rotation.set(-p.knL, 0, 0)
  bones[B.thR].rotation.set(p.thRx, 0, p.thRz)
  bones[B.knR].rotation.set(-p.knR, 0, 0)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WorkerModel({ look: lookPatch, anim = 'idle', speed = 0, seed = 0, castShadow = true, opacity, lookYaw, ...groupProps }: WorkerModelProps) {
  const look = useMemo<WorkerLook>(() => ({ ...DEFAULT_LOOK, ...lookPatch }), [lookPatch])
  const key = lookKey(look)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geometry = useMemo(() => getWorkerGeometry(look), [key])
  const dithered = opacity !== undefined
  const rig = useMemo(() => createRig(geometry, dithered), [geometry, dithered])

  useEffect(() => {
    rig.mesh.castShadow = castShadow
    rig.mesh.receiveShadow = castShadow
  }, [rig, castShadow])

  useEffect(
    () => () => {
      rig.skeleton.dispose()
      rig.ownMaterial?.dispose()
    },
    [rig],
  )

  const state = useRef<AnimState | null>(null)
  if (!state.current) {
    const cur = neutralPose({} as Pose)
    state.current = {
      t: seed * 3.1,
      phase: seed * 1.37,
      spin: 0,
      wasTumble: false,
      cur,
      tgt: neutralPose({} as Pose),
      fidget: null,
      fidgetStart: 0,
      fidgetEnd: 0,
      nextFidget: seed * 3.1 + 3 + (Math.abs(Math.sin(seed * 12.9898)) % 1) * 5,
      rng: (Math.floor(Math.abs(seed) * 2654435761) ^ 0x9e3779b9) >>> 0 || 1,
    }
  }

  useFrame((_, rawDt) => {
    const s = state.current
    if (!s) return
    const dt = Math.min(Math.max(rawDt, 0), 0.05)
    s.t += dt
    const a = resolve(anim, 'idle')
    const v = Math.max(0, resolve(speed, 0) || 0)
    computePose(s, a, v, seed, dt)
    if (lookYaw !== undefined && LOOK_ANIMS.has(a)) {
      const ly = resolve(lookYaw, null)
      if (ly !== null && Number.isFinite(ly)) {
        const y = Math.max(-1.1, Math.min(1.1, ly))
        s.tgt.headRy = s.tgt.headRy * 0.15 + y * 0.85
        s.tgt.spineRy += y * 0.22
      }
    }

    const tumble = a === 'tumble'
    if (s.wasTumble && !tumble) {
      // continue smoothly from the spin angle toward the new pose (shortest way round)
      const w = ((s.spin % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
      s.cur.hipsRx += w > Math.PI ? w - Math.PI * 2 : w
      s.spin = 0
    }
    s.wasTumble = tumble

    const rate = a === 'point' || a === 'kick' || a === 'wave' ? 18 : a === 'sleep' ? 6 : 14
    const k = 1 - Math.exp(-rate * dt)
    const c = s.cur
    const T = s.tgt
    for (const key2 of POSE_KEYS) c[key2] += (T[key2] - c[key2]) * k
    applyPose(rig.bones, c, tumble ? s.spin : 0)

    if (rig.ownMaterial) {
      const o = Math.min(1, Math.max(0, resolve(opacity, 1)))
      rig.ownMaterial.opacity = o
      rig.mesh.visible = o > 0.02
    }
  })

  return (
    <group {...groupProps}>
      <primitive object={rig.mesh} />
    </group>
  )
}

export default WorkerModel
