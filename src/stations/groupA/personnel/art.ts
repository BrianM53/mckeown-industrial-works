import { PROFILE } from '@/content/profile'
import { createRng } from '@/core/rng'
import { type AtlasItem, type Ctx, fitText, fitWrapped, font, grime, hazardBand, rivets, roundRect } from '../lib/canvas'

/**
 * Canvas art for the Personnel Office. Real facts (name, headline) come from
 * src/content/profile.ts; everything else is in-world fiction.
 */

const INK = '#1f2324'
const RED_INK = '#c8302a'

// ---------------------------------------------------------------------------
// The printed résumé sheet (giant "A-whatever" page)
// ---------------------------------------------------------------------------

export const SHEET_PX = { w: 360, h: 460 }

export function drawSheet(ctx: Ctx, w: number, h: number, stamped: boolean): void {
  ctx.fillStyle = '#f7f3e8'
  ctx.fillRect(0, 0, w, h)
  // subtle paper grain
  grime(ctx, 0, 0, w, h, 77, 0.035, 500)
  // header band
  ctx.fillStyle = '#2c3a3c'
  ctx.fillRect(0, 0, w, 64)
  ctx.fillStyle = '#E9B63F'
  ctx.fillRect(0, 64, w, 5)
  fitText(ctx, PROFILE.name.toUpperCase(), w / 2, 27, w - 40, 30, { color: '#f4efe2', tracking: 0.04 })
  fitText(ctx, PROFILE.headline, w / 2, 50, w - 40, 15, { weight: 600, color: '#d9d2bf' })
  // section blocks with illegible "text" lines
  const sections = ['EXPERIENCE', 'EDUCATION', 'SKILLS', 'PROJECTS']
  const rng = createRng(4242)
  let y = 92
  for (const s of sections) {
    fitText(ctx, s, 24, y, 200, 15, { align: 'left', color: '#3e5658' })
    ctx.fillStyle = '#c9c2ae'
    ctx.fillRect(24, y + 9, w - 48, 1.5)
    y += 18
    const lines = s === 'SKILLS' ? 2 : 4
    for (let i = 0; i < lines; i++) {
      const lw = (w - 60) * (0.55 + rng() * 0.42)
      ctx.fillStyle = 'rgba(60,64,66,0.55)'
      roundRect(ctx, 28, y, lw, 5, 2.5)
      ctx.fill()
      y += 12
    }
    y += 16
  }
  ctx.fillStyle = 'rgba(60,64,66,0.4)'
  fitText(ctx, 'RÉSUMÉ-O-MATIC 3000 · OFFICIAL COPY', w / 2, h - 16, w - 30, 11, { weight: 600, mono: true, color: 'rgba(60,64,66,0.55)' })
  if (stamped) drawApprovedStamp(ctx, w / 2 + 6, h * 0.56, w * 0.86)
}

