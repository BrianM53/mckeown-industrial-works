import { HARMONY } from '@/content/stations'
import type { LineId } from '@/core/types'
import type { LineStateWithBelt } from '@/systems/factory'
import { LINE_LABELS, TARGET } from '@/systems/factory/config'
import { ROCKET_STAGES, type FactoryState } from '@/systems/factory/types'
import { type Ctx, fitText, fitWrapped, font, roundRect } from '../lib/canvas'
import { type EventLog, LINE_ORDER, LINE_SHORT, OUTCOME_LABEL, PHASE_LABEL, type Telemetry, assemblyProgress, elapsed, plantClock, sinceDisassembly } from './telemetry'

/**
 * Control-room HMI screens, drawn with canvas 2D into one shared atlas
 * (~4 Hz). Every screen carries a "SIMULATED FACTORY DATA" footer: the data is
 * the pretend factory's simulation, never real telemetry.
 */
export type ScreenKind =
  | 'overview'
  | 'assembly'
  | 'launch'
  | 'rates'
  | 'odds'
  | 'counter'
  | 'trend'
  | 'log'
  | 'qc'
  | 'settings'
  | 'readme'
  | 'hoppers'
  | 'history'
  | 'padcam'
  | 'belts'
  | 'schedule'

export interface ScreenData {
  s: FactoryState
  tel: Telemetry
  log: EventLog
  /** Wall-clock-ish seconds for blinking. */
  time: number
  /** Night shift: screens run on "UPS". */
  blackout: boolean
}

const BG0 = '#081113'
const BG1 = '#0d1d20'
const GRID = 'rgba(99,140,136,0.12)'
const TEAL = '#5fd3c4'
const GREEN = '#6fe07a'
const AMBER = '#ffb23f'
const RED = '#ff4b3a'
const DIM = '#5f7a78'
const TEXT = '#d6efe9'

const STATUS_COLOR = { running: GREEN, blocked: AMBER, idle: DIM } as const

function frame(ctx: Ctx, x: number, y: number, w: number, h: number, title: string, d: ScreenData, right?: string): { cx: number; cy: number; cw: number; ch: number } {
  const g = ctx.createLinearGradient(0, y, 0, y + h)
  g.addColorStop(0, BG1)
  g.addColorStop(1, BG0)
  ctx.fillStyle = g
  ctx.fillRect(x, y, w, h)
  // faint grid
  ctx.strokeStyle = GRID
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let gx = x + 16; gx < x + w; gx += 24) {
    ctx.moveTo(gx, y + 26)
    ctx.lineTo(gx, y + h - 16)
  }
  for (let gy = y + 30; gy < y + h - 16; gy += 24) {
    ctx.moveTo(x, gy)
    ctx.lineTo(x + w, gy)
  }
  ctx.stroke()
  // header
  ctx.fillStyle = 'rgba(95,211,196,0.16)'
  ctx.fillRect(x, y, w, 24)
  ctx.fillStyle = TEAL
  ctx.fillRect(x, y + 23, w, 1.5)
  fitText(ctx, title, x + 8, y + 13, w * 0.68, 15, { align: 'left', color: TEXT, tracking: 0.03 })
  fitText(ctx, right ?? plantClock(d.s.t), x + w - 7, y + 13, w * 0.3, 12, { align: 'right', mono: true, weight: 600, color: DIM })
  // footer label (every screen)
  ctx.fillStyle = 'rgba(255,178,63,0.1)'
  ctx.fillRect(x, y + h - 15, w, 15)
  fitText(ctx, 'SIMULATED FACTORY DATA', x + w / 2, y + h - 7, w - 12, 10, { mono: true, weight: 600, color: AMBER, tracking: 0.12 })
  return { cx: x + 8, cy: y + 30, cw: w - 16, ch: h - 30 - 19 }
}

function bar(ctx: Ctx, x: number, y: number, w: number, h: number, f: number, color: string): void {
  ctx.fillStyle = 'rgba(255,255,255,0.07)'
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = color
  ctx.fillRect(x, y, Math.max(0, Math.min(1, f)) * w, h)
}

