import { useEffect, useId, useRef, type ReactNode } from 'react'
import './panel.css'

/**
 * Accessible modal panel shell used by every portfolio/console panel.
 * - role="dialog", aria-modal, labelled by its title
 * - focus moves into the panel on open and is trapped (Tab / Shift+Tab)
 * - Esc and the visible ✕ button close it; clicking the backdrop closes it
 * - pointer/keyboard events never leak to the game canvas underneath
 *
 * Owner: ui module (may restyle; must keep this props API stable).
 */
export interface PanelProps {
  title: string
  /** Small stamped label above the title, e.g. "PERSONNEL OFFICE · BAY 2". */
  kicker?: string
  onClose: () => void
  children: ReactNode
  size?: 'sm' | 'md' | 'lg'
  /** 'paper' = warm paper for long-form text; 'hmi' = dark control-panel look. */
  tone?: 'paper' | 'hmi'
  footer?: ReactNode
  /** Adds a visible "In-world fiction" ribbon (for jokes/lore, never for real facts). */
  fiction?: boolean
  /** data-testid for tests (defaults to "panel"). */
  testId?: string
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Panel({ title, kicker, onClose, children, size = 'md', tone = 'paper', footer, fiction, testId = 'panel' }: PanelProps) {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const first = el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>('h2')
    first?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        onCloseRef.current()
        return
      }
      if (e.key === 'Tab') {
        const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement)
        if (items.length === 0) return
        const firstItem = items[0]
        const lastItem = items[items.length - 1]
        if (e.shiftKey && (document.activeElement === firstItem || !el.contains(document.activeElement))) {
          e.preventDefault()
          lastItem.focus()
        } else if (!e.shiftKey && document.activeElement === lastItem) {
          e.preventDefault()
          firstItem.focus()
        }
      }
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [])

  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

  return (
    <div
      className="miw-panel-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
        e.stopPropagation()
      }}
      onWheel={stop}
    >
      <div
        ref={ref}
        className={`miw-panel miw-panel--${size} miw-panel--${tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        onPointerDown={stop}
        onKeyDown={stop}
      >
        <header className="miw-panel__header">
          <div>
            {kicker && <p className="miw-panel__kicker">{kicker}</p>}
            <h2 id={titleId} className="miw-panel__title" tabIndex={-1}>
              {title}
            </h2>
          </div>
          <button type="button" className="miw-panel__close" onClick={onClose} aria-label="Close panel" data-testid="panel-close">
            ✕
          </button>
        </header>
        {fiction && <p className="miw-panel__fiction">In-world fiction — not a real claim</p>}
        <div className="miw-panel__body">{children}</div>
        {footer && <footer className="miw-panel__footer">{footer}</footer>}
      </div>
    </div>
  )
}

/** Safe external link (always new tab + noopener noreferrer). */
export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}
