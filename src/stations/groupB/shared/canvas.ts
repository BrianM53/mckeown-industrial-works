import * as THREE from 'three'

/**
 * Canvas helpers for stations-b signage: a tiny shelf-packing texture atlas
 * (one texture + one material per station keeps text to a single draw call)
 * and text layout utilities. Pure layout helpers (wrapping) are unit-tested;
 * drawing helpers need a real 2D canvas (browser only).
 */
export type UvRect = readonly [number, number, number, number]

export interface AtlasItem {
  id: string
  w: number
  h: number
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
}

export interface Atlas {
  texture: THREE.CanvasTexture
  canvas: HTMLCanvasElement
  /** [u0, v0, u1, v1] (bottom-left, top-right) for each item id. */
  uv: Record<string, UvRect>
  /** Pixel rect of each item (for later redraws of dynamic cells). */
  px: Record<string, { x: number; y: number; w: number; h: number }>
}

function nextPow2(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

/** Pack items into one canvas texture (shelf packing, tallest first). */
export function buildAtlas(items: AtlasItem[], width = 2048, pad = 4, maxAnisotropy = 4): Atlas {
  const sorted = [...items].sort((a, b) => b.h - a.h)
  const placed: { item: AtlasItem; x: number; y: number }[] = []
  let x = pad
  let y = pad
  let shelf = 0
  for (const item of sorted) {
    if (x + item.w + pad > width) {
      x = pad
      y += shelf + pad
      shelf = 0
    }
    placed.push({ item, x, y })
    x += item.w + pad
    shelf = Math.max(shelf, item.h)
  }
  const height = nextPow2(y + shelf + pad)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const uv: Record<string, UvRect> = {}
  const px: Atlas['px'] = {}
  for (const { item, x: px0, y: py0 } of placed) {
    ctx.save()
    ctx.translate(px0, py0)
    ctx.beginPath()
    ctx.rect(0, 0, item.w, item.h)
    ctx.clip()
    item.draw(ctx, item.w, item.h)
    ctx.restore()
    // half-texel inset avoids bleeding from neighbours under mipmapping
    uv[item.id] = [(px0 + 0.5) / width, 1 - (py0 + item.h - 0.5) / height, (px0 + item.w - 0.5) / width, 1 - (py0 + 0.5) / height]
    px[item.id] = { x: px0, y: py0, w: item.w, h: item.h }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = maxAnisotropy
  texture.needsUpdate = true
  return { texture, canvas, uv, px }
}

/** Word-wrap `text` to lines of at most `maxChars` characters (monospace layout). */
export function wrapMono(text: string, maxChars: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if (!w) continue
    if (w.length > maxChars) {
      // hard-split very long tokens (URLs)
      if (cur) {
        lines.push(cur)
        cur = ''
      }
      for (let i = 0; i < w.length; i += maxChars) {
        const chunk = w.slice(i, i + maxChars)
        if (chunk.length === maxChars) lines.push(chunk)
        else cur = chunk
      }
      continue
    }
    if (!cur) cur = w
    else if (cur.length + 1 + w.length <= maxChars) cur += ` ${w}`
    else {
      lines.push(cur)
      cur = w
    }
  }
  if (cur) lines.push(cur)
  return lines
}

/** Clamp a list of lines to `maxLines`, ending the last kept line with an ellipsis. */
export function clampLines(lines: string[], maxLines: number, maxChars: number): string[] {
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  let last = kept[maxLines - 1]
  if (last.length + 1 > maxChars) last = last.slice(0, Math.max(0, maxChars - 1)).trimEnd()
  kept[maxLines - 1] = `${last}…`
  return kept
}

export function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
  ctx.lineTo(x + rr, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr)
  ctx.lineTo(x, y + rr)
  ctx.quadraticCurveTo(x, y, x + rr, y)
  ctx.closePath()
}

/** Draw text centered at (cx, cy), shrinking the font until it fits `maxW`. */
export function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  maxW: number,
  size: number,
  family: string,
  weight = 700,
  align: CanvasTextAlign = 'center',
): number {
  let s = size
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  for (let i = 0; i < 24; i++) {
    ctx.font = `${weight} ${s}px ${family}`
    if (ctx.measureText(text).width <= maxW || s <= 8) break
    s *= 0.93
  }
  ctx.fillText(text, cx, cy)
  return s
}

/** Light paint wear / grime speckle over a sign (deterministic). */
export function grime(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, amount = 0.5): void {
  let s = seed >>> 0 || 1
  const r = () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
  const n = Math.round(w * h * 0.0016 * amount)
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = `rgba(40,32,26,${0.04 + r() * 0.1})`
    const sz = 1 + r() * 3
    ctx.fillRect(r() * w, r() * h, sz, sz)
  }
  for (let i = 0; i < 5 * amount; i++) {
    const x = r() * w
    const g = ctx.createLinearGradient(x, 0, x, h)
    g.addColorStop(0, `rgba(110,70,40,${0.08 * amount})`)
    g.addColorStop(1, 'rgba(110,70,40,0)')
    ctx.fillStyle = g
    ctx.fillRect(x, 0, 2 + r() * 4, h * (0.3 + r() * 0.7))
  }
}

/** Single-cell canvas texture (dynamic boards: scoreboard, monitors). */
export function makeCanvasTexture(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; texture: THREE.CanvasTexture } {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return { canvas, ctx, texture }
}
