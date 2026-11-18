/**
 * Local fonts for stations-b canvas text (never remote — production CSP allows
 * same-origin only). Registered once through the FontFace API under private
 * family names; resolves even if loading fails (falls back to the CSS-loaded
 * @fontsource families / system fonts) and never waits longer than `timeoutMs`.
 */
export const FONT_DISPLAY = '"SB Barlow", "Barlow Condensed", "Arial Narrow", "Helvetica Neue", sans-serif'
export const FONT_MONO = '"SB Plex", "IBM Plex Mono", "Courier New", monospace'

/** Base-path aware URL of a file in /public/fonts (works under a sub-path deploy). */
export function fontUrl(file: string): string {
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/'
  return `${base.endsWith('/') ? base : `${base}/`}fonts/${file}`
}

let promise: Promise<void> | null = null

export function loadStationFonts(timeoutMs = 3500): Promise<void> {
  if (promise) return promise
  promise = new Promise<void>((resolve) => {
    if (typeof document === 'undefined' || typeof FontFace === 'undefined' || !document.fonts) {
      resolve()
      return
    }
    const faces = [
      new FontFace('SB Barlow', `url(${fontUrl('BarlowCondensed-Bold.woff')}) format("woff")`, { weight: '700' }),
      new FontFace('SB Barlow', `url(${fontUrl('BarlowCondensed-SemiBold.woff')}) format("woff")`, { weight: '600' }),
      new FontFace('SB Plex', `url(${fontUrl('IBMPlexMono-SemiBold.woff')}) format("woff")`, { weight: '600' }),
    ]
    const timer = setTimeout(resolve, timeoutMs)
    Promise.all(
      faces.map((f) =>
        f
          .load()
          .then((loaded) => {
            document.fonts.add(loaded)
          })
          .catch(() => undefined),
      ),
    ).then(() => {
      clearTimeout(timer)
      resolve()
    })
  })
  return promise
}
