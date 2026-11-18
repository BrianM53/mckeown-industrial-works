import { isTypingTarget } from '@/core/actions'
import { runtime } from '@/core/runtime'
import { isOverlayBlocking } from '@/state/ui'

/**
 * Forklift driving input: W/S (↑/↓) throttle, A/D (←/→) steer, H / Space
 * horn, the touch joystick (runtime.input.touchMove), and a programmatic
 * override for tests (`__MIW__.forklift.drive`). Vehicle-relative: W always
 * drives toward the forks, whatever the camera does.
 *
 * E (exit) and R (recover) stay with the player module, which routes them to
 * the forklift interactable / service.
 */
type Axis = 'fwd' | 'back' | 'left' | 'right'

const BY_CODE: Record<string, Axis | 'horn'> = {
  KeyW: 'fwd',
  ArrowUp: 'fwd',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  KeyH: 'horn',
  Space: 'horn',
}

const BY_KEY: Record<string, Axis | 'horn'> = { w: 'fwd', s: 'back', a: 'left', d: 'right', h: 'horn', ' ': 'horn' }

/** Map a key event to a driving control (pure, tested). */
export function driveControlForKey(code: string, key: string): Axis | 'horn' | null {
  if (code && BY_CODE[code]) return BY_CODE[code]
  const k = key.length === 1 ? key.toLowerCase() : key
  if (!code && BY_KEY[k]) return BY_KEY[k]
  return null
}

/** Elements whose native activation already uses Space (never hijack them). */
function isActivatable(target: EventTarget | null): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false
  return target.closest('button, a[href], [role="button"], [role="switch"], summary, input, select, textarea') !== null
}

export interface DriveIntent {
  throttle: number
  steer: number
  /** A real driving key / stick is held (stuck detection). */
  held: boolean
}

export class DriveInput {
  private held = new Map<string, Axis>()
  /** Codes that were already down when we sat in: ignored until released. */
  private suppressed = new Set<string>()
  private test: { throttle: number; steer: number; until: number } | null = null
  /** Called on a horn press (H / Space / touch button). */
  onHorn: (() => void) | null = null
  /** Is somebody driving? Horn & Space capture only then. */
  isActive: () => boolean = () => false

  attach(): () => void {
    if (typeof window === 'undefined') return () => {}
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    document.addEventListener('visibilitychange', this.onVisibility)
    return () => {
      window.removeEventListener('keydown', this.onKeyDown)
      window.removeEventListener('keyup', this.onKeyUp)
      window.removeEventListener('blur', this.onBlur)
      document.removeEventListener('visibilitychange', this.onVisibility)
      this.clear()
    }
  }

  /** Ignore keys that are down right now until they are released (no lurch on entry). */
  suppressHeld(): void {
    for (const code of this.held.keys()) this.suppressed.add(code)
    this.held.clear()
  }

  clear(): void {
    this.held.clear()
    this.suppressed.clear()
  }

  setTest(throttle: number, steer: number, ms: number): void {
    const t = Number.isFinite(throttle) ? Math.max(-1, Math.min(1, throttle)) : 0
    const s = Number.isFinite(steer) ? Math.max(-1, Math.min(1, steer)) : 0
    const dur = Number.isFinite(ms) ? Math.max(0, ms) : 1000
    this.test = dur > 0 ? { throttle: t, steer: s, until: now() + dur } : null
  }

  get testActive(): boolean {
    if (this.test && now() > this.test.until) this.test = null
    return this.test !== null
  }

  /** Current intent. `driving` false → zero (unless a test drive is running). */
  read(out: DriveIntent, driving: boolean): DriveIntent {
    out.throttle = 0
    out.steer = 0
    out.held = false
    if (this.testActive && this.test) {
      out.throttle = this.test.throttle
      out.steer = this.test.steer
      out.held = out.throttle !== 0
      return out
    }
    if (!driving || isOverlayBlocking()) return out
    if (typeof document !== 'undefined' && isTypingTarget(document.activeElement)) return out
    let fwd = false
    let back = false
    let left = false
    let right = false
    for (const a of this.held.values()) {
      if (a === 'fwd') fwd = true
      else if (a === 'back') back = true
      else if (a === 'left') left = true
      else if (a === 'right') right = true
    }
    let th = (fwd ? 1 : 0) - (back ? 1 : 0)
    let st = (right ? 1 : 0) - (left ? 1 : 0)
    const stick = runtime.input.touchMove
    const sx = stick && Number.isFinite(stick.x) ? stick.x : 0
    const sy = stick && Number.isFinite(stick.y) ? stick.y : 0
    if (Math.hypot(sx, sy) > 0.15) {
      if (Math.abs(sy) > Math.abs(th)) th = sy
      if (Math.abs(sx) > Math.abs(st)) st = sx
    }
    out.throttle = Math.max(-1, Math.min(1, th))
    out.steer = Math.max(-1, Math.min(1, st))
    out.held = Math.abs(out.throttle) > 0.2
    return out
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (isTypingTarget(e.target)) return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const c = driveControlForKey(e.code, e.key)
    if (!c) return
    const id = e.code || e.key
    if (c === 'horn') {
      if (!this.isActive() || isOverlayBlocking()) return
      if (e.code === 'Space' || e.key === ' ') {
        if (isActivatable(e.target)) return
        e.preventDefault()
      }
      if (!e.repeat) this.onHorn?.()
      return
    }
    if (this.suppressed.has(id)) return
    if (isOverlayBlocking()) return
    this.held.set(id, c)
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    const id = e.code || e.key
    this.held.delete(id)
    this.suppressed.delete(id)
  }

  private onBlur = (): void => this.clear()

  private onVisibility = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') this.clear()
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}