function spark(ctx: Ctx, x: number, y: number, w: number, h: number, n: number, at: (i: number) => number, max: number, color: string, fill = false): void {
  if (n < 2 || max <= 0) return
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const px = x + (i / (n - 1)) * w
    const py = y + h - (Math.max(0, at(i)) / max) * h
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  if (fill) {
    ctx.lineTo(x + w, y + h)
    ctx.lineTo(x, y + h)
    ctx.closePath()
    ctx.fillStyle = color + '33'
    ctx.fill()
  } else {
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.stroke()
  }
}

function blink(d: ScreenData, hz = 1): boolean {
  return Math.floor(d.time * hz * 2) % 2 === 0
}

// ---------------------------------------------------------------------------

function overview(ctx: Ctx, x: number, y: number, w: number, h: number, d: ScreenData): void {
  const { cx, cy, cw, ch } = frame(ctx, x, y, w, h, 'PLANT OVERVIEW · 5 LINES', d)
  const laneH = ch / 5
  const towerW = 44
  const lx = cx + 52
  const lw = cw - 52 - towerW - 12
  LINE_ORDER.forEach((id, i) => {
    const line = d.s.lines[id]
    const ly = cy + i * laneH + laneH / 2
    ctx.fillStyle = STATUS_COLOR[line.status]
    ctx.beginPath()
    ctx.arc(cx + 6, ly, 5, 0, Math.PI * 2)
    ctx.fill()
    fitText(ctx, LINE_SHORT[id], cx + 15, ly + 1, 38, 12, { align: 'left', mono: true, weight: 600, color: TEXT })
    ctx.fillStyle = 'rgba(214,239,233,0.14)'
    ctx.fillRect(lx, ly - 3, lw, 6)
    ctx.fillStyle = id === 'payload' ? AMBER : TEAL
    for (const it of line.items) ctx.fillRect(lx + it * lw - 3, ly - 5, 6, 10)
    ctx.strokeStyle = 'rgba(214,239,233,0.3)'
    ctx.beginPath()
    ctx.moveTo(lx + lw, ly)
    ctx.lineTo(cx + cw - towerW, ly)
    ctx.stroke()
  })
  ctx.strokeStyle = AMBER
  ctx.lineWidth = 2
  ctx.strokeRect(cx + cw - towerW + 2, cy + 4, towerW - 4, ch - 8)
  fitText(ctx, 'TOWER', cx + cw - towerW / 2, cy + ch / 2, towerW - 8, 12, { color: AMBER })
}

function assembly(ctx: Ctx, x: number, y: number, w: number, h: number, d: ScreenData): void {
  const r = d.s.rocket
  const { cx, cy, cw, ch } = frame(ctx, x, y, w, h, `ROCKET ASSEMBLY · R-${r.id}`, d)
  const rowH = ch / ROCKET_STAGES.length
  const listW = cw * 0.62
  ROCKET_STAGES.forEach((st, i) => {
    const ry = cy + i * rowH + rowH / 2
    const done = i < r.stagesComplete
    const cur = i === r.stagesComplete && r.phase === 'assembling'
    ctx.fillStyle = done ? GREEN : cur ? AMBER : 'rgba(214,239,233,0.2)'
    ctx.fillRect(cx, ry - 6, 12, 12)
    if (done) {
      ctx.strokeStyle = BG0
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(cx + 2.5, ry)
      ctx.lineTo(cx + 5, ry + 3)
      ctx.lineTo(cx + 10, ry - 3)
      ctx.stroke()
    }
    fitText(ctx, st.toUpperCase(), cx + 18, ry + 1, 86, 13, { align: 'left', mono: true, weight: 600, color: done ? TEXT : cur ? AMBER : DIM })
    if (cur) bar(ctx, cx + 106, ry - 4, listW - 110, 8, r.stageProgress, AMBER)
    else if (done) bar(ctx, cx + 106, ry - 4, listW - 110, 8, 1, 'rgba(111,224,122,0.55)')
  })
  const p = r.phase === 'assembling' ? assemblyProgress(d.s) : 1
  const px = cx + listW + (cw - listW) / 2
  fitText(ctx, `${Math.round(p * 100)}%`, px, cy + ch * 0.38, cw - listW - 6, 44, { mono: true, color: p >= 1 ? GREEN : TEXT })
  fitText(ctx, r.phase === 'assembling' ? 'BUILT' : 'COMPLETE', px, cy + ch * 0.68, cw - listW - 6, 14, { mono: true, weight: 600, color: DIM })
}

