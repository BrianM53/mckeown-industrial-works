import type { Vec2 } from '@/core/types'
import { ANCHORS, PAD, PATHS, PRINCIPAL_ZONES, TOWER, TRACK, WORLD_BOUNDS, ZONE_LIST, ZONES, type ZoneId } from '@/world/layout'
import { type Ctx, fitText, font, roundRect } from '../lib/canvas'

/**
 * "YOU ARE HERE" board art, generated from world/layout.ts (zones, buildings,
 * paths, tower, pad) in zone colours. The kiosk faces EAST, so the visitor
 * reading it faces WEST: the map is drawn forward-up (west at the top, north
 * to the right) so it lines up with what they see — wayfinding-board best
 * practice — with a compass rose to make that explicit.
 */
export interface MapRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Project a world (x, z) into the map rect for a viewer facing WEST
 * (forward-up): screen-up = -X, screen-right = -Z (north).
 */
export function projectForwardUp(x: number, z: number, r: MapRect): Vec2 {
  const B = WORLD_BOUNDS
  const u = (B.maxZ - z) / (B.maxZ - B.minZ) // 0 at the south edge (left) → 1 at the north edge (right)
  const v = (x - B.minX) / (B.maxX - B.minX) // 0 at the west edge (top) → 1 at the east edge (bottom)
  return [r.x + u * r.w, r.y + v * r.h]
}

/** Aspect (w/h) the map area should have so the world is not distorted. */
export const MAP_ASPECT = (WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ) / (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX)

function rectPx(rect: { minX: number; maxX: number; minZ: number; maxZ: number }, r: MapRect): [number, number, number, number] {
  const [x0, y0] = projectForwardUp(rect.minX, rect.maxZ, r)
  const [x1, y1] = projectForwardUp(rect.maxX, rect.minZ, r)
  return [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)]
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.replace('#', ''), 16)
  const r = Math.min(255, Math.round(((n >> 16) & 255) * k))
  const g = Math.min(255, Math.round(((n >> 8) & 255) * k))
  const b = Math.min(255, Math.round((n & 255) * k))
  return `rgb(${r},${g},${b})`
}

/** Label anchors (world) where zone centres would collide with other marks. */
const LABEL_AT: Partial<Record<ZoneId, Vec2>> = {
  launch: [-6, -40],
  production: [0, 14],
  intake: [0, 37],
  tower: [0, -14.5],
}

