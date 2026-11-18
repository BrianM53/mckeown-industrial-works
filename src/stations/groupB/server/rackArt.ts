/**
 * Server rack faces: deterministic unit layouts (shared by the canvas painter
 * and the LED placement, so every LED sits on its drawn socket).
 *
 * Coordinates on a face: u 0..1 left→right as seen from the front, v 0..1
 * top→bottom. Variants 0..3 are fronts, variant 4 is the perforated rear door.
 */
import { createRng } from '@/core/rng'

export const FACE_VARIANTS = 5
export const BACK_VARIANT = 4
/** Pixel size of one face cell in the atlas. */
export const FACE_PX = { w: 192, h: 640 }

export type UnitKind = 'srv1' | 'srv2' | 'stor4' | 'switch' | 'blank' | 'patch' | 'ups3'

export interface Unit {
  kind: UnitKind
  /** Top edge and height in v (0..1). */
  v0: number
  vh: number
}

/** 0 steady, 1 blink, 2 random flicker (disk activity), 3 slow pulse. */
export type LedMode = 0 | 1 | 2 | 3

export interface LedSpec {
  u: number
  v: number
  color: 'green' | 'amber' | 'blue' | 'red' | 'white'
  mode: LedMode
  /** Hz. */
  rate: number
  phase: number
  /** On-fraction for blink / flicker threshold. */
  duty: number
}

const U = 1 / 44 // 42U plus top/bottom margins

const STACKS: UnitKind[][] = [
  ['switch', 'patch', 'blank', 'srv1', 'srv1', 'srv1', 'srv2', 'srv2', 'blank', 'stor4', 'srv1', 'srv1', 'srv2', 'blank', 'srv2', 'ups3'],
  ['patch', 'switch', 'srv2', 'srv2', 'srv2', 'blank', 'stor4', 'stor4', 'srv1', 'srv1', 'blank', 'ups3'],
  ['switch', 'srv1', 'srv1', 'srv1', 'srv1', 'blank', 'srv2', 'stor4', 'blank', 'srv2', 'srv2', 'srv1', 'srv1', 'ups3'],
  ['patch', 'patch', 'switch', 'blank', 'stor4', 'srv2', 'srv2', 'srv1', 'blank', 'stor4', 'ups3'],
]

const HEIGHT_U: Record<UnitKind, number> = { srv1: 1, srv2: 2, stor4: 4, switch: 1, blank: 1, patch: 1, ups3: 3 }

/** Units of a front variant, top to bottom (gaps become blank panels). */
export function unitsFor(variant: number): Unit[] {
  if (variant === BACK_VARIANT) return []
  const stack = STACKS[((variant % STACKS.length) + STACKS.length) % STACKS.length]
  const out: Unit[] = []
  let v = U
  // stretch the stack over 42U by inserting blanks evenly
  const used = stack.reduce((s, k) => s + HEIGHT_U[k], 0)
  const spare = Math.max(0, 42 - used)
  const every = spare > 0 ? Math.max(1, Math.floor(stack.length / spare)) : Infinity
  let added = 0
  stack.forEach((kind, i) => {
    out.push({ kind, v0: v, vh: HEIGHT_U[kind] * U })
    v += HEIGHT_U[kind] * U
    if (added < spare && (i + 1) % every === 0 && kind !== 'ups3') {
      v += U
      added++
    }
  })
  return out
}