function launch(ctx: Ctx, x: number, y: number, w: number, h: number, d: ScreenData): void {
  const r = d.s.rocket
  const { cx, cy, cw, ch } = frame(ctx, x, y, w, h, 'LAUNCH STATUS', d, `R-${r.id}`)
  const counting = r.phase === 'countdown' && r.countdown !== null
  if (counting) {
    const sec = Math.max(0, Math.ceil(r.countdown ?? 0))
    fitText(ctx, `T-${String(sec).padStart(2, '0')}`, cx + cw / 2, cy + ch * 0.38, cw, 64, { mono: true, color: blink(d, 2) ? RED : AMBER })
  } else {
    const col = r.phase === 'flight' || r.phase === 'ignition' ? RED : r.phase === 'assembling' ? TEAL : AMBER
    fitText(ctx, PHASE_LABEL[r.phase], cx + cw / 2, cy + ch * 0.34, cw - 10, 34, { color: col, tracking: 0.04 })
  }
  if (Number.isFinite(r.phaseDuration) && r.phaseDuration > 0) bar(ctx, cx + 10, cy + ch * 0.6, cw - 20, 7, r.phaseTime / r.phaseDuration, TEAL)
  const last = d.s.history[d.s.history.length - 1]
  const lastText = last ? `LAST: R-${last.rocketId} ${OUTCOME_LABEL[last.outcome]}` : 'LAST: (NONE THIS SHIFT)'
  const bad = last && (last.outcome === 'breakup' || last.outcome === 'explosion')
  fitText(ctx, lastText, cx + cw / 2, cy + ch * 0.8, cw - 10, 13, { mono: true, weight: 600, color: bad ? RED : DIM })
  if (r.stowaway && (r.phase === 'pad' || r.phase === 'countdown')) {
    fitText(ctx, 'CREW HEADCOUNT: ONE SHORT', cx + cw / 2, cy + ch * 0.95, cw - 10, 12, { mono: true, weight: 600, color: blink(d) ? AMBER : DIM })
  }
}

function rates(ctx: Ctx, x: number, y: number, w: number, h: number, d: ScreenData): void {
  const { cx, cy, cw, ch } = frame(ctx, x, y, w, h, 'LINE RATES · PARTS/MIN', d)
  const rowH = ch / 5
  let max = 1
  for (const id of LINE_ORDER) max = Math.max(max, d.s.lines[id].rate, d.tel.rates[id].max())
  LINE_ORDER.forEach((id, i) => {
    const line = d.s.lines[id]
    const ry = cy + i * rowH + 3
    fitText(ctx, LINE_SHORT[id], cx, ry + rowH * 0.35, 54, 12, { align: 'left', mono: true, weight: 600, color: TEXT })
    bar(ctx, cx + 58, ry + 2, cw * 0.42, rowH * 0.45, line.rate / (max * 1.1), STATUS_COLOR[line.status])
    fitText(ctx, line.rate.toFixed(1), cx + 62 + cw * 0.42 + 26, ry + rowH * 0.35, 50, 13, { mono: true, color: TEXT })
    const sx = cx + cw * 0.42 + 120
    const series = d.tel.rates[id]
    spark(ctx, sx, ry, cx + cw - sx, rowH * 0.62, series.count, (k) => series.at(k), max * 1.1, STATUS_COLOR[line.status])
  })
}

