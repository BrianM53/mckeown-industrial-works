import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Tiny procedural-geometry batcher: parts are baked (transform + linear vertex
 * color) into ONE non-indexed BufferGeometry with position/normal/uv/color, so
 * a whole multi-part model renders with one draw call and one shared
 * vertex-colored material.
 */
export type V3 = [number, number, number]

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)

export function lin(hex: THREE.ColorRepresentation, scale = 1): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(scale)
}

function prepare(src: THREE.BufferGeometry, matrix: THREE.Matrix4, color: THREE.Color): THREE.BufferGeometry {
  // always a fresh copy (never mutate the cached source geometry)
  const g = src.index ? src.toNonIndexed() : src.clone()
  g.applyMatrix4(matrix)
  if (!g.getAttribute('normal')) g.computeVertexNormals()
  const n = g.getAttribute('position').count
  if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2))
  const col = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    col[i * 3] = color.r
    col[i * 3 + 1] = color.g
    col[i * 3 + 2] = color.b
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  // keep only the attributes every part has (mergeGeometries requires identical sets)
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name)
  g.morphAttributes = {}
  g.clearGroups()
  return g
}

export class GeoBuilder {
  private parts: THREE.BufferGeometry[] = []

  get count(): number {
    return this.parts.length
  }

  /** Add any geometry with a full matrix. */
  addMatrix(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, color: THREE.ColorRepresentation): this {
    this.parts.push(prepare(geo, matrix, color instanceof THREE.Color ? color : lin(color)))
    return this
  }

  /** Add a geometry at position / euler rotation / scale. */
  add(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): this {
    _e.set(rot[0], rot[1], rot[2])
    _q.setFromEuler(_e)
    _m.compose(_p.set(pos[0], pos[1], pos[2]), _q, _s.set(scale[0], scale[1], scale[2]))
    return this.addMatrix(geo, _m, color)
  }

  /** Axis-aligned box from min/max corners (optionally rotated about its center). */
  boxMinMax(min: V3, max: V3, color: THREE.ColorRepresentation, rot: V3 = [0, 0, 0]): this {
    const w = Math.max(1e-4, max[0] - min[0])
    const h = Math.max(1e-4, max[1] - min[1])
    const d = Math.max(1e-4, max[2] - min[2])
    return this.add(UNIT_BOX, color, [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2], rot, [w, h, d])
  }

  /** Box by center + size. */
  box(center: V3, size: V3, color: THREE.ColorRepresentation, rot: V3 = [0, 0, 0]): this {
    return this.add(UNIT_BOX, color, center, rot, size)
  }

  /** Cylinder (along local +Y before rotation) by center, radius, height. */
  cyl(center: V3, radius: number, height: number, color: THREE.ColorRepresentation, segs = 12, rot: V3 = [0, 0, 0], radiusTop = radius): this {
    return this.add(cylGeo(segs, radiusTop / Math.max(radius, 1e-6)), color, center, rot, [radius, height, radius])
  }

  /** Cylinder (tube) between two points. */
  tube(a: V3, b: V3, radius: number, color: THREE.ColorRepresentation, segs = 8): this {
    _a.set(a[0], a[1], a[2])
    _b.set(b[0], b[1], b[2])
    _dir.subVectors(_b, _a)
    const len = _dir.length()
    if (len < 1e-5) return this
    _dir.multiplyScalar(1 / len)
    _q.setFromUnitVectors(_up, _dir)
    _p.addVectors(_a, _b).multiplyScalar(0.5)
    _m.compose(_p, _q, _s.set(radius, len, radius))
    return this.addMatrix(cylGeo(segs, 1), _m, color)
  }

  /** Square-section bar between two points (rotated so its "up" stays near world up). */
  bar(a: V3, b: V3, thickness: number, color: THREE.ColorRepresentation): this {
    _a.set(a[0], a[1], a[2])
    _b.set(b[0], b[1], b[2])
    _dir.subVectors(_b, _a)
    const len = _dir.length()
    if (len < 1e-5) return this
    _dir.multiplyScalar(1 / len)
    _q.setFromUnitVectors(_up, _dir)
    _p.addVectors(_a, _b).multiplyScalar(0.5)
    _m.compose(_p, _q, _s.set(thickness, len, thickness))
    return this.addMatrix(UNIT_BOX, _m, color)
  }

  sphere(center: V3, radius: number, color: THREE.ColorRepresentation, w = 10, h = 8, scale: V3 = [1, 1, 1]): this {
    return this.add(sphereGeo(w, h), color, center, [0, 0, 0], [radius * scale[0], radius * scale[1], radius * scale[2]])
  }

  build(): THREE.BufferGeometry {
    if (this.parts.length === 0) return new THREE.BufferGeometry()
    const merged = mergeGeometries(this.parts, false)
    for (const p of this.parts) p.dispose()
    this.parts = []
    if (!merged) throw new Error('GeoBuilder: merge failed')
    merged.computeBoundingBox()
    merged.computeBoundingSphere()
    return merged
  }
}

/** 1×1×1 box centered at the origin. */
export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1)

const cylCache = new Map<string, THREE.BufferGeometry>()
/** Unit cylinder along +Y: radius 1 (bottom), `topRatio` (top), height 1, centered. */
export function cylGeo(segs: number, topRatio = 1): THREE.BufferGeometry {
  const key = `${segs}:${topRatio.toFixed(4)}`
  let g = cylCache.get(key)
  if (!g) {
    g = new THREE.CylinderGeometry(topRatio, 1, 1, segs, 1, false)
    cylCache.set(key, g)
  }
  return g
}

const sphereCache = new Map<string, THREE.BufferGeometry>()
export function sphereGeo(w: number, h: number): THREE.BufferGeometry {
  const key = `${w}:${h}`
  let g = sphereCache.get(key)
  if (!g) {
    g = new THREE.SphereGeometry(1, w, h)
    sphereCache.set(key, g)
  }
  return g
}

/**
 * Flat quad (facing +Z before rotation) whose UVs map into a sub-rectangle of
 * an atlas texture: uv = [u0, v0, u1, v1] (v measured from the BOTTOM).
 */
export function atlasQuad(width: number, height: number, uv: [number, number, number, number]): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(width, height)
  const a = g.getAttribute('uv') as THREE.BufferAttribute
  for (let i = 0; i < a.count; i++) {
    const u = a.getX(i)
    const v = a.getY(i)
    a.setXY(i, uv[0] + (uv[2] - uv[0]) * u, uv[1] + (uv[3] - uv[1]) * v)
  }
  return g
}
