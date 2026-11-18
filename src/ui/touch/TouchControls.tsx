import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { actions, type ActionName } from '@/core/actions'
import { runtime } from '@/core/runtime'
import { useGameStore } from '@/state/game'
import { useUIStore } from '@/state/ui'
import { Icon, type IconName } from '../kit/Icon'
import { clampStickCenter, stickVector } from '../lib/joystick'
import { useIsTouch } from '../lib/modality'

/** Knob travel (px) and base diameter (px) of the floating joystick. */
export const STICK_RADIUS = 56
const BASE_SIZE = 132

/** Zero every touch input the player module consumes (touchRun is a sticky toggle and is kept). */
export function resetTouchInput(): void {
  const input = runtime.input
  input.touchMove.x = 0
  input.touchMove.y = 0
  input.touchLook.dx = 0
  input.touchLook.dy = 0
  input.touchZoom = 0
}

/**
 * Touch controls (game mode, coarse pointer or a touch seen; hidden while a panel
 * is open). Writes core/runtime input:
 *   touchMove {x right, y forward} -1..1 from the left floating joystick (0 on release)
 *   touchLook.dx/dy accumulated CSS px from one-finger drags elsewhere
 *   touchZoom accumulated CSS px of two-finger pinch (positive = fingers closing = zoom out)
 * Buttons never start a look drag and every gesture tracks its own pointer id.
 */
export function TouchControls() {
  const touch = useIsTouch()
  const ready = useGameStore((s) => s.status === 'ready')
  const panelOpen = useUIStore((s) => s.panel !== null)
  const visible = touch && ready && !panelOpen

  useEffect(() => {
    if (!visible) resetTouchInput()
  }, [visible])
  useEffect(() => () => resetTouchInput(), [])

  if (!visible) return null
  return <TouchLayer />
}

type PE = ReactPointerEvent<HTMLDivElement>

function TouchLayer() {
  const zoneRef = useRef<HTMLDivElement>(null)
  const baseRef = useRef<HTMLDivElement>(null)
  const knobRef = useRef<HTMLDivElement>(null)
  const stick = useRef<{ id: number; cx: number; cy: number } | null>(null)
  const looks = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<number | null>(null)
  const [stickActive, setStickActive] = useState(false)

  useEffect(() => {
    const lookPointers = looks.current
    return () => {
      stick.current = null
      lookPointers.clear()
      resetTouchInput()
    }
  }, [])

  // ---- left: floating joystick ----
  const placeBase = (cx: number, cy: number) => {
    const base = baseRef.current
    const zone = zoneRef.current
    if (!base || !zone) return
    const r = zone.getBoundingClientRect()
    base.style.left = `${cx - r.left - BASE_SIZE / 2}px`
    base.style.top = `${cy - r.top - BASE_SIZE / 2}px`
    base.style.bottom = 'auto'
  }
  const releaseStick = () => {
    stick.current = null
    const base = baseRef.current
    if (base) {
      base.style.left = ''
      base.style.top = ''
      base.style.bottom = ''
    }
    if (knobRef.current) knobRef.current.style.transform = ''
    runtime.input.touchMove.x = 0
    runtime.input.touchMove.y = 0
    setStickActive(false)
  }
  const steer = (x: number, y: number) => {
    const s = stick.current
    if (!s) return
    const v = stickVector(x - s.cx, y - s.cy, STICK_RADIUS)
    runtime.input.touchMove.x = v.x
    runtime.input.touchMove.y = v.y
    if (knobRef.current) knobRef.current.style.transform = `translate(${v.knobX}px, ${v.knobY}px)`
  }
  const onStickDown = (e: PE) => {
    if (stick.current) return
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* capture is best-effort */
    }
    const r = e.currentTarget.getBoundingClientRect()
    const c = clampStickCenter(e.clientX, e.clientY, BASE_SIZE / 2 + 6, { minX: r.left, maxX: r.right, minY: r.top, maxY: r.bottom })
    stick.current = { id: e.pointerId, cx: c.x, cy: c.y }
    placeBase(c.x, c.y)
    steer(e.clientX, e.clientY)
    setStickActive(true)
  }
  const onStickMove = (e: PE) => {
    if (stick.current?.id === e.pointerId) steer(e.clientX, e.clientY)
  }
  const onStickEnd = (e: PE) => {
    if (stick.current?.id === e.pointerId) releaseStick()
  }

  // ---- everywhere else: look drag + two-finger pinch zoom ----
  const spread = (): number | null => {
    const pts = [...looks.current.values()]
    if (pts.length < 2) return null
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
  }
  const onLookDown = (e: PE) => {
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* best-effort */
    }
    looks.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    pinch.current = spread()
  }
  const onLookMove = (e: PE) => {
    const p = looks.current.get(e.pointerId)
    if (!p) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    p.x = e.clientX
    p.y = e.clientY
    if (looks.current.size >= 2) {
      const d = spread()
      if (pinch.current !== null && d !== null) runtime.input.touchZoom += pinch.current - d
      pinch.current = d
      return
    }
    runtime.input.touchLook.dx += dx
    runtime.input.touchLook.dy += dy
  }
  const onLookEnd = (e: PE) => {
    if (!looks.current.delete(e.pointerId)) return
    pinch.current = spread()
  }

  return (
    <section className="miw-touch" aria-label="Touch controls" data-testid="touch-controls">
      <div
        className="miw-touch__look"
        aria-hidden="true"
        onPointerDown={onLookDown}
        onPointerMove={onLookMove}
        onPointerUp={onLookEnd}
        onPointerCancel={onLookEnd}
        onLostPointerCapture={onLookEnd}
      />
      <div
        ref={zoneRef}
        className="miw-touch__stick-zone"
        aria-hidden="true"
        onPointerDown={onStickDown}
        onPointerMove={onStickMove}
        onPointerUp={onStickEnd}
        onPointerCancel={onStickEnd}
        onLostPointerCapture={onStickEnd}
      >
        <div ref={baseRef} className={`miw-stick${stickActive ? ' is-active' : ''}`}>
          <div ref={knobRef} className="miw-stick__knob" />
        </div>
      </div>
      <TouchButtons />
    </section>
  )
}