/** Red rubber-stamp mark: APPROVED FOR EMPLOYMENT (slightly rotated, distressed). */
export function drawApprovedStamp(ctx: Ctx, cx: number, cy: number, width: number): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(-0.21)
  const w = width
  const h = width * 0.42
  ctx.globalAlpha = 0.88
  ctx.strokeStyle = RED_INK
  ctx.lineWidth = Math.max(3, w * 0.022)
  roundRect(ctx, -w / 2, -h / 2, w, h, h * 0.12)
  ctx.stroke()
  ctx.lineWidth = Math.max(1.5, w * 0.008)
  roundRect(ctx, -w / 2 + w * 0.035, -h / 2 + w * 0.035, w - w * 0.07, h - w * 0.07, h * 0.08)
  ctx.stroke()
  fitText(ctx, 'APPROVED', 0, -h * 0.13, w * 0.82, h * 0.5, { color: RED_INK, tracking: 0.06 })
  fitText(ctx, 'FOR EMPLOYMENT', 0, h * 0.24, w * 0.78, h * 0.22, { color: RED_INK, tracking: 0.08 })
  // ink voids (distressed stamp)
  ctx.globalCompositeOperation = 'destination-out'
  const rng = createRng(1957)
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.25 + rng() * 0.6})`
    ctx.beginPath()
    ctx.arc((rng() - 0.5) * w, (rng() - 0.5) * h, 0.6 + rng() * 2.2, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

// ---------------------------------------------------------------------------
// Employee of the Month portraits: the same exhausted forklift driver, monthly
// ---------------------------------------------------------------------------

export const PORTRAIT_PX = { w: 256, h: 320 }
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER']

/** The six most recent month names ending with the current month (oldest first). */
export function recentMonths(now: Date = new Date(), n = 6): string[] {
  const m = Number.isFinite(now.getTime()) ? now.getMonth() : 0
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) out.push(MONTHS[(m - i + 120) % 12])
  return out
}

/**
 * One portrait. `tired` 0..1 grows month by month: droopier eyes, darker bags,
 * a hat that slowly gives up, more coffee. The last one is asleep.
 */
export function drawPortrait(ctx: Ctx, w: number, h: number, month: string, tired: number, seed: number): void {
  const rng = createRng(seed)
  const imgH = h - 70
  // studio backdrop
  const bg = ctx.createRadialGradient(w * 0.5, imgH * 0.38, 10, w * 0.5, imgH * 0.5, w * 0.8)
  bg.addColorStop(0, '#9fb4bf')
  bg.addColorStop(1, '#4d6470')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, imgH)
  // forklift silhouette in the background (he loves it, it owns him)
  ctx.fillStyle = 'rgba(40,52,58,0.35)'
  ctx.fillRect(w * 0.66, imgH * 0.46, w * 0.26, imgH * 0.2)
  ctx.fillRect(w * 0.84, imgH * 0.2, w * 0.03, imgH * 0.46)
  ctx.beginPath()
  ctx.arc(w * 0.71, imgH * 0.68, w * 0.045, 0, Math.PI * 2)
  ctx.arc(w * 0.86, imgH * 0.68, w * 0.045, 0, Math.PI * 2)
  ctx.fill()

  const cx = w * 0.5 + (rng() - 0.5) * 6
  const headY = imgH * 0.44 + tired * 6
  const tilt = (rng() - 0.5) * 0.08 + tired * 0.12 * (seed % 2 ? 1 : -1)
  // shoulders: shirt + hi-vis vest
  ctx.fillStyle = '#4A3B30'
  roundRect(ctx, cx - w * 0.36, imgH * 0.72, w * 0.72, imgH * 0.4, 40)
  ctx.fill()
  ctx.fillStyle = '#E57D35'
  roundRect(ctx, cx - w * 0.34, imgH * 0.75, w * 0.22, imgH * 0.3, 18)
  ctx.fill()
  roundRect(ctx, cx + w * 0.12, imgH * 0.75, w * 0.22, imgH * 0.3, 18)
  ctx.fill()
  ctx.fillStyle = '#e8ecdf'
  ctx.fillRect(cx - w * 0.32, imgH * 0.86, w * 0.18, 7)
  ctx.fillRect(cx + w * 0.14, imgH * 0.86, w * 0.18, 7)
  // name badge
  ctx.fillStyle = '#f2ecdc'
  ctx.fillRect(cx + w * 0.17, imgH * 0.78, w * 0.12, 12)
  ctx.fillStyle = RED_INK
  ctx.font = font(9, 700)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('DALE', cx + w * 0.23, imgH * 0.78 + 6.5)

  ctx.save()
  ctx.translate(cx, headY)
  ctx.rotate(tilt)
  // neck + head
  ctx.fillStyle = '#b98663'
  ctx.fillRect(-16, 30, 32, 34)
  ctx.fillStyle = '#c99a76'
  ctx.beginPath()
  ctx.ellipse(0, 0, 50, 60, 0, 0, Math.PI * 2)
  ctx.fill()
  // ears
  ctx.beginPath()
  ctx.ellipse(-50, 4, 9, 14, 0, 0, Math.PI * 2)
  ctx.ellipse(50, 4, 9, 14, 0, 0, Math.PI * 2)
  ctx.fill()
  // stubble
  ctx.fillStyle = `rgba(70,50,40,${0.12 + tired * 0.22})`
  for (let i = 0; i < 70 + tired * 120; i++) {
    const a = rng() * Math.PI
    const r = 30 + rng() * 26
    ctx.fillRect(Math.cos(a) * r * 0.9, 18 + Math.sin(a) * r * 0.55, 1.6, 1.6)
  }
  // eye bags (darker every month)
  const asleep = tired >= 0.99
  for (const sx of [-1, 1]) {
    const ex = sx * 19
    ctx.fillStyle = `rgba(95,70,90,${0.18 + tired * 0.45})`
    ctx.beginPath()
    ctx.ellipse(ex, 4, 15, 8 + tired * 4, 0, 0, Math.PI)
    ctx.fill()
    if (asleep) {
      ctx.strokeStyle = '#2a2324'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(ex, -6, 9, 0.15 * Math.PI, 0.85 * Math.PI)
      ctx.stroke()
    } else {
      // eye white + pupil, eyelid drooping lower each month
      ctx.fillStyle = '#f3efe6'
      ctx.beginPath()
      ctx.ellipse(ex, -6, 11, 8, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#2a2324'
      ctx.beginPath()
      ctx.arc(ex + (rng() - 0.5) * 3, -4, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#c99a76'
      const lid = 0.25 + tired * 0.62
      ctx.fillRect(ex - 13, -16, 26, 20 * lid)
      ctx.strokeStyle = '#7c5a44'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(ex - 12, -16 + 20 * lid)
      ctx.lineTo(ex + 12, -16 + 20 * lid)
      ctx.stroke()
    }
    // eyebrows, sagging
    ctx.strokeStyle = '#4a3428'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(ex - 13, -22 + sx * tired * 3)
    ctx.lineTo(ex + 13, -22 - sx * tired * 3 + tired * 4)
    ctx.stroke()
  }
  // nose
  ctx.fillStyle = '#b5845f'
  ctx.beginPath()
  ctx.ellipse(0, 12, 7, 11, 0, 0, Math.PI * 2)
  ctx.fill()
  // mustache + mouth (forced smile flattening over time)
  ctx.fillStyle = '#4a3428'
  roundRect(ctx, -22, 25, 44, 9, 4)
  ctx.fill()
  ctx.strokeStyle = '#6b3b32'
  ctx.lineWidth = 3
  ctx.beginPath()
  const smile = (1 - tired) * 7 - 1
  ctx.moveTo(-16, 41)
  ctx.quadraticCurveTo(0, 41 + smile, 16, 41 - tired * 2)
  ctx.stroke()
  // hard hat, slowly giving up
  ctx.save()
  ctx.translate(0, -44)
  ctx.rotate(-0.06 - tired * 0.32)
  ctx.fillStyle = '#4F86A8' // Dale's signal-blue hat (npc LOOK_DRIVER)
  ctx.beginPath()
  ctx.ellipse(0, 0, 58, 40, 0, Math.PI, 0)
  ctx.fill()
  ctx.fillRect(-66, -4, 132, 10)
  ctx.fillStyle = '#3B6A87'
  ctx.fillRect(-6, -40, 12, 38)
  ctx.restore()
  // hair sticking out
  ctx.strokeStyle = '#3b2a20'
  ctx.lineWidth = 3
  for (let i = 0; i < 3 + tired * 6; i++) {
    const x = -40 + rng() * 80
    ctx.beginPath()
    ctx.moveTo(x, -44)
    ctx.lineTo(x + (rng() - 0.5) * 14, -56 - rng() * 10)
    ctx.stroke()
  }
  ctx.restore()

  // coffee cups pile up
  const cups = Math.round(tired * 4)
  for (let i = 0; i < cups; i++) {
    const x = 16 + i * 20
    const y = imgH - 30
    ctx.fillStyle = '#efe9dd'
    ctx.fillRect(x, y, 15, 22)
    ctx.fillStyle = '#A95E39'
    ctx.fillRect(x, y + 8, 15, 6)
  }
  if (asleep) {
    ctx.fillStyle = '#f4efe2'
    ctx.font = font(26, 700)
    ctx.textAlign = 'left'
    ctx.fillText('z', w * 0.72, imgH * 0.2)
    ctx.font = font(34, 700)
    ctx.fillText('Z', w * 0.8, imgH * 0.12)
  }
  // photo vignette
  const vg = ctx.createRadialGradient(w / 2, imgH / 2, imgH * 0.3, w / 2, imgH / 2, imgH * 0.75)
  vg.addColorStop(0, 'rgba(0,0,0,0)')
  vg.addColorStop(1, 'rgba(0,0,0,0.35)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, w, imgH)

  // brass month plaque
  const py = imgH
  const g = ctx.createLinearGradient(0, py, 0, h)
  g.addColorStop(0, '#e2c46c')
  g.addColorStop(0.5, '#b98f35')
  g.addColorStop(1, '#8e6b24')
  ctx.fillStyle = g
  ctx.fillRect(0, py, w, h - py)
  fitText(ctx, month, w / 2, py + 24, w - 30, 30, { color: '#2a2210', tracking: 0.08 })
  fitText(ctx, 'DALE · FORKLIFT OPERATIONS', w / 2, py + 52, w - 30, 15, { weight: 600, color: '#3a2e14' })
}

// ---------------------------------------------------------------------------
// Static signage for the office (one atlas)
// ---------------------------------------------------------------------------

function drawHrSign(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = '#23302f'
  roundRect(ctx, 0, 0, w, h, 14)
  ctx.fill()
  ctx.strokeStyle = '#E9B63F'
  ctx.lineWidth = 6
  roundRect(ctx, 8, 8, w - 16, h - 16, 10)
  ctx.stroke()
  const main = 'HUMAN RESOURCES'
  ctx.font = font(h * 0.5, 700)
  const mw = ctx.measureText(main).width
  ctx.font = font(h * 0.3, 600)
  const sw = ctx.measureText(' (MOSTLY)').width
  const total = mw + sw
  const scale = Math.min(1, (w - 70) / total)
  const x0 = w / 2 - (total * scale) / 2
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.font = font(h * 0.5 * scale, 700)
  ctx.fillStyle = '#f2ead6'
  ctx.fillText(main, x0, h * 0.53)
  ctx.font = font(h * 0.3 * scale, 600)
  ctx.fillStyle = '#E9B63F'
  ctx.fillText(' (MOSTLY)', x0 + mw * scale, h * 0.57)
  rivets(ctx, 0, 0, w, h, 18, 6)
}

function drawEotmHeader(ctx: Ctx, w: number, h: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#e6c770')
  g.addColorStop(0.55, '#b98f35')
  g.addColorStop(1, '#8b6824')
  ctx.fillStyle = g
  roundRect(ctx, 0, 0, w, h, 10)
  ctx.fill()
  ctx.strokeStyle = '#5c4515'
  ctx.lineWidth = 3
  roundRect(ctx, 6, 6, w - 12, h - 12, 7)
  ctx.stroke()
  fitText(ctx, '★  EMPLOYEE OF THE MONTH  ★', w / 2, h / 2 + 2, w - 40, h * 0.56, { color: '#2a2210', tracking: 0.06 })
}

function drawNameplate(ctx: Ctx, w: number, h: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#ecd27e')
  g.addColorStop(0.5, '#c39a3c')
  g.addColorStop(1, '#94712a')
  ctx.fillStyle = g
  roundRect(ctx, 0, 0, w, h, 12)
  ctx.fill()
  ctx.strokeStyle = '#5c4515'
  ctx.lineWidth = 4
  roundRect(ctx, 7, 7, w - 14, h - 14, 8)
  ctx.stroke()
  fitText(ctx, 'RÉSUMÉ-O-MATIC 3000', w / 2, h * 0.43, w - 60, h * 0.42, { color: '#2a2210', tracking: 0.05 })
  fitText(ctx, 'EST. 1957 · KEEP HANDS, FEET & TIES CLEAR', w / 2, h * 0.78, w - 70, h * 0.16, { weight: 600, color: '#3d3015' })
  rivets(ctx, 0, 0, w, h, 16, 5, '#5c4515')
}

function drawGauge(ctx: Ctx, w: number, h: number, label: string, redFrom: number): void {
  const cx = w / 2
  const cy = h / 2
  const r = w / 2 - 4
  ctx.fillStyle = '#f2ecdc'
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  // sweep from 225° to -45° (clockwise), same as the needle mapping
  const a0 = Math.PI * 0.75
  const sweep = Math.PI * 1.5
  ctx.lineWidth = r * 0.16
  ctx.strokeStyle = '#c8302a'
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.8, a0 + sweep * redFrom, a0 + sweep)
  ctx.stroke()
  ctx.strokeStyle = '#5DBB63'
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.8, a0 + sweep * 0.25, a0 + sweep * Math.min(redFrom, 0.6))
  ctx.stroke()
  ctx.strokeStyle = INK
  for (let i = 0; i <= 10; i++) {
    const a = a0 + (sweep * i) / 10
    ctx.lineWidth = i % 5 === 0 ? 4 : 2
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62)
    ctx.lineTo(cx + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9)
    ctx.stroke()
  }
  fitText(ctx, label, cx, cy + r * 0.5, r * 1.3, r * 0.26, { color: INK })
}

function drawPrintLabel(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = '#1d2122'
  roundRect(ctx, 0, 0, w, h, 8)
  ctx.fill()
  fitText(ctx, 'PRINT', w / 2, h / 2 + 1, w - 16, h * 0.7, { color: '#f2ead6', tracking: 0.1 })
}

function drawShredLabel(ctx: Ctx, w: number, h: number): void {
  hazardBand(ctx, 0, 0, w, h, '#E9B63F', '#1d2122', h * 0.5)
  ctx.fillStyle = '#1d2122'
  roundRect(ctx, 10, 8, w - 20, h - 16, 6)
  ctx.fill()
  fitText(ctx, 'SHRED-O-MATIC', w / 2, h / 2 + 1, w - 36, h * 0.5, { color: '#E9B63F', tracking: 0.05 })
}

function drawDrumLabel(ctx: Ctx, w: number, h: number): void {
  ctx.fillStyle = '#f2ecdc'
  roundRect(ctx, 0, 0, w, h, 8)
  ctx.fill()
  ctx.strokeStyle = '#c8302a'
  ctx.lineWidth = 4
  roundRect(ctx, 5, 5, w - 10, h - 10, 6)
  ctx.stroke()
  const { size, lines } = fitWrapped(ctx, 'SHREDDED: MOSTLY RÉSUMÉS', w - 26, 2, h * 0.36)
  ctx.font = font(size, 700)
  ctx.fillStyle = INK
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  lines.forEach((l, i) => ctx.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.05))
}

function drawClockFace(ctx: Ctx, w: number, h: number): void {
  const cx = w / 2
  const cy = h / 2
  const r = w / 2 - 2
  ctx.fillStyle = '#f4efe2'
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = INK
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2
    const big = i % 5 === 0
    const len = big ? r * 0.14 : r * 0.05
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(a)
    ctx.fillRect(-(big ? 3 : 1), -r * 0.93, big ? 6 : 2, len)
    ctx.restore()
  }
  ctx.font = font(r * 0.24, 700)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let n = 1; n <= 12; n++) {
    const a = (n / 12) * Math.PI * 2
    ctx.fillText(String(n), cx + Math.sin(a) * r * 0.66, cy - Math.cos(a) * r * 0.66)
  }
  fitText(ctx, 'McKEOWN', cx, cy - r * 0.3, r * 0.9, r * 0.13, { color: '#8e6e2a' })
  fitText(ctx, 'TIME IS A RESOURCE', cx, cy + r * 0.34, r * 1.0, r * 0.09, { weight: 600, color: '#5a5f60' })
}

function drawFloorDecal(ctx: Ctx, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h)
  hazardBand(ctx, 0, 0, w, h, '#E9B63F', '#22282a', 22)
  ctx.fillStyle = '#2a3133'
  ctx.fillRect(16, 16, w - 32, h - 32)
  // footprints
  ctx.fillStyle = '#E9B63F'
  for (const sx of [-1, 1]) {
    const x = w / 2 + sx * 38
    ctx.beginPath()
    ctx.ellipse(x, h * 0.52, 22, 44, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(x, h * 0.22, 18, 20, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  fitText(ctx, 'APPLICANTS', w / 2, h * 0.84, w - 50, 30, { color: '#f2ead6', tracking: 0.08 })
}

export const PORTRAIT_KEYS = [0, 1, 2, 3, 4, 5].map((i) => `portrait:${i}`)

/** Draw `fn` designed for a (dw × dh) canvas into a (w × h) atlas cell. */
function scaled(dw: number, dh: number, fn: (ctx: Ctx, w: number, h: number) => void) {
  return (ctx: Ctx, w: number, h: number) => {
    ctx.save()
    ctx.scale(w / dw, h / dh)
    fn(ctx, dw, dh)
    ctx.restore()
  }
}

/** All static office art in one 1024² atlas (portraits at 200×250 keep it under one page). */
export function personnelAtlasItems(months: string[]): AtlasItem[] {
  const items: AtlasItem[] = [
    { key: 'hr', w: 900, h: 104, draw: drawHrSign },
    { key: 'eotm', w: 640, h: 84, draw: drawEotmHeader },
    { key: 'nameplate', w: 560, h: 120, draw: drawNameplate },
    { key: 'gauge:0', w: 128, h: 128, draw: (c, w, h) => drawGauge(c, w, h, 'PSI', 0.8) },
    { key: 'gauge:1', w: 128, h: 128, draw: (c, w, h) => drawGauge(c, w, h, 'WHIMSY', 0.7) },
    { key: 'gauge:2', w: 128, h: 128, draw: (c, w, h) => drawGauge(c, w, h, 'EMPLOYABLE', 0.85) },
    { key: 'print', w: 160, h: 56, draw: drawPrintLabel },
    { key: 'shred', w: 360, h: 80, draw: drawShredLabel },
    { key: 'drum', w: 240, h: 110, draw: drawDrumLabel },
    { key: 'clock', w: 200, h: 200, draw: drawClockFace },
    { key: 'decal', w: 200, h: 250, draw: scaled(240, 300, drawFloorDecal) },
  ]
  months.forEach((m, i) => {
    const tired = i / Math.max(1, months.length - 1)
    items.push({ key: PORTRAIT_KEYS[i], w: 200, h: 250, draw: scaled(PORTRAIT_PX.w, PORTRAIT_PX.h, (c, w, h) => drawPortrait(c, w, h, m, tired, 31 + i * 7)) })
  })
  return items
}
