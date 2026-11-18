/**
 * Canvas-drawn art for the safety module: hatch lid stencil, comic text bursts,
 * the "NIGHT SHIFT — DO NOT TEST" sign and the pedestal status display.
 * Fonts are the locally bundled families (@fontsource Barlow Condensed / IBM Plex
 * Mono, loaded by the app CSS) — never remote. Textures are drawn immediately
 * with fallbacks and redrawn once the fonts are ready. Cached for the app
 * lifetime (like world/materials.ts); never dispose them.
 */
import * as THREE from 'three'
import { PALETTE } from '@/world/palette'

export const FONT_DISPLAY = '"Barlow Condensed", "MIW Barlow", "Arial Narrow", "Helvetica Neue", sans-serif'
export const FONT_MONO = '"IBM Plex Mono", "MIW Plex", "Courier New", monospace'

let fontPromise: Promise<void> | null = null

/** Resolves when the sign fonts are usable (or after 3 s / on failure). Never rejects. */
export function loadSafetyFonts(): Promise<void> {
  if (fontPromise) return fontPromise
  fontPromise = new Promise<void>((resolve) => {
    try {
      if (typeof document === 'undefined' || !document.fonts || typeof document.fonts.load !== 'function') {
        resolve()
        return
      }
      const timer = setTimeout(resolve, 3000)
      Promise.all([
        document.fonts.load(`700 64px ${FONT_DISPLAY}`),
        document.fonts.load(`600 64px ${FONT_DISPLAY}`),
        document.fonts.load(`600 32px ${FONT_MONO}`),
      ]).then(
        () => {
          clearTimeout(timer)
          resolve()
        },
        () => {
          clearTimeout(timer)
          resolve()
        },
      )
    } catch {
      resolve()
    }
  })
  return fontPromise
}

export interface CanvasArt {
  texture: THREE.CanvasTexture
  /** Redraw (e.g. new status text). */
  redraw(): void
}

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void

const artCache = new Map<string, CanvasArt>()

/** Cached canvas texture; returns null where no 2D canvas exists (tests / headless without canvas). */
export function canvasArt(key: string, w: number, h: number, draw: Draw, opts: { srgb?: boolean; mipmaps?: boolean } = {}): CanvasArt | null {
  const cached = artCache.get(key)
  if (cached) return cached
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  let ctx: CanvasRenderingContext2D | null = null
  try {
    ctx = canvas.getContext('2d')
  } catch {
    ctx = null
  }
  if (!ctx) return null
  const c = ctx
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace
  texture.anisotropy = 4
  if (opts.mipmaps === false) {
    texture.generateMipmaps = false
    texture.minFilter = THREE.LinearFilter
  }
  const art: CanvasArt = {
    texture,
    redraw: () => {
      c.save()
      c.clearRect(0, 0, w, h)
      try {
        draw(c, w, h)
      } catch (err) {
        console.error('[safety] canvas art failed', key, err)
      }
      c.restore()
      texture.needsUpdate = true
    },
  }
  art.redraw()
  artCache.set(key, art)
  void loadSafetyFonts().then(() => art.redraw())
  return art
}

