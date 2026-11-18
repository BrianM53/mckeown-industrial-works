import * as THREE from 'three'

/**
 * Static geometry batcher. Parts are added with a material KEY, a transform and
 * a (linear, possibly HDR) vertex color; `build()` merges every part sharing a
 * key into ONE indexed BufferGeometry (position/normal/uv/color). Keeps the
 * environment at a few dozen draw calls.
 *
 * UV modes:
 *  - 'world': box-projected world-space UVs (u along the horizontal axis on
 *    walls, so corrugation ribs stay vertical), scaled by the key's tile size.
 *  - 'keep' : keep the source UVs (atlas-mapped quads, custom geometry).
 *  - 'scale': keep source UVs multiplied by uvScale (chains, pipes).
 */
export type UvMode = 'world' | 'keep' | 'scale'

export type Vec3 = [number, number, number]

interface Part {
  geo: THREE.BufferGeometry
  matrix: THREE.Matrix4
  color: THREE.Color
  uvMode: UvMode
  uvScale: [number, number]
  uvRect: [number, number, number, number] | null
}

const unitBox = new THREE.BoxGeometry(1, 1, 1)
const geoCache = new Map<string, THREE.BufferGeometry>()

function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key) as T | undefined
  if (!g) {
    g = make()
    geoCache.set(key, g)
  }
  return g
}

/** Unit cylinder along +Y: bottom radius 1, top radius `ratio`, height 1, centered. */
export function unitCylinder(segs: number, ratio = 1, open = false): THREE.BufferGeometry {
  return cached(`cyl:${segs}:${ratio}:${open}`, () => new THREE.CylinderGeometry(ratio, 1, 1, segs, 1, open))
}

export function unitSphere(w: number, h: number): THREE.BufferGeometry {
  return cached(`sph:${w}:${h}`, () => new THREE.SphereGeometry(1, w, h))
}

export function torusGeo(R: number, tube: number, rs = 6, ts = 16): THREE.BufferGeometry {
  return cached(`tor:${R}:${tube}:${rs}:${ts}`, () => new THREE.TorusGeometry(R, tube, rs, ts))
}

const unitPlane = new THREE.PlaneGeometry(1, 1)

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _s = new THREE.Vector3()
const _p = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const _dir = new THREE.Vector3()
const _c = new THREE.Color()

export function color(c: THREE.ColorRepresentation, scale = 1): THREE.Color {
  return new THREE.Color(c).multiplyScalar(scale)
}

export class Batch {
  private parts = new Map<string, Part[]>()
  /** World-UV tile size (m) per key; default 2. */
  constructor(private tiles: Record<string, number> = {}) {}

  get keys(): string[] {
    return [...this.parts.keys()]
  }

  add(key: string, geo: THREE.BufferGeometry, matrix: THREE.Matrix4, col: THREE.ColorRepresentation, uvMode: UvMode = 'world', uvScale: [number, number] = [1, 1], uvRect: Part['uvRect'] = null): void {
    let list = this.parts.get(key)
    if (!list) {
      list = []
      this.parts.set(key, list)
    }
    list.push({ geo, matrix: matrix.clone(), color: col instanceof THREE.Color ? col.clone() : new THREE.Color(col), uvMode, uvScale, uvRect })
  }

  /** Box by center & full size, rotated (YXZ order). */
  box(key: string, cx: number, cy: number, cz: number, w: number, h: number, d: number, col: THREE.ColorRepresentation, rotY = 0, rotX = 0, rotZ = 0): void {
    if (w <= 0 || h <= 0 || d <= 0) return
    _e.set(rotX, rotY, rotZ, 'YXZ')
    _q.setFromEuler(_e)
    _m.compose(_p.set(cx, cy, cz), _q, _s.set(w, h, d))
    this.add(key, unitBox, _m, col)
  }

  /** Box resting on y0 (base), centered on x/z. */
  boxB(key: string, x: number, y0: number, z: number, w: number, h: number, d: number, col: THREE.ColorRepresentation, rotY = 0): void {
    this.box(key, x, y0 + h / 2, z, w, h, d, col, rotY)
  }

