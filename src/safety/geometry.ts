/**
 * Tiny geometry kit for the safety props: compose primitives with transforms
 * and per-part colors, then merge into ONE vertex-colored geometry (one draw
 * call per material). Built once at module level / in useMemo, never per frame.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export type V3 = [number, number, number]

export interface PartOpts {
  position?: V3
  rotation?: V3
  scale?: V3
  /** Extra parent transform (e.g. parts sitting on a tilted head). */
  parent?: THREE.Matrix4
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()

export function partMatrix(opts: PartOpts = {}, out = new THREE.Matrix4()): THREE.Matrix4 {
  _e.set(...(opts.rotation ?? [0, 0, 0]))
  _q.setFromEuler(_e)
  _p.set(...(opts.position ?? [0, 0, 0]))
  _s.set(...(opts.scale ?? [1, 1, 1]))
  out.compose(_p, _q, _s)
  if (opts.parent) out.premultiply(opts.parent)
  return out
}

/** Collects colored parts and merges them. */
export class PartBuilder {
  private parts: THREE.BufferGeometry[] = []

  /** Adds `geo` (consumed: it is transformed in place and disposed after build). */
  add(geo: THREE.BufferGeometry, color: string | THREE.Color, opts: PartOpts = {}): this {
    let g = geo
    if (!g.getAttribute('normal')) g.computeVertexNormals()
    if (!g.getAttribute('uv')) {
      const n = g.getAttribute('position').count
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2))
    }
    if (!g.index) {
      // mergeGeometries needs all-indexed or all-non-indexed inputs: index everything.
      const n = g.getAttribute('position').count
      const idx = new Uint32Array(n)
      for (let i = 0; i < n; i++) idx[i] = i
      g = g.clone()
      g.setIndex(new THREE.BufferAttribute(idx, 1))
      geo.dispose()
    }
    g.applyMatrix4(partMatrix(opts, _m))
    const c = color instanceof THREE.Color ? color : new THREE.Color(color)
    const n = g.getAttribute('position').count
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r
      col[i * 3 + 1] = c.g
      col[i * 3 + 2] = c.b
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    // keep only the attributes every part shares
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name)
    this.parts.push(g)
    return this
  }

  get size(): number {
    return this.parts.length
  }

  build(): THREE.BufferGeometry {
    const merged = this.parts.length ? mergeGeometries(this.parts, false) : null
    for (const p of this.parts) p.dispose()
    this.parts = []
    const out = merged ?? new THREE.BufferGeometry()
    out.computeBoundingSphere()
    out.computeBoundingBox()
    return out
  }
}

/** Shared vertex-colored standard materials (cached by params for the app lifetime). */
const matCache = new Map<string, THREE.MeshStandardMaterial>()
export function vertexColorMat(roughness = 0.65, metalness = 0.3, polygonOffset = 0): THREE.MeshStandardMaterial {
  const key = `${roughness}:${metalness}:${polygonOffset}`
  let m = matCache.get(key)
  if (!m) {
    m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness })
    if (polygonOffset) {
      m.polygonOffset = true
      m.polygonOffsetFactor = -polygonOffset
      m.polygonOffsetUnits = -polygonOffset
    }
    m.name = `safety-vc:${key}`
    matCache.set(key, m)
  }
  return m
}

export function easeOutBack(t: number, s = 1.70158): number {
  const u = Math.min(1, Math.max(0, t)) - 1
  return 1 + u * u * ((s + 1) * u + s)
}

export function easeOutCubic(t: number): number {
  const u = 1 - Math.min(1, Math.max(0, t))
  return 1 - u * u * u
}
