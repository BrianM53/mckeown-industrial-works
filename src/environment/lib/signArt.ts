/**
 * Canvas artwork for signage, posters and floor stencils. All drawing is in a
 * cell-local logical coordinate space (0..w, 0..h). Fonts are the local
 * Barlow Condensed / IBM Plex Mono faces (see fonts.ts).
 */
import { createRng } from '@/core/rng'
import type { PosterDef, PosterIcon } from '../data/text'
import { FONT_DISPLAY, FONT_MONO } from './fonts'

type Ctx = CanvasRenderingContext2D

export const INK = '#1E2323'
export const CREAM = '#EAE3D2'
export const PANEL = '#232A2A'
export const HAZARD = '#E9B63F'

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2)
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

function setFont(ctx: Ctx, size: number, weight: number, family: string): void {
  ctx.font = `${weight} ${Math.max(4, Math.round(size))}px ${family}`
}

function setSpacing(ctx: Ctx, px: number): void {
  const c = ctx as Ctx & { letterSpacing?: string }
  if ('letterSpacing' in c) c.letterSpacing = `${px}px`
}

export interface TextOpts {
  size: number
  color: string
  weight?: number
  family?: string
  align?: CanvasTextAlign
  baseline?: CanvasTextBaseline
  maxW?: number
  spacing?: number
}

/** Draw a single line, shrinking it to fit maxW. Returns the font size used. */
export function text(ctx: Ctx, str: string, x: number, y: number, o: TextOpts): number {
  const weight = o.weight ?? 700
  const family = o.family ?? FONT_DISPLAY
  let size = o.size
  setSpacing(ctx, o.spacing ?? 0)
  setFont(ctx, size, weight, family)
  if (o.maxW) {
    let guard = 0
    while (ctx.measureText(str).width > o.maxW && size > 6 && guard++ < 200) {
      size *= 0.95
      setFont(ctx, size, weight, family)
    }
  }
  ctx.fillStyle = o.color
  ctx.textAlign = o.align ?? 'left'
  ctx.textBaseline = o.baseline ?? 'middle'
  ctx.fillText(str, x, y)
  setSpacing(ctx, 0)
  return size
}

/** Word-wrap into at most `maxLines` lines of width maxW; returns lines. */
export function wrap(ctx: Ctx, str: string, maxW: number, size: number, weight = 700, family = FONT_DISPLAY): string[] {
  setFont(ctx, size, weight, family)
  const words = str.split(/\s+/)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w
    if (ctx.measureText(test).width > maxW && cur) {
      lines.push(cur)
      cur = w
    } else cur = test
  }
  if (cur) lines.push(cur)
  return lines
}

