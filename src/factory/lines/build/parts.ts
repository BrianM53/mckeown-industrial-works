/**
 * Reusable machine parts for the production spine: palette & styles, a
 * 4-axis robot arm with planar IK, stack lights, ground belts, bucket
 * elevators, sign boards and small industrial dressing (bolts, ladders,
 * cabinets, pipe runs).
 */
import { forwardFromYaw, rightFromYaw } from '@/core/math'
import { BELT, ELEVATOR, lineDef, type GroundLineId } from '../config'
import { ik2 } from '../logic'
import { CH } from '../render/materials'
import { LAMP } from '../render/lamps'
import type { GeoBatch, Style, V3 } from './builder'
import type { Kit } from './kit'
import type { Rig } from './rig'

// ---------------------------------------------------------------------------
// Palette & styles
// ---------------------------------------------------------------------------

export const COL = {
  black: '#151819',
  charcoal: '#2a3031',
  iron: '#3a4042',
  gunmetal: '#4a575a',
  steel: '#7d8a8c',
  steelLight: '#a7b1b0',
  chrome: '#cfd6d5',
  rust: '#a95e39',
  brick: '#7a4a36',
  brickDark: '#5a3528',
  refractory: '#b59f84',
  hazard: '#e9b63f',
  safety: '#e57d35',
  red: '#c8443a',
  redDark: '#8e2a22',
  cream: '#e6dfcc',
  white: '#d8d4c6',
  copper: '#b87333',
  brass: '#c29a4a',
  machineGreen: '#56786a',
  greenDark: '#3c5a4e',
  teal: '#4fc3a1',
  tealDark: '#2d6a5e',
  blueGrey: '#4d6a7e',
  blue: '#3f7aa0',
  navy: '#2b3f52',
  tankOrange: '#e5762c',
  rubber: '#1a1c1d',
  pcb: '#2f7d4a',
  gold: '#d6b048',
  furnace: '#ffb05a',
  molten: '#ff8a2a',
  coolWhite: '#e2f2ff',
  wood: '#a8794a',
} as const

export const st = {
  paint: (color: string, rough = 0.6, metal = 0.22): Style => ({ color, rough, metal }),
  metal: (color: string, rough = 0.34, metal = 0.8): Style => ({ color, rough, metal }),
  rough: (color: string, rough = 0.92, metal = 0.04): Style => ({ color, rough, metal }),
  rubber: { color: COL.rubber, rough: 0.95, metal: 0 } as Style,
  glow: (color: string, emis = 2, chan: number = CH.CONST): Style => ({ color, rough: 0.5, metal: 0, emis, chan }),
  white: { color: '#ffffff' } as Style,
}

// ---------------------------------------------------------------------------
// Small dressing
// ---------------------------------------------------------------------------

/** Ring of bolt heads on a flange (axis along `axis`). */
export function boltRing(b: GeoBatch, c: V3, R: number, n: number, axis: 'x' | 'y' | 'z', style: Style, r = 0.035, len = 0.05): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const u = Math.cos(a) * R
    const v = Math.sin(a) * R
    const p: V3 = axis === 'z' ? [c[0] + u, c[1] + v, c[2]] : axis === 'x' ? [c[0], c[1] + v, c[2] + u] : [c[0] + u, c[1], c[2] + v]
    b.cylAxis(p, axis, r, len, style, 6)
  }
}

/** Vertical cage ladder against a face (ladder runs up from y0 to y1). */
export function ladder(b: GeoBatch, x: number, z: number, y0: number, y1: number, along: 'x' | 'z', style: Style): void {
  const w = 0.22
  for (const s of [-1, 1]) {
    const a: V3 = along === 'x' ? [x + s * w, y0, z] : [x, y0, z + s * w]
    const c: V3 = along === 'x' ? [x + s * w, y1, z] : [x, y1, z + s * w]
    b.cyl(a, c, 0.025, style, 6)
  }
  for (let y = y0 + 0.3; y < y1; y += 0.32) {
    const a: V3 = along === 'x' ? [x - w, y, z] : [x, y, z - w]
    const c: V3 = along === 'x' ? [x + w, y, z] : [x, y, z + w]
    b.cyl(a, c, 0.018, style, 5)
  }
}

