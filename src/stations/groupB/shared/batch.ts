import * as THREE from 'three'

/**
 * Static geometry batcher for stations-b. Parts are added under a material KEY
 * with a transform and a vertex color; `build()` merges every part sharing a key
 * into ONE indexed BufferGeometry (position / normal / uv / color). A whole
 * station therefore costs one draw call per material.
 *
 * UVs: parts keep their source UVs when `keepUv` is set (atlas-mapped quads);
 * otherwise they get world-space box-projected UVs (1 unit = `uvTile` m) so
 * tiling wear textures never stretch with the part's scale.
 *
 * Sub-assemblies: `group(x, y, z, yaw, fn)` builds `fn` in a local frame, so a
 * kiosk/bench can be authored once and stamped at several anchors.
 */
export type V3 = readonly [number, number, number]

interface Part {
  geo: THREE.BufferGeometry
  matrix: THREE.Matrix4
  color: THREE.Color
  keepUv: boolean
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

/** Unit box (1 m cube, centered). */
export const unitBox = (): THREE.BufferGeometry => cached('box', () => new THREE.BoxGeometry(1, 1, 1))
/** Unit cylinder along +Y: radius 1 (top radius `top`), height 1, centered. */
export const unitCyl = (segs: number, top = 1, open = false): THREE.BufferGeometry =>
  cached(`cyl:${segs}:${top}:${open}`, () => new THREE.CylinderGeometry(top, 1, 1, segs, 1, open))
export const unitSphere = (ws: number, hs: number): THREE.BufferGeometry => cached(`sph:${ws}:${hs}`, () => new THREE.SphereGeometry(1, ws, hs))
export const torusGeo = (R: number, tube: number, rs = 6, ts = 24, arc = Math.PI * 2): THREE.BufferGeometry =>
  cached(`tor:${R}:${tube}:${rs}:${ts}:${arc}`, () => new THREE.TorusGeometry(R, tube, rs, ts, arc))
export const unitPlane = (): THREE.BufferGeometry => cached('plane', () => new THREE.PlaneGeometry(1, 1))

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _s = new THREE.Vector3()
const _p = new THREE.Vector3()
const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _d = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const _c = new THREE.Color()

function toColor(c: THREE.ColorRepresentation): THREE.Color {
  return c instanceof THREE.Color ? c.clone() : new THREE.Color(c)
}

export class Batch {
  private parts = new Map<string, Part[]>()
  private frames: THREE.Matrix4[] = [new THREE.Matrix4()]
  /** World-space UV tile size (m) for box-projected UVs. */
  uvTile = 1.6

  private get frame(): THREE.Matrix4 {
    return this.frames[this.frames.length - 1]
  }

  /** Build `fn` inside a local frame at (x, y, z) rotated by `yaw` about +Y. */
  group(x: number, y: number, z: number, yaw: number, fn: () => void, scale = 1): void {
    this.groupR([x, y, z], [0, yaw, 0], fn, scale)
  }

  /** Build `fn` inside a local frame with a full Euler rotation (XYZ order). */
  groupR(pos: V3, rot: V3, fn: () => void, scale = 1): void {
    _e.set(rot[0], rot[1], rot[2])
    _q.setFromEuler(_e)
    const local = new THREE.Matrix4().compose(_p.set(pos[0], pos[1], pos[2]), _q, _s.set(scale, scale, scale))
    this.frames.push(this.frame.clone().multiply(local))
    try {
      fn()
    } finally {
      this.frames.pop()
    }
  }

  /** Current local→world matrix (e.g. to place a screen/interactable inside a group). */
  currentMatrix(out = new THREE.Matrix4()): THREE.Matrix4 {
    return out.copy(this.frame)
  }

  /** Add any geometry (shared; it is cloned at build time) with a local matrix. */
  add(key: string, geo: THREE.BufferGeometry, matrix: THREE.Matrix4, color: THREE.ColorRepresentation, keepUv = false): void {
    let list = this.parts.get(key)
    if (!list) {
      list = []
      this.parts.set(key, list)
    }
    list.push({ geo, matrix: this.frame.clone().multiply(matrix), color: toColor(color), keepUv })
  }

  /** Geometry with position / Euler rotation / scale. */
  geo(key: string, geo: THREE.BufferGeometry, pos: V3, rot: V3, scale: V3, color: THREE.ColorRepresentation, keepUv = false): void {
    _e.set(rot[0], rot[1], rot[2])
    _q.setFromEuler(_e)
    this.add(key, geo, new THREE.Matrix4().compose(_p.set(pos[0], pos[1], pos[2]), _q, _s.set(scale[0], scale[1], scale[2])), color, keepUv)
  }

  /** Centered box. */
  box(key: string, x: number, y: number, z: number, w: number, h: number, d: number, color: THREE.ColorRepresentation, rot: V3 = [0, 0, 0]): void {
    this.geo(key, unitBox(), [x, y, z], rot, [w, h, d], color)
  }

  /** Box standing on y0. */
  boxB(key: string, x: number, y0: number, z: number, w: number, h: number, d: number, color: THREE.ColorRepresentation, yaw = 0): void {
    this.geo(key, unitBox(), [x, y0 + h / 2, z], [0, yaw, 0], [w, h, d], color)
  }

  /** Box from min/max corners (axis aligned in the current frame). */
  boxMinMax(key: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: THREE.ColorRepresentation): void {
    this.box(key, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), color)
  }

