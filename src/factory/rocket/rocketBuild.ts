/**
 * Procedural, intentionally ugly rocket built from the per-rocket seed.
 *
 * Rocket frame: +Y up, base (engine exit plane) at y = 0, axis at x = z = 0.
 * Angles θ are measured from local +Z toward +X: a point at radius r is
 * (sin θ · r, y, cos θ · r). Fixed layout (the tower/pad rely on it):
 *   θ = 0°    ladder (stowaway side; faces the viewers on the pad)
 *   θ = 90°   the comically large fin (open south face in the tower, east on the pad)
 *   θ = 210°, 330° the other fins (330° is the duct-taped one that may fall off)
 *   θ = 145°, 270° side tanks; 180° mini booster; 300° mailbox; 60° dish
 *   θ ≈ 31°   umbilical contact (kept clear)
 *
 * Every part is tagged with its assembly stage and breakup chunk, so the same
 * parts produce both the 6 stage meshes and the 4–5 breakup chunks.
 */
import * as THREE from 'three'
import { createRng, randRange, type Rng } from '@/core/rng'
import { ROCKET_STAGES } from '@/systems/factory'
import { PALETTE } from '@/world/palette'
import { ATLAS_UV, atlasAspect, type AtlasKey } from './atlas'
import { BLINK, GeoBuilder, glow, SURF, type V3 } from './geo'
import { ROCKET_LIMITS } from './config'

export const STAGE_COUNT = ROCKET_STAGES.length
const ST = { chassis: 0, tanks: 1, fins: 2, guidance: 3, nose: 4, attachments: 5 } as const
/** Breakup chunks. */
export const CHUNK = { bottom: 0, middle: 1, top: 2, tankA: 3, tankB: 4 } as const
const CHUNK_COUNT = 5

const DEG = Math.PI / 180

const HULL = ['#E6DDC8', '#D3CEC0', '#A95E39', '#E57D35', '#E9B63F', '#638C88', '#59666A', '#6E7350', '#C8453A', '#7FA3B6', '#8C7B6A']
const TAPE = '#A3A6A2'

export interface StageInfo {
  /** Local bbox (rocket frame). */
  minY: number
  maxY: number
  /** Max horizontal radius of the stage parts. */
  radius: number
  /** Where the crane hook attaches (rocket frame, on the axis). */
  hookY: number
}

export interface ChunkInfo {
  geo: THREE.BufferGeometry
  /** Pivot (centre of mass-ish) in the rocket frame. */
  pivot: V3
  /** Rough radius for ground contact. */
  radius: number
}

export interface RocketModel {
  seed: number
  stages: THREE.BufferGeometry[]
  stageInfo: StageInfo[]
  /** Duct-taped fin: rendered separately (part of the fins stage) so it can fall off. */
  tapedFin: THREE.BufferGeometry
  tapedFinPivot: V3
  /** Breakup chunks (the taped fin flies separately). */
  chunks: ChunkInfo[]
  /** Hook rigging per stage, in the rocket frame. */
  rigs: THREE.BufferGeometry[]
  /** Flame anchors (rocket frame) — main engine first. */
  nozzles: { pos: V3; radius: number }[]
  /** Steam vents for the countdown (rocket frame). */
  vents: V3[]
  /** Guidance ring lights (rocket frame) with their colours. */
  lights: { pos: V3; color: string }[]
  /** Where the stowaway clings (rocket frame) — on the ladder, facing outward (+Z). */
  stowawayAnchor: V3
  /** Top of the nose (+ weathervane). */
  height: number
  /** Max radius of the whole rocket. */
  maxRadius: number
  /** Chassis body radius used by side-mounted things. */
  bodyRadius: number
  triangles: number
  dispose(): void
}

interface Segment {
  y0: number
  y1: number
  r: number
  ox: number
  oz: number
  color: string
}

function pickColor(rng: Rng, avoid: string[] = []): string {
  for (let i = 0; i < 8; i++) {
    const c = HULL[Math.floor(rng() * HULL.length) % HULL.length]
    if (!avoid.includes(c)) return c
  }
  return HULL[0]
}

/** Dented, slightly jagged open cylinder (faceted), base at y = 0. */
function dentedCylinder(rng: Rng, r0: number, r1: number, h: number, segs: number, hsegs: number, dents: number, jag: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, h, segs, hsegs, true)
  g.translate(0, h / 2, 0)
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const ds: { th: number; y: number; s: number; d: number }[] = []
  for (let i = 0; i < dents; i++) ds.push({ th: rng() * Math.PI * 2, y: rng() * h, s: randRange(rng, 0.25, 0.55), d: randRange(rng, 0.05, 0.13) })
  const noise: number[] = []
  for (let i = 0; i < (segs + 1) * (hsegs + 1); i++) noise.push((rng() - 0.5) * 2 * jag)
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const rr = Math.hypot(v.x, v.z)
    if (rr < 1e-5) continue
    const th = Math.atan2(v.x, v.z)
    let disp = noise[i % noise.length]
    for (const dd of ds) {
      let dth = th - dd.th
      while (dth > Math.PI) dth -= Math.PI * 2
      while (dth < -Math.PI) dth += Math.PI * 2
      const ax = (dth * rr) / dd.s
      const ay = (v.y - dd.y) / dd.s
      disp -= dd.d * Math.exp(-(ax * ax + ay * ay))
    }
    // never dent the rims (keeps seams tidy)
    const rim = Math.min(v.y, h - v.y) < 0.02 ? 0 : 1
    const k = (rr + disp * rim) / rr
    pos.setXYZ(i, v.x * k, v.y, v.z * k)
  }
  const ng = g.toNonIndexed()
  g.dispose()
  ng.computeVertexNormals()
  return ng
}

