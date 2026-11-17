/**
 * Keyboard scrolling for the in-app fallback layer (FallbackPortfolio).
 *
 * The layer is a fixed, self-scrolling element because the app root never scrolls. When focus
 * is on <body> (a fresh load of ?lite=1, or after clicking the top bar's background) the browser
 * sends Space / Page Up / Page Down / arrows / Home / End to the non-scrollable document, so
 * nothing moves until the visitor tabs into the page. This forwards those keys to the layer.
 * Focused links and buttons inside the layer keep their native behaviour (Space activates a
 * button, the browser scrolls the layer itself), and an open modal panel keeps the keyboard.
 */

/** Pixels per arrow-key press (Chromium's line step). */
export const LINE_STEP = 40

/** Fraction of the visible height moved by Page Up / Page Down / Space (Chromium pages by 87.5%). */
export const PAGE_FRACTION = 0.875

export interface ScrollMetrics {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

/**
 * Where a scroll key should move the layer: `{ top, smooth }`, or null when the key is not a
 * scroll key or the layer is already at that edge. Arrow keys move instantly (smooth scrolling
 * lags behind key repeat); paging keys use the layer's CSS scroll-behavior.
 */
export function scrollTargetForKey(key: string, shiftKey: boolean, el: ScrollMetrics): { top: number; smooth: boolean } | null {
  const max = Math.max(0, el.scrollHeight - el.clientHeight)
  const page = Math.max(LINE_STEP, Math.round(el.clientHeight * PAGE_FRACTION))
  let top: number
  let smooth = true
  switch (key) {
    case 'ArrowDown':
      top = el.scrollTop + LINE_STEP
      smooth = false
      break
    case 'ArrowUp':
      top = el.scrollTop - LINE_STEP
      smooth = false
      break
    case 'PageDown':
      top = el.scrollTop + page
      break
    case 'PageUp':
      top = el.scrollTop - page
      break
    case ' ':
    case 'Spacebar':
      top = el.scrollTop + (shiftKey ? -page : page)
      break
    case 'Home':
      top = 0
      break
    case 'End':
      top = max
      break
    default:
      return null
  }
  top = Math.min(max, Math.max(0, top))
  return Math.abs(top - el.scrollTop) < 1 ? null : { top, smooth }
}

/** Forwards unhandled scroll keys aimed at <body>/<html> to `layer`. Returns the cleanup. */
export function forwardScrollKeys(layer: HTMLElement): () => void {
  const doc = layer.ownerDocument
  const win = doc.defaultView
  if (!win) return () => {}
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
    if (e.target !== doc.body && e.target !== doc.documentElement) return
    if (doc.querySelector('[aria-modal="true"]')) return
    const next = scrollTargetForKey(e.key, e.shiftKey, layer)
    if (!next) return
    e.preventDefault()
    if (typeof layer.scrollTo === 'function') layer.scrollTo({ top: next.top, behavior: next.smooth ? 'auto' : 'instant' })
    else layer.scrollTop = next.top
  }
  win.addEventListener('keydown', onKeyDown)
  return () => win.removeEventListener('keydown', onKeyDown)
}
