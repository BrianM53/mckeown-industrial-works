/**
 * Local display font for canvas-painted stencils/signs (never remote: the
 * production CSP only allows same-origin). Resolves even if loading fails or
 * stalls (callers paint with the fallback stack first and repaint on load).
 */
export const STENCIL_FONT = '"MIW Vehicles Display", "Barlow Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif'

let promise: Promise<boolean> | null = null

export function loadVehicleFont(timeoutMs = 5000): Promise<boolean> {
  if (promise) return promise
  promise = new Promise<boolean>((resolve) => {
    if (typeof document === 'undefined' || typeof FontFace === 'undefined' || !document.fonts) {
      resolve(false)
      return
    }
    const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/'
    const face = new FontFace('MIW Vehicles Display', `url(${base}fonts/BarlowCondensed-Bold.woff) format("woff")`, { weight: '700' })
    const timer = setTimeout(() => resolve(false), timeoutMs)
    face
      .load()
      .then((loaded) => {
        document.fonts.add(loaded)
        clearTimeout(timer)
        resolve(true)
      })
      .catch(() => {
        clearTimeout(timer)
        resolve(false)
      })
  })
  return promise
}