/** Pipe through a list of points with ball elbows. */
export function pipeRun(b: GeoBatch, pts: V3[], r: number, style: Style, segs = 10): void {
  for (let i = 1; i < pts.length; i++) b.cyl(pts[i - 1], pts[i], r, style, segs)
  for (let i = 1; i < pts.length - 1; i++) b.sphere(pts[i], r * 1.08, style, segs, 6)
}

/** Control cabinet with door seam, vents and a few buttons, front facing `yaw`. Origin = floor center. */
export function cabinet(k: Kit, b: GeoBatch, x: number, z: number, yaw: number, w: number, h: number, d: number, color: string): void {
  b.frame(x, 0, z, yaw, () => {
    b.rbox([0, h / 2, 0], [w, h, d], st.paint(color), 0.04)
    b.box([0, 0.04, 0], [w + 0.06, 0.08, d + 0.06], st.paint(COL.charcoal))
    b.box([0, h * 0.55, -d / 2 - 0.004], [0.01, h * 0.8, 0.01], st.paint(COL.black))
    if (k.detail) {
      for (let i = 0; i < 4; i++) b.box([-w * 0.25, h * 0.82 - i * 0.05, -d / 2 - 0.004], [w * 0.3, 0.018, 0.01], st.paint(COL.black))
      b.cylAxis([w * 0.28, h * 0.55, -d / 2 - 0.02], 'z', 0.035, 0.04, st.metal(COL.chrome), 8)
    }
  })
}

// ---------------------------------------------------------------------------
// Stack light (red / amber / green tower) — returns lamp indices
// ---------------------------------------------------------------------------

export interface StackLight {
  red: number
  amber: number
  green: number
}

export function stackLight(k: Kit, b: GeoBatch, x: number, y: number, z: number, r = 0.075): StackLight {
  const h = r * 1.5
  const gap = 0.012
  b.cylY(x, y - 0.05, z, r * 1.05, 0.05, st.paint(COL.charcoal), 10)
  const green = k.lamps.add([x, y, z], [0, 1, 0], r, h)
  const amber = k.lamps.add([x, y + h + gap, z], [0, 1, 0], r, h)
  const red = k.lamps.add([x, y + 2 * (h + gap), z], [0, 1, 0], r, h)
  b.cylY(x, y + 3 * (h + gap) - 0.01, z, r * 0.9, 0.04, st.paint(COL.charcoal), 10)
  return { red, amber, green }
}

/** Line status light: green running, amber while waiting for belt room, red flash on a caught defect. */
export function setStackLight(k: { lamps: { light: (i: number, c: readonly [number, number, number], on: boolean | number) => void } }, s: StackLight, status: string, rate: number, defect: number, t: number, reduced: boolean): void {
  const waiting = status === 'blocked' || rate <= 0
  const flash = defect > 0 ? (reduced ? 1 : Math.sin(t * 22) > 0 ? 1 : 0.2) : 0
  k.lamps.light(s.red, LAMP.red, flash)
  k.lamps.light(s.amber, LAMP.amber, waiting && defect <= 0 ? (reduced ? 1 : 0.65 + 0.35 * Math.sin(t * 5)) : 0)
  k.lamps.light(s.green, LAMP.green, !waiting && defect <= 0 ? 1 : 0)
}

// ---------------------------------------------------------------------------
// Signs
// ---------------------------------------------------------------------------

