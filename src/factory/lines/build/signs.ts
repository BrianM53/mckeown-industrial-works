/**
 * Sign atlas for the production spine: line name boards (in the line color),
 * "what it makes" plaques, the QC arch boards, console labels and a few
 * deadpan safety signs. One canvas texture → one draw call for every sign.
 * Plaque text is derived from the factory recipe (STAGE_RECIPES) so it always
 * matches what each line actually feeds.
 */
import * as THREE from 'three'
import type { LineId } from '@/core/types'
import { ROCKET_STAGES, STAGE_RECIPES, type RocketStage } from '@/systems/factory'
import { LINE_NUMBER, lineDef } from '../config'
import { FONT_DISPLAY, FONT_MONO } from '../render/fonts'
import type { UvRect } from './builder'

export interface AtlasCell {
  uv: UvRect
  /** Pixel aspect (w / h). */
  aspect: number
}

export interface SignAtlas {
  texture: THREE.CanvasTexture
  cells: Record<string, AtlasCell>
  /** Re-render every cell (e.g. once the fonts finished loading). */
  redraw(): void
  dispose(): void
}

const STAGE_LABEL: Record<RocketStage, string> = {
  chassis: 'chassis',
  tanks: 'fuel tanks',
  fins: 'fins',
  guidance: 'guidance',
  nose: 'nose cone',
  attachments: 'attachments',
}

export const LINE_MAKES: Record<LineId, string> = {
  smelt: 'Stamped steel panels & fins',
  pipe: 'Pipe bundles with valves',
  circuit: 'Guidance circuit boards',
  tank: 'Fuel tanks (pressure tested)',
  payload: 'Payload pods, QC scanned',
}

export const LINE_TITLE: Record<LineId, string> = {
  smelt: 'SMELTING & SHEET STAMPING',
  pipe: 'PIPE & VALVE MACHINING',
  circuit: 'ELECTRONICS & GUIDANCE',
  tank: 'FUEL TANK FABRICATION',
  payload: 'PAYLOAD PACKING & QC',
}

/** Rocket stages a line's parts go into (from the sim recipe). */
export function lineFeeds(id: LineId): string[] {
  return ROCKET_STAGES.filter((s) => (STAGE_RECIPES[s][id] ?? 0) > 0).map((s) => STAGE_LABEL[s])
}

interface CellDef {
  key: string
  w: number
  h: number
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
}

const CHARCOAL = '#1d2324'
const CREAM = '#ece4d0'
const INK = '#1c1f1f'

function fitFont(ctx: CanvasRenderingContext2D, text: string, family: string, weight: number, maxW: number, size: number): number {
  let s = size
  ctx.font = `${weight} ${s}px ${family}`
  while (s > 8 && ctx.measureText(text).width > maxW) {
    s -= 2
    ctx.font = `${weight} ${s}px ${family}`
  }
  return s
}

function rivets(ctx: CanvasRenderingContext2D, w: number, h: number, inset: number, color: string): void {
  ctx.fillStyle = color
  for (const [x, y] of [
    [inset, inset],
    [w - inset, inset],
    [inset, h - inset],
    [w - inset, h - inset],
  ]) {
    ctx.beginPath()
    ctx.arc(x, y, Math.max(2, h * 0.035), 0, Math.PI * 2)
    ctx.fill()
  }
}

