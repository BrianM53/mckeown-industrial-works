import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

/**
 * Static geometry builder: parts are authored in a local frame with a material
 * KEY and a vertex color; build() merges all parts that share a key into ONE
 * indexed geometry (position / normal / uv / color). A whole machine is then a
 * handful of draw calls.
 *
 * UV modes: 'box' (local box projection scaled by `tile` meters — keeps the
 * shared paint-wear texture at a constant texel density), 'keep' (source UVs,
 * optionally remapped into an atlas rect).
 */
export type V3 = [number, number, number]
export type UvMode = 'box' | 'keep'

interface Part {
  geo: THREE.BufferGeometry
  matrix: THREE.Matrix4
  color: THREE.Color
  uv: UvMode
  rect: [number, number, number, number] | null
}

const geoCache = new Map<string, THREE.BufferGeometry>()
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key)
  if (!g) {
    g = make()
    geoCache.set(key, g)
  }
  return g
}

const unitBox = () => cached('box', () => new THREE.BoxGeometry(1, 1, 1))
const unitPlane = () => cached('plane', () => new THREE.PlaneGeometry(1, 1))
export const unitCyl = (segs: number, ratio = 1, open = false) =>
  cached(`cyl:${segs}:${ratio.toFixed(3)}:${open}`, () => new THREE.CylinderGeometry(ratio, 1, 1, segs, 1, open))
const unitSphere = (w: number, h: number) => cached(`sph:${w}:${h}`, () => new THREE.SphereGeometry(1, w, h))
const torusGeo = (R: number, t: number, rs: number, ts: number, arc: number) =>
  cached(`tor:${R}:${t}:${rs}:${ts}:${arc.toFixed(3)}`, () => new THREE.TorusGeometry(R, t, rs, ts, arc))
const rboxGeo = (w: number, h: number, d: number, r: number) =>
  cached(`rbox:${w.toFixed(3)}:${h.toFixed(3)}:${d.toFixed(3)}:${r.toFixed(3)}`, () => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)))

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _s = new THREE.Vector3()
const _p = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const _dir = new THREE.Vector3()

export function col(c: THREE.ColorRepresentation, scale = 1): THREE.Color {
  const out = new THREE.Color(c)
  if (scale !== 1) out.multiplyScalar(scale)
  return out
}

export class Builder {
  private parts = new Map<string, Part[]>()
  private base = new THREE.Matrix4()
  private stack: THREE.Matrix4[] = []

  constructor(private tile = 1.4) {}

  /** Push a transform (applied to every part added until pop()). */
  push(pos: V3, rotY = 0, rotX = 0, rotZ = 0, scale = 1): void {
    this.stack.push(this.base.clone())
    _e.set(rotX, rotY, rotZ, 'YXZ')
    _q.setFromEuler(_e)
    _m.compose(_p.set(pos[0], pos[1], pos[2]), _q, _s.setScalar(scale))
    this.base.multiply(_m)
  }

  pop(): void {
    const m = this.stack.pop()
    if (m) this.base.copy(m)
  }

  add(key: string, geo: THREE.BufferGeometry, matrix: THREE.Matrix4, color: THREE.ColorRepresentation, uv: UvMode = 'box', rect: Part['rect'] = null): void {
    let list = this.parts.get(key)
    if (!list) {
      list = []
      this.parts.set(key, list)
    }
    const m = this.base.clone().multiply(matrix)
    list.push({ geo, matrix: m, color: color instanceof THREE.Color ? color.clone() : new THREE.Color(color), uv, rect })
  }

  /** Box by center & full size; rotation order YXZ. */
  box(key: string, c: V3, size: V3, color: THREE.ColorRepresentation, rot: V3 = [0, 0, 0]): void {
    if (size[0] <= 0 || size[1] <= 0 || size[2] <= 0) return
    _e.set(rot[0], rot[1], rot[2], 'YXZ')
    _q.setFromEuler(_e)
    _m.compose(_p.set(c[0], c[1], c[2]), _q, _s.set(size[0], size[1], size[2]))
    this.add(key, unitBox(), _m, color)
  }

