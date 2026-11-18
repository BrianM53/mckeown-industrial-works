/**
 * "TIME SINCE LAST UNSCHEDULED DISASSEMBLY" board: a canvas drawn at 1 Hz
 * (2 Hz while the RESET flash blinks). Seven-segment digits are drawn as
 * polygons, so the readout never depends on a font.
 */
import { FONT_DISPLAY, FONT_MONO } from './atlas'

export const BOARD_W = 1024
export const BOARD_H = 512

/** HH:MM:SS for a duration in seconds (clamped to 0..99:59:59, NaN-safe). */
export function formatHMS(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.min(99 * 3600 + 3599, Math.floor(seconds))) : 0
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

/** Zero-padded counter (4 digits, grows if needed). */
export function formatCount(n: number): string {
  const v = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
  return String(v).padStart(4, '0')
}

//   aaa
//  f   b
//   ggg
//  e   c
//   ddd
const SEGMENTS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abged',
  '3': 'abgcd',
  '4': 'fgbc',
  '5': 'afgcd',
  '6': 'afgedc',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcfgd',
}

function segment(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, t: number, horizontal: boolean): void {
  const h = t / 2
  ctx.beginPath()
  if (horizontal) {
    ctx.moveTo(x, y)
    ctx.lineTo(x + h, y - h)
    ctx.lineTo(x + len - h, y - h)
    ctx.lineTo(x + len, y)
    ctx.lineTo(x + len - h, y + h)
    ctx.lineTo(x + h, y + h)
  } else {
    ctx.moveTo(x, y)
    ctx.lineTo(x + h, y + h)
    ctx.lineTo(x + h, y + len - h)
    ctx.lineTo(x, y + len)
    ctx.lineTo(x - h, y + len - h)
    ctx.lineTo(x - h, y + h)
  }
  ctx.closePath()
  ctx.fill()
}

/** Draw one 7-segment digit with its top-left at (x, y). */
export function drawDigit(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, ch: string, on: string, off: string): void {
  const t = Math.max(4, w * 0.18)
  const g = t * 0.32
  const lit = SEGMENTS[ch] ?? ''
  const half = h / 2
  const segs: [string, number, number, number, boolean][] = [
    ['a', x + g, y, w - 2 * g, true],
    ['g', x + g, y + half, w - 2 * g, true],
    ['d', x + g, y + h, w - 2 * g, true],
    ['f', x, y + g, half - 2 * g, false],
    ['b', x + w, y + g, half - 2 * g, false],
    ['e', x, y + half + g, half - 2 * g, false],
    ['c', x + w, y + half + g, half - 2 * g, false],
  ]
  for (const [name, sx, sy, len, horiz] of segs) {
    ctx.fillStyle = lit.includes(name) ? on : off
    segment(ctx, sx, sy, len, t, horiz)
  }
}

function drawReadout(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, dh: number, on: string, off: string, glow: string): void {
  const dw = dh * 0.5
  const gap = dh * 0.16
  const colonW = dh * 0.22
  let width = 0
  for (const ch of text) width += ch === ':' ? colonW + gap : dw + gap
  width -= gap
  let x = cx - width / 2
  ctx.save()
  ctx.shadowColor = glow
  ctx.shadowBlur = dh * 0.12
  for (const ch of text) {
    if (ch === ':') {
      ctx.fillStyle = on
      const r = dh * 0.055
      for (const fy of [0.32, 0.7]) {
        ctx.beginPath()
        ctx.arc(x + colonW / 2, y + dh * fy, r, 0, Math.PI * 2)
        ctx.fill()
      }
      x += colonW + gap
    } else {
      drawDigit(ctx, x, y, dw, dh, ch, on, off)
      x += dw + gap
    }
  }
  ctx.restore()
}

function fitFont(ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number, family: string, weight: number): void {
  let s = size
  ctx.font = `${weight} ${s}px ${family}`
  while (ctx.measureText(text).width > maxW && s > 10) {
    s -= 2
    ctx.font = `${weight} ${s}px ${family}`
  }
}

export interface BoardData {
  elapsed: number
  successes: number
  disassemblies: number
  /** 'normal' board or the red RESET state. */
  reset: boolean
}

export function drawBoard(ctx: CanvasRenderingContext2D, d: BoardData): void {
  const W = BOARD_W
  const H = BOARD_H
  ctx.save()
  ctx.clearRect(0, 0, W, H)
  // panel
  ctx.fillStyle = d.reset ? '#7D1712' : '#15191A'
  ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = d.reset ? '#E9B63F' : '#4C585B'
  ctx.lineWidth = 8
  ctx.strokeRect(10, 10, W - 20, H - 20)
  // header band
  ctx.fillStyle = d.reset ? '#B3261E' : '#262E30'
  ctx.fillRect(18, 18, W - 36, 84)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#EAE3D2'
  const title = 'TIME SINCE LAST UNSCHEDULED DISASSEMBLY'
  fitFont(ctx, title, W - 80, 58, FONT_DISPLAY, 700)
  ctx.fillText(title, W / 2, 62)

  if (d.reset) {
    ctx.fillStyle = '#FFF4E6'
    fitFont(ctx, 'RESET', W - 200, 190, FONT_DISPLAY, 700)
    ctx.save()
    ctx.shadowColor = '#FF8A70'
    ctx.shadowBlur = 24
    ctx.fillText('RESET', W / 2, 226)
    ctx.restore()
    drawReadout(ctx, '00:00:00', W / 2, 330, 62, '#FFD7CF', '#5A1410', '#FF8A70')
  } else {
    drawReadout(ctx, formatHMS(d.elapsed), W / 2, 126, 196, '#FFB23F', '#33240E', '#FF9A2E')
  }

  // counters
  const rowY = 418
  const colW = (W - 72) / 2
  const counters: [string, string, string][] = [
    ['SUCCESSFUL LAUNCHES', formatCount(d.successes), '#7CE38B'],
    ['UNSCHEDULED DISASSEMBLIES', formatCount(d.disassemblies), '#FF6B57'],
  ]
  counters.forEach(([label, value, color], i) => {
    const x0 = 36 + i * colW
    ctx.fillStyle = d.reset ? '#5E110D' : '#1E2425'
    ctx.fillRect(x0 + 6, rowY - 34, colW - 12, 68)
    ctx.textAlign = 'left'
    ctx.fillStyle = '#C9C2B2'
    fitFont(ctx, label, colW * 0.6, 30, FONT_DISPLAY, 600)
    ctx.fillText(label, x0 + 22, rowY + 1)
    ctx.textAlign = 'right'
    ctx.fillStyle = color
    fitFont(ctx, value, colW * 0.34, 46, FONT_MONO, 600)
    ctx.fillText(value, x0 + colW - 24, rowY + 2)
  })
  // honesty plate
  ctx.textAlign = 'center'
  ctx.fillStyle = '#E9E3D3'
  ctx.fillRect(W / 2 - 230, 466, 460, 30)
  ctx.fillStyle = '#1B1F20'
  fitFont(ctx, 'LOCAL SIMULATION — NOT REAL DATA', 440, 22, FONT_DISPLAY, 600)
  ctx.fillText('LOCAL SIMULATION — NOT REAL DATA', W / 2, 482)
  ctx.restore()
}
