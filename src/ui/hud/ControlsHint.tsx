import { useEffect, useState, type ReactNode } from 'react'
import { SPAWN_HINT } from '@/content/controls'
import { runtime } from '@/core/runtime'
import { useGameStore } from '@/state/game'
import { useUIStore } from '@/state/ui'
import { Keycap } from '../kit/Keycap'
import { useIsTouch } from '../lib/modality'

/** Seconds the spawn hint stays up, and how long the worker must have been walking to dismiss it early. */
export const HINT_SECONDS = 9
export const HINT_MOVING_SECONDS = 1
const POLL_MS = 250

/**
 * Brief, non-blocking controls hint shown once the world is ready. Hides after
 * ~9 s of visible time or once the worker has walked (speed > 0.5) for ~1 s.
 * Respects ui store controlsHintVisible (other modules may hide it).
 */
export function ControlsHint() {
  const visible = useUIStore((s) => s.controlsHintVisible)
  const ready = useGameStore((s) => s.status === 'ready')
  const touch = useIsTouch()
  const [leaving, setLeaving] = useState(false)
  const [mounted, setMounted] = useState(visible)

  useEffect(() => {
    if (!visible || !ready) return
    let shown = 0
    let moving = 0
    const id = window.setInterval(() => {
      const ui = useUIStore.getState()
      if (ui.panel) return // reading a panel: pause the clock
      shown += POLL_MS / 1000
      moving = runtime.player.speed > 0.5 ? moving + POLL_MS / 1000 : 0
      if (shown >= HINT_SECONDS || moving >= HINT_MOVING_SECONDS) ui.setControlsHintVisible(false)
    }, POLL_MS)
    return () => window.clearInterval(id)
  }, [visible, ready])

  // Fade out, then unmount.
  useEffect(() => {
    if (visible) {
      setMounted(true)
      setLeaving(false)
      return
    }
    setLeaving(true)
    const t = window.setTimeout(() => setMounted(false), 450)
    return () => window.clearTimeout(t)
  }, [visible])

  if (!ready || !mounted) return null
  const lines = touch ? SPAWN_HINT.touch : SPAWN_HINT.desktop
  return (
    <section className={`miw-hint${leaving ? ' is-leaving' : ''}`} aria-label="Controls" data-testid="controls-hint">
      <p className="miw-hint__title">Controls</p>
      <ul className="miw-hint__list">
        {lines.map((line) => (
          <li key={line}>{touch ? line : formatHintLine(line)}</li>
        ))}
      </ul>
      {!touch && (
        <p className="miw-hint__foot">
          <Keycap size="sm">?</Keycap> all controls · <Keycap size="sm">P</Keycap> portfolio links
        </p>
      )}
    </section>
  )
}

/** "W A S D to walk · Shift to run" → keycaps for the inputs, plain text for the rest. */
export function formatHintLine(line: string): ReactNode[] {
  return line.split(' · ').map((seg, i) => {
    const m = /^(.+?) (to|for) (.+)$/.exec(seg)
    return (
      <span key={i} className="miw-hint__seg">
        {i > 0 && <span className="miw-hint__dot" aria-hidden="true"> · </span>}
        {m ? (
          <>
            <Keycap size="sm">{m[1]}</Keycap> {m[2]} {m[3]}
          </>
        ) : (
          seg
        )}
      </span>
    )
  })
}