  /** Box spanning two corners (axis aligned). */
  boxMinMax(key: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col: THREE.ColorRepresentation): void {
    this.box(key, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), col)
  }

  /** Vertical cylinder from base y0 with height h. */
  cylY(key: string, x: number, y0: number, z: number, r: number, h: number, col: THREE.ColorRepresentation, segs = 12, rTop?: number, open = false): void {
    if (r <= 0 || h <= 0) return
    const ratio = rTop === undefined ? 1 : Math.round((rTop / r) * 1000) / 1000
    _m.compose(_p.set(x, y0 + h / 2, z), _q.identity(), _s.set(r, h, r))
    this.add(key, unitCylinder(segs, ratio, open), _m, col)
  }

  /** Cylinder between two points (pipes, rails, struts). */
  cylBetween(key: string, a: Vec3, b: Vec3, r: number, col: THREE.ColorRepresentation, segs = 10, open = false, uvMode: UvMode = 'world', uvScale: [number, number] = [1, 1]): void {
    _dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    const len = _dir.length()
    if (len < 1e-4 || r <= 0) return
    _dir.divideScalar(len)
    _q.setFromUnitVectors(_up, _dir)
    _m.compose(_p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, _s.set(r, len, r))
    this.add(key, unitCylinder(segs, 1, open), _m, col, uvMode, uvScale)
  }

  sphere(key: string, x: number, y: number, z: number, r: number, col: THREE.ColorRepresentation, w = 12, h = 8, sy = 1): void {
    _m.compose(_p.set(x, y, z), _q.identity(), _s.set(r, r * sy, r))
    this.add(key, unitSphere(w, h), _m, col)
  }

  /** Torus in the plane perpendicular to `axis` ('x' | 'y' | 'z'), e.g. valve wheels and flanges. */
  torus(key: string, x: number, y: number, z: number, R: number, tube: number, col: THREE.ColorRepresentation, axis: 'x' | 'y' | 'z' = 'z', rotY = 0): void {
    _e.set(axis === 'y' ? Math.PI / 2 : 0, rotY + (axis === 'x' ? Math.PI / 2 : 0), 0, 'YXZ')
    _q.setFromEuler(_e)
    _m.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1))
    this.add(key, torusGeo(R, tube), _m, col)
  }

  /**
   * Flat quad facing `yaw` (front normal = forward(yaw)), centered at (cx, cy, cz).
   * `uvRect` = [u0, v0, u1, v1] maps the quad into an atlas (front view, unmirrored).
   */
  plane(key: string, cx: number, cy: number, cz: number, w: number, h: number, yaw: number, uvRect: [number, number, number, number], col: THREE.ColorRepresentation = '#ffffff', tilt = 0): void {
    _e.set(tilt, yaw + Math.PI, 0, 'YXZ')
    _q.setFromEuler(_e)
    _m.compose(_p.set(cx, cy, cz), _q, _s.set(w, h, 1))
    this.add(key, unitPlane, _m, col, 'keep', [1, 1], uvRect)
  }

  /** Horizontal floor quad (normal +Y) from rect, rotated by yaw around its center; uvRect maps it (top = -z when yaw = 0). */
  floorQuad(key: string, cx: number, y: number, cz: number, w: number, d: number, yaw: number, uvRect: [number, number, number, number] | null, col: THREE.ColorRepresentation, uvScale: [number, number] = [1, 1]): void {
    _e.set(-Math.PI / 2, yaw, 0, 'YXZ')
    _q.setFromEuler(_e)
    _m.compose(_p.set(cx, y, cz), _q, _s.set(w, d, 1))
    this.add(key, unitPlane, _m, col, uvRect ? 'keep' : 'scale', uvScale, uvRect)
  }

  /** Custom geometry with a full transform. */
  geo(key: string, geometry: THREE.BufferGeometry, position: Vec3, rotation: Vec3 = [0, 0, 0], scale: Vec3 = [1, 1, 1], col: THREE.ColorRepresentation = '#ffffff', uvMode: UvMode = 'world'): void {
    _e.set(rotation[0], rotation[1], rotation[2], 'YXZ')
    _q.setFromEuler(_e)
    _m.compose(_p.set(position[0], position[1], position[2]), _q, _s.set(scale[0], scale[1], scale[2]))
    this.add(key, geometry, _m, col, uvMode)
  }

  /** Merge one key into a geometry (or null when empty). `filter` keeps only matching parts. */
  buildKey(key: string, filter?: (geo: THREE.BufferGeometry, matrix: THREE.Matrix4) => boolean): THREE.BufferGeometry | null {
    const all = this.parts.get(key)
    const list = all && filter ? all.filter((p) => filter(p.geo, p.matrix)) : all
    if (!list || !list.length) return null
    const tile = this.tiles[key] ?? 2
    let nv = 0
    let ni = 0
    for (const p of list) {
      const pos = p.geo.getAttribute('position')
      nv += pos.count
      ni += p.geo.index ? p.geo.index.count : pos.count
    }
    const positions = new Float32Array(nv * 3)
    const normals = new Float32Array(nv * 3)
    const uvs = new Float32Array(nv * 2)
    const colors = new Float32Array(nv * 3)
    const indices = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni)
    const nm = new THREE.Matrix3()
    const v = new THREE.Vector3()
    const n = new THREE.Vector3()
    let vo = 0
    let io = 0
    for (const p of list) {
      const pos = p.geo.getAttribute('position')
      const nor = p.geo.getAttribute('normal')
      const uv = p.geo.getAttribute('uv')
      nm.getNormalMatrix(p.matrix)
      const det = p.matrix.determinant()
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(p.matrix)
        if (nor) n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize()
        else n.set(0, 1, 0)
        const o3 = (vo + i) * 3
        const o2 = (vo + i) * 2
        positions[o3] = v.x
        positions[o3 + 1] = v.y
        positions[o3 + 2] = v.z
        normals[o3] = n.x
        normals[o3 + 1] = n.y
        normals[o3 + 2] = n.z
        colors[o3] = p.color.r
        colors[o3 + 1] = p.color.g
        colors[o3 + 2] = p.color.b
        if (p.uvMode === 'world') {
          const ax = Math.abs(n.x)
          const ay = Math.abs(n.y)
          const az = Math.abs(n.z)
          if (ay >= ax && ay >= az) {
            uvs[o2] = v.x / tile
            uvs[o2 + 1] = v.z / tile
          } else if (ax >= az) {
            uvs[o2] = v.z / tile
            uvs[o2 + 1] = v.y / tile
          } else {
            uvs[o2] = v.x / tile
            uvs[o2 + 1] = v.y / tile
          }
        } else if (uv) {
          let u = uv.getX(i)
          let w = uv.getY(i)
          if (p.uvRect) {
            u = p.uvRect[0] + u * (p.uvRect[2] - p.uvRect[0])
            w = p.uvRect[1] + w * (p.uvRect[3] - p.uvRect[1])
          } else {
            u *= p.uvScale[0]
            w *= p.uvScale[1]
          }
          uvs[o2] = u
          uvs[o2 + 1] = w
        }
      }
      if (p.geo.index) {
        const idx = p.geo.index
        // Mirrored transforms flip winding.
        if (det < 0) {
          for (let k = 0; k < idx.count; k += 3) {
            indices[io + k] = idx.getX(k) + vo
            indices[io + k + 1] = idx.getX(k + 2) + vo
            indices[io + k + 2] = idx.getX(k + 1) + vo
          }
        } else for (let k = 0; k < idx.count; k++) indices[io + k] = idx.getX(k) + vo
        io += idx.count
      } else {
        for (let k = 0; k < pos.count; k++) indices[io + k] = vo + k
        io += pos.count
      }
      vo += pos.count
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    g.setIndex(new THREE.BufferAttribute(indices, 1))
    g.computeBoundingSphere()
    g.computeBoundingBox()
    return g
  }

  /**
   * Split one key by shadow significance: parts whose oriented size is at least `minMid` m on
   * their middle axis (or cheap boxes at least `minBox` m long) go to `cast`, the rest
   * (rivets, bolts, thin pipes, rails, small trims) to `rest`. Same material, so the cost is one
   * extra main-pass draw call in exchange for a much lighter shadow pass.
   */
  buildSplit(key: string, minMid = 0.32, minBox = 0.9): { cast: THREE.BufferGeometry | null; rest: THREE.BufferGeometry | null } {
    const isCaster = (geo: THREE.BufferGeometry, m: THREE.Matrix4): boolean => {
      if (!geo.boundingBox) geo.computeBoundingBox()
      const bb = geo.boundingBox!
      const e = m.elements
      const sx = (bb.max.x - bb.min.x) * Math.hypot(e[0], e[1], e[2])
      const sy = (bb.max.y - bb.min.y) * Math.hypot(e[4], e[5], e[6])
      const sz = (bb.max.z - bb.min.z) * Math.hypot(e[8], e[9], e[10])
      const lo = Math.min(sx, sy, sz)
      const hi = Math.max(sx, sy, sz)
      const mid = sx + sy + sz - lo - hi
      const tris = (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3
      if (tris <= 12) return hi >= minBox && mid >= 0.12
      return mid >= minMid
    }
    return { cast: this.buildKey(key, isCaster), rest: this.buildKey(key, (g, m) => !isCaster(g, m)) }
  }

  build(): Map<string, THREE.BufferGeometry> {
    const out = new Map<string, THREE.BufferGeometry>()
    for (const key of this.parts.keys()) {
      const g = this.buildKey(key)
      if (g) out.set(key, g)
    }
    return out
  }
}

