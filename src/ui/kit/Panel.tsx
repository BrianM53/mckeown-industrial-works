import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Icon } from './Icon'
import './panel.css'

/**
 * Accessible modal panel shell used by every portfolio/console panel.
 * - role="dialog", aria-modal, labelled by its title
 * - focus moves into the panel on open and is trapped (Tab / Shift+Tab)
 * - Esc and the visible ✕ button close it; clicking the backdrop closes it
 * - pointer/keyboard events never leak to the game canvas underneath
 *
 * Owner: ui module (may restyle; must keep this props API stable).
 *
 * Shared content classes other modules may use inside a Panel (see panel.css):
 *   .miw-btn (+ --primary / --ghost / --sm / --lg), .miw-chips/.miw-chip, .miw-sec/.miw-sec__title,
 *   .miw-callout (+ --note / --sim / --fiction / --pending), .miw-meta, .miw-lede, .miw-tag, .miw-stamp
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

/** Focusable descendants in DOM order. Without a layout engine (jsdom) every candidate counts as visible. */
function focusables(root: HTMLElement): HTMLElement[] {
  const all = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => !n.closest('[hidden],[inert]'))
  const hasLayout = root.getClientRects().length > 0
  if (!hasLayout) return all
  return all.filter((n) => n.getClientRects().length > 0 || n === document.activeElement)
}

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
        const items = focusables(el)
        if (items.length === 0) return
        const firstItem = items[0]
        const lastItem = items[items.length - 1]
        if (e.shiftKey && (document.activeElement === firstItem || !el.contains(document.activeElement))) {
          e.preventDefault()
          lastItem.focus()
        } else if (!e.shiftKey && (document.activeElement === lastItem || !el.contains(document.activeElement))) {
          e.preventDefault()
          firstItem.focus()
        }
      }
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [])

  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()
  // Close on a click that both started and ended on the backdrop: closing on pointerdown would
  // let the trailing pointerup/click reach the game canvas (e.g. grabbing pointer lock), and a
  // text-selection drag that ends outside the panel must not close it.
  const downOnBackdrop = useRef(false)

  return (
    <div
      className="miw-panel-backdrop"
      onPointerDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget
        e.stopPropagation()
      }}
      onClick={(e) => {
        if (downOnBackdrop.current && e.target === e.currentTarget) onClose()
        downOnBackdrop.current = false
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
        {/* header group: stays pinned when a very short viewport scrolls the whole panel */}
        <div className="miw-panel__top">
          <div className="miw-panel__header">
            <div className="miw-panel__heading">
              {kicker && <p className="miw-panel__kicker">{kicker}</p>}
              <h2 id={titleId} className="miw-panel__title" tabIndex={-1}>
                {title}
              </h2>
            </div>
            <button type="button" className="miw-panel__close" onClick={onClose} aria-label="Close panel" title="Close (Esc)" data-testid="panel-close">
              <Icon name="close" size={22} />
            </button>
          </div>
          <div className="miw-panel__hazard" aria-hidden="true" />
          {fiction && <p className="miw-panel__fiction">In-world fiction — not a real claim</p>}
        </div>
        <div className="miw-panel__body" role="document" aria-labelledby={titleId} tabIndex={0}>
          {children}
        </div>
        {footer && <div className="miw-panel__footer">{footer}</div>}
      </div>
    </div>
  )
}

/**
 * Safe external link (always new tab + noopener noreferrer).
 * `label` (optional) sets an explicit accessible name, e.g. "View repo: Gaussian-SLAM" for
 * repeated short link texts; " (opens in a new tab)" is appended automatically.
 */
export function ExternalLink({ href, children, className, label }: { href: string; children: ReactNode; className?: string; label?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className} aria-label={label ? `${label} (opens in a new tab)` : undefined}>
      {children}
      <Icon name="external" size={15} className="miw-ext-icon" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}