/** Atlas sign on a dark backing board, facing `yaw`. Height from width & the cell aspect. Returns height. */
export function signBoard(k: Kit, b: GeoBatch, key: string, c: V3, w: number, yaw: number, opts: { back?: boolean; frame?: string; emis?: number; chan?: number; depth?: number } = {}): number {
  const cell = k.atlas.cells[key]
  if (!cell) return 0
  const h = w / cell.aspect
  const d = opts.depth ?? 0.06
  const f = forwardFromYaw(yaw)
  b.frame(c[0], c[1], c[2], yaw, () => {
    b.box([0, 0, d / 2], [w + 0.08, h + 0.08, d], st.paint(opts.frame ?? COL.charcoal))
  })
  const style: Style = { color: '#ffffff', emis: opts.emis ?? 0, chan: opts.chan ?? CH.CONST }
  k.sign.quad([c[0] + f.x * 0.006, c[1], c[2] + f.z * 0.006], w, h, yaw, style, cell.uv)
  if (opts.back) k.sign.quad([c[0] - f.x * (d + 0.006), c[1], c[2] - f.z * (d + 0.006)], w, h, yaw + Math.PI, style, cell.uv)
  return h
}

// ---------------------------------------------------------------------------
// Ground belt run (frame, legs, rollers, scrolling surface)
// ---------------------------------------------------------------------------

/** Builds a ground line's belt from BELT.zNorth to BELT.zSouth. Returns the belt id. */
export function groundBelt(k: Kit, b: GeoBatch, id: GroundLineId): number {
  const x = lineDef(id).x
  const accent = lineDef(id).color
  const z0 = BELT.zNorth
  const z1 = BELT.zSouth
  const len = z1 - z0
  const zc = (z0 + z1) / 2
  const top = BELT.top
  const tile = 0.8
  const beltId = k.belts.add(tile)
  k.belt.belt(beltId, () => {
    k.belt.quad([x, top, zc], BELT.width, len, 0, st.white, [0, 0, 1, len / tile], -Math.PI / 2)
  })
  // return strand + bed
  b.box([x, top - 0.28, zc], [BELT.width - 0.06, 0.02, len], st.rubber)
  b.box([x, top - 0.035, zc], [BELT.width + 0.02, 0.05, len + 0.02], st.paint(COL.iron))
  // side rails with a painted lip in the line color
  for (const s of [-1, 1]) {
    const rx = x + s * (BELT.frameW / 2 - 0.05)
    b.rbox([rx, top - 0.06, zc], [0.1, 0.26, len + 0.1], st.paint(COL.gunmetal), 0.02)
    b.box([rx, top + 0.08, zc], [0.11, 0.035, len + 0.1], st.paint(accent, 0.55, 0.2))
  }
  // end drums
  for (const z of [z0 + 0.12, z1 - 0.12]) b.cylAxis([x, top - 0.13, z], 'x', 0.13, BELT.width + 0.02, st.metal(COL.steel), 14)
  // legs + braces
  const n = Math.max(2, Math.round(len / 2.1))
  for (let i = 0; i <= n; i++) {
    const z = z0 + 0.4 + ((len - 0.8) * i) / n
    for (const s of [-1, 1]) {
      const lx = x + s * (BELT.frameW / 2 - 0.1)
      b.box([lx, (top - 0.18) / 2, z], [0.08, top - 0.18, 0.08], st.paint(COL.gunmetal))
      b.box([lx, 0.015, z], [0.18, 0.03, 0.18], st.paint(COL.charcoal))
    }
    b.box([x, 0.28, z], [BELT.frameW - 0.2, 0.05, 0.05], st.paint(COL.gunmetal))
  }
  if (k.detail) {
    for (let z = z0 + 0.8; z < z1 - 0.6; z += 1.1) b.cylAxis([x, top - 0.2, z], 'x', 0.045, BELT.width - 0.1, st.metal(COL.steelLight), 8)
  }
  return beltId
}

// ---------------------------------------------------------------------------
// Bucket elevator (north end of every ground line)
// ---------------------------------------------------------------------------

