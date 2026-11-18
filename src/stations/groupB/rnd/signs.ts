import * as THREE from 'three'
import { PROJECTS } from '@/content/projects'
import { RND_ANNEX } from '@/content/stations'
import type { ProjectContent } from '@/content/types'
import { ZONES } from '@/world/layout'
import { PALETTE } from '@/world/palette'
import { buildAtlas, clampLines, fitText, grime, roundRectPath, wrapMono, type UvRect } from '../shared/canvas'
import { FONT_DISPLAY, FONT_MONO } from '../shared/fonts'
import { LAMP_ORDER } from './rowing'

/**
 * R&D Annex signage atlas: rig signs, the form gauge dial, lamp labels, DO NOT
 * PRESS plates, the thank-you lightbox, the annex directory board and generic
 * bench nameplates. One texture → one material (+ one unlit variant).
 */
const PURPLE = ZONES.rnd.color
const INK = '#1f2426'

export interface RndSigns {
  texture: THREE.CanvasTexture
  uv: Record<string, UvRect>
}

function dial(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const cx = w / 2
  const cy = h * 0.6
  const R = w * 0.42
  ctx.fillStyle = '#f2eee2'
  ctx.beginPath()
  ctx.arc(cx, h / 2, w / 2 - 4, 0, Math.PI * 2)
  ctx.fill()
  ctx.lineWidth = 10
  ctx.strokeStyle = '#2b3033'
  ctx.stroke()
  // colored arc: GOOD (left, green) → BAD (right, red); needle swings ±60°
  const a0 = -Math.PI / 2 - 1.05
  const a1 = -Math.PI / 2 + 1.05
  const seg = 24
  for (let i = 0; i < seg; i++) {
    const t = i / seg
    const r = Math.round(80 + 175 * t)
    const g = Math.round(190 - 140 * t)
    ctx.strokeStyle = `rgb(${r},${g},60)`
    ctx.lineWidth = 34
    ctx.beginPath()
    ctx.arc(cx, cy, R * 0.86, a0 + (a1 - a0) * t, a0 + (a1 - a0) * (t + 1 / seg) + 0.01)
    ctx.stroke()
  }
  // ticks
  ctx.strokeStyle = INK
  for (let i = 0; i <= 10; i++) {
    const a = a0 + ((a1 - a0) * i) / 10
    ctx.lineWidth = i % 5 === 0 ? 6 : 3
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * R * 0.66, cy + Math.sin(a) * R * 0.66)
    ctx.lineTo(cx + Math.cos(a) * R * (i % 5 === 0 ? 0.56 : 0.6), cy + Math.sin(a) * R * (i % 5 === 0 ? 0.56 : 0.6))
    ctx.stroke()
  }
  ctx.fillStyle = '#2f7d3a'
  fitText(ctx, 'GOOD', cx - R * 0.62, cy + R * 0.2, 150, 58, FONT_DISPLAY, 700)
  ctx.fillStyle = '#b8332a'
  fitText(ctx, 'BAD', cx + R * 0.62, cy + R * 0.2, 150, 58, FONT_DISPLAY, 700)
  ctx.fillStyle = INK
  fitText(ctx, 'FORM-O-METER', cx, cy + R * 0.48, w * 0.6, 44, FONT_DISPLAY, 700)
  ctx.fillStyle = '#6b7275'
  fitText(ctx, 'ROW-PERGFECT 1.0', cx, cy + R * 0.7, w * 0.5, 28, FONT_MONO, 600)
  grime(ctx, w, h, 5, 0.4)
}

function lampLabels(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = '#23292b'
  ctx.fillRect(0, 0, w, h)
  const n = LAMP_ORDER.length
  LAMP_ORDER.forEach((k, i) => {
    ctx.fillStyle = '#EAE3D2'
    fitText(ctx, k.toUpperCase(), (w * (i + 0.5)) / n, h / 2 + 2, w / n - 12, 54, FONT_DISPLAY, 700)
  })
}

function benchPlate(p: ProjectContent) {
  return {
    id: `bench:${p.id}`,
    w: 512,
    h: 256,
    draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      ctx.fillStyle = '#081420'
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = '#9fd8ff'
      fitText(ctx, p.name.toUpperCase(), w / 2, 40, w - 40, 40, FONT_DISPLAY, 700)
      ctx.fillStyle = '#6fa8c8'
      const lines = clampLines(wrapMono(p.oneLiner, 38), 5, 38)
      ctx.font = `600 18px ${FONT_MONO}`
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      lines.forEach((l, i) => ctx.fillText(l, 24, 78 + i * 25))
      ctx.fillStyle = '#d6efff'
      fitText(ctx, '> PRESS E TO INSPECT', w / 2, h - 24, w - 40, 22, FONT_MONO, 600)
    },
  }
}