function odds(ctx: Ctx, x: number, y: number, w: number, h: number, d: ScreenData): void {
  const m = d.s.model
  const { cx, cy, cw, ch } = frame(ctx, x, y, w, h, 'LAUNCH SUCCESS ODDS', d)
  const gx = cx + cw * 0.3
  const gy = cy + ch * 0.66
  const R = Math.min(cw * 0.26, ch * 0.58)
  ctx.lineWidth = 12
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.beginPath()
  ctx.arc(gx, gy, R, Math.PI, Math.PI * 2)
  ctx.stroke()
  const f = Math.max(0, Math.min(1, m.successChance))
  ctx.strokeStyle = f > 0.6 ? GREEN : f > 0.4 ? AMBER : RED
  ctx.beginPath()
  ctx.arc(gx, gy, R, Math.PI, Math.PI + Math.PI * f)
  ctx.stroke()
  fitText(ctx, `${Math.round(f * 100)}%`, gx, gy - R * 0.32, R * 1.5, 40, { mono: true, color: TEXT })
  const tx = cx + cw * 0.62
  fitText(ctx, 'DEFECT ESCAPE', tx, cy + ch * 0.18, cw * 0.38, 12, { align: 'left', mono: true, weight: 600, color: DIM })
  const dr = m.defectRate * 100
  fitText(ctx, `${dr.toFixed(1)}%`, tx, cy + ch * 0.36, cw * 0.36, 24, { align: 'left', mono: true, color: m.defectRate <= TARGET.defectRate ? GREEN : AMBER })
  fitText(ctx, 'BOTTLENECK', tx, cy + ch * 0.58, cw * 0.38, 12, { align: 'left', mono: true, weight: 600, color: DIM })
  const bn = m.bottleneck === 'balanced' ? 'BALANCED' : m.bottleneck === 'inspection' ? 'INSPECTION' : LINE_SHORT[m.bottleneck as LineId]
  fitText(ctx, bn, tx, cy + ch * 0.76, cw * 0.36, 20, { align: 'left', mono: true, color: AMBER })
}

function counter(ctx: Ctx, x: number, y: number, w: number, h: number, d: ScreenData): void {
  const { cx, cy, cw, ch } = frame(ctx, x, y, w, h, 'TIME SINCE LAST UNSCHEDULED DISASSEMBLY', d, ' ')
  const since = sinceDisassembly(d.s)
  fitText(ctx, elapsed(since), cx + cw / 2, cy + ch * 0.4, cw - 10, 62, { mono: true, color: since < 30 ? (blink(d, 2) ? RED : AMBER) : GREEN })
  const c = d.s.counters
  fitText(ctx, `LAUNCHES ${c.successes}`, cx + cw * 0.25, cy + ch * 0.84, cw * 0.48, 16, { mono: true, color: GREEN })
  fitText(ctx, `DISASSEMBLIES ${c.disassemblies}`, cx + cw * 0.73, cy + ch * 0.84, cw * 0.5, 16, { mono: true, color: RED })
}

function trend(ctx: Ctx, x: number, y: number, w: number, h: number, d: ScreenData): void {
  const { cx, cy, cw, ch } = frame(ctx, x, y, w, h, 'THROUGHPUT · ROCKETS/HR', d)
  const ser = d.tel.throughput
  const max = Math.max(TARGET.throughputPerHour * 1.4, ser.max() * 1.15)
  const gy = cy + 8
  const gh = ch - 30
  // target line
  const ty = gy + gh - (TARGET.throughputPerHour / max) * gh
  ctx.setLineDash([6, 4])
  ctx.strokeStyle = AMBER
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(cx, ty)
  ctx.lineTo(cx + cw, ty)
  ctx.stroke()
  ctx.setLineDash([])
  fitText(ctx, `TARGET ${TARGET.throughputPerHour}`, cx + cw - 4, ty - 8, 90, 11, { align: 'right', mono: true, weight: 600, color: AMBER })
  spark(ctx, cx, gy, cw, gh, ser.count, (k) => ser.at(k), max, TEAL, true)
  spark(ctx, cx, gy, cw, gh, ser.count, (k) => ser.at(k), max, TEAL)
  const cur = d.s.model.throughputPerHour
  fitText(ctx, `NOW ${cur.toFixed(1)} / HR`, cx, cy + ch - 8, cw * 0.6, 14, { align: 'left', mono: true, color: TEXT })
  fitText(ctx, d.s.model.meetsTarget ? 'ON TARGET' : 'BELOW TARGET', cx + cw, cy + ch - 8, cw * 0.4, 13, { align: 'right', mono: true, weight: 600, color: d.s.model.meetsTarget ? GREEN : AMBER })
}