function lathe(points: [number, number][], segs: number): THREE.BufferGeometry {
  return new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(r, y)),
    segs,
  )
}

/** Extruded fin in the (radial u, height v) plane, thickness t along local Z, root at u = 0. */
function finGeometry(shape: [number, number][], t: number): THREE.BufferGeometry {
  const s = new THREE.Shape()
  s.moveTo(shape[0][0], shape[0][1])
  for (let i = 1; i < shape.length; i++) s.lineTo(shape[i][0], shape[i][1])
  s.closePath()
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1, steps: 1 })
  g.translate(0, 0, -t / 2)
  return g
}

/** Merge a geometry with a reversed-winding copy (thin shells visible from both sides). */
function doubleSided(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const src = g.index ? g.toNonIndexed() : g
  const pos = src.getAttribute('position')
  const nor = src.getAttribute('normal')
  const uv = src.getAttribute('uv')
  const n = pos.count
  const P = new Float32Array(n * 6)
  const N = new Float32Array(n * 6)
  const U = new Float32Array(n * 4)
  P.set(pos.array as Float32Array, 0)
  N.set(nor.array as Float32Array, 0)
  if (uv) U.set(uv.array as Float32Array, 0)
  for (let t = 0; t < n; t += 3) {
    for (let k = 0; k < 3; k++) {
      const s = t + (k === 0 ? 0 : k === 1 ? 2 : 1)
      const d = n + t + k
      P[d * 3] = pos.getX(s) * 0.995
      P[d * 3 + 1] = pos.getY(s) * 0.995
      P[d * 3 + 2] = pos.getZ(s) * 0.995
      N[d * 3] = -nor.getX(s)
      N[d * 3 + 1] = -nor.getY(s)
      N[d * 3 + 2] = -nor.getZ(s)
      if (uv) {
        U[d * 2] = uv.getX(s)
        U[d * 2 + 1] = uv.getY(s)
      }
    }
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(P, 3))
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3))
  out.setAttribute('uv', new THREE.BufferAttribute(U, 2))
  if (src !== g) src.dispose()
  g.dispose()
  return out
}

/** Point at radius r, angle θ, height y. */
function polar(r: number, thetaDeg: number, y: number): V3 {
  const t = thetaDeg * DEG
  return [Math.sin(t) * r, y, Math.cos(t) * r]
}