/** Build a single merged geometry from parts all added under key 'k' (instancing kits). */
export function buildKit(fn: (b: Batch) => void, tile = 1): THREE.BufferGeometry {
  const b = new Batch({ k: tile })
  fn(b)
  return b.buildKey('k') ?? new THREE.BufferGeometry()
}

/**
 * Convex prism: polygon given as [z, y] points (any winding) extruded along X
 * by `length` (centered on x = 0). Flat normals, winding fixed per face.
 */
export function prismGeometry(points: [number, number][], length: number): THREE.BufferGeometry {
  const hx = length / 2
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const cz = points.reduce((s, p) => s + p[0], 0) / points.length
  const cy = points.reduce((s, p) => s + p[1], 0) / points.length
  const tri = (a: Vec3, b: Vec3, c: Vec3, n: Vec3) => {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const cr = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]]
    if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < 0) [b, c] = [c, b]
    const base = pos.length / 3
    for (const p of [a, b, c]) {
      pos.push(p[0], p[1], p[2])
      nor.push(n[0], n[1], n[2])
      uv.push(0, 0)
    }
    idx.push(base, base + 1, base + 2)
  }
  for (const sx of [-1, 1]) {
    const n: Vec3 = [sx, 0, 0]
    for (let i = 1; i < points.length - 1; i++)
      tri([sx * hx, points[0][1], points[0][0]], [sx * hx, points[i][1], points[i][0]], [sx * hx, points[i + 1][1], points[i + 1][0]], n)
  }
  for (let i = 0; i < points.length; i++) {
    const [z0, y0] = points[i]
    const [z1, y1] = points[(i + 1) % points.length]
    let nz = -(y1 - y0)
    let ny = z1 - z0
    const len = Math.hypot(nz, ny) || 1
    nz /= len
    ny /= len
    if (nz * ((z0 + z1) / 2 - cz) + ny * ((y0 + y1) / 2 - cy) < 0) {
      nz = -nz
      ny = -ny
    }
    const n: Vec3 = [0, ny, nz]
    tri([-hx, y0, z0], [hx, y0, z0], [hx, y1, z1], n)
    tri([-hx, y0, z0], [hx, y1, z1], [-hx, y1, z1], n)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  return g
}

/** Sets an HDR color in place (for glow vertex colors). */
export function hdr(c: THREE.ColorRepresentation, intensity: number): THREE.Color {
  return _c.set(c).multiplyScalar(intensity).clone()
}