function rivets(ctx: Ctx, w: number, h: number, inset: number, r: number, color = 'rgba(255,255,255,0.35)'): void {
  for (const [x, y] of [
    [inset, inset],
    [w - inset, inset],
    [inset, h - inset],
    [w - inset, h - inset],
  ]) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.beginPath()
    ctx.arc(x + r * 0.25, y + r * 0.25, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
}

function grime(ctx: Ctx, w: number, h: number, seed: number, amount = 1): void {
  const r = createRng(seed)
  for (let i = 0; i < 40 * amount; i++) {
    ctx.fillStyle = `rgba(60,45,30,${0.03 + r() * 0.05})`
    const x = r() * w
    const y = r() * h
    ctx.beginPath()
    ctx.arc(x, y, 2 + r() * 14, 0, Math.PI * 2)
    ctx.fill()
  }
  const g = ctx.createLinearGradient(0, h * 0.65, 0, h)
  g.addColorStop(0, 'rgba(70,50,30,0)')
  g.addColorStop(1, `rgba(70,50,30,${0.18 * amount})`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}

function hazardBand(ctx: Ctx, x: number, y: number, w: number, h: number, stripe = 24): void {
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.fillStyle = HAZARD
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = '#1b1d1d'
  for (let i = -h; i < w + h; i += stripe * 2) {
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

/** Contrasting text color for a background. */
export function inkOn(bg: string): string {
  const c = bg.replace('#', '')
  const r = parseInt(c.slice(0, 2), 16)
  const g = parseInt(c.slice(2, 4), 16)
  const b = parseInt(c.slice(4, 6), 16)
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? INK : CREAM
}

// ---------------------------------------------------------------------------
// Arrows & pictograms
// ---------------------------------------------------------------------------

export function arrowPath(ctx: Ctx, cx: number, cy: number, size: number, dir: 'left' | 'right' | 'up' | 'down'): void {
  const a = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 }[dir]
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(a)
  const s = size / 2
  ctx.beginPath()
  ctx.moveTo(0, -s)
  ctx.lineTo(s * 0.92, -s * 0.05)
  ctx.lineTo(s * 0.34, -s * 0.05)
  ctx.lineTo(s * 0.34, s)
  ctx.lineTo(-s * 0.34, s)
  ctx.lineTo(-s * 0.34, -s * 0.05)
  ctx.lineTo(-s * 0.92, -s * 0.05)
  ctx.closePath()
  ctx.restore()
}

export function icon(ctx: Ctx, kind: PosterIcon, cx: number, cy: number, size: number, color: string): void {
  const s = size / 2
  ctx.save()
  ctx.translate(cx, cy)
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.lineWidth = size * 0.08
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  switch (kind) {
    case 'hardhat': {
      ctx.beginPath()
      ctx.arc(0, s * 0.25, s * 0.72, Math.PI, 0)
      ctx.fill()
      ctx.fillRect(-s * 0.95, s * 0.2, s * 1.9, s * 0.2)
      ctx.fillRect(-s * 0.1, -s * 0.55, s * 0.2, s * 0.4)
      break
    }
    case 'warning': {
      ctx.beginPath()
      ctx.moveTo(0, -s * 0.9)
      ctx.lineTo(s * 0.95, s * 0.75)
      ctx.lineTo(-s * 0.95, s * 0.75)
      ctx.closePath()
      ctx.lineWidth = size * 0.1
      ctx.stroke()
      ctx.fillRect(-s * 0.08, -s * 0.35, s * 0.16, s * 0.65)
      ctx.beginPath()
      ctx.arc(0, s * 0.5, s * 0.1, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'rocket': {
      ctx.rotate(-0.6)
      ctx.beginPath()
      ctx.moveTo(0, -s)
      ctx.quadraticCurveTo(s * 0.42, -s * 0.5, s * 0.3, s * 0.45)
      ctx.lineTo(-s * 0.3, s * 0.45)
      ctx.quadraticCurveTo(-s * 0.42, -s * 0.5, 0, -s)
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(s * 0.3, s * 0.1)
      ctx.lineTo(s * 0.6, s * 0.65)
      ctx.lineTo(s * 0.25, s * 0.45)
      ctx.moveTo(-s * 0.3, s * 0.1)
      ctx.lineTo(-s * 0.6, s * 0.65)
      ctx.lineTo(-s * 0.25, s * 0.45)
      ctx.fill()
      ctx.globalAlpha = 0.7
      ctx.beginPath()
      ctx.moveTo(-s * 0.2, s * 0.5)
      ctx.lineTo(0, s * 1.0)
      ctx.lineTo(s * 0.2, s * 0.5)
      ctx.fill()
      break
    }
    case 'forklift': {
      ctx.fillRect(-s * 0.7, -s * 0.1, s * 1.0, s * 0.55)
      ctx.fillRect(-s * 0.55, -s * 0.6, s * 0.08, s * 0.55)
      ctx.fillRect(-s * 0.05, -s * 0.6, s * 0.08, s * 0.55)
      ctx.fillRect(-s * 0.55, -s * 0.65, s * 0.58, s * 0.08)
      ctx.fillRect(s * 0.38, -s * 0.85, s * 0.1, s * 1.3)
      ctx.fillRect(s * 0.38, s * 0.35, s * 0.6, s * 0.08)
      ctx.beginPath()
      ctx.arc(-s * 0.45, s * 0.5, s * 0.2, 0, Math.PI * 2)
      ctx.arc(s * 0.15, s * 0.5, s * 0.2, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'bolt': {
      ctx.beginPath()
      ctx.moveTo(s * 0.15, -s)
      ctx.lineTo(-s * 0.55, s * 0.12)
      ctx.lineTo(-s * 0.05, s * 0.12)
      ctx.lineTo(-s * 0.25, s)
      ctx.lineTo(s * 0.6, -s * 0.2)
      ctx.lineTo(s * 0.08, -s * 0.2)
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'eye': {
      ctx.beginPath()
      ctx.moveTo(-s, 0)
      ctx.quadraticCurveTo(0, -s * 0.85, s, 0)
      ctx.quadraticCurveTo(0, s * 0.85, -s, 0)
      ctx.lineWidth = size * 0.08
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(0, 0, s * 0.3, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'cup': {
      ctx.fillRect(-s * 0.55, -s * 0.35, s * 0.85, s * 0.95)
      ctx.beginPath()
      ctx.arc(s * 0.38, s * 0.1, s * 0.25, -Math.PI / 2, Math.PI / 2)
      ctx.lineWidth = size * 0.08
      ctx.stroke()
      ctx.lineWidth = size * 0.05
      for (const dx of [-0.3, 0, 0.3]) {
        ctx.beginPath()
        ctx.moveTo(s * dx - s * 0.1, -s * 0.5)
        ctx.quadraticCurveTo(s * dx + s * 0.1, -s * 0.7, s * dx - s * 0.05, -s * 0.95)
        ctx.stroke()
      }
      break
    }
    case 'clipboard': {
      ctx.lineWidth = size * 0.08
      ctx.strokeRect(-s * 0.6, -s * 0.75, s * 1.2, s * 1.6)
      ctx.fillRect(-s * 0.3, -s * 0.9, s * 0.6, s * 0.25)
      for (let i = 0; i < 3; i++) ctx.fillRect(-s * 0.35, -s * 0.3 + i * s * 0.35, s * 0.7, s * 0.08)
      break
    }
    case 'star': {
      ctx.beginPath()
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? s * 0.42 : s
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
      }
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'chart': {
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.arc(0, 0, s * 0.9, -Math.PI / 2, Math.PI * 1.1)
      ctx.closePath()
      ctx.fill()
      ctx.globalAlpha = 0.55
      ctx.beginPath()
      ctx.moveTo(s * 0.1, -s * 0.1)
      ctx.arc(s * 0.1, -s * 0.1, s * 0.9, Math.PI * 1.1, Math.PI * 1.5)
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'ear': {
      ctx.lineWidth = size * 0.1
      ctx.beginPath()
      ctx.arc(0, -s * 0.15, s * 0.55, Math.PI * 0.9, Math.PI * 2.25)
      ctx.quadraticCurveTo(s * 0.2, s * 0.6, -s * 0.15, s * 0.85)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(0, -s * 0.12, s * 0.2, Math.PI, Math.PI * 2.1)
      ctx.stroke()
      break
    }
    case 'hand': {
      ctx.fillRect(-s * 0.5, -s * 0.05, s * 1.0, s * 0.8)
      for (let i = 0; i < 4; i++) ctx.fillRect(-s * 0.5 + i * s * 0.26, -s * 0.75, s * 0.2, s * 0.8)
      ctx.save()
      ctx.translate(s * 0.55, s * 0.1)
      ctx.rotate(-0.7)
      ctx.fillRect(-s * 0.1, -s * 0.45, s * 0.22, s * 0.5)
      ctx.restore()
      break
    }
  }
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Signs
// ---------------------------------------------------------------------------

export function drawBuildingSign(ctx: Ctx, w: number, h: number, title: string, tab: string | null, accent: string, num: string): void {
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#2c3434')
  g.addColorStop(1, '#1c2121')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = accent
  ctx.globalAlpha = 0.65
  ctx.lineWidth = 4
  ctx.strokeRect(10, 10, w - 20, h - 20)
  ctx.globalAlpha = 1
  // number block
  const bw = h * 0.95
  ctx.fillStyle = accent
  ctx.fillRect(0, 0, bw, h)
  const ink = inkOn(accent)
  text(ctx, 'BLDG', bw / 2, h * 0.26, { size: h * 0.16, color: ink, align: 'center', spacing: 2 })
  text(ctx, num, bw / 2, h * 0.62, { size: h * 0.5, color: ink, align: 'center' })
  let right = w - 26
  if (tab) {
    setFont(ctx, h * 0.3, 700, FONT_DISPLAY)
    const tw = Math.min(ctx.measureText(tab).width + h * 0.5, w * 0.36)
    roundRect(ctx, w - tw - 24, h * 0.24, tw, h * 0.52, h * 0.12)
    ctx.fillStyle = accent
    ctx.fill()
    text(ctx, tab, w - tw / 2 - 24, h * 0.505, { size: h * 0.3, color: inkOn(accent), align: 'center', maxW: tw - h * 0.25, spacing: 1 })
    right = w - tw - 46
  }
  text(ctx, title, bw + 28, h * 0.52, { size: h * 0.52, color: CREAM, maxW: right - bw - 28, spacing: 2 })
  rivets(ctx, w, h, 14, 4)
  grime(ctx, w, h, title.length * 7, 0.6)
}

export function drawArch(ctx: Ctx, w: number, h: number, title: string, sub: string): void {
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#2f3838')
  g.addColorStop(1, '#1d2222')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  hazardBand(ctx, 0, 0, w, h * 0.09, 22)
  hazardBand(ctx, 0, h * 0.91, w, h * 0.09, 22)
  text(ctx, title, w / 2, h * 0.43, { size: h * 0.46, color: CREAM, align: 'center', maxW: w * 0.92, spacing: 6 })
  ctx.fillStyle = HAZARD
  const sw = w * 0.5
  ctx.fillRect(w / 2 - sw / 2, h * 0.66, sw, 3)
  text(ctx, `·  ${sub}  ·`, w / 2, h * 0.77, { size: h * 0.15, color: HAZARD, align: 'center', spacing: 8 })
  rivets(ctx, w, h, 18, 5)
  grime(ctx, w, h, 3, 0.5)
}

export function drawMotto(ctx: Ctx, w: number, h: number, motto: string): void {
  const g = ctx.createLinearGradient(0, 0, w, h)
  g.addColorStop(0, '#d8c48f')
  g.addColorStop(0.5, '#efe0b0')
  g.addColorStop(1, '#bfa66a')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = '#7d6638'
  ctx.lineWidth = 6
  ctx.strokeRect(8, 8, w - 16, h - 16)
  const [a, b] = motto.split('. ')
  text(ctx, `${a}.`, w / 2, h * 0.36, { size: h * 0.25, color: '#3a2e18', align: 'center', maxW: w * 0.9, spacing: 2 })
  text(ctx, b ?? '', w / 2, h * 0.64, { size: h * 0.25, color: '#3a2e18', align: 'center', maxW: w * 0.9, spacing: 2 })
  text(ctx, '— THE MANAGEMENT', w - 30, h * 0.86, { size: h * 0.1, color: '#5a4724', align: 'right', family: FONT_MONO, weight: 600 })
  rivets(ctx, w, h, 16, 5, 'rgba(255,240,200,0.7)')
}

export interface GantryItem {
  label: string
  color: string
}

export function drawGantryPanel(ctx: Ctx, w: number, h: number, arrow: 'left' | 'up' | 'right', items: GantryItem[]): void {
  ctx.fillStyle = '#1F4B3A'
  ctx.fillRect(0, 0, w, h)
  roundRect(ctx, 8, 8, w - 16, h - 16, 14)
  ctx.strokeStyle = CREAM
  ctx.lineWidth = 5
  ctx.stroke()
  const as = h * 0.5
  const ax = arrow === 'right' ? w - as * 0.75 - 14 : as * 0.75 + 14
  arrowPath(ctx, ax, h / 2, as, arrow)
  ctx.fillStyle = CREAM
  ctx.fill()
  const tx0 = arrow === 'right' ? 34 : as * 1.5 + 30
  const tx1 = arrow === 'right' ? w - as * 1.5 - 30 : w - 34
  const lineH = (h - 40) / Math.max(1, items.length)
  items.forEach((it, i) => {
    const y = 20 + lineH * (i + 0.5)
    ctx.fillStyle = it.color
    ctx.fillRect(tx0, y - lineH * 0.26, lineH * 0.36, lineH * 0.52)
    text(ctx, it.label, tx0 + lineH * 0.52, y + 1, { size: Math.min(lineH * 0.72, 58), color: CREAM, maxW: tx1 - tx0 - lineH * 0.55, spacing: 1 })
  })
}

/** Blade sign (shape drawn with transparent surroundings; tip on `tip` side). */
export function drawBlade(ctx: Ctx, w: number, h: number, label: string, color: string, tip: 'left' | 'right'): void {
  ctx.clearRect(0, 0, w, h)
  const t = h * 0.55
  ctx.save()
  if (tip === 'left') {
    ctx.translate(w, 0)
    ctx.scale(-1, 1)
  }
  ctx.beginPath()
  ctx.moveTo(4, 4)
  ctx.lineTo(w - t, 4)
  ctx.lineTo(w - 4, h / 2)
  ctx.lineTo(w - t, h - 4)
  ctx.lineTo(4, h - 4)
  ctx.closePath()
  ctx.fillStyle = PANEL
  ctx.fill()
  ctx.lineWidth = 4
  ctx.strokeStyle = 'rgba(234,227,210,0.85)'
  ctx.stroke()
  // colored tip
  ctx.beginPath()
  ctx.moveTo(w - t - 30, 4)
  ctx.lineTo(w - t, 4)
  ctx.lineTo(w - 4, h / 2)
  ctx.lineTo(w - t, h - 4)
  ctx.lineTo(w - t - 30, h - 4)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
  ctx.restore()
  const x0 = tip === 'left' ? t + 44 : 22
  const x1 = tip === 'left' ? w - 22 : w - t - 44
  text(ctx, label, (x0 + x1) / 2, h * 0.53, { size: h * 0.56, color: CREAM, align: 'center', maxW: x1 - x0, spacing: 1 })
}

export function drawPoster(ctx: Ctx, w: number, h: number, p: PosterDef, seed: number): void {
  ctx.fillStyle = '#efe6cf'
  ctx.fillRect(0, 0, w, h)
  const bandH = h * 0.42
  ctx.fillStyle = p.color
  ctx.fillRect(0, 0, w, bandH)
  icon(ctx, p.icon, w / 2, bandH * 0.52, bandH * 0.62, inkOn(p.color))
  const lines = wrap(ctx, p.headline, w * 0.86, h * 0.1)
  const hs = lines.length > 2 ? h * 0.075 : h * 0.09
  const lines2 = wrap(ctx, p.headline, w * 0.86, hs)
  let y = bandH + h * 0.08
  for (const l of lines2.slice(0, 3)) {
    text(ctx, l, w / 2, y, { size: hs, color: INK, align: 'center', maxW: w * 0.9 })
    y += hs * 1.05
  }
  const bodyLines = wrap(ctx, p.body, w * 0.84, h * 0.052, 600)
  y += h * 0.02
  for (const l of bodyLines.slice(0, 3)) {
    text(ctx, l, w / 2, y, { size: h * 0.052, color: '#3b3b36', align: 'center', weight: 600, maxW: w * 0.88 })
    y += h * 0.062
  }
  text(ctx, 'McKEOWN INDUSTRIAL WORKS · SAFETY DEPT.', w / 2, h * 0.95, { size: h * 0.032, color: '#6b675c', align: 'center', family: FONT_MONO, weight: 600, maxW: w * 0.9 })
  // tape + wear
  ctx.fillStyle = 'rgba(240,235,200,0.75)'
  ctx.save()
  ctx.translate(w * 0.12, h * 0.02)
  ctx.rotate(-0.5)
  ctx.fillRect(-w * 0.08, -h * 0.015, w * 0.16, h * 0.04)
  ctx.restore()
  ctx.save()
  ctx.translate(w * 0.88, h * 0.02)
  ctx.rotate(0.5)
  ctx.fillRect(-w * 0.08, -h * 0.015, w * 0.16, h * 0.04)
  ctx.restore()
  grime(ctx, w, h, seed, 1.2)
}

export function drawRestricted(ctx: Ctx, w: number, h: number, label: string, sub: string, kind: 'danger' | 'caution', pict: PosterIcon): void {
  ctx.fillStyle = '#f2efe6'
  ctx.fillRect(0, 0, w, h)
  const top = h * 0.26
  ctx.fillStyle = kind === 'danger' ? '#C8302A' : HAZARD
  ctx.fillRect(0, 0, w, top)
  text(ctx, kind === 'danger' ? 'DANGER' : 'CAUTION', w / 2, top * 0.53, { size: top * 0.68, color: kind === 'danger' ? '#f7f3ea' : INK, align: 'center', spacing: 8 })
  icon(ctx, pict, w * 0.17, top + (h - top) * 0.45, (h - top) * 0.55, kind === 'danger' ? '#C8302A' : INK)
  const words = wrap(ctx, label, w * 0.64, h * 0.13)
  const ls = words.length > 2 ? h * 0.1 : h * 0.13
  const lines = wrap(ctx, label, w * 0.64, ls)
  let y = top + h * 0.11
  for (const l of lines.slice(0, 3)) {
    text(ctx, l, w * 0.34, y, { size: ls, color: INK, maxW: w * 0.62 })
    y += ls * 1.02
  }
  text(ctx, sub, w * 0.34, h * 0.88, { size: h * 0.075, color: '#4a4740', weight: 600, maxW: w * 0.62 })
  ctx.strokeStyle = INK
  ctx.lineWidth = 6
  ctx.strokeRect(3, 3, w - 6, h - 6)
  grime(ctx, w, h, label.length, 0.8)
}

export function drawIncidentBoard(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = '#f3efe4'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#2F7D4A'
  ctx.fillRect(0, 0, w, h * 0.24)
  text(ctx, 'SAFETY FIRST', w / 2, h * 0.125, { size: h * 0.15, color: '#f3efe4', align: 'center', spacing: 6 })
  text(ctx, 'THIS FACILITY HAS GONE', w / 2, h * 0.34, { size: h * 0.09, color: INK, align: 'center', spacing: 2, maxW: w * 0.9 })
  // LED box
  const bx = w * 0.3
  const bw = w * 0.4
  ctx.fillStyle = '#121414'
  roundRect(ctx, bx, h * 0.41, bw, h * 0.3, 10)
  ctx.fill()
  ctx.shadowColor = '#ff3b2f'
  ctx.shadowBlur = 18
  text(ctx, '0.2', w / 2, h * 0.565, { size: h * 0.27, color: '#ff4a36', align: 'center', family: FONT_MONO, weight: 600 })
  ctx.shadowBlur = 0
  text(ctx, 'DAYS WITHOUT INCIDENT', w / 2, h * 0.8, { size: h * 0.1, color: INK, align: 'center', spacing: 2, maxW: w * 0.92 })
  text(ctx, 'PREVIOUS RECORD: 0.3 · KEEP IT UP', w / 2, h * 0.92, { size: h * 0.045, color: '#555', align: 'center', family: FONT_MONO, weight: 600 })
  ctx.strokeStyle = '#2F7D4A'
  ctx.lineWidth = 8
  ctx.strokeRect(4, 4, w - 8, h - 8)
  grime(ctx, w, h, 99, 0.7)
}

export function drawSimpleSign(ctx: Ctx, w: number, h: number, title: string, sub: string, bg: string, fg: string, accent?: string): void {
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)
  if (accent) {
    ctx.fillStyle = accent
    ctx.fillRect(0, h - h * 0.12, w, h * 0.12)
  }
  const hasSub = sub.length > 0
  text(ctx, title, w / 2, hasSub ? h * 0.38 : h * 0.47, { size: h * (hasSub ? 0.36 : 0.5), color: fg, align: 'center', maxW: w * 0.9, spacing: 2 })
  if (hasSub) text(ctx, sub, w / 2, h * 0.72, { size: h * 0.17, color: fg, align: 'center', maxW: w * 0.9, weight: 600 })
  ctx.strokeStyle = fg
  ctx.globalAlpha = 0.5
  ctx.lineWidth = 4
  ctx.strokeRect(6, 6, w - 12, h - 12)
  ctx.globalAlpha = 1
  grime(ctx, w, h, title.length * 3, 0.5)
}

export function drawStencil(ctx: Ctx, w: number, h: number, str: string, color: string): void {
  ctx.clearRect(0, 0, w, h)
  text(ctx, str, w / 2, h * 0.53, { size: h * 0.86, color, align: 'center', maxW: w * 0.96, spacing: 4 })
  // stencil bridges
  ctx.globalCompositeOperation = 'destination-out'
  ctx.fillStyle = '#000'
  ctx.fillRect(0, h * 0.5, w, h * 0.035)
  ctx.globalCompositeOperation = 'source-over'
}

export function drawTruckSide(ctx: Ctx, w: number, h: number, title: string, color: string, slogan: string): void {
  ctx.fillStyle = '#e9e6dc'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = color
  ctx.fillRect(0, h * 0.72, w, h * 0.16)
  ctx.fillStyle = '#2a2f30'
  ctx.fillRect(0, h * 0.9, w, h * 0.1)
  text(ctx, title, w * 0.05, h * 0.36, { size: h * 0.3, color: '#2a2f30', maxW: w * 0.9, spacing: 3 })
  text(ctx, slogan, w * 0.05, h * 0.6, { size: h * 0.11, color: '#555', maxW: w * 0.9, weight: 600 })
  grime(ctx, w, h, title.length, 1)
}

export function drawContainerSide(ctx: Ctx, w: number, h: number, color: string, code: string): void {
  ctx.fillStyle = color
  ctx.fillRect(0, 0, w, h)
  // corrugation shading
  for (let x = 0; x < w; x += 18) {
    ctx.fillStyle = 'rgba(0,0,0,0.12)'
    ctx.fillRect(x, 0, 6, h)
    ctx.fillStyle = 'rgba(255,255,255,0.06)'
    ctx.fillRect(x + 9, 0, 4, h)
  }
  text(ctx, 'McKEOWN', w * 0.5, h * 0.42, { size: h * 0.36, color: CREAM, align: 'center', maxW: w * 0.8, spacing: 10 })
  text(ctx, 'INDUSTRIAL WORKS', w * 0.5, h * 0.66, { size: h * 0.12, color: CREAM, align: 'center', spacing: 6 })
  text(ctx, code, w * 0.95, h * 0.12, { size: h * 0.07, color: CREAM, align: 'right', family: FONT_MONO, weight: 600 })
  grime(ctx, w, h, code.length, 1.4)
}

export function drawPieFace(ctx: Ctx, s: number): void {
  ctx.clearRect(0, 0, s, s)
  const cx = s / 2
  const cy = s / 2
  const r = s * 0.48
  const cols = ['#8C6BB1', '#E9B63F', '#638C88', '#D9483B', '#4F86A8', '#E57D35']
  const parts = [0.31, 0.22, 0.17, 0.14, 0.1, 0.06]
  let a = -Math.PI / 2
  parts.forEach((p, i) => {
    const b = a + p * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.arc(cx, cy, r, a, b)
    ctx.closePath()
    ctx.fillStyle = cols[i]
    ctx.fill()
    ctx.strokeStyle = '#f4efe2'
    ctx.lineWidth = 6
    ctx.stroke()
    const m = (a + b) / 2
    const tx = cx + Math.cos(m) * r * 0.62
    const ty = cy + Math.sin(m) * r * 0.62
    ctx.save()
    ctx.translate(tx, ty)
    let rot = m + Math.PI / 2
    if (Math.cos(m) < 0) rot += Math.PI
    ctx.rotate(rot - Math.PI / 2)
    text(ctx, 'SYNERGY', 0, 0, { size: s * (0.035 + p * 0.12), color: inkOn(cols[i]), align: 'center', spacing: 2 })
    ctx.restore()
    a = b
  })
}

export function drawVendingFront(ctx: Ctx, w: number, h: number, variant: number): void {
  const brands = [
    { name: 'SYNERGY COLA', color: '#C8302A' },
    { name: 'SNAK-O-MATIC', color: '#4F86A8' },
    { name: 'BEAN THERE', color: '#6B4A30' },
  ]
  const b = brands[variant % brands.length]
  ctx.fillStyle = b.color
  ctx.fillRect(0, 0, w, h)
  text(ctx, b.name, w / 2, h * 0.07, { size: h * 0.06, color: CREAM, align: 'center', maxW: w * 0.9, spacing: 2 })
  // glass window
  ctx.fillStyle = '#1a2224'
  ctx.fillRect(w * 0.06, h * 0.13, w * 0.62, h * 0.68)
  const r = createRng(variant + 5)
  const rows = 6
  for (let j = 0; j < rows; j++) {
    const y = h * 0.15 + j * h * 0.11
    ctx.fillStyle = 'rgba(200,210,210,0.35)'
    ctx.fillRect(w * 0.07, y + h * 0.085, w * 0.6, 3)
    for (let i = 0; i < 4; i++) {
      const hue = Math.floor(r() * 360)
      ctx.fillStyle = `hsl(${hue},55%,55%)`
      ctx.fillRect(w * 0.09 + i * w * 0.145, y + h * 0.02, w * 0.1, h * 0.065)
    }
  }
  // glow
  const g = ctx.createLinearGradient(0, h * 0.13, 0, h * 0.81)
  g.addColorStop(0, 'rgba(255,255,240,0.25)')
  g.addColorStop(1, 'rgba(255,255,240,0.02)')
  ctx.fillStyle = g
  ctx.fillRect(w * 0.06, h * 0.13, w * 0.62, h * 0.68)
  // keypad
  ctx.fillStyle = '#2b2f30'
  ctx.fillRect(w * 0.73, h * 0.2, w * 0.21, h * 0.3)
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = '#c9c9c0'
      ctx.fillRect(w * 0.75 + i * w * 0.065, h * 0.23 + j * h * 0.065, w * 0.045, h * 0.045)
    }
  ctx.fillStyle = '#86e0a0'
  ctx.fillRect(w * 0.74, h * 0.53, w * 0.19, h * 0.05)
  ctx.fillStyle = '#111'
  ctx.fillRect(w * 0.1, h * 0.85, w * 0.55, h * 0.1)
}

export function drawPegboard(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = '#9a7b55'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = 'rgba(40,28,15,0.5)'
  for (let y = 10; y < h; y += 18) for (let x = 10; x < w; x += 18) ctx.fillRect(x, y, 3, 3)
  const r = createRng(42)
  const tools = 10
  for (let i = 0; i < tools; i++) {
    const x = (i + 0.5) * (w / tools)
    const y = h * (0.3 + r() * 0.35)
    const len = h * (0.35 + r() * 0.3)
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate((r() - 0.5) * 0.2)
    ctx.strokeStyle = 'rgba(25,20,15,0.6)'
    ctx.lineWidth = 10
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(0, -len / 2)
    ctx.lineTo(0, len / 2)
    ctx.stroke()
    ctx.strokeStyle = ['#c0392b', '#7d8a8c', '#e9b63f', '#4f86a8'][i % 4]
    ctx.lineWidth = 7
    ctx.beginPath()
    ctx.moveTo(0, -len / 2)
    ctx.lineTo(0, len / 2)
    ctx.stroke()
    ctx.fillStyle = '#9aa3a5'
    if (i % 3 === 0) ctx.fillRect(-12, -len / 2 - 6, 24, 12)
    else if (i % 3 === 1) {
      ctx.beginPath()
      ctx.arc(0, -len / 2, 10, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }
  text(ctx, 'IF YOU BORROW IT, IT IS NOW YOURS. FOREVER.', w / 2, h * 0.92, { size: h * 0.07, color: '#2a1d10', align: 'center', maxW: w * 0.95 })
}

export function drawWhiteboard(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = '#f4f6f4'
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = '#9aa0a0'
  ctx.lineWidth = 10
  ctx.strokeRect(5, 5, w - 10, h - 10)
  ctx.lineWidth = 4
  ctx.strokeStyle = '#2050a0'
  ctx.beginPath()
  ctx.moveTo(w * 0.08, h * 0.8)
  ctx.quadraticCurveTo(w * 0.3, h * 0.05, w * 0.5, h * 0.35)
  ctx.quadraticCurveTo(w * 0.6, h * 0.5, w * 0.55, h * 0.85)
  ctx.stroke()
  text(ctx, 'PLAN', w * 0.2, h * 0.3, { size: h * 0.09, color: '#2050a0' })
  text(ctx, 'ACTUAL', w * 0.56, h * 0.72, { size: h * 0.09, color: '#c0392b' })
  text(ctx, 'SYNERGY = MC²', w * 0.66, h * 0.2, { size: h * 0.1, color: '#222', family: FONT_MONO, weight: 600 })
  text(ctx, 'TODO: FIX FINS', w * 0.66, h * 0.38, { size: h * 0.08, color: '#c0392b', family: FONT_MONO, weight: 600 })
  text(ctx, 'LAUNCH WINDOW: ?', w * 0.66, h * 0.52, { size: h * 0.08, color: '#222', family: FONT_MONO, weight: 600 })
}

export function drawOnAir(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = '#3a0d0b'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#ff3b2f'
  roundRect(ctx, 10, 10, w - 20, h - 20, 18)
  ctx.fill()
  text(ctx, 'ON AIR', w / 2, h / 2 + 2, { size: h * 0.62, color: '#fff3ea', align: 'center', spacing: 10 })
}

// ---------------------------------------------------------------------------
// Floor stencil masks (white on transparent; tinted by vertex color)
// ---------------------------------------------------------------------------

export function maskText(ctx: Ctx, w: number, h: number, str: string): void {
  ctx.clearRect(0, 0, w, h)
  text(ctx, str, w / 2, h * 0.54, { size: h * 0.9, color: '#fff', align: 'center', maxW: w * 0.97, spacing: 6 })
}

export function maskArrow(ctx: Ctx, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.moveTo(w / 2, 4)
  ctx.lineTo(w - 6, h * 0.42)
  ctx.lineTo(w * 0.66, h * 0.42)
  ctx.lineTo(w * 0.66, h - 4)
  ctx.lineTo(w * 0.34, h - 4)
  ctx.lineTo(w * 0.34, h * 0.42)
  ctx.lineTo(6, h * 0.42)
  ctx.closePath()
  ctx.fill()
}

export function maskChevrons(ctx: Ctx, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#fff'
  for (let k = 0; k < 2; k++) {
    const y = k * h * 0.45 + 6
    ctx.beginPath()
    ctx.moveTo(w / 2, y)
    ctx.lineTo(w - 6, y + h * 0.36)
    ctx.lineTo(w - 6, y + h * 0.52)
    ctx.lineTo(w / 2, y + h * 0.18)
    ctx.lineTo(6, y + h * 0.52)
    ctx.lineTo(6, y + h * 0.36)
    ctx.closePath()
    ctx.fill()
  }
}

export function maskHatchDisc(ctx: Ctx, s: number, stripe: number): void {
  ctx.clearRect(0, 0, s, s)
  ctx.save()
  ctx.beginPath()
  ctx.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2)
  ctx.clip()
  ctx.fillStyle = '#fff'
  for (let i = -s; i < s * 2; i += stripe * 2) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i + stripe, 0)
    ctx.lineTo(i + stripe - s, s)
    ctx.lineTo(i - s, s)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

export function maskRing(ctx: Ctx, s: number, thickness: number): void {
  ctx.clearRect(0, 0, s, s)
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = thickness
  ctx.beginPath()
  ctx.arc(s / 2, s / 2, s / 2 - thickness / 2 - 2, 0, Math.PI * 2)
  ctx.stroke()
}

export function maskSpawn(ctx: Ctx, s: number): void {
  ctx.clearRect(0, 0, s, s)
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = s * 0.035
  ctx.beginPath()
  ctx.arc(s / 2, s / 2, s * 0.44, 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([s * 0.04, s * 0.03])
  ctx.lineWidth = s * 0.012
  ctx.beginPath()
  ctx.arc(s / 2, s / 2, s * 0.36, 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([])
  text(ctx, 'YOU ARE HERE', s / 2, s * 0.8, { size: s * 0.085, color: '#fff', align: 'center', spacing: 4 })
  text(ctx, '(PROBABLY)', s / 2, s * 0.2, { size: s * 0.06, color: '#fff', align: 'center', spacing: 3 })
  // boot prints in the middle
  for (const sx of [-1, 1]) {
    ctx.save()
    ctx.translate(s / 2 + sx * s * 0.07, s / 2 + (sx > 0 ? -s * 0.02 : s * 0.02))
    ctx.fillStyle = '#fff'
    roundRect(ctx, -s * 0.035, -s * 0.09, s * 0.07, s * 0.12, s * 0.03)
    ctx.fill()
    roundRect(ctx, -s * 0.03, s * 0.045, s * 0.06, s * 0.05, s * 0.02)
    ctx.fill()
    ctx.restore()
  }
}

export function maskFootprints(ctx: Ctx, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#fff'
  const n = 6
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1
    const y = h - (i + 0.6) * (h / n)
    ctx.save()
    ctx.translate(w / 2 + side * w * 0.16, y)
    ctx.rotate(side * 0.08)
    roundRect(ctx, -w * 0.12, -h * 0.07, w * 0.24, h * 0.1, w * 0.1)
    ctx.fill()
    roundRect(ctx, -w * 0.1, h * 0.04, w * 0.2, h * 0.045, w * 0.08)
    ctx.fill()
    ctx.restore()
  }
}

export function maskStain(ctx: Ctx, w: number, h: number, seed: number): void {
  ctx.clearRect(0, 0, w, h)
  const r = createRng(seed)
  ctx.fillStyle = '#fff'
  for (let i = 0; i < 9; i++) {
    ctx.beginPath()
    ctx.ellipse(w / 2 + (r() - 0.5) * w * 0.4, h / 2 + (r() - 0.5) * h * 0.4, w * (0.12 + r() * 0.2), h * (0.1 + r() * 0.18), r() * Math.PI, 0, Math.PI * 2)
    ctx.fill()
  }
  for (let i = 0; i < 14; i++) {
    ctx.beginPath()
    ctx.arc(w / 2 + (r() - 0.5) * w * 0.9, h / 2 + (r() - 0.5) * h * 0.9, 2 + r() * 7, 0, Math.PI * 2)
    ctx.fill()
  }
}

export function maskHatchBox(ctx: Ctx, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h)
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 12
  ctx.strokeRect(8, 8, w - 16, h - 16)
  ctx.save()
  ctx.beginPath()
  ctx.rect(8, 8, w - 16, h - 16)
  ctx.clip()
  ctx.lineWidth = 14
  for (let i = -h; i < w + h; i += 52) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i + h, h)
    ctx.stroke()
  }
  ctx.restore()
}

export function maskPedestrian(ctx: Ctx, s: number): void {
  ctx.clearRect(0, 0, s, s)
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(s * 0.5, s * 0.16, s * 0.09, 0, Math.PI * 2)
  ctx.fill()
  ctx.lineCap = 'round'
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = s * 0.1
  ctx.beginPath()
  ctx.moveTo(s * 0.5, s * 0.3)
  ctx.lineTo(s * 0.47, s * 0.58)
  ctx.lineTo(s * 0.32, s * 0.86)
  ctx.moveTo(s * 0.47, s * 0.58)
  ctx.lineTo(s * 0.64, s * 0.86)
  ctx.moveTo(s * 0.5, s * 0.36)
  ctx.lineTo(s * 0.3, s * 0.52)
  ctx.moveTo(s * 0.5, s * 0.36)
  ctx.lineTo(s * 0.7, s * 0.5)
  ctx.stroke()
}