  /** Box spanning min/max corners (axis aligned). */
  boxMM(key: string, min: V3, max: V3, color: THREE.ColorRepresentation): void {
    this.box(key, [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2], [Math.abs(max[0] - min[0]), Math.abs(max[1] - min[1]), Math.abs(max[2] - min[2])], color)
  }

  /** Rounded box (bevelled sheet metal look). */
  rbox(key: string, c: V3, size: V3, r: number, color: THREE.ColorRepresentation, rot: V3 = [0, 0, 0]): void {
    _e.set(rot[0], rot[1], rot[2], 'YXZ')
    _q.setFromEuler(_e)
    _m.compose(_p.set(c[0], c[1], c[2]), _q, _s.set(1, 1, 1))
    this.add(key, rboxGeo(size[0], size[1], size[2], r), _m, color)
  }

  /** Vertical cylinder from base y0, height h (optional top radius). */
  cyl(key: string, x: number, y0: number, z: number, r: number, h: number, color: THREE.ColorRepresentation, segs = 14, rTop?: number, open = false): void {
    if (r <= 0 || h <= 0) return
    const ratio = rTop === undefined ? 1 : rTop / r
    _m.compose(_p.set(x, y0 + h / 2, z), _q.identity(), _s.set(r, h, r))
    this.add(key, unitCyl(segs, ratio, open), _m, color)
  }

  /** Cylinder between two points (pipes, struts, rods). */
  tube(key: string, a: V3, b: V3, r: number, color: THREE.ColorRepresentation, segs = 10, rB?: number, open = false): void {
    _dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    const len = _dir.length()
    if (len < 1e-5 || r <= 0) return
    _dir.divideScalar(len)
    _q.setFromUnitVectors(_up, _dir)
    // unit cylinder: bottom radius 1 at -0.5, top radius `ratio` at +0.5 (top = b)
    const ratio = rB === undefined ? 1 : rB / r
    _m.compose(_p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, _s.set(r, len, r))
    this.add(key, unitCyl(segs, ratio, open), _m, color)
  }

  /** Cylinder along a local axis, centered at c. */
  cylAxis(key: string, c: V3, axis: 'x' | 'y' | 'z', r: number, len: number, color: THREE.ColorRepresentation, segs = 14, rEnd?: number): void {
    const h = len / 2
    const a: V3 = axis === 'x' ? [c[0] - h, c[1], c[2]] : axis === 'y' ? [c[0], c[1] - h, c[2]] : [c[0], c[1], c[2] - h]
    const b: V3 = axis === 'x' ? [c[0] + h, c[1], c[2]] : axis === 'y' ? [c[0], c[1] + h, c[2]] : [c[0], c[1], c[2] + h]
    this.tube(key, a, b, r, color, segs, rEnd)
  }

  sphere(key: string, c: V3, r: number, color: THREE.ColorRepresentation, w = 14, h = 10, sy = 1): void {
    _m.compose(_p.set(c[0], c[1], c[2]), _q.identity(), _s.set(r, r * sy, r))
    this.add(key, unitSphere(w, h), _m, color)
  }

  /** Torus whose ring lies in the plane perpendicular to `axis`. */
  torus(key: string, c: V3, R: number, tube: number, color: THREE.ColorRepresentation, axis: 'x' | 'y' | 'z' = 'z', arc = Math.PI * 2, spin = 0, rs = 8, ts = 20): void {
    // TorusGeometry lies in the XY plane (ring axis = +Z); spin turns it about its own axis.
    if (axis === 'z') _e.set(0, 0, spin, 'XYZ')
    else if (axis === 'y') _e.set(Math.PI / 2, 0, spin, 'XYZ')
    else _e.set(0, Math.PI / 2, spin, 'YXZ')
    _q.setFromEuler(_e)
    _m.compose(_p.set(c[0], c[1], c[2]), _q, _s.set(1, 1, 1))
    this.add(key, torusGeo(R, tube, rs, ts, arc), _m, color)
  }

  /**
   * Flat quad facing +Z rotated by `rot` (YXZ). With `rect` the quad maps that
   * atlas rect ([u0, v0, u1, v1]).
   */
  plane(key: string, c: V3, w: number, h: number, color: THREE.ColorRepresentation, rot: V3 = [0, 0, 0], rect: Part['rect'] = null): void {
    _e.set(rot[0], rot[1], rot[2], 'YXZ')
    _q.setFromEuler(_e)
    _m.compose(_p.set(c[0], c[1], c[2]), _q, _s.set(w, h, 1))
    this.add(key, unitPlane(), _m, color, 'keep', rect ?? [0, 0, 1, 1])
  }

