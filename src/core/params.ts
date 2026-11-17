import type { QualityTier } from './types'

/**
 * URL query parameters (all optional):
 *   ?lite=1            force the HTML portfolio fallback (no 3D)
 *   ?quality=low|medium|high   override render quality
 *   ?seed=123          seed for deterministic factory outcomes / gags
 *   ?panel=resume      open a portfolio panel on load (deep link)
 *   ?spawn=<zoneId>    start at a zone entrance instead of visitor intake (dev/test)
 *   ?noevents=1        disable involuntary ambient events (tests)
 *   ?timescale=4       simulation speed multiplier (dev/test builds only)
 */
export interface UrlParams {
  lite: boolean
  quality: QualityTier | null
  seed: number | null
  panel: string | null
  spawn: string | null
  noEvents: boolean
  timeScale: number | null
}

export function readParams(search: string = typeof window !== 'undefined' ? window.location.search : ''): UrlParams {
  const q = new URLSearchParams(search)
  const quality = q.get('quality')
  const seed = q.get('seed')
  const ts = q.get('timescale')
  return {
    lite: q.get('lite') === '1' || q.get('lite') === 'true',
    quality: quality === 'low' || quality === 'medium' || quality === 'high' ? quality : null,
    seed: seed !== null && /^\d+$/.test(seed) ? Number(seed) : null,
    panel: q.get('panel'),
    spawn: q.get('spawn'),
    noEvents: q.get('noevents') === '1',
    timeScale: ts !== null && Number.isFinite(Number(ts)) ? Math.min(50, Math.max(0, Number(ts))) : null,
  }
}

export const params: UrlParams = readParams()
