/**
 * Decal atlas for the shared material: one 1024² canvas with the module's
 * signs, stencils and stripes. Plain geometry samples the white block at the
 * top-left corner (WHITE_UV), decals sample their rect. Stencils are drawn dark
 * on white so they multiply onto any vertex color.
 *
 * Fonts: only locally bundled faces (the @fontsource CSS families loaded by
 * main.tsx). The atlas is drawn immediately with fallbacks and redrawn once the
 * faces are ready (never blocks, never fetches anything remote).
 */
import * as THREE from 'three'
import { PALETTE } from '@/world/palette'
import { setAtlasTexture, type UvRect } from './geo'

const SIZE = 1024
export const FONT_DISPLAY = '"Barlow Condensed", "MIW Barlow", "Arial Narrow", sans-serif'
export const FONT_MONO = '"IBM Plex Mono", "MIW Plex", "Courier New", monospace'

interface Region {
  x: number
  y: number
  w: number
  h: number
}

/** Canvas pixel regions (top-left origin). */
const R = {
  white: { x: 0, y: 0, w: 16, h: 16 },
  towerSign: { x: 0, y: 24, w: 1024, h: 196 },
  portalSign: { x: 0, y: 228, w: 1024, h: 110 },
  crawlerName: { x: 0, y: 346, w: 504, h: 92 },
  howsMyDriving: { x: 520, y: 346, w: 504, h: 92 },
  deluge: { x: 0, y: 446, w: 504, h: 92 },
  flameTrench: { x: 520, y: 446, w: 504, h: 92 },
  cushion: { x: 0, y: 546, w: 504, h: 92 },
  inflator: { x: 520, y: 546, w: 504, h: 92 },
  logo: { x: 0, y: 646, w: 240, h: 132 },
  sideUp: { x: 248, y: 646, w: 380, h: 62 },
  noStep: { x: 636, y: 646, w: 250, h: 62 },
  fragile: { x: 248, y: 716, w: 250, h: 62 },
  warranty: { x: 506, y: 716, w: 518, h: 62 },
  kiosk: { x: 0, y: 786, w: 504, h: 110 },
  bench: { x: 520, y: 786, w: 504, h: 110 },
  hazard: { x: 0, y: 904, w: 1024, h: 56 },
  redWhite: { x: 0, y: 966, w: 1024, h: 52 },
} satisfies Record<string, Region>

export type AtlasKey = keyof typeof R

function rectUv(r: Region): UvRect {
  // CanvasTexture flipY: canvas top -> v = 1
  const pad = 1.5
  return [(r.x + pad) / SIZE, 1 - (r.y + r.h - pad) / SIZE, (r.x + r.w - pad) / SIZE, 1 - (r.y + pad) / SIZE]
}

export const ATLAS_UV = Object.fromEntries(Object.entries(R).map(([k, r]) => [k, rectUv(r)])) as Record<AtlasKey, UvRect>

/** World aspect (w / h) of a region, so quads can be sized without stretching. */
export function atlasAspect(key: AtlasKey): number {
  return R[key].w / R[key].h
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number, font: string, weight = 700): number {
  let s = size
  ctx.font = `${weight} ${s}px ${font}`
  while (ctx.measureText(text).width > maxW && s > 8) {
    s -= 2
    ctx.font = `${weight} ${s}px ${font}`
  }
  return s
}