function TouchButtons() {
  const prompt = useUIStore((s) => s.prompt)
  const dialogue = useUIStore((s) => s.dialogue !== null)
  const needsRecovery = useUIStore((s) => s.recoveryHint !== null)
  const driving = useGameStore((s) => s.mode === 'forklift')
  const [run, setRun] = useState(() => runtime.input.touchRun)

  const trigger = (name: ActionName) => () => actions.trigger(name)
  const onInteract = () => {
    const ui = useUIStore.getState()
    if (ui.dialogue) ui.advanceDialogue()
    else actions.trigger('interact')
  }
  const toggleRun = () => {
    const next = !runtime.input.touchRun
    runtime.input.touchRun = next
    setRun(next)
  }
  const idle = !prompt && !dialogue

  return (
    <>
      <div className="miw-touch__top">
        <TouchButton icon="map" label="Map" ariaLabel="Map and directory" onPress={trigger('map')} />
        <TouchButton icon="pause" label="Pause" ariaLabel="Pause menu and portfolio links" onPress={trigger('menu')} />
      </div>
      <div className="miw-touch__cluster">
        <div className="miw-touch__row">
          {driving && <TouchButton className="miw-tbtn--horn" icon="horn" label="Horn" onPress={trigger('horn')} />}
          <TouchButton className={`miw-tbtn--recover${needsRecovery ? ' is-alert' : ''}`} icon="recover" label="Recover" ariaLabel="Recover (unstick)" onPress={trigger('recover')} />
          <TouchButton className="miw-tbtn--recenter" icon="recenter" label="Recenter" ariaLabel="Recenter camera" onPress={trigger('recenter')} />
          <TouchButton className="miw-tbtn--run" icon="run" label="Run" pressed={run} onPress={toggleRun} />
        </div>
        {/* Name comes from the visible text (WCAG 2.5.3 label-in-name), with screen-reader-only joiners:
            "Inspect: Résumé-O-Matic 3000", "Continue dialogue", "Interact (nothing in range)". */}
        <button
          type="button"
          className={`miw-tbtn miw-tbtn--interact${idle ? ' is-idle' : ''}`}
          aria-disabled={idle || undefined}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onInteract}
          data-testid="touch-interact"
        >
          <Icon name="hand" size={26} />
          <span className="miw-tbtn__text">
            <span className="miw-tbtn__verb">{dialogue ? 'Continue' : prompt ? prompt.verb : 'Interact'}</span>
            {dialogue && <span className="sr-only"> dialogue</span>}
            {!dialogue && prompt && (
              <>
                <span className="sr-only">:</span> <span className="miw-tbtn__target">{prompt.label}</span>
              </>
            )}
            {idle && <span className="sr-only"> (nothing in range)</span>}
          </span>
        </button>
      </div>
    </>
  )
}

function TouchButton({
  icon,
  label,
  ariaLabel,
  pressed,
  className,
  onPress,
}: {
  icon: IconName
  label: string
  ariaLabel?: string
  pressed?: boolean
  className?: string
  onPress: () => void
}) {
  return (
    <button
      type="button"
      className={`miw-tbtn${className ? ` ${className}` : ''}`}
      aria-label={ariaLabel}
      aria-pressed={pressed}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onPress}
    >
      <Icon name={icon} size={22} />
      <span className="miw-tbtn__label">{label}</span>
    </button>
  )
}
