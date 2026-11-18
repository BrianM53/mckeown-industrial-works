/**
 * Geometry batcher for the production spine. Primitives are added in world
 * (or a pushed local) frame with a Style; `build()` merges everything into ONE
 * indexed BufferGeometry with:
 *   position, normal, uv (box-projected world UVs, or atlas/kept UVs),
 *   color (linear, may be HDR), aRM (roughness, metalness), aEmis (emissive
 *   strength), aChan (animated glow channel), optional skinIndex/skinWeight
 *   (rigid skinning to a Rig bone) and aBelt (belt id for UV scrolling).
 * One batch = one draw call. Primitive geometries are cached and reused.
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

export type V3 = readonly [number, number, number]
export type UvRect = readonly [number, number, number, number]

export interface Style {
  color: THREE.ColorRepresentation
  rough?: number
  metal?: number
  /** Emissive strength (emissive = diffuse color × emis × channel multiplier). */
  emis?: number
  /** Glow channel index (see render/materials CH). */
  chan?: number
}

interface Part {
  geo: THREE.BufferGeometry
  matrix: THREE.Matrix4
  color: THREE.Color
  rough: number
  metal: number
  emis: number
  chan: number
  bone: number
  belt: number
  uv: 'world' | 'keep' | UvRect
  tile: number
}

const geoCache = new Map<string, THREE.BufferGeometry>()
function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key) as T | undefined
  if (!g) {
    g = make()
    geoCache.set(key, g)
  }
  return g
}

const r3 = (v: number) => Math.round(v * 1000) / 1000

export const unitBox = (): THREE.BufferGeometry => cached('box', () => new THREE.BoxGeometry(1, 1, 1))
export const unitCyl = (segs: number, ratio = 1, open = false): THREE.BufferGeometry =>
  cached(`cyl:${segs}:${r3(ratio)}:${open}`, () => new THREE.CylinderGeometry(ratio, 1, 1, segs, 1, open))
export const unitSphere = (w: number, h: number): THREE.BufferGeometry => cached(`sph:${w}:${h}`, () => new THREE.SphereGeometry(1, w, h))
const unitPlane = (): THREE.BufferGeometry => cached('plane', () => new THREE.PlaneGeometry(1, 1))

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _qa = new THREE.Quaternion()
const _X = new THREE.Vector3(1, 0, 0)
const _Y = new THREE.Vector3(0, 1, 0)
const _Z = new THREE.Vector3(0, 0, 1)
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const _dir = new THREE.Vector3()