function stripes(ctx: CanvasRenderingContext2D, r: Region, a: string, b: string, period: number): void {
  ctx.save()
  ctx.beginPath()
  ctx.rect(r.x, r.y, r.w, r.h)
  ctx.clip()
  ctx.fillStyle = a
  ctx.fillRect(r.x, r.y, r.w, r.h)
  ctx.fillStyle = b
  for (let x = r.x - r.h * 2; x < r.x + r.w + r.h; x += period) {
    ctx.beginPath()
    ctx.moveTo(x, r.y + r.h)
    ctx.lineTo(x + period / 2, r.y + r.h)
    ctx.lineTo(x + period / 2 + r.h, r.y)
    ctx.lineTo(x + r.h, r.y)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

function plate(ctx: CanvasRenderingContext2D, r: Region, bg: string, fg: string, lines: [string, number][], border?: string): void {
  ctx.fillStyle = bg
  ctx.fillRect(r.x, r.y, r.w, r.h)
  if (border) {
    ctx.strokeStyle = border
    ctx.lineWidth = 6
    ctx.strokeRect(r.x + 5, r.y + 5, r.w - 10, r.h - 10)
  }
  ctx.fillStyle = fg
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const total = lines.reduce((s, [, h]) => s + h, 0)
  let y = r.y + (r.h - total) / 2
  for (const [text, frac] of lines) {
    const size = fitText(ctx, text, r.w - 36, frac * 0.86, FONT_DISPLAY)
    ctx.font = `700 ${size}px ${FONT_DISPLAY}`
    ctx.fillText(text, r.x + r.w / 2, y + frac / 2 + 1)
    y += frac
  }
}

/** Dark stencil text on white (multiplies onto the surface color). */
function stencil(ctx: CanvasRenderingContext2D, r: Region, text: string, color = '#1d1f1f', font = FONT_DISPLAY): void {
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(r.x, r.y, r.w, r.h)
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const size = fitText(ctx, text, r.w - 20, r.h * 0.8, font)
  ctx.font = `700 ${size}px ${font}`
  ctx.fillText(text, r.x + r.w / 2, r.y + r.h / 2 + 2)
}

function rocketGlyph(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, color: string): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(0.35)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(0, -s)
  ctx.quadraticCurveTo(s * 0.42, -s * 0.45, s * 0.3, s * 0.45)
  ctx.lineTo(s * 0.55, s * 0.85)
  ctx.lineTo(s * 0.18, s * 0.62)
  ctx.lineTo(-s * 0.18, s * 0.62)
  ctx.lineTo(-s * 0.62, s * 0.95)
  ctx.lineTo(-s * 0.3, s * 0.45)
  ctx.quadraticCurveTo(-s * 0.42, -s * 0.45, 0, -s)
  ctx.fill()
  ctx.fillStyle = PALETTE.furnace
  ctx.beginPath()
  ctx.moveTo(-s * 0.15, s * 0.68)
  ctx.lineTo(0, s * 1.15)
  ctx.lineTo(s * 0.15, s * 0.68)
  ctx.fill()
  ctx.restore()
}

function draw(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, SIZE, SIZE)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, SIZE, SIZE)

  // --- big tower sign (charcoal plate, cream letters, hazard rails) ---
  {
    const r = R.towerSign
    ctx.fillStyle = '#1F2526'
    ctx.fillRect(r.x, r.y, r.w, r.h)
    stripes(ctx, { x: r.x, y: r.y, w: r.w, h: 16 }, PALETTE.hazard, PALETTE.soot, 34)
    stripes(ctx, { x: r.x, y: r.y + r.h - 16, w: r.w, h: 16 }, PALETTE.hazard, PALETTE.soot, 34)
    rocketGlyph(ctx, r.x + 86, r.y + r.h / 2 + 4, 58, PALETTE.cream)
    rocketGlyph(ctx, r.x + r.w - 86, r.y + r.h / 2 + 4, 58, PALETTE.cream)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = PALETTE.cream
    const size = fitText(ctx, 'ROCKET ASSEMBLY TOWER', r.w - 260, 104, FONT_DISPLAY)
    ctx.font = `700 ${size}px ${FONT_DISPLAY}`
    ctx.fillText('ROCKET ASSEMBLY TOWER', r.x + r.w / 2, r.y + 80)
    ctx.fillStyle = PALETTE.furnace
    const s2 = fitText(ctx, 'McKEOWN INDUSTRIAL WORKS · QUESTIONABLE ROCKETS SINCE LAST TUESDAY', r.w - 280, 34, FONT_DISPLAY, 600)
    ctx.font = `600 ${s2}px ${FONT_DISPLAY}`
    ctx.fillText('McKEOWN INDUSTRIAL WORKS · QUESTIONABLE ROCKETS SINCE LAST TUESDAY', r.x + r.w / 2, r.y + 148)
  }
  // --- rollout portal sign ---
  {
    const r = R.portalSign
    stripes(ctx, r, PALETTE.hazard, PALETTE.soot, 40)
    ctx.fillStyle = '#1F2526'
    ctx.fillRect(r.x + 120, r.y + 12, r.w - 240, r.h - 24)
    ctx.fillStyle = PALETTE.hazard
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const t = 'ROLLOUT DOOR · ROCKETS HAVE RIGHT OF WAY'
    const size = fitText(ctx, t, r.w - 290, 64, FONT_DISPLAY)
    ctx.font = `700 ${size}px ${FONT_DISPLAY}`
    ctx.fillText(t, r.x + r.w / 2, r.y + r.h / 2 + 2)
  }
  plate(ctx, R.crawlerName, '#ffffff', '#1d1f1f', [['CRAWLER No. 2', 62], ['(No. 1 IS ON THE ROOF)', 24]])
  plate(ctx, R.howsMyDriving, PALETTE.hazard, '#1d1f1f', [["HOW'S MY DRIVING?", 50], ['TOP SPEED: SLOWLY', 30]], '#1d1f1f')
  plate(ctx, R.deluge, '#ffffff', '#1d1f1f', [['DELUGE WATER', 56], ['NOT FOR DRINKING · NOT FOR SWIMMING', 26]])
  stencil(ctx, R.flameTrench, 'FLAME TRENCH · KEEP CLEAR', '#262626')
  plate(ctx, R.cushion, '#ffffff', '#1d1f1f', [['STOWAWAY RECOVERY', 58], ['INFLATABLE · DO NOT POKE', 26]])
  plate(ctx, R.inflator, PALETTE.safety, '#1d1f1f', [['INFLATES FOR STOWAWAYS', 52], ['USED MORE OFTEN THAN YOU THINK', 26]], '#1d1f1f')
  // --- rocket stencils (dark on white -> multiply onto hull colors) ---
  {
    const r = R.logo
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(r.x, r.y, r.w, r.h)
    ctx.fillStyle = '#1d1f1f'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `700 92px ${FONT_DISPLAY}`
    ctx.fillText('MIW', r.x + r.w / 2, r.y + 54)
    ctx.font = `600 24px ${FONT_DISPLAY}`
    ctx.fillText('PROPERTY OF McKEOWN', r.x + r.w / 2, r.y + 112)
  }
  stencil(ctx, R.sideUp, 'THIS SIDE UP  ↓')
  stencil(ctx, R.noStep, 'NO STEP')
  stencil(ctx, R.fragile, 'FRAGILE')
  stencil(ctx, R.warranty, 'WARRANTY VOID IF LAUNCHED')
  plate(ctx, R.kiosk, '#1F2526', PALETTE.cream, [['ASSEMBLY STATUS', 56], ['LIVE (ISH) · PRESS E', 30]], PALETTE.hazard)
  plate(ctx, R.bench, '#5b4a36', '#efe4cf', [['RESERVED FOR', 34], ['LAUNCH ENTHUSIASTS', 46]])
  stripes(ctx, R.hazard, PALETTE.hazard, PALETTE.soot, 56)
  stripes(ctx, R.redWhite, '#E9E3D3', PALETTE.signalRed, 64)
  // white block last (guaranteed clean)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(R.white.x, R.white.y, R.white.w, R.white.h)
}

let texture: THREE.CanvasTexture | null = null

/** The atlas texture (created and drawn on first use; redrawn when local fonts finish loading). */
export function getAtlas(): THREE.CanvasTexture | null {
  if (texture) return texture
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  try {
    draw(ctx)
  } catch {
    /* canvas text unsupported (tests) */
  }
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  t.name = 'rocket:atlas'
  texture = t
  setAtlasTexture(t)
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
  if (fonts && typeof fonts.load === 'function') {
    Promise.all([fonts.load(`700 64px "Barlow Condensed"`), fonts.load(`600 32px "Barlow Condensed"`)])
      .then(() => {
        try {
          draw(ctx)
          t.needsUpdate = true
        } catch {
          /* ignore */
        }
      })
      .catch(() => undefined)
  }
  return t
}