function logScreen(ctx: Ctx, x: number, y: number, w: number, h: number, d: ScreenData): void {
  const { cx, cy, cw, ch } = frame(ctx, x, y, w, h, 'EVENT LOG', d)
  const lineH = 17
  const n = Math.floor((ch - 4) / lineH)
  const entries = d.log.entries.slice(-n)
  const col = { info: TEXT, good: GREEN, warn: AMBER, bad: RED } as const
  entries.forEach((e, i) => {
    const ly = cy + 8 + i * lineH
    fitText(ctx, plantClock(e.t).slice(0, 5), cx, ly, 46, 12, { align: 'left', mono: true, weight: 600, color: DIM })
    fitText(ctx, e.text, cx + 50, ly, cw - 52, 12, { align: 'left', mono: true, weight: 600, color: col[e.level] })
  })
  if (blink(d)) {
    ctx.fillStyle = TEAL
    ctx.fillRect(cx + 50, cy + 2 + entries.length * lineH, 8, 12)
  }
}

function qc(ctx: Ctx, x: number, y: number, w: number, h: number, d: ScreenData): void {
  const { cx, cy, cw, ch } = frame(ctx, x, y, w, h, 'QUALITY CONTROL · PAYLOAD ARCH', d)
  const flashing = LINE_ORDER.some((id) => d.s.lines[id].defectFlash > 0)
  fitText(ctx, 'INSPECTION', cx, cy + 12, 120, 12, { align: 'left', mono: true, weight: 600, color: DIM })
  bar(ctx, cx, cy + 22, cw * 0.55, 10, d.s.params.inspection, TEAL)
  fitText(ctx, `${Math.round(d.s.params.inspection * 100)}%`, cx + cw * 0.55 + 8, cy + 27, 60, 14, { align: 'left', mono: true, color: TEXT })
  fitText(ctx, 'DEFECTS CAUGHT', cx, cy + 52, 160, 12, { align: 'left', mono: true, weight: 600, color: DIM })
  fitText(ctx, String(d.tel.qcCaught), cx, cy + 80, 140, 30, { align: 'left', mono: true, color: AMBER })
  const bx = cx + cw * 0.58
  ctx.fillStyle = flashing ? (blink(d, 3) ? RED : '#5a1410') : 'rgba(111,224,122,0.18)'
  roundRect(ctx, bx, cy + 44, cw - (bx - cx), ch - 50, 6)
  ctx.fill()
  fitText(ctx, flashing ? 'DEFECT CAUGHT' : 'ALL CLEAR', bx + (cw - (bx - cx)) / 2, cy + 44 + (ch - 50) / 2, cw - (bx - cx) - 10, 16, { color: flashing ? '#ffffff' : GREEN })
}

function settings(ctx: Ctx, x: number, y: number, w: number, h: number, d: ScreenData): void {
  const { cx, cy, cw, ch } = frame(ctx, x, y, w, h, 'LINE SUPERVISOR SETTINGS', d, ' ')
  const p = d.s.params
  const rows: [string, string][] = [
    ['CONVEYOR', `${p.conveyorSpeed.toFixed(1)}×`],
    ['INSPECTION', `${Math.round(p.inspection * 100)}%`],
    ['PRESSES→TANKS', `${p.pressesToTanks}/6`],
  ]
  rows.forEach(([k, v], i) => {
    const ry = cy + 12 + i * 22
    fitText(ctx, k, cx, ry, cw * 0.6, 13, { align: 'left', mono: true, weight: 600, color: DIM })
    fitText(ctx, v, cx + cw, ry, cw * 0.38, 15, { align: 'right', mono: true, color: TEXT })
  })
  const ok = d.s.model.meetsTarget
  ctx.fillStyle = ok ? 'rgba(111,224,122,0.2)' : 'rgba(255,178,63,0.14)'
  ctx.fillRect(cx, cy + ch - 28, cw, 24)
  fitText(ctx, ok ? 'LINE CERTIFIED' : 'NOT YET CERTIFIED', cx + cw / 2, cy + ch - 16, cw - 10, 14, { color: ok ? GREEN : AMBER })
}

function readme(ctx: Ctx, x: number, y: number, w: number, h: number, d: ScreenData): void {
  const { cx, cy, cw, ch } = frame(ctx, x, y, w, h, 'HARMONY AI · READ ME', d, ' ')
  const { size, lines } = fitWrapped(ctx, HARMONY.simulatedDataNote, cw - 6, 6, 16, 600)
  ctx.font = font(size, 600)
  ctx.fillStyle = TEXT
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  lines.forEach((l, i) => ctx.fillText(l, cx + 3, cy + 10 + i * size * 1.25))
  void ch
}