/** LEDs drawn on a face variant (deterministic). */
export function ledsFor(variant: number): LedSpec[] {
  const rng = createRng(1013 + variant * 7919)
  const out: LedSpec[] = []
  if (variant === BACK_VARIANT) {
    // PSU and NIC lights on the rear door
    for (const v of [0.12, 0.36, 0.62, 0.86]) {
      out.push({ u: 0.86, v, color: 'green', mode: 0, rate: 0, phase: 0, duty: 1 })
      out.push({ u: 0.8, v: v + 0.012, color: rng() < 0.3 ? 'amber' : 'green', mode: 1, rate: 0.6 + rng() * 2, phase: rng(), duty: 0.5 })
    }
    return out
  }
  for (const unit of unitsFor(variant)) {
    const cy = unit.v0 + unit.vh / 2
    switch (unit.kind) {
      case 'srv1':
        out.push({ u: 0.86, v: cy, color: 'green', mode: 0, rate: 0, phase: 0, duty: 1 })
        out.push({ u: 0.92, v: cy, color: 'amber', mode: 2, rate: 6 + rng() * 8, phase: rng() * 10, duty: 0.55 })
        break
      case 'srv2':
        for (let k = 0; k < 4; k++) out.push({ u: 0.18 + k * 0.13, v: cy + unit.vh * 0.18, color: 'green', mode: 2, rate: 5 + rng() * 9, phase: rng() * 10, duty: 0.5 })
        out.push({ u: 0.9, v: cy - unit.vh * 0.18, color: rng() < 0.2 ? 'blue' : 'green', mode: 0, rate: 0, phase: 0, duty: 1 })
        break
      case 'stor4':
        for (let r = 0; r < 3; r++)
          for (let k = 0; k < 4; k++) out.push({ u: 0.16 + k * 0.19, v: unit.v0 + unit.vh * (0.22 + r * 0.28), color: rng() < 0.08 ? 'amber' : 'blue', mode: 2, rate: 3 + rng() * 10, phase: rng() * 10, duty: 0.45 })
        break
      case 'switch':
        for (let k = 0; k < 8; k++) out.push({ u: 0.12 + k * 0.1, v: cy, color: 'green', mode: 2, rate: 8 + rng() * 10, phase: rng() * 10, duty: 0.35 })
        out.push({ u: 0.93, v: cy, color: 'blue', mode: 3, rate: 0.35, phase: rng(), duty: 1 })
        break
      case 'ups3':
        out.push({ u: 0.78, v: cy - unit.vh * 0.1, color: 'green', mode: 3, rate: 0.25, phase: rng(), duty: 1 })
        out.push({ u: 0.86, v: cy - unit.vh * 0.1, color: 'amber', mode: 0, rate: 0, phase: 0, duty: 1 })
        break
      default:
        break
    }
  }
  // one rack in four has a fault light blinking politely
  if (variant === 2) out.push({ u: 0.5, v: 0.012, color: 'red', mode: 1, rate: 0.8, phase: 0.3, duty: 0.5 })
  return out
}

export const LED_RGB: Record<LedSpec['color'], [number, number, number]> = {
  green: [0.35, 1.6, 0.55],
  amber: [1.7, 0.95, 0.18],
  blue: [0.35, 0.85, 1.9],
  red: [1.9, 0.22, 0.16],
  white: [1.4, 1.4, 1.3],
}

