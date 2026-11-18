/** URL of the static, prerendered HTML portfolio page (produced by the portfolio-static module). */
export function portfolioHref(): string {
  const base = import.meta.env.BASE_URL || '/'
  return `${base.endsWith('/') ? base : `${base}/`}portfolio/`
}

/** The in-app lite view (?lite=1): the same site shell and panels with the HTML portfolio, no 3D. */
export function liteHref(): string {
  const base = import.meta.env.BASE_URL || '/'
  return `${base.endsWith('/') ? base : `${base}/`}?lite=1`
}

/** Resolve a site-relative asset path (e.g. 'resume/cv.pdf') against the deploy base path. Absolute URLs pass through. */
export function assetHref(path: string): string {
  if (/^[a-z]+:\/\//i.test(path)) return path
  const base = import.meta.env.BASE_URL || '/'
  return `${base.endsWith('/') ? base : `${base}/`}${path.replace(/^\/+/, '')}`
}

/** "https://github.com/BrianM53/Gaussian-SLAM" → "BrianM53/Gaussian-SLAM". */
export function repoPath(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\/+|\/+$/g, '')
  } catch {
    return url
  }
}

/** "https://www.codestory.co/episodes/…" → "codestory.co". */
export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Human-readable destination: "https://www.linkedin.com/in/someone/" → "linkedin.com/in/someone". */
export function displayUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/\/+$/, '')
    return `${u.hostname.replace(/^www\./, '')}${path}`
  } catch {
    return url
  }
}