function hoppers(ctx: Ctx, x: number, y: number, w: number, h: number, d: ScreenData): void {
  const { cx, cy, cw, ch } = frame(ctx, x, y, w, h, 'TOWER PART BINS', d, ' ')
  const colW = cw / 5
  LINE_ORDER.forEach((id, i) => {
    const l = d.s.lines[id]
    const f = l.required > 0 ? l.delivered / l.required : 1
    const bx = cx + i * colW + colW * 0.2
    const bw = colW * 0.6
    const bh = ch - 26
    ctx.fillStyle = 'rgba(255,255,255,0.07)'
    ctx.fillRect(bx, cy + 2, bw, bh)
    ctx.fillStyle = f >= 1 ? GREEN : TEAL
    const fh = Math.min(1, Math.max(0, f)) * bh
    ctx.fillRect(bx, cy + 2 + bh - fh, bw, fh)
    fitText(ctx, LINE_SHORT[id], bx + bw / 2, cy + ch - 10, colW - 2, 11, { mono: true, weight: 600, color: TEXT })
  })
}

function history(ctx: Ctx, x: number, y: number, w: number, h: number, d: ScreenData): void {
  const { cx, cy, cw, ch } = frame(ctx, x, y, w, h, 'LAUNCH HISTORY (THIS SHIFT)', d, ' ')
  const hist = d.s.history.slice(-5).reverse()
  if (!hist.length) {
    fitText(ctx, 'NO LAUNCHES YET', cx + cw / 2, cy + ch / 2, cw - 10, 15, { mono: true, color: DIM })
    return
  }
  hist.forEach((r, i) => {
    const ry = cy + 10 + i * 17
    const bad = r.outcome === 'breakup' || r.outcome === 'explosion'
    fitText(ctx, `R-${r.rocketId}`, cx, ry, 40, 12, { align: 'left', mono: true, weight: 600, color: DIM })
    fitText(ctx, OUTCOME_LABEL[r.outcome], cx + 42, ry, cw - 44, 12, { align: 'left', mono: true, weight: 600, color: bad ? RED : GREEN })
  })
}

function padcam(ctx: Ctx, x: number, y: number, w: number, h: number, d: ScreenData): void {
  const { cx, cy, cw, ch } = frame(ctx, x, y, w, h, 'PAD CAM 2', d, ' ')
  const r = d.s.rocket
  ctx.fillStyle = '#16282a'
  ctx.fillRect(cx, cy, cw, ch)
  ctx.fillStyle = '#2b3d3f'
  ctx.fillRect(cx, cy + ch * 0.72, cw, ch * 0.28)
  const px = cx + cw / 2
  const py = cy + ch * 0.74
  ctx.fillStyle = '#3c5052'
  ctx.fillRect(px - 26, py - 4, 52, 6)
  const onPad = r.phase === 'pad' || r.phase === 'countdown' || r.phase === 'ignition'
  const flying = r.phase === 'flight'
  if (onPad || flying) {
    const lift = flying ? Math.min(ch * 0.8, r.phaseTime * 14) : 0
    const ry = py - 4 - lift
    ctx.fillStyle = '#c9d6d2'
    ctx.fillRect(px - 5, ry - 34, 10, 34)
    ctx.beginPath()
    ctx.moveTo(px - 5, ry - 34)
    ctx.lineTo(px, ry - 44)
    ctx.lineTo(px + 5, ry - 34)
    ctx.fill()
    if (r.phase === 'ignition' || flying) {
      ctx.fillStyle = blink(d, 4) ? AMBER : RED
      ctx.beginPath()
      ctx.moveTo(px - 4, ry)
      ctx.lineTo(px, ry + 12 + (blink(d, 4) ? 6 : 0))
      ctx.lineTo(px + 4, ry)
      ctx.fill()
    }
  }
  // scanlines + REC
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  for (let sy = cy; sy < cy + ch; sy += 3) ctx.fillRect(cx, sy, cw, 1)
  if (blink(d)) {
    ctx.fillStyle = RED
    ctx.beginPath()
    ctx.arc(cx + 10, cy + 10, 4, 0, Math.PI * 2)
    ctx.fill()
  }
  fitText(ctx, 'REC', cx + 18, cy + 10, 30, 10, { align: 'left', mono: true, weight: 600, color: TEXT })
}