/** Deterministic pseudo-random for paint wear. */
function rand(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hazardBand(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, stripe = 22): void {
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.fillStyle = PALETTE.hazard
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = '#1b1d1e'
  for (let i = -h * 2; i < w + h * 2; i += stripe * 2) {
    ctx.beginPath()
    ctx.moveTo(x + i, y + h)
    ctx.lineTo(x + i + stripe, y + h)
    ctx.lineTo(x + i + stripe + h, y)
    ctx.lineTo(x + i + h, y)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Hatch lid: cast-steel disc, yellow safety ring, "SAFETY HATCH" stencil
// ---------------------------------------------------------------------------

export function lidArt(): CanvasArt | null {
  return canvasArt('safety:lid', 256, 256, (ctx, w) => {
    const c = w / 2
    const r = rand(13)
    ctx.fillStyle = '#41484a'
    ctx.fillRect(0, 0, w, w)
    // yellow painted ring with chips
    ctx.lineWidth = 22
    ctx.strokeStyle = PALETTE.hazard
    ctx.beginPath()
    ctx.arc(c, c, c - 14, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = '#2b3031'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(c, c, c - 26, 0, Math.PI * 2)
    ctx.stroke()
    // raised concentric rings + diamond studs
    ctx.strokeStyle = 'rgba(160,170,170,0.35)'
    ctx.lineWidth = 4
    for (const rr of [c - 46, c - 84]) {
      ctx.beginPath()
      ctx.arc(c, c, rr, 0, Math.PI * 2)
      ctx.stroke()
    }
    for (let yy = 24; yy < w; yy += 16) {
      for (let xx = 24 + ((yy / 16) % 2) * 8; xx < w; xx += 16) {
        const d = Math.hypot(xx - c, yy - c)
        if (d > c - 32 || (d > c - 92 && d < c - 40)) continue
        ctx.fillStyle = 'rgba(150,160,160,0.28)'
        ctx.fillRect(xx - 2, yy - 2, 4, 4)
      }
    }
    // bolt heads in the ring
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.2
      const bx = c + Math.cos(a) * (c - 14)
      const by = c + Math.sin(a) * (c - 14)
      ctx.fillStyle = '#2a2e2f'
      ctx.beginPath()
      ctx.arc(bx, by, 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#9aa3a3'
      ctx.beginPath()
      ctx.arc(bx - 1, by - 1, 3, 0, Math.PI * 2)
      ctx.fill()
    }
    // stencil text
    ctx.fillStyle = PALETTE.hazard
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `700 46px ${FONT_DISPLAY}`
    ctx.fillText('SAFETY', c, c - 22)
    ctx.font = `700 34px ${FONT_DISPLAY}`
    ctx.fillText('HATCH', c, c + 20)
    ctx.font = `600 15px ${FONT_DISPLAY}`
    ctx.fillStyle = 'rgba(233,182,63,0.85)'
    ctx.fillText('INSPECTOR ACCESS ONLY', c, c + 52)
    // wear
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(25,28,29,${0.08 + r() * 0.25})`
      ctx.fillRect(r() * w, r() * w, 1 + r() * 3, 1 + r() * 2)
    }
    for (let i = 0; i < 160; i++) {
      ctx.fillStyle = `rgba(170,110,60,${0.05 + r() * 0.12})`
      ctx.fillRect(r() * w, r() * w, 2 + r() * 5, 1 + r() * 3)
    }
  })
}

// ---------------------------------------------------------------------------
// Comic bursts over the inspector's head
// ---------------------------------------------------------------------------

function burst(ctx: CanvasRenderingContext2D, w: number, h: number, fill: string, text: string, size: number, seed: number): void {
  const r = rand(seed)
  const cx = w / 2
  const cy = h / 2
  const spikes = 16
  ctx.beginPath()
  for (let i = 0; i <= spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2
    const out = i % 2 === 0
    const rx = (out ? w * 0.49 : w * 0.37) * (0.94 + r() * 0.08)
    const ry = (out ? h * 0.48 : h * 0.33) * (0.94 + r() * 0.08)
    const x = cx + Math.cos(a) * rx
    const y = cy + Math.sin(a) * ry
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.lineJoin = 'round'
  ctx.lineWidth = 9
  ctx.strokeStyle = '#1b1d1e'
  ctx.stroke()
  ctx.fillStyle = fill
  ctx.fill()
  ctx.save()
  ctx.translate(cx, cy + 2)
  ctx.rotate(-0.08)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 ${size}px ${FONT_DISPLAY}`
  ctx.lineWidth = 10
  ctx.strokeStyle = '#fff6dc'
  ctx.strokeText(text, 0, 0)
  ctx.fillStyle = '#1b1d1e'
  ctx.fillText(text, 0, 0)
  ctx.restore()
}

export function tweetArt(): CanvasArt | null {
  return canvasArt('safety:tweet', 320, 160, (ctx, w, h) => burst(ctx, w, h, '#FFD84A', 'TWEEEET!', 70, 3), { mipmaps: false })
}

export function whumpArt(): CanvasArt | null {
  return canvasArt('safety:whump', 320, 160, (ctx, w, h) => burst(ctx, w, h, '#FF8A3D', 'WHUMP!', 80, 9), { mipmaps: false })
}

// ---------------------------------------------------------------------------
// Night Shift sign + status display
// ---------------------------------------------------------------------------

export function signArt(): CanvasArt | null {
  return canvasArt('safety:nightSign', 512, 320, (ctx, w, h) => {
    ctx.fillStyle = '#1b1d1e'
    ctx.fillRect(0, 0, w, h)
    hazardBand(ctx, 8, 8, w - 16, 26)
    hazardBand(ctx, 8, h - 34, w - 16, 26)
    ctx.fillStyle = PALETTE.hazard
    ctx.fillRect(14, 40, w - 28, 150)
    ctx.fillStyle = '#1b1d1e'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `700 118px ${FONT_DISPLAY}`
    ctx.fillText('NIGHT SHIFT', w / 2, 118, w - 52)
    // red band
    ctx.fillStyle = PALETTE.signalRed
    ctx.fillRect(14, 196, w - 28, 58)
    ctx.fillStyle = '#fff6dc'
    ctx.font = `700 52px ${FONT_DISPLAY}`
    ctx.fillText('— DO NOT TEST —', w / 2, 227, w - 60)
    ctx.fillStyle = PALETTE.cream
    ctx.font = `600 17px ${FONT_DISPLAY}`
    ctx.fillText('AUTHORIZED NIGHT SHIFT SUPERVISORS ONLY  ·  THERE ARE NONE', w / 2, 271, w - 40)
    // grime
    const r = rand(77)
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = `rgba(60,45,30,${0.04 + r() * 0.1})`
      ctx.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 2)
    }
    const g = ctx.createLinearGradient(0, h * 0.65, 0, h)
    g.addColorStop(0, 'rgba(70,50,30,0)')
    g.addColorStop(1, 'rgba(70,50,30,0.25)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  })
}

export interface StatusLine {
  text: string
  color: string
}

const statusState: { line: StatusLine } = { line: { text: 'READY', color: '#5DFF7A' } }

/** Pedestal LED display; call setStatus() to change the text (redraws only on change). */
export function statusArt(): CanvasArt | null {
  return canvasArt(
    'safety:status',
    256,
    64,
    (ctx, w, h) => {
      ctx.fillStyle = '#0b0f0f'
      ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = '#2a3132'
      ctx.lineWidth = 4
      ctx.strokeRect(2, 2, w - 4, h - 4)
      const { text, color } = statusState.line
      ctx.font = `600 30px ${FONT_MONO}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.shadowColor = color
      ctx.shadowBlur = 10
      ctx.fillStyle = color
      ctx.fillText(text, w / 2, h / 2 + 1, w - 20)
      ctx.shadowBlur = 0
      // scanlines
      ctx.fillStyle = 'rgba(0,0,0,0.22)'
      for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1)
    },
    { mipmaps: false },
  )
}

export function setStatus(text: string, color: string): void {
  const cur = statusState.line
  if (cur.text === text && cur.color === color) return
  statusState.line = { text, color }
  artCache.get('safety:status')?.redraw()
}
