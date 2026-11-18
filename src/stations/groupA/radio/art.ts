import { PODCAST } from '@/content/stations'
import { type AtlasItem, type Ctx, fitText, fitWrapped, font, grime, rivets, roundRect } from '../lib/canvas'
import { STATION_MHZ, dialFraction } from './onAir'

/**
 * Broadcast Booth art. The poster's show, episode title and date are the REAL
 * values from src/content/stations.ts (PODCAST); the station call sign
 * "WMIW 101.3" is in-world fiction.
 */
export const CALL_SIGN = 'WMIW 101.3 FM'

export function drawOnAir(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = '#2a0805'
  ctx.fillRect(0, 0, w, h)
  const g = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.6)
  g.addColorStop(0, '#ff5a3c')
  g.addColorStop(1, '#a3180f')
  ctx.fillStyle = g
  roundRect(ctx, 10, 10, w - 20, h - 20, 18)
  ctx.fill()
  fitText(ctx, 'ON AIR', w / 2, h / 2 + 4, w - 70, h * 0.62, { color: '#fff4ea', tracking: 0.12 })
}

function drawCallSign(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = '#1c1414'
  roundRect(ctx, 0, 0, w, h, 12)
  ctx.fill()
  ctx.strokeStyle = '#C8553D'
  ctx.lineWidth = 5
  roundRect(ctx, 6, 6, w - 12, h - 12, 9)
  ctx.stroke()
  fitText(ctx, CALL_SIGN, w * 0.3, h / 2 + 2, w * 0.5, h * 0.6, { color: '#f4e7d8', tracking: 0.06 })
  fitText(ctx, 'THE FACTORY FLOOR', w * 0.73, h / 2 + 2, w * 0.42, h * 0.42, { weight: 600, color: '#ff9a7a', tracking: 0.08 })
}

/** The framed episode poster (real title/date from content). */
export function drawPoster(ctx: Ctx, w: number, h: number): void {
  const bg = ctx.createLinearGradient(0, 0, 0, h)
  bg.addColorStop(0, '#1f2a33')
  bg.addColorStop(1, '#141a20')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)
  // sound-wave motif
  ctx.strokeStyle = 'rgba(200,85,61,0.5)'
  ctx.lineWidth = 6
  for (let k = 0; k < 3; k++) {
    ctx.beginPath()
    ctx.arc(w * 0.5, h * 0.27, 70 + k * 46, Math.PI * 1.15, Math.PI * 1.85)
    ctx.stroke()
  }
  // microphone glyph
  ctx.fillStyle = '#e9e2d4'
  roundRect(ctx, w / 2 - 28, h * 0.17, 56, 96, 28)
  ctx.fill()
  ctx.fillStyle = '#C8553D'
  ctx.fillRect(w / 2 - 4, h * 0.17 + 96, 8, 30)
  ctx.fillRect(w / 2 - 34, h * 0.17 + 124, 68, 8)
  // show + label
  fitText(ctx, PODCAST.show.toUpperCase(), w / 2, h * 0.47, w - 60, 78, { color: '#f4ecdc', tracking: 0.08 })
  fitText(ctx, 'FEATURED INTERVIEW', w / 2, h * 0.535, w - 80, 28, { weight: 600, color: '#ff9a7a', tracking: 0.16 })
  ctx.fillStyle = '#C8553D'
  ctx.fillRect(w * 0.18, h * 0.565, w * 0.64, 4)
  // real episode title, wrapped
  const { size, lines } = fitWrapped(ctx, PODCAST.episodeTitle, w - 70, 6, 40, 700)
  ctx.font = font(size, 700)
  ctx.fillStyle = '#f2ead6'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const y0 = h * 0.62
  lines.forEach((l, i) => ctx.fillText(l, w / 2, y0 + i * size * 1.18))
  if (PODCAST.date) fitText(ctx, PODCAST.date.toUpperCase(), w / 2, h * 0.9, w - 80, 24, { weight: 600, color: '#9fb2bc', tracking: 0.1 })
  fitText(ctx, 'TUNE IN AT THE DESK', w / 2, h * 0.955, w - 80, 22, { weight: 600, color: '#E9B63F', tracking: 0.1 })
  grime(ctx, 0, 0, w, h, 909, 0.05, 300)
}

function drawDial(ctx: Ctx, w: number, h: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#f6e7bf')
  g.addColorStop(1, '#e2c98a')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  const x0 = 40
  const x1 = w - 40
  ctx.strokeStyle = '#3b2a14'
  ctx.fillStyle = '#3b2a14'
  for (let mhz = 88; mhz <= 108; mhz += 0.5) {
    const x = x0 + dialFraction(mhz) * (x1 - x0)
    const major = Math.abs(mhz % 2) < 0.01
    ctx.lineWidth = major ? 3 : 1.5
    ctx.beginPath()
    ctx.moveTo(x, h * 0.62)
    ctx.lineTo(x, h * (major ? 0.36 : 0.48))
    ctx.stroke()
    if (major) {
      ctx.font = font(h * 0.2, 700)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(mhz), x, h * 0.2)
    }
  }
  // the station's mark
  const sx = x0 + dialFraction(STATION_MHZ) * (x1 - x0)
  ctx.fillStyle = '#c8302a'
  ctx.beginPath()
  ctx.moveTo(sx, h * 0.68)
  ctx.lineTo(sx - 9, h * 0.84)
  ctx.lineTo(sx + 9, h * 0.84)
  ctx.closePath()
  ctx.fill()
  fitText(ctx, 'FM  MHz', 60, h * 0.88, 120, h * 0.14, { align: 'left', weight: 600, color: '#5a4320' })
  fitText(ctx, CALL_SIGN, w - 50, h * 0.88, 220, h * 0.14, { align: 'right', weight: 600, color: '#8a2a1e' })
}