export function elevator(k: Kit, b: GeoBatch, id: GroundLineId): number {
  const x = lineDef(id).x
  const accent = lineDef(id).color
  const E = ELEVATOR
  const hw = E.halfW
  const zc = (E.zMin + E.zMax) / 2
  const depth = E.zMax - E.zMin
  const body = st.paint(COL.steelLight, 0.55, 0.35)
  const trim = st.paint(COL.gunmetal)
  const zS = E.zMax // south face
  // back + side walls
  b.box([x, E.height / 2, E.zMin + 0.03], [hw * 2, E.height, 0.06], body)
  for (const s of [-1, 1]) b.box([x + s * (hw - 0.03), E.height / 2, zc], [0.06, E.height, depth], body)
  b.rbox([x, E.height + 0.06, zc], [hw * 2 + 0.12, 0.14, depth + 0.12], trim, 0.03)
  // south face with belt mouth (y 0.7..1.35) and a window (E.windowY0..E.windowY1)
  const wf = (y0: number, y1: number) => b.box([x, (y0 + y1) / 2, zS - 0.03], [hw * 2, y1 - y0, 0.06], body)
  wf(0, 0.62)
  wf(1.38, E.windowY0)
  wf(E.windowY1, E.height)
  for (const s of [-1, 1]) {
    b.box([x + s * (hw - 0.09), (0.62 + 1.38) / 2, zS - 0.03], [0.18, 0.76, 0.06], body)
    b.box([x + s * (hw - 0.11), (E.windowY0 + E.windowY1) / 2, zS - 0.03], [0.22, E.windowY1 - E.windowY0, 0.06], body)
  }
  // window frame + glass
  b.box([x, E.windowY0 - 0.03, zS + 0.01], [hw * 2 - 0.18, 0.06, 0.06], trim)
  b.box([x, E.windowY1 + 0.03, zS + 0.01], [hw * 2 - 0.18, 0.06, 0.06], trim)
  k.glass.box([x, (E.windowY0 + E.windowY1) / 2, zS - 0.01], [hw * 2 - 0.44, E.windowY1 - E.windowY0, 0.02], st.white)
  // dark interior + rising bucket chain
  b.box([x, (E.windowY0 + E.windowY1) / 2, E.zMin + 0.12], [hw * 2 - 0.2, E.windowY1 - E.windowY0 + 0.4, 0.04], st.paint(COL.black, 0.9, 0.1))
  const tile = 0.6
  const chainId = k.belts.add(tile)
  k.belt.belt(chainId, () => {
    const h = E.height - 0.4
    k.belt.quad([x, 0.2 + h / 2, zc + 0.1], 0.5, h, Math.PI, st.white, [0, 0, 1, h / tile])
  })
  // bucket lips (static rail stripes beside the chain)
  for (const s of [-1, 1]) b.box([x + s * 0.3, E.height / 2, zc + 0.12], [0.04, E.height - 0.3, 0.04], st.metal(COL.steel))
  // accent band + corner angles + foot
  b.box([x, 4.55, zc], [hw * 2 + 0.03, 0.3, depth + 0.03], st.paint(accent, 0.55, 0.2))
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box([x + sx * (hw - 0.01), E.height / 2, zc + sz * (depth / 2 - 0.01)], [0.08, E.height, 0.08], trim)
  b.box([x, 0.08, zc], [hw * 2 + 0.25, 0.16, depth + 0.25], st.paint(COL.charcoal))
  // head bridge to the collector (enclosed) + discharge spout
  const hz0 = E.headZEnd
  const hz1 = E.zMin + 0.4
  b.rbox([x, (E.headY0 + E.headY1) / 2, (hz0 + hz1) / 2], [0.92, E.headY1 - E.headY0, hz1 - hz0], body, 0.04)
  b.box([x, E.headY1 + 0.02, (hz0 + hz1) / 2], [0.98, 0.05, hz1 - hz0 + 0.06], trim)
  b.box([x, E.headY0 - 0.18, hz0 + 0.18], [0.6, 0.36, 0.36], trim)
  b.box([x, E.headY0 + 0.12, (hz0 + hz1) / 2], [0.96, 0.06, hz1 - hz0], st.paint(accent, 0.55, 0.2))
  // drive motor on the head
  b.cylAxis([x + 0.6, E.height - 0.3, zc], 'x', 0.16, 0.4, st.paint(COL.navy), 12)
  b.box([x + 0.5, E.height - 0.3, zc], [0.2, 0.32, 0.36], st.paint(COL.navy))
  if (k.detail) ladder(b, x - hw - 0.18, zc, 0.2, E.height - 0.1, 'z', st.metal(COL.hazard, 0.5, 0.4))
  // "PARTS LIFT" sign above the window
  signBoard(k, b, 'lift', [x, (E.windowY1 + E.height) / 2 - 0.02, zS + 0.04], 0.62, Math.PI)
  return chainId
}