/** Paint one face cell (browser only). */
export function paintFace(ctx: CanvasRenderingContext2D, variant: number, w: number, h: number): void {
  const rng = createRng(77 + variant * 131)
  // frame + rails
  ctx.fillStyle = '#15191b'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#2b3236'
  ctx.fillRect(0, 0, 10, h)
  ctx.fillRect(w - 10, 0, 10, h)
  ctx.fillStyle = '#3b444a'
  for (let y = 6; y < h; y += 15) {
    ctx.fillRect(3, y, 4, 4)
    ctx.fillRect(w - 7, y, 4, 4)
  }
  if (variant === BACK_VARIANT) {
    // perforated rear door with cable bundles peeking through
    ctx.fillStyle = '#1e2427'
    ctx.fillRect(12, 8, w - 24, h - 16)
    const cableCols = ['#2f6fb5', '#e0b13a', '#c24a3a', '#3d9a5b', '#8c8f93']
    for (let i = 0; i < 9; i++) {
      ctx.strokeStyle = cableCols[i % cableCols.length]
      ctx.globalAlpha = 0.55
      ctx.lineWidth = 3 + rng() * 3
      ctx.beginPath()
      const x = 20 + rng() * (w - 40)
      ctx.moveTo(x, 10)
      ctx.bezierCurveTo(x + (rng() - 0.5) * 60, h * 0.3, x + (rng() - 0.5) * 60, h * 0.7, x + (rng() - 0.5) * 30, h - 10)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    ctx.fillStyle = 'rgba(8,10,11,0.78)'
    for (let y = 14; y < h - 12; y += 7) for (let x = 16 + ((y / 7) % 2) * 3; x < w - 16; x += 7) ctx.fillRect(x, y, 4, 4)
    ctx.fillStyle = '#596268'
    ctx.fillRect(w - 24, h * 0.45, 6, 48)
    return
  }
  for (const u of unitsFor(variant)) {
    const y = u.v0 * h
    const uh = u.vh * h
    const x0 = 12
    const x1 = w - 12
    const bw = x1 - x0
    switch (u.kind) {
      case 'blank':
        ctx.fillStyle = '#101314'
        ctx.fillRect(x0, y + 1, bw, uh - 2)
        break
      case 'srv1':
      case 'srv2': {
        ctx.fillStyle = u.kind === 'srv1' ? '#4c565c' : '#59646b'
        ctx.fillRect(x0, y + 1, bw, uh - 2)
        // vent hatch
        ctx.fillStyle = '#23292c'
        for (let x = x0 + 6; x < x0 + bw * 0.62; x += 5) ctx.fillRect(x, y + 3, 2, uh - 6)
        if (u.kind === 'srv2') {
          ctx.fillStyle = '#76828a'
          for (let k = 0; k < 4; k++) ctx.fillRect(x0 + 8 + k * (bw * 0.13), y + uh * 0.55, bw * 0.11, uh * 0.32)
        }
        // pull tab
        ctx.fillStyle = ['#c9cfd2', '#e0b13a', '#4f86a8'][Math.floor(rng() * 3)]
        ctx.fillRect(x1 - 18, y + 2, 4, uh - 4)
        // LED sockets
        ctx.fillStyle = '#0b0d0e'
        ctx.fillRect(x0 + bw * 0.8, y + uh * 0.35, bw * 0.15, uh * 0.3)
        break
      }
      case 'stor4': {
        ctx.fillStyle = '#39434a'
        ctx.fillRect(x0, y + 1, bw, uh - 2)
        for (let r = 0; r < 3; r++)
          for (let k = 0; k < 4; k++) {
            const bx = x0 + 4 + k * (bw - 8) / 4
            const by = y + 4 + r * (uh - 8) / 3
            ctx.fillStyle = '#7b878e'
            ctx.fillRect(bx + 2, by + 2, (bw - 8) / 4 - 4, (uh - 8) / 3 - 4)
            ctx.fillStyle = '#20262a'
            ctx.fillRect(bx + 4, by + (uh - 8) / 3 - 8, (bw - 8) / 4 - 8, 3)
          }
        break
      }
      case 'switch': {
        ctx.fillStyle = '#343c41'
        ctx.fillRect(x0, y + 1, bw, uh - 2)
        ctx.fillStyle = '#0a0c0d'
        for (let k = 0; k < 16; k++) ctx.fillRect(x0 + 8 + k * ((bw - 30) / 16), y + uh * 0.2, (bw - 30) / 16 - 2, uh * 0.6)
        break
      }
      case 'patch': {
        ctx.fillStyle = '#1d2225'
        ctx.fillRect(x0, y + 1, bw, uh - 2)
        const cols = ['#2f6fb5', '#e0b13a', '#c24a3a', '#3d9a5b']
        for (let k = 0; k < 12; k++) {
          ctx.fillStyle = cols[Math.floor(rng() * cols.length)]
          ctx.fillRect(x0 + 6 + k * ((bw - 12) / 12), y + uh * 0.25, (bw - 12) / 12 - 3, uh * 0.5)
        }
        break
      }
      case 'ups3': {
        ctx.fillStyle = '#414b51'
        ctx.fillRect(x0, y + 1, bw, uh - 2)
        ctx.fillStyle = '#0c1a12'
        ctx.fillRect(x0 + bw * 0.12, y + uh * 0.25, bw * 0.4, uh * 0.28)
        ctx.fillStyle = '#4fbf6e'
        ctx.fillRect(x0 + bw * 0.15, y + uh * 0.33, bw * 0.22, uh * 0.06)
        ctx.fillStyle = '#23292c'
        for (let x = x0 + 6; x < x1 - 6; x += 5) ctx.fillRect(x, y + uh * 0.66, 2, uh * 0.25)
        break
      }
    }
    // unit edge highlight
    ctx.fillStyle = 'rgba(255,255,255,0.06)'
    ctx.fillRect(x0, y + 1, bw, 1)
  }
}
