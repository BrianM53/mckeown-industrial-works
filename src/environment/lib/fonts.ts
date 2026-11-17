/**
 * Local sign fonts for canvas-rendered signage (never remote). Loaded once via
 * the FontFace API from /public/fonts; resolves even if loading fails (falls
 * back to the CSS-loaded @fontsource families / system fonts) and never hangs.
 */
export const FONT_DISPLAY = '"MIW Barlow", "Barlow Condensed", "Arial Narrow", "Helvetica Neue", sans-serif'
export const FONT_MONO = '"MIW Plex", "IBM Plex Mono", "Courier New", monospace'

let promise: Promise<void> | null = null

export function loadEnvFonts(timeoutMs = 4000): Promise<void> {
  if (promise) return promise
  promise = new Promise<void>((resolve) => {
    if (typeof document === 'undefined' || typeof FontFace === 'undefined' || !document.fonts) {
      resolve()
      return
    }
    const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/'
    const faces = [
      new FontFace('MIW Barlow', `url(${base}fonts/BarlowCondensed-Bold.woff) format("woff")`, { weight: '700' }),
      new FontFace('MIW Barlow', `url(${base}fonts/BarlowCondensed-SemiBold.woff) format("woff")`, { weight: '600' }),
      new FontFace('MIW Plex', `url(${base}fonts/IBMPlexMono-SemiBold.woff) format("woff")`, { weight: '600' }),
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
