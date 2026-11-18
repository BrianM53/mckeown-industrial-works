/**
 * Local fonts for the module's canvas textures (signs, console screen). Loaded
 * once from /public/fonts with the FontFace API under module-private family
 * names (never remote). Resolves even if loading fails or times out, so text
 * simply falls back to the CSS @fontsource families / system fonts.
 */
export const FONT_DISPLAY = '"MIW Lines Display", "Barlow Condensed", "Arial Narrow", "Helvetica Neue", sans-serif'
export const FONT_MONO = '"MIW Lines Mono", "IBM Plex Mono", "Courier New", monospace'

let promise: Promise<boolean> | null = null

/** Resolves true when the fonts are ready (false = fallback fonts). */
export function loadLineFonts(timeoutMs = 4000): Promise<boolean> {
  if (promise) return promise
  promise = new Promise<boolean>((resolve) => {
    if (typeof document === 'undefined' || typeof FontFace === 'undefined' || !document.fonts) {
      resolve(false)
      return
    }
    const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/'
    const faces = [
      new FontFace('MIW Lines Display', `url(${base}fonts/BarlowCondensed-Bold.woff) format("woff")`, { weight: '700' }),
      new FontFace('MIW Lines Display', `url(${base}fonts/BarlowCondensed-SemiBold.woff) format("woff")`, { weight: '600' }),
      new FontFace('MIW Lines Mono', `url(${base}fonts/IBMPlexMono-SemiBold.woff) format("woff")`, { weight: '600' }),
    ]
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    Promise.all(
      faces.map((f) =>
        f
          .load()
          .then((loaded) => {
            document.fonts.add(loaded)
            return true
          })
          .catch(() => false),
      ),
    ).then((oks) => {
      clearTimeout(timer)
      finish(oks.every(Boolean))
    })
  })
  return promise
}