function drawVu(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = '#f3e3b4'
  ctx.fillRect(0, 0, w, h)
  const cx = w / 2
  const cy = h * 0.95
  const R = h * 0.78
  ctx.lineWidth = 3
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * (1.2 + 0.6 * (i / 10))
    ctx.strokeStyle = i >= 8 ? '#c8302a' : '#2a2210'
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * R * 0.82, cy + Math.sin(a) * R * 0.82)
    ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R)
    ctx.stroke()
  }
  ctx.strokeStyle = '#c8302a'
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.arc(cx, cy, R * 0.9, Math.PI * 1.68, Math.PI * 1.8)
  ctx.stroke()
  fitText(ctx, 'VU', cx, h * 0.55, 60, h * 0.2, { color: '#2a2210' })
}

function drawMixer(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = '#2b3033'
  ctx.fillRect(0, 0, w, h)
  const ch = 16
  const cw = w / ch
  for (let i = 0; i < ch; i++) {
    const x = i * cw
    ctx.fillStyle = i % 2 ? '#30363a' : '#2a2f32'
    ctx.fillRect(x + 1, 0, cw - 2, h)
    // knob rings (upper half)
    for (let k = 0; k < 3; k++) {
      ctx.strokeStyle = ['#c8553d', '#e9b63f', '#638c88'][k]
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(x + cw / 2, h * (0.12 + k * 0.12), cw * 0.28, 0, Math.PI * 2)
      ctx.stroke()
    }
    // fader slot (lower half)
    ctx.fillStyle = '#0f1213'
    ctx.fillRect(x + cw / 2 - 2, h * 0.5, 4, h * 0.42)
    ctx.fillStyle = '#cfd5d2'
    for (let k = 0; k < 6; k++) ctx.fillRect(x + cw / 2 + 6, h * (0.52 + k * 0.075), 5, 1.5)
    ctx.fillStyle = '#9fb0ae'
    ctx.font = font(h * 0.045, 600, true)
    ctx.textAlign = 'center'
    ctx.fillText(String(i + 1), x + cw / 2, h * 0.47)
  }
}

function drawCart(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = '#1d2122'
  roundRect(ctx, 0, 0, w, h, 8)
  ctx.fill()
  fitText(ctx, 'STATION JINGLES', w / 2, h * 0.38, w - 20, h * 0.36, { color: '#f2ead6', tracking: 0.06 })
  fitText(ctx, 'CART 1 · 0:06', w / 2, h * 0.74, w - 30, h * 0.24, { weight: 600, mono: true, color: '#E9B63F' })
}

function drawDeskPlate(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = '#C8553D'
  roundRect(ctx, 0, 0, w, h, 10)
  ctx.fill()
  fitText(ctx, `${PODCAST.show.toUpperCase()} STUDIO · ${CALL_SIGN}`, w / 2, h / 2 + 2, w - 40, h * 0.5, { color: '#fff3e8', tracking: 0.08 })
  rivets(ctx, 0, 0, w, h, 12, 4, '#6b2016')
}

function drawRfSign(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = '#f1ece0'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#E9B63F'
  ctx.fillRect(0, 0, w, h * 0.34)
  fitText(ctx, 'CAUTION', w / 2, h * 0.18, w - 20, h * 0.24, { color: '#1d2122', tracking: 0.1 })
  fitText(ctx, 'RF ENERGY', w / 2, h * 0.5, w - 20, h * 0.2, { color: '#1d2122' })
  fitText(ctx, 'DO NOT CLIMB (WE MEAN IT)', w / 2, h * 0.77, w - 20, h * 0.13, { weight: 600, color: '#c8302a' })
}

export function radioAtlasItems(): AtlasItem[] {
  return [
    { key: 'poster', w: 600, h: 800, draw: drawPoster },
    { key: 'callsign', w: 900, h: 90, draw: drawCallSign },
    { key: 'dial', w: 640, h: 180, draw: drawDial },
    { key: 'vu', w: 200, h: 130, draw: drawVu },
    { key: 'mixer', w: 512, h: 256, draw: drawMixer },
    { key: 'cart', w: 260, h: 80, draw: drawCart },
    { key: 'plate', w: 560, h: 64, draw: drawDeskPlate },
    { key: 'rf', w: 220, h: 200, draw: drawRfSign },
  ]
}