function grime(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, alpha = 0.08): void {
  let s = seed
  const r = () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(40,30,20,${alpha * r()})`
    ctx.fillRect(r() * w, r() * h, 2 + r() * 6, 2 + r() * 6)
  }
  const g = ctx.createLinearGradient(0, h * 0.6, 0, h)
  g.addColorStop(0, 'rgba(60,45,30,0)')
  g.addColorStop(1, `rgba(60,45,30,${alpha * 1.5})`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}

function header(id: LineId): CellDef {
  const color = lineDef(id).color
  const num = LINE_NUMBER[id]
  return {
    key: `line:${id}`,
    w: 508,
    h: 112,
    draw: (ctx, w, h) => {
      ctx.fillStyle = CHARCOAL
      ctx.fillRect(0, 0, w, h)
      // number block
      const bw = h * 1.05
      ctx.fillStyle = color
      ctx.fillRect(0, 0, bw, h)
      ctx.fillStyle = INK
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `700 ${Math.round(h * 0.2)}px ${FONT_DISPLAY}`
      ctx.fillText('LINE', bw / 2, h * 0.2)
      ctx.font = `700 ${Math.round(h * 0.7)}px ${FONT_DISPLAY}`
      ctx.fillText(String(num), bw / 2, h * 0.6)
      // title
      ctx.textAlign = 'left'
      ctx.fillStyle = CREAM
      const title = LINE_TITLE[id]
      const s = fitFont(ctx, title, FONT_DISPLAY, 700, w - bw - 34, Math.round(h * 0.5))
      ctx.fillText(title, bw + 18, h * 0.43 + s * 0.04)
      ctx.fillStyle = color
      ctx.fillRect(bw + 18, h * 0.76, w - bw - 36, Math.max(3, h * 0.05))
      ctx.fillStyle = 'rgba(236,228,208,0.7)'
      ctx.font = `600 ${Math.round(h * 0.13)}px ${FONT_MONO}`
      ctx.fillText('McKEOWN INDUSTRIAL WORKS · PRODUCTION SPINE', bw + 18, h * 0.91)
      rivets(ctx, w, h, 7, 'rgba(255,255,255,0.25)')
      grime(ctx, w, h, num * 101, 0.12)
    },
  }
}

function plaque(id: LineId): CellDef {
  const color = lineDef(id).color
  const feeds = lineFeeds(id)
  return {
    key: `plaque:${id}`,
    w: 250,
    h: 160,
    draw: (ctx, w, h) => {
      ctx.fillStyle = CREAM
      ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = color
      ctx.lineWidth = 8
      ctx.strokeRect(4, 4, w - 8, h - 8)
      ctx.fillStyle = INK
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.font = `600 15px ${FONT_MONO}`
      ctx.fillText(`LINE ${LINE_NUMBER[id]} · MAKES`, 16, 30)
      const makes = LINE_MAKES[id]
      const s = fitFont(ctx, makes, FONT_DISPLAY, 700, w - 32, 30)
      ctx.fillText(makes, 16, 30 + s + 4)
      ctx.font = `600 15px ${FONT_MONO}`
      ctx.fillText('FEEDS THE ROCKET:', 16, 100)
      const f = feeds.join(' · ')
      fitFont(ctx, f, FONT_DISPLAY, 600, w - 32, 26)
      ctx.fillStyle = '#5a3b22'
      ctx.fillText(f, 16, 128)
      ctx.fillStyle = 'rgba(28,31,31,0.55)'
      ctx.font = `600 11px ${FONT_MONO}`
      ctx.fillText('SIMULATED PRODUCTION · FICTIONAL FACTORY', 16, h - 14)
      rivets(ctx, w, h, 12, 'rgba(0,0,0,0.35)')
    },
  }
}

function textCell(key: string, w: number, h: number, bg: string, fg: string, lines: Array<{ text: string; size: number; font?: string; weight?: number; color?: string }>, opts: { stripes?: boolean; border?: string } = {}): CellDef {
  return {
    key,
    w,
    h,
    draw: (ctx, cw, ch) => {
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, cw, ch)
      if (opts.stripes) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(0, 0, cw, ch * 0.12)
        ctx.rect(0, ch * 0.88, cw, ch * 0.12)
        ctx.clip()
        ctx.fillStyle = '#1c1f1f'
        for (let x = -ch; x < cw + ch; x += 28) {
          ctx.beginPath()
          ctx.moveTo(x, 0)
          ctx.lineTo(x + 14, 0)
          ctx.lineTo(x + 14 - ch, ch)
          ctx.lineTo(x - ch, ch)
          ctx.closePath()
          ctx.fill()
        }
        ctx.restore()
      }
      if (opts.border) {
        ctx.strokeStyle = opts.border
        ctx.lineWidth = 6
        ctx.strokeRect(3, 3, cw - 6, ch - 6)
      }
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const total = lines.reduce((s, l) => s + l.size * 1.12, 0)
      let y = ch / 2 - total / 2
      for (const l of lines) {
        const fam = l.font ?? FONT_DISPLAY
        fitFont(ctx, l.text, fam, l.weight ?? 700, cw - 24, l.size)
        ctx.fillStyle = l.color ?? fg
        ctx.fillText(l.text, cw / 2, y + (l.size * 1.12) / 2)
        y += l.size * 1.12
      }
    },
  }
}

function cellDefs(): CellDef[] {
  const ids: LineId[] = ['smelt', 'pipe', 'circuit', 'tank', 'payload']
  return [
    ...ids.map(header),
    textCell('arch:qc', 508, 112, '#E9B63F', INK, [
      { text: 'QUALITY CONTROL', size: 56 },
      { text: 'ALL PAYLOADS AND PERSONNEL ARE SCANNED', size: 18, font: FONT_MONO, weight: 600 },
    ], { stripes: true }),
    textCell('arch:rejected', 384, 96, '#1f0a09', '#8a2d24', [{ text: 'REJECTED', size: 70 }], { border: '#5a1a14' }),
    textCell('arch:passed', 384, 96, '#0c2414', '#5dff7a', [{ text: 'SCANNING…', size: 64 }], { border: '#16402a' }),
    ...ids.map(plaque),
    textCell('bin:rejects', 250, 96, '#C8443A', CREAM, [
      { text: 'REJECTS', size: 50 },
      { text: 'PLEASE DO NOT RE-SHIP', size: 15, font: FONT_MONO, weight: 600 },
    ]),
    textCell('console:title', 508, 72, '#1d2324', '#E9B63F', [
      { text: 'LINE SUPERVISOR CONSOLE', size: 40 },
      { text: 'TUNE THE LINE · CERTIFY THE SHIFT', size: 14, font: FONT_MONO, weight: 600, color: 'rgba(236,228,208,0.75)' },
    ]),
    textCell('console:speed', 192, 40, '#2a3031', CREAM, [{ text: 'BELT SPEED', size: 26 }]),
    textCell('console:inspect', 192, 40, '#2a3031', CREAM, [{ text: 'INSPECTION', size: 26 }]),
    textCell('console:split', 192, 40, '#2a3031', CREAM, [{ text: 'PRESS SPLIT', size: 26 }]),
    textCell('console:cert', 250, 48, '#0f2a18', '#7dffa0', [{ text: 'LINE CERTIFIED', size: 34 }]),
    textCell('console:press', 250, 40, '#2a3031', CREAM, [{ text: 'TANKS ◀ ▶ FINS', size: 24 }]),
    textCell('warn:hot', 250, 128, '#E57D35', INK, [
      { text: 'DANGER · HOT METAL', size: 30 },
      { text: 'NOT A HAND WARMER', size: 20, font: FONT_MONO, weight: 600 },
    ], { border: INK }),
    textCell('warn:press', 250, 128, '#E9B63F', INK, [
      { text: 'KEEP HANDS CLEAR', size: 30 },
      { text: 'THE PRESS DOES NOT CARE', size: 17, font: FONT_MONO, weight: 600 },
    ], { border: INK }),
    textCell('warn:robot', 250, 128, '#E9B63F', INK, [
      { text: 'ROBOT ARM IN USE', size: 30 },
      { text: 'DO NOT HIGH-FIVE', size: 20, font: FONT_MONO, weight: 600 },
    ], { border: INK }),
    textCell('warn:clean', 250, 128, '#dfe9ec', '#1d3b44', [
      { text: 'CLEAN ROOM', size: 38 },
      { text: 'NO SNACKS · NO SNEEZING', size: 17, font: FONT_MONO, weight: 600 },
    ], { border: '#4FC3A1' }),
    textCell('warn:pressure', 250, 128, '#E9B63F', INK, [
      { text: 'PRESSURE TEST', size: 32 },
      { text: 'STAND BACK (ISH)', size: 20, font: FONT_MONO, weight: 600 },
    ], { border: INK }),
    textCell('packing', 508, 120, '#1d2324', '#E9B63F', [
      { text: 'PAYLOAD PACKING', size: 52 },
      { text: 'PODS → QC SCANNER → ROCKET TOWER', size: 18, font: FONT_MONO, weight: 600, color: CREAM },
    ], { stripes: true }),
    textCell('intake', 250, 64, '#1d2324', '#E9B63F', [{ text: 'TOWER INTAKE', size: 36 }]),
    textCell('lift', 128, 160, '#2a3031', '#E9B63F', [
      { text: 'PARTS', size: 34 },
      { text: 'LIFT', size: 52 },
      { text: '↑ TO TOWER', size: 18, font: FONT_MONO, weight: 600, color: CREAM },
    ]),
  ]
}

/** Builds the atlas canvas (shelf-packed, 1024 design px wide). Text redraws when fonts arrive. */
export function createSignAtlas(scale = 1): SignAtlas {
  const defs = cellDefs()
  const places: Array<{ def: CellDef; x: number; y: number; w: number; h: number }> = []
  const W = 1024
  let x = 0
  let y = 0
  let rowH = 0
  const pad = 4
  for (const d of defs) {
    if (x + d.w > W) {
      x = 0
      y += rowH + pad
      rowH = 0
    }
    places.push({ def: d, x, y, w: d.w, h: d.h })
    x += d.w + pad
    rowH = Math.max(rowH, d.h)
  }
  const usedH = y + rowH
  const H = usedH <= 1024 ? 1024 : 2048
  const cw = Math.round(W * scale)
  const ch = Math.round(H * scale)
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  const cells: Record<string, AtlasCell> = {}
  for (const p of places) {
    const u0 = p.x / W
    const u1 = (p.x + p.w) / W
    const v1 = 1 - p.y / H
    const v0 = 1 - (p.y + p.h) / H
    cells[p.def.key] = { uv: [u0 + 0.5 / cw, v0 + 0.5 / ch, u1 - 0.5 / cw, v1 - 0.5 / ch], aspect: p.w / p.h }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  const redraw = () => {
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#20262a'
    ctx.fillRect(0, 0, cw, ch)
    for (const p of places) {
      ctx.save()
      ctx.scale(scale, scale)
      ctx.translate(p.x, p.y)
      ctx.beginPath()
      ctx.rect(0, 0, p.w, p.h)
      ctx.clip()
      try {
        p.def.draw(ctx, p.w, p.h)
      } catch (err) {
        console.warn('[lines] sign draw failed', p.def.key, err)
      }
      ctx.restore()
    }
    texture.needsUpdate = true
  }
  redraw()
  return {
    texture,
    cells,
    redraw,
    dispose: () => texture.dispose(),
  }
}
