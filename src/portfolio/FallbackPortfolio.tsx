import { useEffect, useRef } from 'react'
import PortfolioDocument from './PortfolioDocument'
import { forwardScrollKeys } from './keyboardScroll'
import './portfolio.css'
import './fallback.css'

/**
 * HTML portfolio shown by App in fallback mode: WebGL unavailable, the visitor chose the
 * lite view (?lite=1), or the 3D scene crashed. Renders under the ui module's top bar in a
 * fixed, self-scrolling layer (the app root is overflow:hidden).
 */
export type FallbackReason = 'requested' | 'no-webgl' | 'error'

const NOTICE: Record<FallbackReason, { label: string; text: string; cta: string | null }> = {
  requested: {
    label: 'Lite view',
    text: 'You’re viewing the plain portfolio: the same facts, no 3D. The factory is one click away whenever you want it.',
    cta: 'Try the 3D factory',
  },
  'no-webgl': {
    label: '3D unavailable',
    text: 'This browser can’t start WebGL, which the 3D factory needs, so here is the full portfolio as a regular page. Turning on hardware acceleration in your browser settings may help.',
    cta: null,
  },
  error: {
    label: '3D factory offline',
    text: 'The 3D factory hit a problem and was shut down safely. Everything you came for is right here.',
    cta: 'Try the 3D factory again',
  },
}

export default function FallbackPortfolio({ reason }: { reason: FallbackReason }) {
  // Base URL without ?lite (or any other query): opens the 3D factory.
  const base = import.meta.env.BASE_URL || '/'
  const noticeRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const copy = NOTICE[reason] ?? NOTICE.requested

  useEffect(() => {
    // After a crash the canvas (and keyboard focus) is gone: move focus to the explanation.
    if (reason === 'error') noticeRef.current?.focus({ preventScroll: true })
  }, [reason])

  useEffect(() => {
    // Deep links such as ?lite=1#resume: this layer mounts lazily, after the browser's own
    // fragment scroll, so scroll the target section into view once it exists.
    let id = ''
    try {
      id = decodeURIComponent(window.location.hash.slice(1))
    } catch {
      return
    }
    if (!id) return
    const el = document.getElementById(id)
    if (el && containerRef.current?.contains(el)) el.scrollIntoView({ block: 'start' })
  }, [])

  useEffect(() => {
    // The layer is not the page's root scroller: without this, Space / Page Down / arrows do
    // nothing until the visitor tabs into the page (focus starts on <body>).
    const layer = containerRef.current
    return layer ? forwardScrollKeys(layer) : undefined
  }, [])

  const notice = (
    <div
      ref={noticeRef}
      className={`pf-notice pf-notice--${reason}`}
      role="note"
      aria-label="Viewing mode"
      tabIndex={-1}
      data-testid="fallback-notice"
    >
      <div className="pf-notice__body">
        <p className="pf-notice__label">
          <span className="pf-notice__lamp" aria-hidden="true" />
          {copy.label}
        </p>
        <p className="pf-notice__text">{copy.text}</p>
      </div>
      {copy.cta && (
        <a className="pf-btn pf-btn--primary" href={base} data-testid="fallback-try-3d">
          {copy.cta}
        </a>
      )}
    </div>
  )

  return (
    <div ref={containerRef} className="pf-fallback" data-testid="fallback-portfolio" data-reason={reason}>
      <main id="main" className="pf-fallback__main">
        <PortfolioDocument variant="embedded" basePath={base} factoryHref={reason === 'no-webgl' ? null : base} notice={notice} />
      </main>
    </div>
  )
}
