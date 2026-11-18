import * as THREE from 'three'
import { FONT_DISPLAY, FONT_MONO } from './fonts'

/**
 * Canvas-texture helpers for station signage, screens and paper art.
 * Every texture made here is owned by the component that created it and
 * disposed on unmount (see useDisposable in ./hooks).
 */
export type Ctx = CanvasRenderingContext2D

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

export function canvasTexture(canvas: HTMLCanvasElement, opts: { anisotropy?: number; mipmaps?: boolean } = {}): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = opts.anisotropy ?? 4
  t.generateMipmaps = opts.mipmaps ?? true
  t.minFilter = t.generateMipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter
  t.magFilter = THREE.LinearFilter
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  return t
}

export function font(px: number, weight: 600 | 700 = 700, mono = false): string {
  return `${weight} ${Math.max(1, Math.round(px))}px ${mono ? FONT_MONO : FONT_DISPLAY}`
}

/** Fill text shrunk (never grown) to fit `maxW`. Returns the font size used. */
export function fitText(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  maxW: number,
  px: number,
  opts: { weight?: 600 | 700; mono?: boolean; align?: CanvasTextAlign; baseline?: CanvasTextBaseline; color?: string; tracking?: number } = {},
): number {
  let size = px
  ctx.font = font(size, opts.weight ?? 700, opts.mono)
  const track = opts.tracking ?? 0
  const measure = () => ctx.measureText(text).width + track * size * Math.max(0, text.length - 1)
  let w = measure()
  if (w > maxW && w > 0) {
    size = Math.max(4, Math.floor(size * (maxW / w)))
    ctx.font = font(size, opts.weight ?? 700, opts.mono)
    w = measure()
  }
  ctx.textAlign = opts.align ?? 'center'
  ctx.textBaseline = opts.baseline ?? 'middle'
  if (opts.color) ctx.fillStyle = opts.color
  if (track && 'letterSpacing' in ctx) {
    ;(ctx as Ctx & { letterSpacing: string }).letterSpacing = `${track * size}px`
    ctx.fillText(text, x, y)
    ;(ctx as Ctx & { letterSpacing: string }).letterSpacing = '0px'
  } else ctx.fillText(text, x, y)
  return size
}

/** Greedy word wrap with the current ctx.font. */
export function wrapLines(ctx: Ctx, text: string, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (ctx.measureText(next).width <= maxW || !cur) cur = next
    else {
      lines.push(cur)
      cur = w
    }
  }
  if (cur) lines.push(cur)
  return lines
}

/**
 * Wrap `text` into at most `maxLines` lines inside `maxW`, shrinking the font
 * from `px` until it fits. Returns the chosen size and lines.
 */
export function fitWrapped(ctx: Ctx, text: string, maxW: number, maxLines: number, px: number, weight: 600 | 700 = 700, mono = false): { size: number; lines: string[] } {
  let size = px
  for (let i = 0; i < 24; i++) {
    ctx.font = font(size, weight, mono)
    const lines = wrapLines(ctx, text, maxW)
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxW)) return { size, lines }
    size = Math.max(6, Math.floor(size * 0.92))
  }
  ctx.font = font(size, weight, mono)
  return { size, lines: wrapLines(ctx, text, maxW).slice(0, maxLines) }
}

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/** Little dome rivets in the corners of a plate. */
export function rivets(ctx: Ctx, x: number, y: number, w: number, h: number, inset: number, r: number, color = '#2a2f30'): void {
  const pts: [number, number][] = [
    [x + inset, y + inset],
    [x + w - inset, y + inset],
    [x + inset, y + h - inset],
    [x + w - inset, y + h - inset],
  ]
  for (const [px, py] of pts) {
    const g = ctx.createRadialGradient(px - r * 0.3, py - r * 0.3, r * 0.1, px, py, r)
    g.addColorStop(0, '#d9dcd6')
    g.addColorStop(0.6, color)
    g.addColorStop(1, '#111')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(px, py, r, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** Diagonal hazard stripes inside a rect. */
export function hazardBand(ctx: Ctx, x: number, y: number, w: number, h: number, a = '#E9B63F', b = '#1d2122', step = 0): void {
  const s = step || h * 1.2
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.fillStyle = a
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = b
  for (let i = -h * 2; i < w + h * 2; i += s * 2) {
    ctx.beginPath()
    ctx.moveTo(x + i, y + h)
    ctx.lineTo(x + i + s, y + h)
    ctx.lineTo(x + i + s + h, y)
    ctx.lineTo(x + i + h, y)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

/** Speckle/grime overlay (deterministic). */
export function grime(ctx: Ctx, x: number, y: number, w: number, h: number, seed: number, amount = 0.08, count = 400): void {
  let s = seed >>> 0 || 1
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  for (let i = 0; i < count; i++) {
    const v = rnd() < 0.5 ? 30 : 230
    ctx.fillStyle = `rgba(${v},${v - 4},${v - 10},${amount * (0.3 + rnd())})`
    const sz = 1 + rnd() * 2.5
    ctx.fillRect(x + rnd() * w, y + rnd() * h, sz, sz)
  }
}

// ---------------------------------------------------------------------------
// Tiny shelf-packing atlas
// ---------------------------------------------------------------------------

export interface AtlasItem {
  key: string
  w: number
  h: number
  /** Draw into (0,0,w,h) — the context is translated & clipped for you. */
  draw: (ctx: Ctx, w: number, h: number) => void
}

export interface AtlasCell {
  /** [u0, v0, u1, v1] with v up (three.js convention). */
  uv: [number, number, number, number]
  px: [number, number, number, number]
}

export interface Atlas {
  canvas: HTMLCanvasElement
  texture: THREE.CanvasTexture
  cells: Record<string, AtlasCell>
}

/** Pack items into a canvas of fixed width (height = next power of two). 2 px gutters. */
export function buildAtlas(items: AtlasItem[], width = 1024, opts: { anisotropy?: number; scale?: number } = {}): Atlas {
  const scale = opts.scale ?? 1
  const pad = 3
  const sorted = [...items].sort((a, b) => b.h - a.h)
  const placed: { item: AtlasItem; x: number; y: number; w: number; h: number }[] = []
  let x = pad
  let y = pad
  let rowH = 0
  for (const it of sorted) {
    const w = Math.ceil(it.w * scale)
    const h = Math.ceil(it.h * scale)
    if (x + w + pad > width) {
      x = pad
      y += rowH + pad
      rowH = 0
    }
    placed.push({ item: it, x, y, w, h })
    x += w + pad
    rowH = Math.max(rowH, h)
  }
  const used = y + rowH + pad
  let height = 64
  while (height < used) height *= 2
  const canvas = makeCanvas(width, height)
  const ctx = canvas.getContext('2d')!
  const cells: Record<string, AtlasCell> = {}
  for (const p of placed) {
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.beginPath()
    ctx.rect(0, 0, p.w, p.h)
    ctx.clip()
    ctx.scale(scale, scale)
    p.item.draw(ctx, p.item.w, p.item.h)
    ctx.restore()
    // half-texel inset avoids bleeding from neighbours
    const u0 = (p.x + 0.5) / width
    const u1 = (p.x + p.w - 0.5) / width
    const v1 = 1 - (p.y + 0.5) / height
    const v0 = 1 - (p.y + p.h - 0.5) / height
    cells[p.item.key] = { uv: [u0, v0, u1, v1], px: [p.x, p.y, p.w, p.h] }
  }
  const texture = canvasTexture(canvas, { anisotropy: opts.anisotropy ?? 8 })
  return { canvas, texture, cells }
}
