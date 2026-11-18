/**
 * Prop geometry builder: compose chunky primitives with per-part colors and
 * merge them into ONE indexed BufferGeometry with a `color` attribute, so each
 * prop part is a single draw call with a shared vertex-color material.
 * Geometries are built once at module level and never disposed (app lifetime).
 */
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

type V3 = [number, number, number]

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _s = new THREE.Vector3()
const _p = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const _dir = new THREE.Vector3()

interface Part {
  geo: THREE.BufferGeometry
  color: THREE.Color
}

export class Parts {
  private parts: Part[] = []

  add(geo: THREE.BufferGeometry, color: string | THREE.Color, pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): this {
    _e.set(rot[0], rot[1], rot[2])
    _q.setFromEuler(_e)
    geo.applyMatrix4(_m.compose(_p.set(pos[0], pos[1], pos[2]), _q, _s.set(scale[0], scale[1], scale[2])))
    this.parts.push({ geo, color: color instanceof THREE.Color ? color : new THREE.Color(color) })
    return this
  }

  box(w: number, h: number, d: number, color: string, pos: V3, rot?: V3): this {
    return this.add(new THREE.BoxGeometry(w, h, d), color, pos, rot)
  }

  rbox(w: number, h: number, d: number, r: number, color: string, pos: V3, rot?: V3): this {
    const rr = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)
    return this.add(new RoundedBoxGeometry(w, h, d, 2, rr), color, pos, rot)
  }

  cyl(rt: number, rb: number, h: number, color: string, pos: V3, rot?: V3, seg = 14, open = false): this {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), color, pos, rot)
  }

  sphere(r: number, color: string, pos: V3, scale?: V3, seg = 12): this {
    return this.add(new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.7))), color, pos, [0, 0, 0], scale)
  }

  torus(r: number, tube: number, color: string, pos: V3, rot?: V3, arc = Math.PI * 2, seg = 18): this {
    return this.add(new THREE.TorusGeometry(r, tube, 6, seg, arc), color, pos, rot)
  }

  /** A round bar between two points. */
  bar(a: V3, b: V3, r: number, color: string, seg = 8): this {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    const geo = new THREE.CylinderGeometry(r, r, len, seg, 1)
    _dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize()
    _q.setFromUnitVectors(_up, _dir)
    geo.applyMatrix4(_m.compose(_p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, _s.set(1, 1, 1)))
    this.parts.push({ geo, color: new THREE.Color(color) })
    return this
  }

  /** Square tube between two points (frames, rails). */
  beam(a: V3, b: V3, w: number, color: string): this {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    const geo = new THREE.BoxGeometry(w, len, w)
    _dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize()
    _q.setFromUnitVectors(_up, _dir)
    geo.applyMatrix4(_m.compose(_p.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, _s.set(1, 1, 1)))
    this.parts.push({ geo, color: new THREE.Color(color) })
    return this
  }

  get count(): number {
    return this.parts.length
  }

  /** Merge into one geometry (position, normal, color, index). Source parts are disposed. */
  build(): THREE.BufferGeometry {
    let vCount = 0
    let iCount = 0
    for (const p of this.parts) {
      const n = p.geo.getAttribute('position').count
      vCount += n
      iCount += p.geo.index ? p.geo.index.count : n
    }
    const pos = new Float32Array(vCount * 3)
    const nor = new Float32Array(vCount * 3)
    const col = new Float32Array(vCount * 3)
    const index = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount)
    let vo = 0
    let io = 0
    for (const p of this.parts) {
      const pa = p.geo.getAttribute('position')
      const na = p.geo.getAttribute('normal')
      const n = pa.count
      for (let i = 0; i < n; i++) {
        const v = (vo + i) * 3
        pos[v] = pa.getX(i)
        pos[v + 1] = pa.getY(i)
        pos[v + 2] = pa.getZ(i)
        if (na) {
          nor[v] = na.getX(i)
          nor[v + 1] = na.getY(i)
          nor[v + 2] = na.getZ(i)
        }
        col[v] = p.color.r
        col[v + 1] = p.color.g
        col[v + 2] = p.color.b
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
      p.geo.dispose()
    }
    this.parts = []
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    g.setIndex(new THREE.BufferAttribute(index, 1))
    g.computeBoundingBox()
    g.computeBoundingSphere()
    return g
  }
}

// ---------------------------------------------------------------------------
// Shared materials (module level, app lifetime)
// ---------------------------------------------------------------------------

let painted: THREE.MeshStandardMaterial | null = null
let metal: THREE.MeshStandardMaterial | null = null

/** Painted sheet metal / wood / plastic (vertex colors). */
export function paintedMat(): THREE.MeshStandardMaterial {
  if (!painted) {
    painted = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0.16 })
    painted.name = 'npc-prop-painted'
  }
  return painted
}

/** Bare steel / chrome (vertex colors). */
export function metalMat(): THREE.MeshStandardMaterial {
  if (!metal) {
    metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.68 })
    metal.name = 'npc-prop-metal'
  }
  return metal
}

/** Font stack for canvas labels: local Barlow Condensed (never remote), then system fallbacks. */
export const LABEL_FONT = '"MIW NPC Barlow", "MIW Barlow", "Barlow Condensed", "Arial Narrow", Arial, sans-serif'

let fontPromise: Promise<void> | null = null

/** Loads the local label face once (resolves on failure/timeout too — never hangs). */
export function labelFontReady(timeoutMs = 4000): Promise<void> {
  if (fontPromise) return fontPromise
  fontPromise = new Promise<void>((resolve) => {
    if (typeof document === 'undefined' || typeof FontFace === 'undefined' || !document.fonts) {
      resolve()
      return
    }
    const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/'
    const face = new FontFace('MIW NPC Barlow', `url(${base}fonts/BarlowCondensed-Bold.woff) format("woff")`, { weight: '700' })
    const timer = setTimeout(resolve, timeoutMs)
    face
      .load()
      .then((loaded) => {
        document.fonts.add(loaded)
      })
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timer)
        resolve()
      })
  })
  return fontPromise
}

/** Small canvas-texture label (stencils, warning plates). Cached by key; redrawn once the font is ready. */
const labelCache = new Map<string, THREE.CanvasTexture>()

export function labelTexture(
  key: string,
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.Texture {
  let t = labelCache.get(key)
  if (t) return t
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  const paint = () => {
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    draw(ctx, w, h)
  }
  paint()
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  labelCache.set(key, tex)
  void labelFontReady().then(() => {
    paint()
    tex.needsUpdate = true
  })
  return tex
}