export class GeoBatch {
  private parts: Part[] = []
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()]
  private curBone = 0
  private curBelt = -1

  constructor(
    readonly opts: { skinned?: boolean; belt?: boolean; tile?: number } = {},
  ) {}

  get size(): number {
    return this.parts.length
  }

  /** Approximate triangle count of everything added so far. */
  get triangles(): number {
    let n = 0
    for (const p of this.parts) n += (p.geo.index ? p.geo.index.count : p.geo.getAttribute('position').count) / 3
    return n
  }

  // ---- frames ---------------------------------------------------------------

  private get base(): THREE.Matrix4 {
    return this.stack[this.stack.length - 1]
  }

  /** Run `fn` in a local frame translated to (x, y, z) and rotated by yaw (and optional pitch/roll). */
  frame(x: number, y: number, z: number, yaw: number, fn: () => void, pitch = 0, roll = 0): void {
    _e.set(pitch, yaw, roll, 'YXZ')
    _q.setFromEuler(_e)
    const m = new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(1, 1, 1))
    this.stack.push(this.base.clone().multiply(m))
    try {
      fn()
    } finally {
      this.stack.pop()
    }
  }

  /** Transform a point from the current (pushed) frame to world space. */
  toWorld(p: V3): [number, number, number] {
    _p.set(p[0], p[1], p[2]).applyMatrix4(this.base)
    return [_p.x, _p.y, _p.z]
  }

  /** Transform a direction from the current frame to world space (normalized). */
  dirToWorld(d: V3): [number, number, number] {
    _p.set(d[0], d[1], d[2]).transformDirection(this.base)
    return [_p.x, _p.y, _p.z]
  }

  /** Subsequent parts inside `fn` are skinned to `bone`. */
  bone(bone: number, fn: () => void): void {
    const prev = this.curBone
    this.curBone = bone
    try {
      fn()
    } finally {
      this.curBone = prev
    }
  }

  /** Subsequent parts inside `fn` belong to belt `id` (scrolling UVs). */
  belt(id: number, fn: () => void): void {
    const prev = this.curBelt
    this.curBelt = id
    try {
      fn()
    } finally {
      this.curBelt = prev
    }
  }

  // ---- primitives -----------------------------------------------------------

  add(geo: THREE.BufferGeometry, local: THREE.Matrix4, style: Style, uv: Part['uv'] = 'world', tile?: number): void {
    const color = new THREE.Color(style.color)
    this.parts.push({
      geo,
      matrix: this.base.clone().multiply(local),
      color,
      rough: style.rough ?? 0.62,
      metal: style.metal ?? 0.3,
      emis: style.emis ?? 0,
      chan: style.chan ?? 0,
      bone: this.curBone,
      belt: this.curBelt,
      uv,
      tile: tile ?? this.opts.tile ?? 1.6,
    })
  }

  private compose(c: V3, rot: V3 | undefined, scale: V3): THREE.Matrix4 {
    _e.set(rot?.[0] ?? 0, rot?.[1] ?? 0, rot?.[2] ?? 0, 'YXZ')
    _q.setFromEuler(_e)
    return _m.compose(_p.set(c[0], c[1], c[2]), _q, _s.set(scale[0], scale[1], scale[2]))
  }

  /** Box by center and full size; rot = [pitch, yaw, roll]. */
  box(c: V3, size: V3, style: Style, rot?: V3): void {
    if (size[0] <= 0 || size[1] <= 0 || size[2] <= 0) return
    this.add(unitBox(), this.compose(c, rot, size), style)
  }

  /** Box from min/max corners (axis aligned in the current frame). */
  boxMM(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, style: Style): void {
    this.box([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], [Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)], style)
  }

  /** Chamfered/rounded box (chunky sheet-metal look). */
  rbox(c: V3, size: V3, style: Style, radius = 0.06, rot?: V3, segs = 1): void {
    const [w, h, d] = size
    if (w <= 0 || h <= 0 || d <= 0) return
    const rr = Math.min(radius, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)
    if (rr <= 0.005) return this.box(c, size, style, rot)
    const geo = cached(`rbox:${r3(w)}:${r3(h)}:${r3(d)}:${r3(rr)}:${segs}`, () => new RoundedBoxGeometry(w, h, d, segs, rr))
    this.add(geo, this.compose(c, rot, [1, 1, 1]), style)
  }

  /** Cylinder between two points (rTop = radius at b). */
  cyl(a: V3, b: V3, r: number, style: Style, segs = 12, rTop?: number, open = false): void {
    _dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    const len = _dir.length()
    if (len < 1e-5 || r <= 0) return
    _dir.divideScalar(len)
    _q.setFromUnitVectors(_up, _dir)
    const ratio = rTop === undefined ? 1 : rTop / r
    _m.compose(_p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, _s.set(r, len, r))
    this.add(unitCyl(segs, ratio, open), _m, style)
  }

  /** Vertical cylinder from base y0. */
  cylY(x: number, y0: number, z: number, r: number, h: number, style: Style, segs = 14, rTop?: number): void {
    this.cyl([x, y0, z], [x, y0 + h, z], r, style, segs, rTop)
  }

  /** Cylinder along an axis centered at c. */
  cylAxis(c: V3, axis: 'x' | 'y' | 'z', r: number, len: number, style: Style, segs = 14): void {
    const h = len / 2
    const a: V3 = axis === 'x' ? [c[0] - h, c[1], c[2]] : axis === 'y' ? [c[0], c[1] - h, c[2]] : [c[0], c[1], c[2] - h]
    const b: V3 = axis === 'x' ? [c[0] + h, c[1], c[2]] : axis === 'y' ? [c[0], c[1] + h, c[2]] : [c[0], c[1], c[2] + h]
    this.cyl(a, b, r, style, segs)
  }

  sphere(c: V3, r: number, style: Style, w = 12, h = 8, scale: V3 = [1, 1, 1]): void {
    this.add(unitSphere(w, h), this.compose(c, undefined, [r * scale[0], r * scale[1], r * scale[2]]), style)
  }

  /** Torus whose axis is `axis` (ring lies in the perpendicular plane). arc < 2π for partial rings starting at `startAngle`. */
  torus(c: V3, R: number, tube: number, style: Style, axis: 'x' | 'y' | 'z' = 'z', arc = Math.PI * 2, rs = 8, ts = 24, startAngle = 0): void {
    const geo = cached(`tor:${r3(R)}:${r3(tube)}:${rs}:${ts}:${r3(arc)}`, () => new THREE.TorusGeometry(R, tube, rs, ts, arc))
    // TorusGeometry lies in the XY plane (axis +Z): spin within the plane, then turn the axis.
    if (axis === 'x') _qa.setFromAxisAngle(_Y, Math.PI / 2)
    else if (axis === 'y') _qa.setFromAxisAngle(_X, -Math.PI / 2)
    else _qa.identity()
    _q.setFromAxisAngle(_Z, startAngle)
    _qa.multiply(_q)
    _m.compose(_p.set(c[0], c[1], c[2]), _qa, _s.set(1, 1, 1))
    this.add(geo, _m, style)
  }

  /** Surface of revolution around +Y from [radius, y] points (bottom → top). */
  lathe(points: ReadonlyArray<readonly [number, number]>, c: V3, style: Style, segs = 16, rot?: V3, scale: V3 = [1, 1, 1]): void {
    const key = `lathe:${segs}:${points.map((p) => `${r3(p[0])},${r3(p[1])}`).join(';')}`
    const geo = cached(key, () => new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y)), segs))
    this.add(geo, this.compose(c, rot, scale), style)
  }

  /** Extruded convex polygon ([u, v] in the local XY plane) with depth along local Z (centered). */
  prism(poly: ReadonlyArray<readonly [number, number]>, depth: number, c: V3, style: Style, rot?: V3): void {
    const key = `prism:${r3(depth)}:${poly.map((p) => `${r3(p[0])},${r3(p[1])}`).join(';')}`
    const geo = cached(key, () => {
      const shape = new THREE.Shape(poly.map(([u, v]) => new THREE.Vector2(u, v)))
      const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 })
      g.translate(0, 0, -depth / 2)
      return g
    })
    this.add(geo, this.compose(c, rot, [1, 1, 1]), style)
  }

  /** Flat quad: front faces forward(yaw) (-Z rotated by yaw), tilted by pitch. UVs map to `uvRect` (atlas) or keep 0..1. */
  quad(c: V3, w: number, h: number, yaw: number, style: Style, uvRect?: UvRect, pitch = 0): void {
    _e.set(pitch, yaw + Math.PI, 0, 'YXZ')
    _q.setFromEuler(_e)
    _m.compose(_p.set(c[0], c[1], c[2]), _q, _s.set(w, h, 1))
    this.add(unitPlane(), _m, style, uvRect ?? 'keep')
  }

  /** Arbitrary geometry with a full local transform. */
  geo(geometry: THREE.BufferGeometry, c: V3, style: Style, rot?: V3, scale: V3 = [1, 1, 1], uv: Part['uv'] = 'world'): void {
    this.add(geometry, this.compose(c, rot, scale), style, uv)
  }

  // ---- merge ----------------------------------------------------------------

  build(): THREE.BufferGeometry | null {
    if (!this.parts.length) return null
    let nv = 0
    let ni = 0
    for (const p of this.parts) {
      const pos = p.geo.getAttribute('position')
      nv += pos.count
      ni += p.geo.index ? p.geo.index.count : pos.count
    }
    const skinned = !!this.opts.skinned
    const beltAttr = !!this.opts.belt
    const positions = new Float32Array(nv * 3)
    const normals = new Float32Array(nv * 3)
    const uvs = new Float32Array(nv * 2)
    const colors = new Float32Array(nv * 3)
    const rm = new Float32Array(nv * 2)
    const emis = new Float32Array(nv)
    const chan = new Float32Array(nv)
    const skinIndex = skinned ? new Uint16Array(nv * 4) : null
    const skinWeight = skinned ? new Float32Array(nv * 4) : null
    const belts = beltAttr ? new Float32Array(nv) : null
    const indices = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni)
    const nm = new THREE.Matrix3()
    const v = new THREE.Vector3()
    const n = new THREE.Vector3()
    let vo = 0
    let io = 0
    for (const p of this.parts) {
      const pos = p.geo.getAttribute('position')
      const nor = p.geo.getAttribute('normal')
      const uv = p.geo.getAttribute('uv')
      nm.getNormalMatrix(p.matrix)
      const flip = p.matrix.determinant() < 0
      const tile = p.tile
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(p.matrix)
        if (nor) n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize()
        else n.set(0, 1, 0)
        const k = vo + i
        positions[k * 3] = v.x
        positions[k * 3 + 1] = v.y
        positions[k * 3 + 2] = v.z
        normals[k * 3] = n.x
        normals[k * 3 + 1] = n.y
        normals[k * 3 + 2] = n.z
        colors[k * 3] = p.color.r
        colors[k * 3 + 1] = p.color.g
        colors[k * 3 + 2] = p.color.b
        rm[k * 2] = p.rough
        rm[k * 2 + 1] = p.metal
        emis[k] = p.emis
        chan[k] = p.chan
        if (skinIndex && skinWeight) {
          skinIndex[k * 4] = p.bone
          skinWeight[k * 4] = 1
        }
        if (belts) belts[k] = p.belt
        if (p.uv === 'world') {
          const ax = Math.abs(n.x)
          const ay = Math.abs(n.y)
          const az = Math.abs(n.z)
          if (ay >= ax && ay >= az) {
            uvs[k * 2] = v.x / tile
            uvs[k * 2 + 1] = v.z / tile
          } else if (ax >= az) {
            uvs[k * 2] = v.z / tile
            uvs[k * 2 + 1] = v.y / tile
          } else {
            uvs[k * 2] = v.x / tile
            uvs[k * 2 + 1] = v.y / tile
          }
        } else if (uv) {
          let u = uv.getX(i)
          let w = uv.getY(i)
          if (p.uv !== 'keep') {
            const r = p.uv
            u = r[0] + u * (r[2] - r[0])
            w = r[1] + w * (r[3] - r[1])
          }
          uvs[k * 2] = u
          uvs[k * 2 + 1] = w
        }
      }
      if (p.geo.index) {
        const idx = p.geo.index
        if (flip) {
          for (let t = 0; t < idx.count; t += 3) {
            indices[io + t] = idx.getX(t) + vo
            indices[io + t + 1] = idx.getX(t + 2) + vo
            indices[io + t + 2] = idx.getX(t + 1) + vo
          }
        } else for (let t = 0; t < idx.count; t++) indices[io + t] = idx.getX(t) + vo
        io += idx.count
      } else {
        for (let t = 0; t < pos.count; t++) indices[io + t] = vo + t
        io += pos.count
      }
      vo += pos.count
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    g.setAttribute('aRM', new THREE.BufferAttribute(rm, 2))
    g.setAttribute('aEmis', new THREE.BufferAttribute(emis, 1))
    g.setAttribute('aChan', new THREE.BufferAttribute(chan, 1))
    if (skinIndex && skinWeight) {
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4))
      g.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4))
    }
    if (belts) g.setAttribute('aBelt', new THREE.BufferAttribute(belts, 1))
    g.setIndex(new THREE.BufferAttribute(indices, 1))
    g.computeBoundingBox()
    g.computeBoundingSphere()
    return g
  }
}

/** Build a small standalone geometry (items, lamps) from a callback. */
export function buildGeometry(fn: (b: GeoBatch) => void, tile = 0.8): THREE.BufferGeometry {
  const b = new GeoBatch({ tile })
  fn(b)
  return b.build() ?? new THREE.BufferGeometry()
}

