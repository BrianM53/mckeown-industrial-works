/**
 * Line Supervisor Console screen: a small HMI canvas texture redrawn ~2 Hz
 * from the live factory model (the same numbers the console panel shows).
 */
import * as THREE from 'three'
import {
  displayDefectPercent,
  displaySuccessPercent,
  displayThroughput,
  LINE_IDS,
  TARGET,
  TARGET_DEFECT_PERCENT,
  TOTAL_PRESSES,
  type FactoryState,
} from '@/systems/factory'
import { FONT_DISPLAY, FONT_MONO } from './fonts'

const SHORT: Record<string, string> = { smelt: 'STAMP', pipe: 'PIPE', circuit: 'ELEC', tank: 'TANK', payload: 'PAYLD' }
const BOTTLENECK: Record<string, string> = {
  smelt: 'SHEET STAMPING',
  pipe: 'PIPE MACHINING',
  circuit: 'ELECTRONICS',
  tank: 'TANK LINE',
  payload: 'PAYLOAD QC',
  inspection: 'INSPECTION',
  balanced: 'NONE · BALANCED',
}

const W = 512
const H = 288

export class ConsoleScreen {
  readonly texture: THREE.CanvasTexture
  private readonly ctx: CanvasRenderingContext2D | null
  private last = ''

  constructor() {
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    this.ctx = c.getContext('2d')
    this.texture = new THREE.CanvasTexture(c)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.anisotropy = 4
  }

  /** Redraw from the live sim state. Cheap no-op when nothing visible changed. */
  draw(s: FactoryState, blink: boolean): void {
    const ctx = this.ctx
    if (!ctx) return
    const m = s.model
    const p = s.params
    const thr = displayThroughput(m.throughputPerHour)
    const def = displayDefectPercent(m.defectRate)
    const odds = displaySuccessPercent(m.successChance)
    const st = LINE_IDS.map((id) => (s.lines[id].status === 'running' ? (s.lines[id].rate > 0 ? 'R' : 'W') : 'B')).join('')
    const key = `${thr}|${def}|${odds}|${m.bottleneck}|${m.meetsTarget}|${p.conveyorSpeed}|${p.inspection}|${p.pressesToTanks}|${st}|${blink}`
    if (key === this.last) return
    this.last = key

    // background
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, '#0d1a1a')
    g.addColorStop(1, '#081110')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
    // header bar
    ctx.fillStyle = '#16302c'
    ctx.fillRect(0, 0, W, 34)
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillStyle = '#9fe8c9'
    ctx.font = `600 15px ${FONT_MONO}`
    ctx.fillText('LINE SUPERVISOR · SHIFT 3', 12, 18)
    ctx.textAlign = 'right'
    ctx.fillStyle = blink ? '#ffcf5a' : '#7a6a3a'
    ctx.fillText('● SIM', W - 12, 18)

    // readouts
    const tOk = thr >= TARGET.throughputPerHour
    const dOk = def <= TARGET_DEFECT_PERCENT
    const row = (y: number, label: string, value: string, unit: string, target: string, ok: boolean) => {
      ctx.textAlign = 'left'
      ctx.fillStyle = 'rgba(190,220,210,0.75)'
      ctx.font = `600 13px ${FONT_MONO}`
      ctx.fillText(label, 14, y)
      ctx.fillStyle = ok ? '#7dffa0' : '#ffb85a'
      ctx.font = `700 34px ${FONT_DISPLAY}`
      ctx.fillText(value, 150, y + 1)
      const vw = ctx.measureText(value).width
      ctx.font = `600 14px ${FONT_MONO}`
      ctx.fillText(unit, 156 + vw, y + 4)
      ctx.textAlign = 'right'
      ctx.fillStyle = 'rgba(190,220,210,0.55)'
      ctx.font = `600 12px ${FONT_MONO}`
      ctx.fillText(target, W - 14, y)
    }
    row(60, 'THROUGHPUT', thr.toFixed(1), '/hr', `TARGET ≥ ${TARGET.throughputPerHour}`, tOk)
    row(98, 'ESCAPED DEFECTS', def.toFixed(1), '%', `TARGET ≤ ${TARGET_DEFECT_PERCENT.toFixed(1)}`, dOk)
    row(136, 'LAUNCH ODDS', String(odds), '%', 'NEVER 100%', odds >= 65)

    ctx.textAlign = 'left'
    ctx.fillStyle = 'rgba(190,220,210,0.75)'
    ctx.font = `600 12px ${FONT_MONO}`
    ctx.fillText(`BOTTLENECK: ${BOTTLENECK[m.bottleneck] ?? '—'}`, 14, 166)

    // per-line status bars
    const bx = 14
    const bw = (W - 28 - 4 * 8) / 5
    LINE_IDS.forEach((id, i) => {
      const l = s.lines[id]
      const x = bx + i * (bw + 8)
      const y = 180
      ctx.fillStyle = '#12201f'
      ctx.fillRect(x, y, bw, 40)
      const running = l.status === 'running' && l.rate > 0
      const frac = Math.max(0.06, Math.min(1, l.rate / 40))
      ctx.fillStyle = l.status === 'blocked' ? '#ffb23f' : running ? '#4fc3a1' : '#58706a'
      ctx.fillRect(x + 3, y + 40 - 3 - (34 * frac), bw - 6, 34 * frac)
      ctx.fillStyle = '#d8efe6'
      ctx.textAlign = 'center'
      ctx.font = `600 11px ${FONT_MONO}`
      ctx.fillText(SHORT[id], x + bw / 2, y + 52)
      ctx.fillStyle = l.status === 'blocked' ? '#ffb23f' : running ? '#7dffa0' : '#9fb3ad'
      ctx.fillText(l.status === 'blocked' ? 'WAIT' : running ? 'RUN' : 'HOLD', x + bw / 2, y + 66)
    })

    // params footer
    ctx.fillStyle = '#10201e'
    ctx.fillRect(0, H - 28, W, 28)
    ctx.textAlign = 'left'
    ctx.fillStyle = '#cfe6dc'
    ctx.font = `600 12px ${FONT_MONO}`
    const fins = TOTAL_PRESSES - p.pressesToTanks
    ctx.fillText(`BELT ${p.conveyorSpeed.toFixed(1)}×   INSPECT ${Math.round(p.inspection * 100)}%   PRESSES ${p.pressesToTanks}T/${fins}F`, 12, H - 14)
    ctx.textAlign = 'right'
    ctx.fillStyle = m.meetsTarget ? '#7dffa0' : '#ffb85a'
    ctx.fillText(m.meetsTarget ? 'CERTIFIED ✓' : 'NOT CERTIFIED', W - 12, H - 14)

    // scanlines
    ctx.fillStyle = 'rgba(0,0,0,0.13)'
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1)
    this.texture.needsUpdate = true
  }

  dispose(): void {
    this.texture.dispose()
  }
}
