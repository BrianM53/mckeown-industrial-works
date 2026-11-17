import { isTypingTarget } from '@/core/actions'
import { runtime } from '@/core/runtime'
import { useSettings } from '@/state/settings'
import { isOverlayBlocking } from '@/state/ui'
import { CAMERA } from './constants'
import { wheelToZoom } from './cameraMath'
import { combineMove, controlForKey, isActionControl, moveAxes, orbitAxes, preventsDefault, type ActionControl, type Control } from './inputMap'

/**
 * Player input: keyboard (window), mouse drag-orbit / wheel / pointer-lock
 * (canvas only), and the touch accumulators written by the ui module into
 * `runtime.input`. Never starts an orbit from UI elements (only pointerdown on
 * the canvas element), never traps the pointer unless the visitor opted in to
 * pointer-lock AND clicked the canvas.
 */
export interface MoveInput {
  x: number
  y: number
  run: boolean
}

export interface LookInput {
  /** Orbit delta in CSS px (mouse/touch), + = drag right / down. */
  dx: number
  dy: number
  /** Log zoom delta (+ = zoom out). */
  zoom: number
  /** Keyboard orbit axes (held keys). */
  keyYaw: number
  keyPitch: number
  keyZoom: number
}

export class InputManager {
  /** Held controls keyed by physical code (so keyup always releases what keydown pressed). */
  private heldByCode = new Map<string, Control>()
  private held = new Set<Control>()
  private lookDX = 0
  private lookDY = 0
  private zoom = 0
  private dragId: number | null = null
  private lastX = 0
  private lastY = 0
  private prevCursor = ''
  private canvas: HTMLCanvasElement | null = null
  private test: { x: number; y: number; run: boolean; until: number } | null = null
  /** Pointer currently locked to the canvas. */
  locked = false
  /** Last time (performance.now ms) the visitor gave orbit input. */
  lastLookInputAt = -Infinity

  constructor(private readonly onAction: (a: ActionControl) => void) {}

