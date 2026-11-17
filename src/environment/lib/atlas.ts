import * as THREE from 'three'

/**
 * Canvas texture atlas. Items are planned first (shelf packing, tallest first),
 * the canvas is then created at exactly the used height, and finally every item
 * is painted. Coordinates are LOGICAL pixels; the backing canvas may be scaled
 * (low quality) without changing layout code. Each cell's padding is filled with
 * its background so mipmaps do not bleed neighbouring cells.
 */
export interface Cell {
  x: number
  y: number
  w: number
  h: number
  /** [u0, v0, u1, v1] for the batch (v0 = bottom edge of the cell as seen on the quad). */
  uv: [number, number, number, number]
}

export type DrawFn = (ctx: CanvasRenderingContext2D, w: number, h: number) => void

export interface AtlasItem {
  key: string
  w: number
  h: number
  bg?: string | null
  draw: DrawFn
}

export interface BuiltAtlas {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  cells: Record<string, Cell>
  width: number
  height: number
  scale: number
}

export function buildAtlas(items: AtlasItem[], width: number, scale: number, flipY: boolean, pad = 6): BuiltAtlas {
  const order = [...items].sort((a, b) => b.h - a.h || b.w - a.w)
  const placed = new Map<string, { x: number; y: number; w: number; h: number }>()
  let cx = 0
  let cy = 0
  let shelfH = 0
  for (const it of order) {
    const W = it.w + pad * 2
    const H = it.h + pad * 2
    if (W > width) throw new Error(`atlas item ${it.key} wider than atlas`)
    if (cx + W > width) {
      cx = 0
      cy += shelfH
      shelfH = 0
    }
    placed.set(it.key, { x: cx + pad, y: cy + pad, w: it.w, h: it.h })
    cx += W
    shelfH = Math.max(shelfH, H)
  }
  const used = cy + shelfH
  const height = Math.ceil(used / 16) * 16
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(4, Math.round(width * scale))
  canvas.height = Math.max(4, Math.round(height * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: !flipY })!
  const cells: Record<string, Cell> = {}
  for (const it of items) {
    const p = placed.get(it.key)!
    const u0 = p.x / width
    const u1 = (p.x + p.w) / width
    const uv: Cell['uv'] = flipY ? [u0, 1 - (p.y + p.h) / height, u1, 1 - p.y / height] : [u0, (p.y + p.h) / height, u1, p.y / height]
    cells[it.key] = { ...p, uv }
    ctx.save()
    ctx.setTransform(scale, 0, 0, scale, p.x * scale, p.y * scale)
    if (it.bg) {
      ctx.fillStyle = it.bg
      ctx.fillRect(-pad, -pad, p.w + pad * 2, p.h + pad * 2)
    }
    ctx.beginPath()
    ctx.rect(0, 0, p.w, p.h)
    ctx.clip()
    it.draw(ctx, p.w, p.h)
    ctx.restore()
  }
  return { canvas, ctx, cells, width, height, scale }
}

/** sRGB color texture from an atlas (signs, posters). */
export function atlasColorTexture(a: BuiltAtlas, anisotropy = 8): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(a.canvas)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = anisotropy
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.magFilter = THREE.LinearFilter
  t.needsUpdate = true
  return t
}

/**
 * Two-channel mask texture (R = 255, G = coverage) for use as `alphaMap`
 * (three samples alphaMap.g). Built from the drawn alpha of a flipY=false atlas,
 * with optional chipped-paint wear. Half the memory of RGBA, no dark fringes.
 */
export function atlasMaskTexture(a: BuiltAtlas, wear = 0.18, seed = 1, anisotropy = 8): THREE.DataTexture {
  const cw = a.canvas.width
  const ch = a.canvas.height
  const src = a.ctx.getImageData(0, 0, cw, ch).data
  const out = new Uint8Array(cw * ch * 2)
  const noise = makeNoise(seed)
  const sc = 0.09 / a.scale
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const i = y * cw + x
      let al = src[i * 4 + 3]
      if (al > 0 && wear > 0) {
        const n = noise(x * sc, y * sc) * 0.6 + noise(x * sc * 3.1, y * sc * 3.1) * 0.4
        if (n < wear) al = Math.round(al * Math.max(0, (n - wear + 0.06) / 0.06))
      }
      out[i * 2] = 255
      out[i * 2 + 1] = al
    }
  return maskTexture(out, cw, ch, THREE.ClampToEdgeWrapping, anisotropy)
}

function maskTexture(data: Uint8Array, w: number, h: number, wrap: THREE.Wrapping, anisotropy: number): THREE.DataTexture {
  const t = new THREE.DataTexture(data, w, h, THREE.RGFormat, THREE.UnsignedByteType)
  t.flipY = false
  t.unpackAlignment = 1
  t.colorSpace = THREE.NoColorSpace
  t.anisotropy = anisotropy
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.magFilter = THREE.LinearFilter
  t.wrapS = t.wrapT = wrap
  t.needsUpdate = true
  return t
}

/** Deterministic 2D value noise (0..1) for texture generation. */
export function makeNoise(seed: number): (x: number, y: number) => number {
  const hash = (x: number, y: number) => {
    let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
  return (x: number, y: number) => {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const xf = x - xi
    const yf = y - yi
    const u = xf * xf * (3 - 2 * xf)
    const v = yf * yf * (3 - 2 * yf)
    const a = hash(xi, yi)
    const b = hash(xi + 1, yi)
    const c = hash(xi, yi + 1)
    const e = hash(xi + 1, yi + 1)
    return a + (b - a) * u + (c - a) * v + (a - b - c + e) * u * v
  }
}

/** Tileable wear masks for floor paint (alphaMap; RG). 'line': u across the line, v along it. */
export function paintMaskTexture(kind: 'fill' | 'line', seed: number): THREE.DataTexture {
  const w = kind === 'fill' ? 256 : 64
  const h = 256
  const d = new Uint8Array(w * h * 2)
  const noise = makeNoise(seed)
  // Periodic noise: blend shifted samples so the texture tiles seamlessly.
  const tn = (x: number, y: number, f: number) => {
    const fx = x / w
    const fy = y / h
    const a = noise(x * f, y * f)
    const b = noise((x - w) * f, y * f)
    const c = noise(x * f, (y - h) * f)
    const e = noise((x - w) * f, (y - h) * f)
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      let a = 255
      if (kind === 'fill') {
        const n = tn(x, y, 0.05) * 0.55 + tn(x, y, 0.17) * 0.3 + tn(x, y, 0.45) * 0.15
        if (n < 0.3) a = Math.max(0, Math.round(255 * ((n - 0.26) / 0.04)))
      } else {
        const edgeL = 2 + tn(x, y, 0.2) * 4
        const edgeR = w - 2 - tn(x + 31, y, 0.2) * 4
        const n = tn(x, y, 0.08) * 0.6 + tn(x, y, 0.3) * 0.4
        if (x < edgeL || x > edgeR) a = 0
        else if (n < 0.26) a = Math.max(0, Math.round(255 * ((n - 0.22) / 0.04)))
      }
      d[i * 2] = 255
      d[i * 2 + 1] = a
    }
  return maskTexture(d, w, h, THREE.RepeatWrapping, 8)
}