function belts(ctx: Ctx, x: number, y: number, w: number, h: number, d: ScreenData): void {
  const { cx, cy, cw, ch } = frame(ctx, x, y, w, h, 'BELT SPEEDS', d, ' ')
  const rowH = ch / 5
  LINE_ORDER.forEach((id, i) => {
    const l = d.s.lines[id] as LineStateWithBelt
    const v = Number.isFinite(l.beltSpeed) ? l.beltSpeed : 0
    const ry = cy + i * rowH + rowH / 2
    fitText(ctx, LINE_SHORT[id], cx, ry, 50, 11, { align: 'left', mono: true, weight: 600, color: TEXT })
    bar(ctx, cx + 54, ry - 4, cw - 104, 8, v * 30, v > 0 ? TEAL : DIM)
    fitText(ctx, v > 0 ? 'RUN' : 'HOLD', cx + cw, ry, 44, 11, { align: 'right', mono: true, weight: 600, color: v > 0 ? GREEN : AMBER })
  })
}

function schedule(ctx: Ctx, x: number, y: number, w: number, h: number, d: ScreenData): void {
  const r = d.s.rocket
  const { cx, cy, cw, ch } = frame(ctx, x, y, w, h, `PRODUCTION SCHEDULE · R-${r.id}`, d, ' ')
  const n = ROCKET_STAGES.length
  const rowH = (ch - 14) / n
  const slot = (cw - 50) / n
  ROCKET_STAGES.forEach((st, i) => {
    const ry = cy + i * rowH
    fitText(ctx, st.slice(0, 5).toUpperCase(), cx, ry + rowH / 2, 46, 10, { align: 'left', mono: true, weight: 600, color: DIM })
    const done = i < r.stagesComplete || r.phase !== 'assembling'
    const cur = i === r.stagesComplete && r.phase === 'assembling'
    const bx = cx + 48 + i * slot
    ctx.fillStyle = done ? 'rgba(111,224,122,0.65)' : cur ? AMBER : 'rgba(95,211,196,0.35)'
    ctx.fillRect(bx, ry + 2, slot * (cur ? Math.max(0.15, r.stageProgress) : 1) - 2, rowH - 4)
    if (cur) {
      ctx.strokeStyle = AMBER
      ctx.strokeRect(bx, ry + 2, slot - 2, rowH - 4)
    }
  })
  fitText(ctx, 'CONFIDENCE: HIGH (ALLEGEDLY)', cx + cw / 2, cy + ch - 6, cw, 10, { mono: true, weight: 600, color: DIM })
}

function upsScreen(ctx: Ctx, x: number, y: number, w: number, h: number, d: ScreenData): void {
  ctx.fillStyle = '#120707'
  ctx.fillRect(x, y, w, h)
  fitText(ctx, 'AUX POWER', x + w / 2, y + h * 0.38, w - 20, 30, { color: blink(d) ? RED : '#7a1e18', tracking: 0.08 })
  fitText(ctx, 'NIGHT SHIFT IN PROGRESS', x + w / 2, y + h * 0.62, w - 20, 14, { mono: true, weight: 600, color: AMBER })
  fitText(ctx, 'SIMULATED FACTORY DATA', x + w / 2, y + h - 8, w - 12, 10, { mono: true, weight: 600, color: AMBER, tracking: 0.12 })
}

const DRAW: Record<ScreenKind, (ctx: Ctx, x: number, y: number, w: number, h: number, d: ScreenData) => void> = {
  overview,
  assembly,
  launch,
  rates,
  odds,
  counter,
  trend,
  log: logScreen,
  qc,
  settings,
  readme,
  hoppers,
  history,
  padcam,
  belts,
  schedule,
}

export function drawScreen(ctx: Ctx, kind: ScreenKind, x: number, y: number, w: number, h: number, d: ScreenData): void {
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  try {
    if (d.blackout && kind !== 'readme') upsScreen(ctx, x, y, w, h, d)
    else DRAW[kind](ctx, x, y, w, h, d)
  } catch {
    ctx.fillStyle = BG0
    ctx.fillRect(x, y, w, h)
  }
  ctx.restore()
}

/** Line display names for tooltips/tests. */
export const LINE_NAMES = LINE_LABELS