export function buildRndSigns(benchProjects: ProjectContent[]): RndSigns {
  const featured = PROJECTS.filter((p) => p.featured)
  const atlas = buildAtlas(
    [
      {
        id: 'rig',
        w: 1024,
        h: 150,
        draw: (ctx, w, h) => {
          ctx.fillStyle = PALETTE.hazard
          ctx.fillRect(0, 0, w, h)
          ctx.fillStyle = INK
          ctx.fillRect(0, 0, 200, h)
          ctx.fillStyle = PALETTE.hazard
          fitText(ctx, 'RIG 02', 100, h / 2 + 3, 170, 70, FONT_DISPLAY, 700)
          ctx.fillStyle = INK
          fitText(ctx, 'ROW-PERGFECT FORM TESTER', 200 + (w - 200) / 2, h / 2 + 3, w - 240, 84, FONT_DISPLAY, 700)
          grime(ctx, w, h, 8, 0.5)
        },
      },
      {
        id: 'scanner',
        w: 1024,
        h: 150,
        draw: (ctx, w, h) => {
          ctx.fillStyle = '#1d2830'
          ctx.fillRect(0, 0, w, h)
          ctx.fillStyle = PURPLE
          ctx.fillRect(0, 0, 200, h)
          ctx.fillStyle = '#f2eef8'
          fitText(ctx, 'RIG 01', 100, h / 2 + 3, 170, 70, FONT_DISPLAY, 700)
          ctx.fillStyle = '#d9ecff'
          fitText(ctx, 'GAUSSIAN-SLAM SCANNER', 200 + (w - 200) / 2, h / 2 + 3, w - 240, 84, FONT_DISPLAY, 700)
        },
      },
      { id: 'dial', w: 512, h: 512, draw: dial },
      { id: 'lamps', w: 512, h: 96, draw: lampLabels },
      {
        id: 'dnp1',
        w: 512,
        h: 140,
        draw: (ctx, w, h) => {
          ctx.fillStyle = '#f4f0e4'
          roundRectPath(ctx, 4, 4, w - 8, h - 8, 18)
          ctx.fill()
          ctx.fillStyle = '#c8302a'
          roundRectPath(ctx, 14, 14, w - 28, h - 28, 12)
          ctx.fill()
          ctx.fillStyle = '#ffffff'
          fitText(ctx, 'DO NOT PRESS', w / 2, h / 2 + 3, w - 60, 84, FONT_DISPLAY, 700)
        },
      },
      {
        id: 'dnp2',
        w: 900,
        h: 160,
        draw: (ctx, w, h) => {
          ctx.fillStyle = '#1a1a1a'
          ctx.fillRect(0, 0, w, h)
          ctx.fillStyle = PALETTE.hazard
          ctx.fillRect(0, 0, w, 14)
          ctx.fillRect(0, h - 14, w, 14)
          ctx.fillStyle = '#ff4b3e'
          fitText(ctx, 'SERIOUSLY, DO NOT PRESS', w / 2, h / 2 + 3, w - 60, 92, FONT_DISPLAY, 700)
        },
      },
      {
        id: 'thanks',
        w: 1024,
        h: 220,
        draw: (ctx, w, h) => {
          ctx.fillStyle = '#10161a'
          ctx.fillRect(0, 0, w, h)
          ctx.strokeStyle = '#5dbb63'
          ctx.lineWidth = 10
          ctx.strokeRect(12, 12, w - 24, h - 24)
          ctx.fillStyle = '#e9ffe9'
          fitText(ctx, 'THANK YOU FOR YOUR FEEDBACK', w / 2, h / 2 - 12, w - 90, 96, FONT_DISPLAY, 700)
          ctx.fillStyle = '#8fd18f'
          fitText(ctx, 'IT HAS BEEN FILED APPROPRIATELY', w / 2, h - 46, w - 200, 34, FONT_MONO, 600)
        },
      },
      {
        id: 'info',
        w: 512,
        h: 342,
        draw: (ctx, w, h) => {
          ctx.fillStyle = '#f3f1ea'
          ctx.fillRect(0, 0, w, h)
          ctx.fillStyle = PURPLE
          ctx.fillRect(0, 0, w, 72)
          ctx.fillStyle = '#ffffff'
          fitText(ctx, 'R&D ANNEX', w / 2, 38, w - 40, 58, FONT_DISPLAY, 700)
          ctx.fillStyle = INK
          fitText(ctx, RND_ANNEX.title === 'R&D Annex' ? 'FEATURED BUILDS' : RND_ANNEX.title.toUpperCase(), 22, 102, w - 44, 34, FONT_DISPLAY, 700, 'left')
          featured.slice(0, 4).forEach((p, i) => {
            ctx.fillStyle = PURPLE
            ctx.fillRect(22, 132 + i * 40, 10, 26)
            ctx.fillStyle = '#2b3033'
            fitText(ctx, `RIG ${String(i + 1).padStart(2, '0')} · ${p.name}`, 44, 146 + i * 40, w - 70, 30, FONT_DISPLAY, 600, 'left')
          })
          ctx.fillStyle = PURPLE
          ctx.fillRect(0, h - 50, w, 50)
          ctx.fillStyle = '#ffffff'
          fitText(ctx, 'PRESS E · ANNEX DIRECTORY', w / 2, h - 24, w - 40, 30, FONT_DISPLAY, 700)
          grime(ctx, w, h, 33, 0.35)
        },
      },
      ...benchProjects.map(benchPlate),
    ],
    2048,
    4,
    8,
  )
  return { texture: atlas.texture, uv: atlas.uv }
}

export function makeRndSignMaterials(texture: THREE.Texture) {
  const sign = new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: '#ffffff', emissiveIntensity: 0.25, roughness: 0.6, metalness: 0.05 })
  sign.name = 'stations-b:rnd-signs'
  const lit = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
  lit.name = 'stations-b:rnd-signs-lit'
  return { sign, lit }
}