  attach(canvas: HTMLCanvasElement): () => void {
    this.canvas = canvas
    const opts: AddEventListenerOptions = { passive: false }
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    document.addEventListener('visibilitychange', this.onVisibility)
    document.addEventListener('focusin', this.onFocusIn)
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerUp)
    canvas.addEventListener('lostpointercapture', this.onPointerUp)
    canvas.addEventListener('contextmenu', this.onContextMenu)
    canvas.addEventListener('wheel', this.onWheel, opts)
    canvas.addEventListener('click', this.onClick)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
    document.addEventListener('mousemove', this.onLockedMouseMove)
    return () => {
      window.removeEventListener('keydown', this.onKeyDown)
      window.removeEventListener('keyup', this.onKeyUp)
      window.removeEventListener('blur', this.onBlur)
      document.removeEventListener('visibilitychange', this.onVisibility)
      document.removeEventListener('focusin', this.onFocusIn)
      canvas.removeEventListener('pointerdown', this.onPointerDown)
      canvas.removeEventListener('pointermove', this.onPointerMove)
      canvas.removeEventListener('pointerup', this.onPointerUp)
      canvas.removeEventListener('pointercancel', this.onPointerUp)
      canvas.removeEventListener('lostpointercapture', this.onPointerUp)
      canvas.removeEventListener('contextmenu', this.onContextMenu)
      canvas.removeEventListener('wheel', this.onWheel, opts)
      canvas.removeEventListener('click', this.onClick)
      document.removeEventListener('pointerlockchange', this.onPointerLockChange)
      document.removeEventListener('mousemove', this.onLockedMouseMove)
      this.endDrag()
      this.releasePointerLock()
      this.clear()
      this.canvas = null
    }
  }

  /** Forget all held keys and pending deltas (blur, overlay, teleport). */
  clear(): void {
    this.heldByCode.clear()
    this.held.clear()
    this.lookDX = 0
    this.lookDY = 0
    this.zoom = 0
  }

  /** Debug/test: force a movement input for `ms` milliseconds (or clear with null). */
  setTestInput(v: { x?: number; y?: number; run?: boolean; ms?: number } | null): void {
    if (!v) {
      this.test = null
      return
    }
    this.test = { x: v.x ?? 0, y: v.y ?? 0, run: !!v.run, until: performance.now() + (v.ms ?? 1000) }
  }

  /** Movement intent for this physics step (zero while typing / an overlay is open). */
  move(out: MoveInput): MoveInput {
    out.x = 0
    out.y = 0
    out.run = false
    if (this.test) {
      if (performance.now() > this.test.until) this.test = null
      else {
        out.x = this.test.x
        out.y = this.test.y
        out.run = this.test.run
        return out
      }
    }
    if (isOverlayBlocking() || (typeof document !== 'undefined' && isTypingTarget(document.activeElement))) return out
    const stick = runtime.input.touchMove
    const m = combineMove(moveAxes(this.held), { x: stick?.x ?? 0, y: stick?.y ?? 0 })
    out.x = m.x
    out.y = m.y
    out.run = this.held.has('run') || !!runtime.input.touchRun
    return out
  }

  /** True when any movement key/stick is active (ignores overlays). */
  hasMoveIntent(): boolean {
    const s = runtime.input.touchMove
    return (
      this.held.has('forward') || this.held.has('back') || this.held.has('left') || this.held.has('right') || Math.hypot(s?.x ?? 0, s?.y ?? 0) > 0.2 || !!this.test
    )
  }

  /**
   * Consume accumulated look/zoom input (mouse + touch) since the last frame.
   * Touch accumulators in runtime.input are zeroed here (single consumer).
   */
  consumeLook(out: LookInput): LookInput {
    const ti = runtime.input
    const tl = ti.touchLook
    let tdx = 0
    let tdy = 0
    let tz = 0
    if (tl) {
      tdx = Number.isFinite(tl.dx) ? tl.dx : 0
      tdy = Number.isFinite(tl.dy) ? tl.dy : 0
      tl.dx = 0
      tl.dy = 0
    }
    if (Number.isFinite(ti.touchZoom)) tz = ti.touchZoom
    ti.touchZoom = 0
    const blocked = isOverlayBlocking()
    if (blocked) {
      out.dx = out.dy = out.zoom = out.keyYaw = out.keyPitch = out.keyZoom = 0
      this.lookDX = this.lookDY = this.zoom = 0
      return out
    }
    out.dx = this.lookDX + tdx * CAMERA.touchLookScale
    out.dy = this.lookDY + tdy * CAMERA.touchLookScale
    out.zoom = this.zoom + tz * CAMERA.pinchZoomPerUnit
    const typing = typeof document !== 'undefined' && isTypingTarget(document.activeElement)
    const k = typing ? { yaw: 0, pitch: 0, zoom: 0 } : orbitAxes(this.held)
    out.keyYaw = k.yaw
    out.keyPitch = k.pitch
    out.keyZoom = k.zoom
    if (out.dx !== 0 || out.dy !== 0 || k.yaw !== 0 || k.pitch !== 0) this.lastLookInputAt = performance.now()
    this.lookDX = 0
    this.lookDY = 0
    this.zoom = 0
    return out
  }

  isDragging(): boolean {
    return this.dragId !== null
  }

  // ---------------------------------------------------------------- keyboard

  private onKeyDown = (e: KeyboardEvent): void => {
    if (isTypingTarget(e.target)) return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const c = controlForKey(e.code, e.key)
    if (!c) return
    if (isOverlayBlocking()) return
    if (isActionControl(c)) {
      // E/R/C belong to the player while no overlay is open. Stop this event here so a
      // listener registered after us can't also treat the E that just OPENED a dialogue
      // as "advance dialogue".
      e.stopImmediatePropagation()
      if (!e.repeat) this.onAction(c)
      return
    }
    this.heldByCode.set(e.code || e.key, c)
    this.held.add(c)
    if (preventsDefault(e.code)) e.preventDefault()
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    const id = e.code || e.key
    const c = this.heldByCode.get(id) ?? controlForKey(e.code, e.key)
    this.heldByCode.delete(id)
    if (!c) return
    // Only release the control if no other held key maps to it (e.g. W + ArrowUp).
    for (const v of this.heldByCode.values()) if (v === c) return
    this.held.delete(c)
  }

  private onBlur = (): void => {
    this.clear()
    this.endDrag()
  }

  private onVisibility = (): void => {
    if (document.visibilityState !== 'visible') this.onBlur()
  }

  private onFocusIn = (e: FocusEvent): void => {
    if (isTypingTarget(e.target)) this.clear()
  }

  // ---------------------------------------------------------------- mouse

  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return // touch look is handled by the ui touch layer
    if (e.button !== 0 && e.button !== 2) return
    if (isOverlayBlocking() || this.locked) return
    if (e.button === 0 && useSettings.getState().pointerLock) return // click → pointer lock (see onClick)
    this.dragId = e.pointerId
    this.lastX = e.clientX
    this.lastY = e.clientY
    const cv = this.canvas
    if (cv) {
      try {
        cv.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      this.prevCursor = cv.style.cursor
      cv.style.cursor = 'grabbing'
    }
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (this.dragId === null || e.pointerId !== this.dragId) return
    if (isOverlayBlocking()) {
      this.endDrag()
      return
    }
    const dx = e.clientX - this.lastX
    const dy = e.clientY - this.lastY
    this.lastX = e.clientX
    this.lastY = e.clientY
    if (Number.isFinite(dx) && Number.isFinite(dy)) {
      this.lookDX += dx
      this.lookDY += dy
    }
  }

  private onPointerUp = (e: PointerEvent): void => {
    if (this.dragId === null || e.pointerId !== this.dragId) return
    this.endDrag()
  }

  private endDrag(): void {
    if (this.dragId === null) return
    const cv = this.canvas
    if (cv) {
      try {
        if (cv.hasPointerCapture(this.dragId)) cv.releasePointerCapture(this.dragId)
      } catch {
        /* ignore */
      }
      cv.style.cursor = this.prevCursor
    }
    this.dragId = null
  }

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault()
  }

  private onWheel = (e: WheelEvent): void => {
    if (isOverlayBlocking()) return
    e.preventDefault()
    this.zoom += wheelToZoom(e.deltaY, e.deltaMode)
  }

  // ---------------------------------------------------------------- pointer lock (opt-in)

  private onClick = (e: MouseEvent): void => {
    if (e.button !== 0) return
    if (!useSettings.getState().pointerLock || this.locked || isOverlayBlocking()) return
    const cv = this.canvas
    if (!cv || typeof cv.requestPointerLock !== 'function') return
    try {
      const r = cv.requestPointerLock() as unknown
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => {})
    } catch {
      /* ignore: e.g. sandboxed iframe */
    }
  }

  private onPointerLockChange = (): void => {
    this.locked = !!this.canvas && document.pointerLockElement === this.canvas
  }

  private onLockedMouseMove = (e: MouseEvent): void => {
    if (!this.locked) return
    if (isOverlayBlocking()) {
      this.releasePointerLock()
      return
    }
    const dx = e.movementX
    const dy = e.movementY
    // Some browsers report a huge spurious delta right after locking.
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) > 400 || Math.abs(dy) > 400) return
    this.lookDX += dx
    this.lookDY += dy
  }

  /** Release pointer lock if we hold it (overlay opened, setting turned off, unmount). */
  releasePointerLock(): void {
    if (typeof document === 'undefined') return
    if (this.canvas && document.pointerLockElement === this.canvas) {
      try {
        document.exitPointerLock()
      } catch {
        /* ignore */
      }
    }
    this.locked = false
  }
}