export function drawDirectoryBoard(ctx: Ctx, w: number, h: number): void {
  // board background
  ctx.fillStyle = '#1d2627'
  ctx.fillRect(0, 0, w, h)
  // header
  ctx.fillStyle = '#E9B63F'
  ctx.fillRect(0, 0, w, 8)
  fitText(ctx, 'SITE DIRECTORY', 28, 56, w * 0.62, 56, { align: 'left', color: '#f2ead6', tracking: 0.04 })
  fitText(ctx, 'McKEOWN INDUSTRIAL WORKS', 30, 98, w * 0.6, 22, { align: 'left', weight: 600, color: '#9fb0ae', tracking: 0.08 })
  // you-are-here legend
  ctx.fillStyle = '#ff3b2f'
  ctx.beginPath()
  ctx.arc(w - 200, 62, 14, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 3
  ctx.stroke()
  fitText(ctx, 'YOU ARE HERE', w - 178, 63, 170, 26, { align: 'left', color: '#ffffff' })

  // map frame
  const pad = 22
  const top = 128
  const bottom = 118
  let mw = w - pad * 2
  let mh = h - top - bottom
  if (mw / mh > MAP_ASPECT) mw = mh * MAP_ASPECT
  else mh = mw / MAP_ASPECT
  const r: MapRect = { x: (w - mw) / 2, y: top + (h - top - bottom - mh) / 2, w: mw, h: mh }
  ctx.fillStyle = '#4b4f4a'
  ctx.fillRect(r.x - 6, r.y - 6, r.w + 12, r.h + 12)
  ctx.fillStyle = '#6d6e66'
  ctx.fillRect(r.x, r.y, r.w, r.h)

  // painted paths
  for (const p of PATHS) {
    const [x, y, pw, ph] = rectPx(p.rect, r)
    ctx.fillStyle = p.kind === 'plaza' ? '#83847b' : '#8f9086'
    ctx.fillRect(x, y, pw, ph)
  }
  // zones (open areas get a tinted outline, buildings a solid block)
  const sorted = [...ZONE_LIST].sort((a, b) => Number(!!a.building) - Number(!!b.building))
  for (const z of sorted) {
    const [x, y, zw, zh] = rectPx(z.building ? z.building.footprint : z.bounds, r)
    if (z.building) {
      ctx.fillStyle = shade(z.color, 0.42)
      ctx.fillRect(x + 2, y + 3, zw, zh)
      ctx.fillStyle = z.color
      ctx.fillRect(x, y, zw, zh)
      ctx.strokeStyle = shade(z.color, 0.55)
      ctx.lineWidth = 2
      ctx.strokeRect(x + 1, y + 1, zw - 2, zh - 2)
    } else {
      ctx.fillStyle = z.color + '33'
      ctx.fillRect(x, y, zw, zh)
      ctx.strokeStyle = z.color
      ctx.lineWidth = 2.5
      ctx.setLineDash([7, 5])
      ctx.strokeRect(x + 1, y + 1, zw - 2, zh - 2)
      ctx.setLineDash([])
    }
  }
  // rocket tower, transporter track, launch pad
  {
    const [x, y, tw, th] = rectPx(TOWER.footprint, r)
    ctx.fillStyle = '#2b2f30'
    ctx.fillRect(x, y, tw, th)
    ctx.strokeStyle = '#FFB05A'
    ctx.lineWidth = 3
    ctx.strokeRect(x, y, tw, th)
    ctx.strokeStyle = '#cfc7b4'
    ctx.lineWidth = 3
    ctx.setLineDash([6, 4])
    ctx.beginPath()
    TRACK.points.forEach(([px, pz], i) => {
      const [sx, sy] = projectForwardUp(px, pz, r)
      if (i === 0) ctx.moveTo(sx, sy)
      else ctx.lineTo(sx, sy)
    })
    ctx.stroke()
    ctx.setLineDash([])
    const [cx, cy] = projectForwardUp(PAD.center[0], PAD.center[1], r)
    const rad = (PAD.blastRadius / (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX)) * r.h
    ctx.fillStyle = 'rgba(217,72,59,0.35)'
    ctx.beginPath()
    ctx.arc(cx, cy, rad, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#D9483B'
    ctx.lineWidth = 3
    ctx.stroke()
    // tiny rocket glyph
    ctx.fillStyle = '#f2ead6'
    ctx.beginPath()
    ctx.moveTo(cx, cy - 11)
    ctx.lineTo(cx + 5, cy + 6)
    ctx.lineTo(cx - 5, cy + 6)
    ctx.closePath()
    ctx.fill()
  }
  // labels
  for (const z of ZONE_LIST) {
    const at = LABEL_AT[z.id] ?? z.center
    const [lx, ly] = projectForwardUp(at[0], at[1], r)
    const principal = z.principal
    const size = principal ? 19 : 14
    ctx.font = font(size, 700)
    const label = z.shortName.toUpperCase()
    const tw = Math.min(ctx.measureText(label).width + 12, r.w * 0.3)
    if (principal) {
      ctx.fillStyle = 'rgba(16,20,20,0.82)'
      roundRect(ctx, lx - tw / 2, ly - size * 0.75, tw, size * 1.5, 5)
      ctx.fill()
    }
    fitText(ctx, label, lx, ly + 1, r.w * 0.28, size, { color: principal ? '#ffffff' : '#1d2122' })
  }
  // principal destination markers (numbered like the directory panel)
  PRINCIPAL_ZONES.forEach((id, i) => {
    const z = ZONES[id]
    const [ex, ey] = projectForwardUp(z.entrance[0], z.entrance[1], r)
    ctx.fillStyle = z.color
    ctx.beginPath()
    ctx.arc(ex, ey, 11, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#111'
    ctx.lineWidth = 2
    ctx.stroke()
    fitText(ctx, String(i + 1), ex, ey + 1, 16, 15, { color: '#111' })
  })
  // YOU ARE HERE: red dot at the kiosk (with a view cone pointing "up" = the way the visitor faces)
  const [hx, hy] = projectForwardUp(ANCHORS.directoryKiosk.interact[0], ANCHORS.directoryKiosk.interact[1], r)
  ctx.fillStyle = 'rgba(255,59,47,0.25)'
  ctx.beginPath()
  ctx.moveTo(hx, hy)
  ctx.arc(hx, hy, 46, -Math.PI / 2 - 0.45, -Math.PI / 2 + 0.45)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#ff3b2f'
  ctx.beginPath()
  ctx.arc(hx, hy, 13, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 4
  ctx.stroke()

  // compass: north points RIGHT on this board
  {
    const cx = r.x + r.w - 40
    const cy = r.y + r.h - 44
    ctx.fillStyle = 'rgba(16,20,20,0.75)'
    ctx.beginPath()
    ctx.arc(cx, cy, 30, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ff3b2f'
    ctx.beginPath()
    ctx.moveTo(cx + 24, cy)
    ctx.lineTo(cx - 4, cy - 8)
    ctx.lineTo(cx - 4, cy + 8)
    ctx.closePath()
    ctx.fill()
    fitText(ctx, 'N', cx - 14, cy + 1, 16, 18, { color: '#ffffff' })
  }

  // footer legend
  const fy = h - bottom + 16
  ctx.fillStyle = '#2b3536'
  ctx.fillRect(0, fy - 8, w, bottom - 8)
  const items = PRINCIPAL_ZONES.map((id, i) => `${i + 1} ${ZONES[id].shortName.toUpperCase()}`)
  const colW = (w - 40) / 3
  items.forEach((t, i) => {
    const col = i % 3
    const row = Math.floor(i / 3)
    const x = 26 + col * colW
    const y = fy + 18 + row * 32
    ctx.fillStyle = ZONES[PRINCIPAL_ZONES[i]].color
    ctx.beginPath()
    ctx.arc(x + 8, y, 8, 0, Math.PI * 2)
    ctx.fill()
    fitText(ctx, t, x + 24, y + 1, colW - 32, 21, { align: 'left', color: '#e9e2cf' })
  })
  fitText(ctx, 'MAP FACES THE WAY YOU DO · PRESS M FOR THE DIRECTORY', w / 2, h - 18, w - 40, 17, { weight: 600, color: '#E9B63F', tracking: 0.04 })
}