  /** Any geometry (e.g. lathe profiles) with a transform. */
  geo(key: string, g: THREE.BufferGeometry, c: V3, color: THREE.ColorRepresentation, rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1], uv: UvMode = 'box'): void {
    _e.set(rot[0], rot[1], rot[2], 'YXZ')
    _q.setFromEuler(_e)
    _m.compose(_p.set(c[0], c[1], c[2]), _q, _s.set(scale[0], scale[1], scale[2]))
    this.add(key, g, _m, color, uv)
  }

  get keys(): string[] {
    return [...this.parts.keys()]
  }

  /** Merge parts per key. Caller owns (and must dispose) the returned geometries. */
  build(): { key: string; geometry: THREE.BufferGeometry }[] {
    const out: { key: string; geometry: THREE.BufferGeometry }[] = []
    for (const [key, list] of this.parts) out.push({ key, geometry: mergeParts(list, this.tile) })
    return out
  }
}

const _n = new THREE.Vector3()
const _v = new THREE.Vector3()
const _nm = new THREE.Matrix3()

function mergeParts(parts: Part[], tile: number): THREE.BufferGeometry {
  let vCount = 0
  let iCount = 0
  for (const p of parts) {
    const n = p.geo.getAttribute('position').count
    vCount += n
    iCount += p.geo.index ? p.geo.index.count : n
  }
  const pos = new Float32Array(vCount * 3)
  const nor = new Float32Array(vCount * 3)
  const uv = new Float32Array(vCount * 2)
  const colr = new Float32Array(vCount * 3)
  const index = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount)
  let vo = 0
  let io = 0
  const inv = 1 / tile
  for (const p of parts) {
    const pa = p.geo.getAttribute('position')
    const na = p.geo.getAttribute('normal')
    const ua = p.geo.getAttribute('uv')
    _nm.getNormalMatrix(p.matrix)
    const n = pa.count
    for (let i = 0; i < n; i++) {
      _v.fromBufferAttribute(pa, i).applyMatrix4(p.matrix)
      const k = vo + i
      pos[k * 3] = _v.x
      pos[k * 3 + 1] = _v.y
      pos[k * 3 + 2] = _v.z
      if (na) _n.fromBufferAttribute(na, i).applyMatrix3(_nm).normalize()
      else _n.set(0, 1, 0)
      nor[k * 3] = _n.x
      nor[k * 3 + 1] = _n.y
      nor[k * 3 + 2] = _n.z
      if (p.uv === 'keep' && ua) {
        const r = p.rect ?? [0, 0, 1, 1]
        uv[k * 2] = r[0] + ua.getX(i) * (r[2] - r[0])
        uv[k * 2 + 1] = r[1] + ua.getY(i) * (r[3] - r[1])
      } else {
        const ax = Math.abs(_n.x)
        const ay = Math.abs(_n.y)
        const az = Math.abs(_n.z)
        if (ay >= ax && ay >= az) {
          uv[k * 2] = _v.x * inv
          uv[k * 2 + 1] = _v.z * inv
        } else if (ax >= az) {
          uv[k * 2] = _v.z * inv
          uv[k * 2 + 1] = _v.y * inv
        } else {
          uv[k * 2] = _v.x * inv
          uv[k * 2 + 1] = _v.y * inv
        }
      }
      colr[k * 3] = p.color.r
      colr[k * 3 + 1] = p.color.g
      colr[k * 3 + 2] = p.color.b
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
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.setAttribute('color', new THREE.BufferAttribute(colr, 3))
  g.setIndex(new THREE.BufferAttribute(index, 1))
  g.computeBoundingBox()
  g.computeBoundingSphere()
  return g
}

/** Lathe profile helper (points as [radius, y]). Cached by key. */
export function latheGeo(key: string, pts: [number, number][], segs = 20): THREE.BufferGeometry {
  return cached(`lathe:${key}:${segs}`, () => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs))
}