  /** Vertical cylinder standing on y0. */
  cyl(key: string, x: number, y0: number, z: number, r: number, h: number, color: THREE.ColorRepresentation, segs = 12, top = 1): void {
    this.geo(key, unitCyl(segs, top), [x, y0 + h / 2, z], [0, 0, 0], [r, h, r], color)
  }

  /** Cylinder whose axis runs from a to b. */
  cylBetween(key: string, a: V3, b: V3, r: number, color: THREE.ColorRepresentation, segs = 8, top = 1): void {
    _a.set(a[0], a[1], a[2])
    _b.set(b[0], b[1], b[2])
    _d.subVectors(_b, _a)
    const len = _d.length()
    if (len < 1e-5) return
    _q.setFromUnitVectors(_up, _d.multiplyScalar(1 / len))
    _p.addVectors(_a, _b).multiplyScalar(0.5)
    this.add(key, unitCyl(segs, top), new THREE.Matrix4().compose(_p, _q, _s.set(r, len, r)), color)
  }

  sphere(key: string, x: number, y: number, z: number, r: number, color: THREE.ColorRepresentation, ws = 12, hs = 8, scale: V3 = [1, 1, 1]): void {
    this.geo(key, unitSphere(ws, hs), [x, y, z], [0, 0, 0], [r * scale[0], r * scale[1], r * scale[2]], color)
  }

  torus(key: string, x: number, y: number, z: number, R: number, tube: number, color: THREE.ColorRepresentation, rot: V3 = [0, 0, 0], rs = 6, ts = 24, arc = Math.PI * 2): void {
    this.geo(key, torusGeo(R, tube, rs, ts, arc), [x, y, z], rot, [1, 1, 1], color)
  }

  /** Atlas-mapped quad (unit plane facing +Z before rotation). uv = [u0, v0, u1, v1]. */
  quad(key: string, x: number, y: number, z: number, w: number, h: number, rot: V3, uv: readonly [number, number, number, number], color: THREE.ColorRepresentation = '#ffffff'): void {
    const g = new THREE.PlaneGeometry(1, 1)
    const a = g.getAttribute('uv') as THREE.BufferAttribute
    for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) < 0.5 ? uv[0] : uv[2], a.getY(i) < 0.5 ? uv[1] : uv[3])
    this.geo(key, g, [x, y, z], rot, [w, h, 1], color, true)
  }

  get keys(): string[] {
    return [...this.parts.keys()]
  }

  /** Merge every key into one geometry. */
  build(): Map<string, THREE.BufferGeometry> {
    const out = new Map<string, THREE.BufferGeometry>()
    for (const [key, parts] of this.parts) out.set(key, merge(parts, this.uvTile))
    return out
  }
}

const _n = new THREE.Vector3()
const _v = new THREE.Vector3()
const _nm = new THREE.Matrix3()

function merge(parts: Part[], tile: number): THREE.BufferGeometry {
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
  const col = new Float32Array(vCount * 3)
  const index = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount)
  let vo = 0
  let io = 0
  const inv = 1 / tile
  for (const p of parts) {
    const pa = p.geo.getAttribute('position')
    const na = p.geo.getAttribute('normal')
    const ua = p.geo.getAttribute('uv')
    const n = pa.count
    _nm.getNormalMatrix(p.matrix)
    for (let i = 0; i < n; i++) {
      const v = vo + i
      _v.set(pa.getX(i), pa.getY(i), pa.getZ(i)).applyMatrix4(p.matrix)
      pos[v * 3] = _v.x
      pos[v * 3 + 1] = _v.y
      pos[v * 3 + 2] = _v.z
      if (na) _n.set(na.getX(i), na.getY(i), na.getZ(i)).applyMatrix3(_nm).normalize()
      else _n.set(0, 1, 0)
      nor[v * 3] = _n.x
      nor[v * 3 + 1] = _n.y
      nor[v * 3 + 2] = _n.z
      if (p.keepUv && ua) {
        uv[v * 2] = ua.getX(i)
        uv[v * 2 + 1] = ua.getY(i)
      } else {
        // box projection on the dominant normal axis
        const ax = Math.abs(_n.x)
        const ay = Math.abs(_n.y)
        const az = Math.abs(_n.z)
        if (ay >= ax && ay >= az) {
          uv[v * 2] = _v.x * inv
          uv[v * 2 + 1] = _v.z * inv
        } else if (ax >= az) {
          uv[v * 2] = _v.z * inv
          uv[v * 2 + 1] = _v.y * inv
        } else {
          uv[v * 2] = _v.x * inv
          uv[v * 2 + 1] = _v.y * inv
        }
      }
      _c.copy(p.color)
      col[v * 3] = _c.r
      col[v * 3 + 1] = _c.g
      col[v * 3 + 2] = _c.b
    }
    if (p.geo.index) {
      const idx = p.geo.index
      // flip winding when the transform mirrors
      const flip = p.matrix.determinant() < 0
      for (let i = 0; i < idx.count; i += 3) {
        const a = idx.getX(i) + vo
        const b = idx.getX(i + 1) + vo
        const c = idx.getX(i + 2) + vo
        index[io + i] = a
        index[io + i + 1] = flip ? c : b
        index[io + i + 2] = flip ? b : c
      }
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
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.setIndex(new THREE.BufferAttribute(index, 1))
  g.computeBoundingBox()
  g.computeBoundingSphere()
  return g
}

/** Total triangle count of built geometries (tests / budget checks). */
export function triangleCount(geos: Iterable<THREE.BufferGeometry>): number {
  let t = 0
  for (const g of geos) t += (g.index ? g.index.count : g.getAttribute('position').count) / 3
  return t
}