// ---------------------------------------------------------------------------
// Robot arm (turret / shoulder / elbow / wrist) with planar IK
// ---------------------------------------------------------------------------

export interface RobotSpec {
  name: string
  x: number
  z: number
  /** Facing yaw of the base (the turret's zero). */
  yaw: number
  color: string
  tool: 'gripper' | 'torch'
  l1?: number
  l2?: number
  shoulderY?: number
  scale?: number
  /** Glow channel of the torch tip. */
  tipChan?: number
}

export interface Robot {
  spec: RobotSpec
  turret: number
  shoulder: number
  elbow: number
  wrist: number
  /** Bone of whatever the gripper carries (scale 0/1). */
  carry: number
  l1: number
  l2: number
  lt: number
  sh: number
  /** World position the tool tip was last posed to. */
  tip: [number, number, number]
  /** Pose the arm so the tool tip reaches world (x, y, z); tool angle from vertical (π = straight down). */
  reach(rig: Rig, x: number, y: number, z: number, toolFromVertical: number): void
}

const _ik: [number, number] = [0, 0]

export function robotArm(k: Kit, base: GeoBatch, spec: RobotSpec, carried?: (b: GeoBatch) => void): Robot {
  const sc = spec.scale ?? 1
  const l1 = (spec.l1 ?? 1.05) * sc
  const l2 = (spec.l2 ?? 0.95) * sc
  const sh = (spec.shoulderY ?? 0.98) * sc
  const lt = (spec.tool === 'torch' ? 0.34 : 0.26) * sc
  const paint = st.paint(spec.color, 0.5, 0.25)
  const dark = st.paint(COL.charcoal)
  const joint = st.metal(COL.steel)
  const { x, z, yaw } = spec
  const rig = k.rig
  // pedestal (static)
  base.frame(x, 0, z, yaw, () => {
    base.cylY(0, 0, 0, 0.42 * sc, 0.1, st.paint(COL.charcoal), 16)
    base.cylY(0, 0.1, 0, 0.3 * sc, 0.5 * sc, st.paint(COL.iron), 16)
    if (k.detail) {
      boltRing(base, [0, 0.1, 0], 0.36 * sc, 8, 'y', st.metal(COL.steel), 0.025, 0.03)
      base.box([0, 0.35 * sc, -0.31 * sc], [0.16, 0.2, 0.03], st.paint(COL.hazard))
    }
  })
  const turret = rig.add(`${spec.name}:turret`, 0, [x, 0.6 * sc, z], yaw)
  const shoulder = rig.add(`${spec.name}:shoulder`, turret, [x, sh, z], yaw)
  const elbow = rig.add(`${spec.name}:elbow`, shoulder, [x, sh + l1, z], yaw)
  const wrist = rig.add(`${spec.name}:wrist`, elbow, [x, sh + l1 + l2, z], yaw)
  const carry = rig.add(`${spec.name}:carry`, wrist, [x, sh + l1 + l2 + lt, z], yaw)
  const S = k.skin
  S.frame(x, 0, z, yaw, () => {
    S.bone(turret, () => {
      S.cylY(0, 0.6 * sc, 0, 0.34 * sc, 0.14 * sc, dark, 16)
      S.rbox([0, (0.74 + 0.16) * sc, 0.05 * sc], [0.5 * sc, 0.32 * sc, 0.55 * sc], paint, 0.06)
      for (const s of [-1, 1]) S.rbox([s * 0.2 * sc, sh, 0], [0.07 * sc, 0.36 * sc, 0.34 * sc], paint, 0.02)
      S.cylAxis([-0.33 * sc, 0.88 * sc, 0.12 * sc], 'x', 0.12 * sc, 0.2 * sc, st.paint(COL.charcoal), 12)
      if (k.detail) S.box([0, 0.9 * sc, 0.33 * sc], [0.2 * sc, 0.12 * sc, 0.02], st.glow('#ff9a3a', 0.6))
    })
    S.bone(shoulder, () => {
      S.cylAxis([0, sh, 0], 'x', 0.16 * sc, 0.33 * sc, joint, 14)
      S.rbox([0, sh + l1 / 2, 0.02 * sc], [0.22 * sc, l1, 0.26 * sc], paint, 0.05)
      S.box([0, sh + l1 * 0.45, 0.16 * sc], [0.1 * sc, l1 * 0.6, 0.05 * sc], dark)
    })
    S.bone(elbow, () => {
      S.cylAxis([0, sh + l1, 0], 'x', 0.13 * sc, 0.3 * sc, joint, 12)
      S.cylAxis([0, sh + l1, 0.16 * sc], 'x', 0.1 * sc, 0.22 * sc, st.paint(COL.charcoal), 10)
      S.rbox([0, sh + l1 + l2 / 2, 0], [0.16 * sc, l2, 0.18 * sc], paint, 0.04)
    })
    S.bone(wrist, () => {
      const wy = sh + l1 + l2
      S.cylAxis([0, wy, 0], 'x', 0.09 * sc, 0.2 * sc, joint, 10)
      if (spec.tool === 'gripper') {
        S.box([0, wy + 0.1 * sc, 0], [0.22 * sc, 0.05 * sc, 0.12 * sc], dark)
        for (const s of [-1, 1]) S.box([s * 0.08 * sc, wy + 0.2 * sc, 0], [0.035 * sc, 0.18 * sc, 0.08 * sc], st.metal(COL.chrome))
      } else {
        S.cyl([0, wy, 0], [0, wy + lt * 0.75, -0.04 * sc], 0.045 * sc, dark, 8)
        S.cyl([0, wy + lt * 0.75, -0.04 * sc], [0, wy + lt, -0.02 * sc], 0.03 * sc, st.metal(COL.copper), 8, 0.018 * sc)
        S.sphere([0, wy + lt, -0.02 * sc], 0.025 * sc, st.glow('#bfe4ff', 3, spec.tipChan ?? CH.WELD), 8, 6)
        S.cylAxis([0, wy + 0.06, 0.07 * sc], 'z', 0.03 * sc, 0.12, st.rubber, 6)
      }
    })
    if (carried) S.bone(carry, () => carried(S))
  })
  // NOTE: never pose bones here — the skeleton's bind pose is captured at rig.finalize().
  const robot: Robot = {
    spec,
    turret,
    shoulder,
    elbow,
    wrist,
    carry,
    l1,
    l2,
    lt,
    sh,
    tip: [x, sh + l1 + l2 + lt, z],
    reach(r: Rig, tx: number, ty: number, tz: number, toolFromVertical: number) {
      const dx = tx - x
      const dz = tz - z
      const fw = forwardFromYaw(yaw)
      const rt = rightFromYaw(yaw)
      const f = dx * fw.x + dz * fw.z
      const rr = dx * rt.x + dz * rt.z
      const theta = Math.atan2(-rr, f)
      const d = Math.hypot(f, rr)
      const wd = d - lt * Math.sin(toolFromVertical)
      const wh = ty - lt * Math.cos(toolFromVertical) - sh
      ik2(wd, wh, l1, l2, _ik)
      const a1 = _ik[0]
      const a2 = _ik[1]
      const a3 = toolFromVertical - a1 - a2
      r.pose(turret, 0, theta, 0)
      r.pose(shoulder, -a1, 0, 0)
      r.pose(elbow, -a2, 0, 0)
      r.pose(wrist, -a3, 0, 0)
      this.tip[0] = tx
      this.tip[1] = ty
      this.tip[2] = tz
    },
  }
  return robot
}
