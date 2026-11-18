import { pushToast } from './feed'
import { liteHref, portfolioHref } from './links'

/**
 * "This device is struggling" offer of the lite portfolio (spec §4: a polished lightweight
 * fallback when the 3D experience cannot run well). Shown at most once per browser session;
 * hud/useSlowDeviceOffer decides when. No three.js imports: the debug hook stages it from the
 * entry chunk.
 */
const SESSION_KEY = 'miw:lite-offered'
let offeredInMemory = false

export const LITE_OFFER_TEXT = 'This device is struggling with the 3D factory. Switch to the lite portfolio? Same content, no 3D.'

export function liteOfferedThisSession(): boolean {
  if (offeredInMemory) return true
  try {
    return window.sessionStorage.getItem(SESSION_KEY) === '1'
  } catch {
    return false
  }
}

/** Show the offer (sticky toast with two links). Returns false when it was already offered this session. */
export function offerLitePortfolio({ force = false }: { force?: boolean } = {}): boolean {
  if (!force && liteOfferedThisSession()) return false
  offeredInMemory = true
  try {
    window.sessionStorage.setItem(SESSION_KEY, '1')
  } catch {
    /* private mode / blocked storage: the in-memory flag still limits it to once per page */
  }
  pushToast({
    title: 'Running slowly',
    text: LITE_OFFER_TEXT,
    kind: 'warning',
    sticky: true,
    actions: [
      { label: 'Switch to lite', href: liteHref(), primary: true },
      { label: 'Portfolio page', href: portfolioHref() },
    ],
  })
  return true
}

/** Tests only: forget that the offer was shown. */
export function resetLiteOffer(): void {
  offeredInMemory = false
  try {
    window.sessionStorage.removeItem(SESSION_KEY)
  } catch {
    /* ignore */
  }
}