export function buildRocket(seed: number): RocketModel {
  const rng = createRng(seed >>> 0 || 1)
  const b = new GeoBuilder()
  const tag = (stage: number, chunk: number) => {
    b.tag = stage * 16 + chunk
  }

  // ------------------------------------------------------------------ chassis
  tag(ST.chassis, CHUNK.bottom)
  const R0 = randRange(rng, 1.08, 1.22)
  const engineTwin = rng() < 0.5
  const mainBell = { x: engineTwin ? -0.16 : 0, z: engineTwin ? 0.1 : 0, r: engineTwin ? 0.7 : 0.8 }
  const nozzles: { pos: V3; radius: number }[] = []
  const bell = (x: number, z: number, r: number) => {
    const s = r / 0.8
    const outer = b.own(lathe([[0.85 * s, 0], [0.74 * s, 0.22], [0.58 * s, 0.5], [0.45 * s, 0.8], [0.38 * s, 1.0], [0.4 * s, 1.08]], 16))
    const inner = b.own(lathe([[0.36 * s, 0.98], [0.43 * s, 0.78], [0.56 * s, 0.48], [0.72 * s, 0.2], [0.82 * s, 0.02]], 16))
    const m = new THREE.Matrix4().makeTranslation(x, 0, z)
    b.geo(outer, '#2E3536', m, SURF.metal)
    b.geo(inner, '#151819', m, SURF.dark)
    b.torus(x, 0.02, z, 0.84 * s, 0.035, '#9C6A3C', { surf: SURF.metal })
    b.cyl(x, 1.0, z, 0.42 * s, 0.28, '#4A5355', { surf: SURF.metal, segs: 12 })
    nozzles.push({ pos: [x, 0.05, z], radius: 0.78 * s })
  }
  bell(mainBell.x, mainBell.z, mainBell.r)
  if (engineTwin) bell(0.7, -0.5, 0.28)
  // thrust skirt
  b.cyl(0, 1.0, 0, 0.82, 0.42, '#3B4446', { rTop: R0, segs: 16, open: true, surf: SURF.metal })
  b.torus(0, 1.42, 0, R0 + 0.02, 0.05, '#2F3536', { surf: SURF.metal })

  // stacked, mismatched, dented segments
  const chassisTop = randRange(rng, 8.3, 8.7)
  const nSeg = 3 + (rng() < 0.55 ? 1 : 0)
  const segs: Segment[] = []
  {
    let y = 1.42
    const weights = Array.from({ length: nSeg }, () => randRange(rng, 0.7, 1.3))
    const wsum = weights.reduce((a, c) => a + c, 0)
    let prevColor = ''
    for (let i = 0; i < nSeg; i++) {
      const h = ((chassisTop - 1.42) * weights[i]) / wsum
      const r = R0 * randRange(rng, 0.93, 1.06)
      const color = pickColor(rng, [prevColor])
      prevColor = color
      segs.push({ y0: y, y1: y + h, r, ox: randRange(rng, -0.05, 0.05), oz: randRange(rng, -0.05, 0.05), color })
      y += h
    }
  }
  const rMax = Math.max(...segs.map((s) => s.r))
  const radiusAt = (y: number) => {
    for (const s of segs) if (y >= s.y0 - 1e-6 && y <= s.y1 + 1e-6) return s.r
    return y < 1.42 ? R0 : segs[segs.length - 1].r
  }
  segs.forEach((s, i) => {
    tag(ST.chassis, i === 0 ? CHUNK.bottom : i === segs.length - 1 && segs.length > 2 ? CHUNK.top : CHUNK.middle)
    const h = s.y1 - s.y0
    const g = b.own(dentedCylinder(rng, s.r, s.r * randRange(rng, 0.97, 1.02), h, 18, 5, 2 + Math.floor(rng() * 3), 0.012))
    const tilt = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(randRange(rng, -0.018, 0.018), 0, randRange(rng, -0.018, 0.018)))
    const m = new THREE.Matrix4().makeTranslation(s.ox, s.y0, s.oz).multiply(tilt)
    b.geo(g, s.color, m, SURF.paint)
    // inner bulkhead cap so the open cylinder never shows its inside
    b.cyl(s.ox, s.y1 - 0.06, s.oz, s.r * 0.97, 0.05, '#3A4142', { segs: 14, surf: SURF.dark })
    // riveted seam ring at the joint
    b.torus(0, s.y0 + 0.02, 0, Math.max(s.r, i > 0 ? segs[i - 1].r : s.r) + 0.03, 0.045, '#4C5658', { surf: SURF.metal })
    const nRiv = 22
    for (let k = 0; k < nRiv; k++) {
      const th = (k / nRiv) * 360 + 4
      const p = polar(s.r + 0.03, th, s.y0 + 0.13)
      b.box(p[0], p[1], p[2], 0.05, 0.05, 0.05, '#6B7577', { surf: SURF.metal, rot: [0, th * DEG, 0] })
    }
    // mismatched bolted patches (never on the ladder / umbilical side)
    const nPatch = 1 + Math.floor(rng() * 2)
    for (let k = 0; k < nPatch; k++) {
      const th = randRange(rng, 70, 330)
      const y = randRange(rng, s.y0 + 0.4, s.y1 - 0.5)
      const w = randRange(rng, 0.45, 0.85)
      const ph = randRange(rng, 0.35, 0.7)
      const p = polar(s.r + 0.025, th, y)
      const rot: V3 = [0, th * DEG, randRange(rng, -0.25, 0.25)]
      b.box(p[0], p[1], p[2], w, ph, 0.04, pickColor(rng, [s.color]), { rot, surf: SURF.paint })
      for (const [bx, by] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const lp = new THREE.Vector3(bx * (w / 2 - 0.06), by * (ph / 2 - 0.06), 0.03).applyEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'YXZ'))
        b.box(p[0] + lp.x, p[1] + lp.y, p[2] + lp.z, 0.05, 0.05, 0.03, '#3D4547', { rot, surf: SURF.metal })
      }
    }
  })
  // duct-tape repairs (crooked bands)
  tag(ST.chassis, CHUNK.middle)
  const nTape = 1 + (rng() < 0.6 ? 1 : 0)
  for (let k = 0; k < nTape; k++) {
    const y = randRange(rng, 2.6, chassisTop - 1.2)
    b.cyl(0, y, 0, radiusAt(y) + 0.042, 0.2, TAPE, { segs: 18, open: true, rot: [randRange(rng, -0.06, 0.06), 0, randRange(rng, -0.06, 0.06)], surf: SURF.fabric })
  }
  // stencils wrapped on the hull (cylinder patches)
  const decal = (key: AtlasKey, thetaDeg: number, yc: number, height: number) => {
    const r = radiusAt(yc) + 0.022
    const w = height * atlasAspect(key)
    const arc = w / r
    const g = b.own(new THREE.CylinderGeometry(r, r, height, 8, 1, true, thetaDeg * DEG - arc / 2, arc))
    const segColor = segs.find((s) => yc >= s.y0 && yc <= s.y1)?.color ?? '#E6DDC8'
    b.geo(g, segColor, new THREE.Matrix4().makeTranslation(0, yc, 0), SURF.paint, ATLAS_UV[key])
  }
  tag(ST.chassis, CHUNK.middle)
  decal('logo', 320, randRange(rng, 4.3, 5.0), 0.7)
  decal(rng() < 0.5 ? 'noStep' : 'fragile', 90, randRange(rng, 4.6, 5.4), 0.3)
  tag(ST.chassis, CHUNK.top)
  decal('sideUp', 200, chassisTop - 1.25, 0.26)
  decal('warranty', 300, chassisTop - 0.5, 0.24)

  // ------------------------------------------------------------------ tanks
  const tankAngles = [145, 270]
  if (rng() < 0.45) tankAngles.push(235)
  tankAngles.forEach((th, i) => {
    tag(ST.tanks, i === 0 ? CHUNK.tankA : i === 1 ? CHUNK.tankB : CHUNK.middle)
    const kind = rng()
    const rt = kind < 0.3 ? randRange(rng, 0.5, 0.6) : randRange(rng, 0.4, 0.52)
    const len = Math.min(i === 2 ? 3.4 : 4.6, kind < 0.3 ? randRange(rng, 2.2, 2.8) : randRange(rng, 3.2, 4.6))
    const y0 = randRange(rng, 1.7, 2.6)
    const rc = rMax + rt + 0.06
    const [cx, , cz] = polar(rc, th, 0)
    const color = pickColor(rng)
    const tilt: V3 = [randRange(rng, -0.04, 0.04), 0, randRange(rng, -0.04, 0.04)]
    b.cyl(cx, y0, cz, rt, len, color, { segs: 14, rot: tilt, surf: SURF.gloss })
    b.sphere(cx, y0 + len, cz, rt, color, { scale: [1, 0.62, 1], w: 14, h: 6, surf: SURF.gloss })
    b.sphere(cx, y0, cz, rt, color, { scale: [1, 0.5, 1], w: 14, h: 6, surf: SURF.gloss })
    if (kind > 0.75) {
      // upside-down gas bottle: valve + handle at the BOTTOM
      b.cyl(cx, y0 - rt * 0.5 - 0.22, cz, 0.08, 0.22, '#B8A045', { surf: SURF.metal })
      b.torus(cx, y0 - rt * 0.5 - 0.26, cz, 0.13, 0.025, '#2F3536', { rot: [0, 0, 0], surf: SURF.metal })
    } else {
      b.cyl(cx, y0 + len + rt * 0.55, cz, 0.07, 0.2, '#B8A045', { surf: SURF.metal })
    }
    // bands + straps to the body
    for (const f of [0.22, 0.78]) {
      const y = y0 + len * f
      b.torus(cx, y, cz, rt + 0.03, 0.035, '#2F3536', { surf: SURF.metal })
      const a = polar(radiusAt(y) - 0.02, th, y)
      const c = polar(rc - rt * 0.6, th, y)
      b.beam(a, c, 0.1, 0.06, '#2F3536', SURF.metal)
    }
    // feed pipe with an elbow into the hull
    const top = y0 + len + rt * 0.6
    const p0 = polar(rc - rt * 0.3, th + 6, top - 0.1)
    const p1 = polar(rc - rt * 0.3, th + 6, top + 0.35)
    const p2 = polar(radiusAt(Math.min(top + 0.35, chassisTop - 0.2)) - 0.05, th + 10, Math.min(top + 0.35, chassisTop - 0.2))
    b.tube(p0, p1, 0.06, '#8C949A', 8, SURF.metal)
    b.tube(p1, p2, 0.06, '#8C949A', 8, SURF.metal)
    b.sphere(p1[0], p1[1], p1[2], 0.08, '#8C949A', { surf: SURF.metal })
  })

  // ------------------------------------------------------------------ fins
  const finRootR = radiusAt(1.6) - 0.04
  const finSpanMax = ROCKET_LIMITS.maxRadius - 0.05 - finRootR
  const finFrame = (th: number, roll = 0) => {
    const r = finRootR
    const m = new THREE.Matrix4().makeRotationY(th * DEG - Math.PI / 2)
    m.multiply(new THREE.Matrix4().makeTranslation(r, 0, 0))
    if (roll) m.multiply(new THREE.Matrix4().makeRotationX(roll))
    return m
  }
  tag(ST.fins, CHUNK.bottom)
  {
    // the comically large fin
    const span = Math.min(1.62, finSpanMax)
    const big = b.own(finGeometry([[0, 0.38], [span, 0.12], [span - 0.12, 0.55], [span * 0.55, 1.55], [span * 0.62, 1.82], [0, 3.75]], 0.11))
    b.geo(big, pickColor(rng), finFrame(90), SURF.paint)
    // a bolted repair plate on the big fin
    const m = finFrame(90).multiply(new THREE.Matrix4().makeTranslation(span * 0.35, 1.25, 0.075))
    b.geo(b.own(new THREE.BoxGeometry(0.45, 0.32, 0.03)), pickColor(rng), m, SURF.paint)
    // ordinary swept fin
    const swept = b.own(finGeometry([[0, 0.55], [0.95, 0.18], [1.08, 0.72], [0, 2.3]], 0.09))
    b.geo(swept, pickColor(rng), finFrame(210), SURF.paint)
  }
  // duct-taped fin (separate mesh so it can fall off), roots at θ = 330°
  const tapedShape: [number, number][] = rng() < 0.5 ? [[0, 0.5], [0.72, 0.38], [0.78, 1.4], [0, 1.65]] : [[0, 0.6], [0.9, 0.25], [0.95, 0.85], [0, 2.0]]
  const taped = new GeoBuilder()
  {
    const roll = randRange(rng, 0.12, 0.2) * (rng() < 0.5 ? -1 : 1)
    const fm = finFrame(330, roll)
    taped.geo(taped.own(finGeometry(tapedShape, 0.08)), pickColor(rng), fm, SURF.paint)
    for (const yy of [0.75, 1.2]) {
      const tm = fm.clone().multiply(new THREE.Matrix4().makeTranslation(0.08, yy, 0))
      taped.geo(taped.own(new THREE.BoxGeometry(0.34, 0.12, 0.13)), TAPE, tm, SURF.fabric)
    }
  }
  const tapedFinPivot = polar(finRootR + 0.4, 330, 1.1)

  // ------------------------------------------------------------------ guidance ring
  tag(ST.guidance, CHUNK.top)
  const rTop = segs[segs.length - 1].r
  const gy0 = chassisTop
  const gh = 0.55
  b.cyl(0, gy0, 0, rTop + 0.1, gh, '#2F3739', { segs: 20, surf: SURF.metal })
  b.cyl(0, gy0 + gh - 0.04, 0, rTop + 0.06, 0.06, '#202627', { segs: 20, surf: SURF.dark })
  b.torus(0, gy0 + 0.08, 0, rTop + 0.12, 0.03, PALETTE.hazard, { surf: SURF.paint })
  b.torus(0, gy0 + gh - 0.08, 0, rTop + 0.12, 0.03, PALETTE.hazard, { surf: SURF.paint })
  const lightColors = ['#5DFF7A', '#FFB23F', '#FF3B2F', '#6FC8FF']
  const lights: { pos: V3; color: string }[] = []
  ;[75, 165, 255, 345].forEach((th, i) => {
    const p = polar(rTop + 0.15, th, gy0 + gh / 2)
    b.sphere(p[0], p[1], p[2], 0.075, lightColors[i], { surf: glow(BLINK.guidance0 + i, 3), w: 8, h: 6 })
    lights.push({ pos: [p[0], p[1], p[2]], color: lightColors[i] })
  })
  // bent antenna (outward kinks) at θ = 112°
  {
    const th = 112
    const r0 = rTop + 0.14
    const a0 = polar(r0, th, gy0 + gh)
    const a1 = polar(r0 + 0.05, th, gy0 + gh + 0.85)
    const a2 = polar(r0 + 0.42, th - 8, gy0 + gh + 1.35)
    const a3 = polar(r0 + 0.3, th - 22, gy0 + gh + 1.8)
    b.tube(a0, a1, 0.03, '#B9C0C2', 6, SURF.metal)
    b.tube(a1, a2, 0.026, '#B9C0C2', 6, SURF.metal)
    b.tube(a2, a3, 0.022, '#B9C0C2', 6, SURF.metal)
    b.sphere(a3[0], a3[1], a3[2], 0.06, '#FF3B2F', { surf: glow(BLINK.aviation, 2.4), w: 8, h: 6 })
    b.box(a0[0], a0[1] + 0.05, a0[2], 0.14, 0.1, 0.14, '#2F3739', { surf: SURF.metal })
  }
  // GPS puck + horn antenna
  {
    const p = polar(rTop * 0.5, 230, gy0 + gh + 0.02)
    b.sphere(p[0], p[1], p[2], 0.2, '#D9D4C5', { scale: [1, 0.35, 1], surf: SURF.gloss })
  }

  // ------------------------------------------------------------------ nose
  tag(ST.nose, CHUNK.top)
  const ny0 = gy0 + gh
  const noseKind = rng()
  const noseTilt: V3 = [randRange(rng, 0.05, 0.11) * (rng() < 0.5 ? -1 : 1), 0, randRange(rng, -0.08, 0.08)]
  let noseH = 2.7
  const noseM = new THREE.Matrix4().makeTranslation(0, ny0, 0).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(noseTilt[0], 0, noseTilt[2])))
  b.matrix(noseM, () => {
    if (noseKind < 0.38) {
      // traffic cone (with its square rubber base, obviously)
      noseH = randRange(rng, 2.6, 3.0)
      const rb = rTop * 0.95
      b.box(0, 0.06, 0, rb * 2.05, 0.12, rb * 2.05, '#2A2C2C', { surf: SURF.rubber })
      b.cyl(0, 0.12, 0, rb, noseH, PALETTE.safety, { rTop: 0.07, segs: 16, surf: SURF.gloss })
      for (const [f0, f1] of [[0.36, 0.5], [0.62, 0.72]]) {
        const r0 = rb + (0.07 - rb) * f0 + 0.012
        const r1 = rb + (0.07 - rb) * f1 + 0.012
        b.cyl(0, 0.12 + noseH * f0, 0, r0, noseH * (f1 - f0), '#EEF0EC', { rTop: r1, segs: 16, open: true, surf: SURF.gloss })
      }
      noseH += 0.12
    } else if (noseKind < 0.72) {
      // crooked, dented ogive
      noseH = randRange(rng, 2.5, 3.1)
      const pts: [number, number][] = []
      for (let i = 0; i <= 9; i++) {
        const t = i / 9
        const rr = rTop * 0.97 * Math.pow(1 - Math.pow(t, 1.7), 0.62) * (1 + (rng() - 0.5) * 0.05)
        pts.push([Math.max(0.02, rr), t * noseH])
      }
      const g = b.own(lathe(pts, 16).toNonIndexed())
      g.computeVertexNormals()
      const col = pickColor(rng, ['#2F3739'])
      b.geo(g, col, undefined, SURF.gloss)
      b.box(...polar(rTop * 0.75, 200, noseH * 0.3), 0.5, 0.42, 0.04, pickColor(rng, [col]), { rot: [0.35, 200 * DEG, 0.1], surf: SURF.paint })
      b.torus(0, 0.06, 0, rTop * 0.97, 0.04, '#4C5658', { surf: SURF.metal })
    } else {
      // galvanized bucket with a hubcap
      noseH = randRange(rng, 1.9, 2.3)
      b.cyl(0, 0, 0, rTop * 0.97, noseH * 0.72, '#A7AEAE', { rTop: rTop * 0.5, segs: 16, surf: SURF.metal })
      for (const f of [0.15, 0.45]) b.torus(0, noseH * 0.72 * f, 0, rTop * (0.97 - 0.47 * f) + 0.02, 0.035, '#8B9393', { surf: SURF.metal })
      b.hemi(0, noseH * 0.72, 0, rTop * 0.5, '#C9CFCF', { scale: [1, 0.55, 1], surf: SURF.gloss })
      b.cyl(0, noseH * 0.72 + rTop * 0.27, 0, 0.14, 0.18, '#C9CFCF', { segs: 10, surf: SURF.gloss })
      noseH = noseH * 0.72 + rTop * 0.27 + 0.18
    }
  })
  const noseTip = new THREE.Vector3(0, noseH, 0).applyMatrix4(noseM)

  // ------------------------------------------------------------------ attachments
  tag(ST.attachments, CHUNK.middle)
  // ladder (always: the stowaway needs something to cling to)
  const ladderR = rMax + 0.32
  const ly0 = 1.25
  const ly1 = Math.min(chassisTop - 0.15, 8.3)
  for (const side of [-1, 1]) {
    const off = side * 0.22
    b.box(off, (ly0 + ly1) / 2, ladderR, 0.05, ly1 - ly0, 0.06, '#C9CDC9', { surf: SURF.metal })
  }
  for (let y = ly0 + 0.2; y < ly1 - 0.05; y += 0.32) b.box(0, y, ladderR, 0.44, 0.035, 0.035, '#C9CDC9', { surf: SURF.metal })
  for (let y = ly0 + 0.5; y < ly1; y += 1.7) {
    for (const side of [-1, 1]) b.beam([side * 0.22, y, radiusAt(y) - 0.02], [side * 0.22, y, ladderR], 0.05, 0.05, '#7D8588', SURF.metal)
  }
  const stowawayAnchor: V3 = [0, 4.35, ladderR + 0.36]

  // satellite dish (θ = 60°)
  if (rng() < 0.8) {
    const y = randRange(rng, 6.6, 7.4)
    const a = polar(radiusAt(y) + 0.25, 60, y)
    const c = polar(radiusAt(y) + 0.75, 60, y + 0.15)
    b.beam(polar(radiusAt(y) - 0.02, 60, y), c, 0.07, 0.07, '#5A6366', SURF.metal)
    b.box(a[0], a[1], a[2], 0.18, 0.22, 0.18, '#5A6366', { rot: [0, 60 * DEG, 0], surf: SURF.metal })
    const dish = b.own(doubleSided(new THREE.SphereGeometry(0.62, 14, 5, 0, Math.PI * 2, 0, 0.95)))
    // cap opens along +Y; aim it outward and up
    const dm = new THREE.Matrix4()
      .makeTranslation(c[0], c[1] + 0.05, c[2])
      .multiply(new THREE.Matrix4().makeRotationY(60 * DEG))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2 + 0.5))
      .multiply(new THREE.Matrix4().makeTranslation(0, -0.6, 0))
    b.geo(dish, '#E2E0D8', dm, SURF.gloss)
    const feedBase = new THREE.Vector3(0, 0.0, 0).applyMatrix4(dm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.6, 0)))
    const feedTip = new THREE.Vector3(0, 0.55, 0).applyMatrix4(dm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.6, 0)))
    b.tube([feedBase.x, feedBase.y, feedBase.z], [feedTip.x, feedTip.y, feedTip.z], 0.025, '#8C949A', 6, SURF.metal)
    b.sphere(feedTip.x, feedTip.y, feedTip.z, 0.06, '#2F3739', { surf: SURF.metal })
  }
  // mini booster (θ = 180°): candy-striped, strapped on, has its own flame
  if (rng() < 0.75) {
    const r = 0.24
    const rc = rMax + r + 0.34
    const [cx, , cz] = polar(rc, 180, 0)
    const y0 = randRange(rng, 3.5, 4.1)
    const h = 1.7
    const n = 5
    for (let i = 0; i < n; i++) b.cyl(cx, y0 + (h / n) * i, cz, r, h / n, i % 2 ? '#EEF0EC' : PALETTE.signalRed, { segs: 12, surf: SURF.gloss })
    b.cyl(cx, y0 + h, cz, r, 0.42, '#EEF0EC', { rTop: 0.03, segs: 12, surf: SURF.gloss })
    b.cyl(cx, y0 - 0.22, cz, 0.16, 0.24, '#2E3536', { rTop: 0.1, segs: 10, surf: SURF.metal })
    for (const f of [0.25, 0.75]) {
      const y = y0 + h * f
      b.torus(cx, y, cz, r + 0.025, 0.025, '#2F3536', { surf: SURF.metal })
      b.beam(polar(radiusAt(y) - 0.02, 180, y), polar(rc - r, 180, y), 0.08, 0.05, '#2F3536', SURF.metal)
    }
    nozzles.push({ pos: [cx, y0 - 0.22, cz], radius: 0.16 })
  }
  // rural mailbox (θ = 300°) with the flag up
  if (rng() < 0.8) {
    const y = randRange(rng, 5.8, 6.5)
    const rIn = radiusAt(y)
    b.beam(polar(rIn - 0.02, 300, y - 0.12), polar(rIn + 0.4, 300, y - 0.12), 0.08, 0.08, '#6B5A45', SURF.paint)
    b.frame(polar(rIn + 0.62, 300, y), [0, 300 * DEG, 0], () => {
      b.box(0, 0, 0, 0.3, 0.2, 0.56, '#6F7A80', { surf: SURF.gloss })
      b.cyl(0, 0.1, -0.28, 0.15, 0.56, '#6F7A80', { rot: [Math.PI / 2, 0, 0], segs: 12, surf: SURF.gloss })
      b.box(0.17, 0.16, 0.08, 0.02, 0.32, 0.03, '#C8302A', { surf: SURF.paint })
      b.box(0.17, 0.3, 0.13, 0.02, 0.12, 0.12, '#C8302A', { surf: SURF.paint })
    })
  }
  // weathervane on the crooked nose tip (a rooster, naturally)
  let top = noseTip.y
  if (rng() < 0.85) {
    const tx = noseTip.x
    const ty = noseTip.y
    const tz = noseTip.z
    b.tube([tx, ty - 0.1, tz], [tx, ty + 1.0, tz], 0.025, '#2A2D2D', 6, SURF.metal)
    b.beam([tx - 0.35, ty + 0.45, tz], [tx + 0.35, ty + 0.45, tz], 0.03, 0.03, '#2A2D2D', SURF.metal)
    b.beam([tx, ty + 0.45, tz - 0.35], [tx, ty + 0.45, tz + 0.35], 0.03, 0.03, '#2A2D2D', SURF.metal)
    const rooster = new THREE.Shape()
    const pts: [number, number][] = [
      [-0.32, 0.0], [-0.12, -0.06], [0.1, -0.04], [0.2, 0.06], [0.22, 0.2], [0.3, 0.22], [0.26, 0.28], [0.2, 0.3], [0.17, 0.38], [0.11, 0.33], [0.1, 0.22],
      [0.0, 0.12], [-0.18, 0.14], [-0.3, 0.34], [-0.38, 0.3], [-0.4, 0.12],
    ]
    rooster.moveTo(pts[0][0], pts[0][1])
    for (const p of pts.slice(1)) rooster.lineTo(p[0], p[1])
    rooster.closePath()
    const rg = b.own(new THREE.ExtrudeGeometry(rooster, { depth: 0.03, bevelEnabled: false }))
    rg.translate(0, 0, -0.015)
    b.geo(rg, '#2A2D2D', new THREE.Matrix4().makeTranslation(tx, ty + 0.72, tz).multiply(new THREE.Matrix4().makeRotationY(0.6)), SURF.metal)
    top = ty + 1.12
  }
  // lucky horseshoe nailed to the hull (θ = 165°)
  if (rng() < 0.5) {
    const y = randRange(rng, 3.2, 5.0)
    const p = polar(radiusAt(y) + 0.04, 165, y)
    b.torus(p[0], p[1], p[2], 0.16, 0.03, '#7A7F80', { rot: [0, 165 * DEG, Math.PI], arc: Math.PI * 1.35, surf: SURF.metal })
  }

  // ------------------------------------------------------------------ build
  const stages: THREE.BufferGeometry[] = []
  const stageInfo: StageInfo[] = []
  for (let k = 0; k < STAGE_COUNT; k++) {
    const g = b.build((t) => t >> 4 === k) ?? new THREE.BufferGeometry()
    stages.push(g)
    const bb = g.boundingBox ?? new THREE.Box3(new THREE.Vector3(), new THREE.Vector3())
    let radius = 0
    const pos = g.getAttribute('position')
    if (pos) for (let i = 0; i < pos.count; i++) radius = Math.max(radius, Math.hypot(pos.getX(i), pos.getZ(i)))
    stageInfo.push({ minY: bb.min.y, maxY: bb.max.y, radius, hookY: bb.max.y + 0.35 })
  }
  // the taped fin belongs to the fins stage
  const tapedFin = taped.build() ?? new THREE.BufferGeometry()
  {
    const fi = stageInfo[ST.fins]
    const bb = tapedFin.boundingBox
    if (bb) {
      fi.minY = Math.min(fi.minY, bb.min.y)
      fi.maxY = Math.max(fi.maxY, bb.max.y)
      fi.hookY = fi.maxY + 0.35
    }
  }

  const chunks: ChunkInfo[] = []
  for (let c = 0; c < CHUNK_COUNT; c++) {
    const g = b.build((t) => (t & 15) === c)
    if (!g) continue
    const bb = g.boundingBox!
    const centre = bb.getCenter(new THREE.Vector3())
    const size = bb.getSize(new THREE.Vector3())
    chunks.push({ geo: g, pivot: [centre.x, centre.y, centre.z], radius: Math.max(0.35, Math.min(size.x, size.z) * 0.5) })
  }

  // hook rigging per stage (rocket frame): hook block + spreader + slings to the stage top
  const rigs: THREE.BufferGeometry[] = stageInfo.map((si, k) => {
    const rb = new GeoBuilder()
    const hy = si.hookY
    rb.box(0, hy + 0.3, 0, 0.36, 0.5, 0.26, PALETTE.hazard, { surf: SURF.paint })
    rb.torus(0, hy - 0.02, 0, 0.13, 0.035, '#3A4142', { rot: [0, 0, 0], arc: Math.PI * 1.5, surf: SURF.metal })
    const lugY = k === ST.attachments ? si.maxY + 0.1 : Math.max(si.minY + 0.2, si.maxY - (k === ST.guidance ? 1.9 : 0.15))
    const lugR = Math.min(si.radius * 0.7, 1.25)
    if (k === ST.attachments) {
      // ring frame above the bundle with drop cables to the items
      rb.torus(0, lugY + 0.25, 0, 1.55, 0.05, PALETTE.hazard, { surf: SURF.paint })
      for (const th of [0, 60, 180, 300]) {
        const p = polar(1.55, th, lugY + 0.25)
        rb.tube([0, hy, 0], p, 0.018, '#2A2D2D', 4, SURF.metal)
        rb.tube(p, polar(1.5, th, 6.2), 0.014, '#2A2D2D', 4, SURF.metal)
      }
    } else {
      rb.beam([-lugR - 0.15, lugY + 0.55, 0], [lugR + 0.15, lugY + 0.55, 0], 0.12, 0.16, PALETTE.hazard, SURF.paint)
      for (const s of [-1, 1]) {
        rb.tube([0, hy, 0], [s * (lugR + 0.1), lugY + 0.6, 0], 0.02, '#2A2D2D', 4, SURF.metal)
        rb.tube([s * lugR, lugY + 0.5, 0], [s * lugR, lugY, 0], 0.02, '#2A2D2D', 4, SURF.metal)
      }
    }
    const g = rb.build() ?? new THREE.BufferGeometry()
    rb.dispose()
    return g
  })

  const vents: V3[] = [polar(rMax + 0.05, 40, 7.2), polar(rMax + 0.05, 230, 3.6), polar(rTop + 0.15, 300, gy0 + 0.3)]
  let maxRadius = 0
  for (const si of stageInfo) maxRadius = Math.max(maxRadius, si.radius)
  const triangleCount = stages.reduce((s, g) => s + (g.index ? g.index.count / 3 : 0), 0) + (tapedFin.index ? tapedFin.index.count / 3 : 0)

  b.dispose()
  taped.dispose()

  return {
    seed,
    stages,
    stageInfo,
    tapedFin,
    tapedFinPivot,
    chunks,
    rigs,
    nozzles,
    vents,
    lights,
    stowawayAnchor,
    height: top,
    maxRadius,
    bodyRadius: rMax,
    triangles: triangleCount,
    dispose() {
      for (const g of stages) g.dispose()
      for (const c of chunks) c.geo.dispose()
      for (const g of rigs) g.dispose()
      tapedFin.dispose()
    },
  }
}
