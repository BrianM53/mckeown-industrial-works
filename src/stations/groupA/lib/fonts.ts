/**
 * Local fonts for canvas-drawn station text (never remote: the production CSP
 * only allows same-origin). Loaded once via the FontFace API from /public/fonts,
 * under base-path-aware URLs. Resolves even if loading fails or times out (the
 * canvas then falls back to the @fontsource families / system fonts), so the
 * module can never hang on it.
 */
export const FONT_DISPLAY = '"MIWSA Barlow", "Barlow Condensed", "Arial Narrow", "Helvetica Neue", sans-serif'
export const FONT_MONO = '"MIWSA Plex", "IBM Plex Mono", "Courier New", monospace'

let promise: Promise<void> | null = null

export function fontUrl(file: string): string {
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/'
  return `${base.endsWith('/') ? base : `${base}/`}fonts/${file}`
}

export function loadStationFonts(timeoutMs = 4000): Promise<void> {
  if (promise) return promise
  promise = new Promise<void>((resolve) => {
    if (typeof document === 'undefined' || typeof FontFace === 'undefined' || !document.fonts) {
      resolve()
      return
    }
    let faces: FontFace[] = []
    try {
      faces = [
        new FontFace('MIWSA Barlow', `url(${fontUrl('BarlowCondensed-Bold.woff')}) format("woff")`, { weight: '700' }),
        new FontFace('MIWSA Barlow', `url(${fontUrl('BarlowCondensed-SemiBold.woff')}) format("woff")`, { weight: '600' }),
        new FontFace('MIWSA Plex', `url(${fontUrl('IBMPlexMono-SemiBold.woff')}) format("woff")`, { weight: '600' }),
      ]
    } catch {
      resolve()
      return
    }
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
