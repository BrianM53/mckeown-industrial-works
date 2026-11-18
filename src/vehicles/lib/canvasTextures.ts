import * as THREE from 'three'
import { PALETTE } from '@/world/palette'
import { STENCIL_FONT, loadVehicleFont } from './fonts'

/**
 * Canvas-painted textures (created once, app lifetime). Each is painted
 * immediately with the fallback font stack and repainted when the local
 * display font has loaded.
 */
type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number) => void

function canvasTexture(w: number, h: number, paint: Painter, srgb = true): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  const tex = new THREE.CanvasTexture(canvas)
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  if (!ctx) return tex
  const run = () => {
    try {
      ctx.clearRect(0, 0, w, h)
      paint(ctx, w, h)
      tex.needsUpdate = true
    } catch {
      /* never break the scene over a texture */
    }
  }
  run()
  void loadVehicleFont().then((ok) => {
    if (ok) run()
  })
  return tex
}

/** Deterministic pseudo random for paint speckles. */
function rnd(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function font(px: number): string {
  return `700 ${px}px ${STENCIL_FONT}`
}

/** Fit text to a width by shrinking the font size. */
function fitText(ctx: CanvasRenderingContext2D, text: string, px: number, maxWidth: number): number {
  let size = px
  ctx.font = font(size)
  while (size > 8 && ctx.measureText(text).width > maxWidth) {
    size -= 2
    ctx.font = font(size)
  }
  return size
}

/** Stencil look: paint text, then cut thin vertical "bridges" through it. */
function stencilText(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, px: number, maxWidth: number, color: string, spacing = 0.06) {
  ctx.save()
  const size = fitText(ctx, text, px, maxWidth)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = color
  try {
    ;(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${Math.round(size * spacing)}px`
  } catch {
    /* older canvas */
  }
  ctx.fillText(text, cx, cy)
  const width = Math.min(maxWidth, ctx.measureText(text).width)
  // bridges every ~0.55 em
  ctx.globalCompositeOperation = 'destination-out'
  const step = size * 0.55
  for (let x = cx - width / 2 + step * 0.45; x < cx + width / 2; x += step) ctx.fillRect(Math.round(x), cy - size * 0.1, Math.max(2, size * 0.05), size * 0.2)
  ctx.globalCompositeOperation = 'source-over'
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Forklift decal atlas (1024 × 512)
// ---------------------------------------------------------------------------

/** UV rects [u0, v0, u1, v1] (v from the bottom) of the decal atlas cells. */
export const DECAL_UV = {
  /** "COMPANY PROPERTY" + unit number (1024 × 200 px). */
  property: [0, 1 - 200 / 512, 1, 1] as [number, number, number, number],
  /** Black/yellow chevrons (1024 × 96 px). */
  chevrons: [0, 1 - 312 / 512, 1, 1 - 216 / 512] as [number, number, number, number],
  /** Dents & scuffs: four 256 × 192 cells. */
  dent: (i: number): [number, number, number, number] => [(i % 4) / 4, 0, (i % 4) / 4 + 0.25, 192 / 512],
}

const paintDecals: Painter = (ctx) => {
  // --- property stencil (soot black, slightly worn)
  stencilText(ctx, 'COMPANY PROPERTY', 512, 78, 128, 980, '#1E2121', 0.05)
  stencilText(ctx, 'UNIT 07  ·  DO NOT FEED', 512, 165, 46, 700, '#1E2121', 0.12)
  // wear: knock specks out of the stencil
  const r = rnd(7)
  ctx.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.35 + r() * 0.6})`
    ctx.fillRect(r() * 1024, r() * 200, 1 + r() * 4, 1 + r() * 3)
  }
  ctx.globalCompositeOperation = 'source-over'

  // --- chevrons (opaque) with a scuffed edge
  const y0 = 216
  const h = 96
  ctx.fillStyle = PALETTE.hazard
  ctx.fillRect(0, y0, 1024, h)
  ctx.fillStyle = '#1A1E1F'
  for (let x = -h; x < 1024 + h; x += 96) {
    ctx.beginPath()
    ctx.moveTo(x, y0)
    ctx.lineTo(x + 48, y0)
    ctx.lineTo(x + 48 - h, y0 + h)
    ctx.lineTo(x - h, y0 + h)
    ctx.closePath()
    ctx.fill()
  }
  for (let i = 0; i < 500; i++) {
    const v = 150 + Math.floor(r() * 90)
    ctx.fillStyle = `rgba(${v},${v - 10},${v - 30},${0.25 + r() * 0.35})`
    ctx.fillRect(r() * 1024, y0 + r() * h, 1 + r() * 5, 1 + r() * 2)
  }

  // --- dents & scuffs: dark crumple + crescent highlight + scratches
  for (let i = 0; i < 4; i++) {
    const cx = i * 256 + 128
    const cy = 512 - 96
    const rx = 70 + r() * 30
    const ry = 42 + r() * 22
    const g = ctx.createRadialGradient(cx + 8, cy + 6, 4, cx, cy, rx)
    g.addColorStop(0, 'rgba(40,30,15,0.62)')
    g.addColorStop(0.55, 'rgba(60,45,20,0.32)')
    g.addColorStop(1, 'rgba(60,45,20,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.ellipse(cx, cy, rx, ry, (r() - 0.5) * 0.8, 0, Math.PI * 2)
    ctx.fill()
    // highlight on the upper lip of the dent
    ctx.strokeStyle = 'rgba(255,240,200,0.45)'
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.ellipse(cx - 4, cy - 4, rx * 0.72, ry * 0.62, 0, Math.PI * 1.1, Math.PI * 1.85)
    ctx.stroke()
    // bare-metal scratches
    ctx.strokeStyle = 'rgba(205,205,195,0.7)'
    ctx.lineWidth = 2
    for (let k = 0; k < 6; k++) {
      const sx = cx - rx + r() * rx * 2
      const sy = cy - ry + r() * ry * 2
      ctx.beginPath()
      ctx.moveTo(sx, sy)
      ctx.lineTo(sx + 30 + r() * 50, sy + (r() - 0.5) * 18)
      ctx.stroke()
    }
    // rust freckles
    for (let k = 0; k < 40; k++) {
      ctx.fillStyle = `rgba(150,75,35,${0.25 + r() * 0.4})`
      ctx.fillRect(cx - rx + r() * rx * 2, cy - ry + r() * ry * 2, 2 + r() * 3, 2 + r() * 3)
    }
  }
}

let decalTex: THREE.CanvasTexture | null = null
export function forkliftDecalTexture(): THREE.CanvasTexture {
  if (!decalTex) decalTex = canvasTexture(1024, 512, paintDecals)
  return decalTex
}

// ---------------------------------------------------------------------------
// Tutorial sign face (512 × 768)
// ---------------------------------------------------------------------------

const ROWS: Array<{ keys: string[]; text: string; sub?: string; warn?: boolean }> = [
  { keys: ['E'], text: 'DRIVE' },
  { keys: ['W', 'S'], text: 'THROTTLE' },
  { keys: ['A', 'D'], text: 'STEER' },
  { keys: ['H'], text: 'HORN' },
  { keys: ['E'], text: 'EXIT' },
  { keys: ['R'], text: 'IF YOU FLIP IT', sub: '(YOU WILL)', warn: true },
]

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function keyCap(ctx: CanvasRenderingContext2D, x: number, y: number, label: string) {
  const w = 62
  const h = 58
  ctx.fillStyle = '#121515'
  roundRect(ctx, x, y + 5, w, h, 9)
  ctx.fill()
  ctx.fillStyle = PALETTE.charcoal
  roundRect(ctx, x, y, w, h, 9)
  ctx.fill()
  ctx.strokeStyle = '#59605F'
  ctx.lineWidth = 3
  roundRect(ctx, x + 2, y + 2, w - 4, h - 4, 7)
  ctx.stroke()
  ctx.fillStyle = PALETTE.cream
  ctx.font = font(42)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, x + w / 2, y + h / 2 + 2)
}

const paintSign: Painter = (ctx, W, H) => {
  const r = rnd(19)
  // board
  ctx.fillStyle = PALETTE.cream
  ctx.fillRect(0, 0, W, H)
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(90,80,62,${0.03 + r() * 0.06})`
    ctx.fillRect(r() * W, r() * H, 1 + r() * 3, 1 + r() * 3)
  }
  const grime = ctx.createLinearGradient(0, H * 0.75, 0, H)
  grime.addColorStop(0, 'rgba(80,60,40,0)')
  grime.addColorStop(1, 'rgba(80,60,40,0.18)')
  ctx.fillStyle = grime
  ctx.fillRect(0, 0, W, H)

  // header: hazard stripe + yellow band
  ctx.fillStyle = PALETTE.hazard
  ctx.fillRect(0, 0, W, 176)
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, W, 26)
  ctx.clip()
  ctx.fillStyle = '#1A1E1F'
  for (let x = -40; x < W + 40; x += 36) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x + 18, 0)
    ctx.lineTo(x + 18 - 26, 26)
    ctx.lineTo(x - 26, 26)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
  ctx.fillStyle = '#1A1E1F'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  fitText(ctx, 'FORKLIFT', 92, W - 60)
  ctx.fillText('FORKLIFT', W / 2, 84)
  fitText(ctx, 'OPERATION', 50, W - 60)
  try {
    ;(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '6px'
  } catch {
    /* ignore */
  }
  ctx.fillText('OPERATION', W / 2, 146)
  try {
    ;(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px'
  } catch {
    /* ignore */
  }

  // rows
  const top = 204
  const rowH = 80
  ROWS.forEach((row, i) => {
    const y = top + i * rowH
    if (i > 0) {
      ctx.fillStyle = 'rgba(37,43,43,0.18)'
      ctx.fillRect(30, y - 10, W - 60, 2)
    }
    let x = 34
    row.keys.forEach((k, j) => {
      if (j > 0) {
        ctx.fillStyle = PALETTE.charcoal
        ctx.font = font(36)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('/', x + 10, y + 31)
        x += 22
      }
      keyCap(ctx, x, y, k)
      x += 70
    })
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = row.warn ? PALETTE.signalRed : PALETTE.charcoal
    const tx = 210
    if (row.sub) {
      fitText(ctx, row.text, 44, W - tx - 24)
      ctx.fillText(row.text, tx, y + 18)
      ctx.fillStyle = PALETTE.rust
      fitText(ctx, row.sub, 30, W - tx - 24)
      ctx.fillText(row.sub, tx, y + 52)
    } else {
      fitText(ctx, row.text, 48, W - tx - 24)
      ctx.fillText(row.text, tx, y + 32)
    }
  })

  // footer
  ctx.fillStyle = PALETTE.charcoal
  ctx.fillRect(0, H - 62, W, 62)
  ctx.fillStyle = PALETTE.hazard
  ctx.textAlign = 'center'
  fitText(ctx, 'THE DENTS ARE COMPANY CULTURE', 30, W - 48)
  ctx.fillText('THE DENTS ARE COMPANY CULTURE', W / 2, H - 30)

  // frame
  ctx.strokeStyle = PALETTE.charcoal
  ctx.lineWidth = 10
  ctx.strokeRect(5, 5, W - 10, H - 10)
  // bolt heads
  ctx.fillStyle = '#7D8A8C'
  for (const [bx, by] of [
    [22, 196],
    [W - 22, 196],
    [22, H - 82],
    [W - 22, H - 82],
  ] as [number, number][]) {
    ctx.beginPath()
    ctx.arc(bx, by, 6, 0, Math.PI * 2)
    ctx.fill()
  }
}

let signTex: THREE.CanvasTexture | null = null
export function tutorialSignTexture(): THREE.CanvasTexture {
  if (!signTex) signTex = canvasTexture(512, 768, paintSign)
  return signTex
}
