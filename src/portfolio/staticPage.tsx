import { renderToStaticMarkup } from 'react-dom/server'
import { PROFILE } from '../content/profile'
import { RESUME } from '../content/resume'
import { HARMONY } from '../content/stations'
import PortfolioDocument from './PortfolioDocument'
import { OG_IMAGE, PORTFOLIO_PATH, SITE_NAME, normalizeBasePath, normalizeSiteUrl, portfolioMeta } from './site'

/**
 * Build-time HTML/SEO builders for the static portfolio and the SPA shell.
 * Node/SSR only (react-dom/server): imported by scripts/prerender.tsx, the optional dev-server
 * plugin (./devServer.ts) and tests, never by the browser bundle. No file-system access here;
 * callers read/write files.
 */

/** Stylesheets inlined into /portfolio/ (paths relative to the repo root, read by callers). */
export const PORTFOLIO_CSS_FILES = ['src/portfolio/portfolio.css', 'src/portfolio/standalone.css'] as const

/** Fonts self-hosted by the static page (same families the app loads through @fontsource). */
export const PORTFOLIO_FONTS = [
  { family: 'Barlow', weight: 400, pkg: 'barlow', file: 'barlow-latin-400-normal.woff2', preload: true },
  { family: 'Barlow', weight: 600, pkg: 'barlow', file: 'barlow-latin-600-normal.woff2', preload: false },
  { family: 'Barlow Condensed', weight: 600, pkg: 'barlow-condensed', file: 'barlow-condensed-latin-600-normal.woff2', preload: false },
  { family: 'Barlow Condensed', weight: 700, pkg: 'barlow-condensed', file: 'barlow-condensed-latin-700-normal.woff2', preload: true },
  { family: 'IBM Plex Mono', weight: 400, pkg: 'ibm-plex-mono', file: 'ibm-plex-mono-latin-400-normal.woff2', preload: false },
  { family: 'IBM Plex Mono', weight: 600, pkg: 'ibm-plex-mono', file: 'ibm-plex-mono-latin-600-normal.woff2', preload: false },
] as const

/** @fontsource "latin" subset range (covers é, ê, curly quotes, dashes, ©, …). */
export const LATIN_UNICODE_RANGE =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'

/**
 * CSP for the script-free portfolio page (meta tag; hosts may add a stricter/equal header).
 * JSON-LD is a data block, not executed, so it needs no script-src.
 */
export const PORTFOLIO_PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'"

export interface ResolvedFont {
  family: string
  weight: number
  /** URL the page loads the woff2 from. */
  href: string
  preload?: boolean
  unicodeRange?: string
}

export interface PortfolioPageOptions {
  /** Public base path ("/" or "/mckeown-industrial-works/"). */
  basePath: string
  /** Absolute site URL with trailing slash (canonical/OG). */
  siteUrl: string
  /** CSS to inline (portfolio.css + standalone.css). */
  css: string
  fonts: ResolvedFont[]
}

/* ------------------------------------------------------------ escaping */

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** JSON safe to embed in a <script> data block (no "</script>", no HTML comment openers). */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/* ------------------------------------------------------------- styling */

/** Conservative CSS minifier: drops comments and collapses whitespace (strings are left intact). */
export function minifyCss(css: string): string {
  let out = ''
  let i = 0
  while (i < css.length) {
    const ch = css[i]
    if (ch === '"' || ch === "'") {
      const end = findStringEnd(css, i)
      out += css.slice(i, end)
      i = end
      continue
    }
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      i = end < 0 ? css.length : end + 2
      continue
    }
    if (/\s/.test(ch)) {
      while (i < css.length && /\s/.test(css[i])) i++
      const prev = out[out.length - 1]
      const next = css[i]
      // Drop whitespace next to { } ; , > and after ':' (never before ':', which would turn
      // the descendant selector ".pf :where(a)" into ".pf:where(a)").
      if (prev !== undefined && next !== undefined && !'{};,>:'.includes(prev) && !'{};,>'.includes(next)) out += ' '
      continue
    }
    out += ch
    i++
  }
  return out.replace(/;}/g, '}').trim()
}

function findStringEnd(css: string, start: number): number {
  const quote = css[start]
  let i = start + 1
  while (i < css.length) {
    if (css[i] === '\\') i += 2
    else if (css[i] === quote) return i + 1
    else i++
  }
  return css.length
}

export function fontFaceCss(fonts: ResolvedFont[]): string {
  return fonts
    .map(
      (f) =>
        `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${f.weight};font-display:swap;` +
        `src:url(${f.href}) format('woff2');unicode-range:${f.unicodeRange ?? LATIN_UNICODE_RANGE}}`,
    )
    .join('\n')
}

/* ------------------------------------------------------------- SEO tags */

export interface SeoTagOptions {
  kind: 'site' | 'portfolio'
  siteUrl: string
  title: string
  description: string
}

/** Canonical + Open Graph + Twitter card tags (absolute URLs). */
export function seoTags({ kind, siteUrl, title, description }: SeoTagOptions): string {
  const site = normalizeSiteUrl(siteUrl)
  const url = kind === 'portfolio' ? site + PORTFOLIO_PATH : site
  const image = site + OG_IMAGE.path
  const t = escapeHtml(title)
  const d = escapeHtml(description)
  const alt = escapeHtml(OG_IMAGE.alt)
  const lines = [
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    `<meta property="og:type" content="${kind === 'portfolio' ? 'profile' : 'website'}" />`,
    `<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    `<meta property="og:image:type" content="${OG_IMAGE.type}" />`,
    `<meta property="og:image:width" content="${OG_IMAGE.width}" />`,
    `<meta property="og:image:height" content="${OG_IMAGE.height}" />`,
    `<meta property="og:image:alt" content="${alt}" />`,
  ]
  if (kind === 'portfolio') {
    const { first, last } = splitName(PROFILE.name)
    if (first) lines.push(`<meta property="profile:first_name" content="${escapeHtml(first)}" />`)
    if (last) lines.push(`<meta property="profile:last_name" content="${escapeHtml(last)}" />`)
  }
  lines.push(
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
    `<meta name="twitter:image:alt" content="${alt}" />`,
  )
  return lines.join('\n    ')
}

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/)
  if (parts.length < 2) return { first: parts[0] ?? '', last: '' }
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] }
}

/** schema.org Person built only from verified content (src/content/*). */
export function personJsonLd(siteUrl: string): Record<string, unknown> {
  const site = normalizeSiteUrl(siteUrl)
  const education = RESUME.sections.find((s) => /educat/i.test(s.heading))
  const schools = [...new Set((education?.entries ?? []).map((e) => e.org).filter((o): o is string => Boolean(o)))]
  const sameAs = [PROFILE.github.url]
  if (PROFILE.linkedin?.verified) sameAs.push(PROFILE.linkedin.url)
  if (PROFILE.website?.verified) sameAs.push(PROFILE.website.url)
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: PROFILE.name,
    url: site + PORTFOLIO_PATH,
    jobTitle: HARMONY.role,
    worksFor: { '@type': 'Organization', name: HARMONY.company, url: HARMONY.link.url },
  }
  if (schools.length === 1) ld.alumniOf = { '@type': 'CollegeOrUniversity', name: schools[0] }
  else if (schools.length > 1) ld.alumniOf = schools.map((name) => ({ '@type': 'CollegeOrUniversity', name }))
  ld.sameAs = [...new Set(sameAs)]
  return ld
}

/* ------------------------------------------------------- portfolio page */

/** Complete, script-free HTML document for <out>/portfolio/index.html. */
export function renderPortfolioPage({ basePath, siteUrl, css, fonts }: PortfolioPageOptions): string {
  const base = normalizeBasePath(basePath)
  const site = normalizeSiteUrl(siteUrl)
  const { title, description } = portfolioMeta()
  const body = renderToStaticMarkup(<PortfolioDocument variant="page" basePath={base} factoryHref={base} />)
  const preloads = fonts
    .filter((f) => f.preload)
    .map((f) => `<link rel="preload" href="${escapeHtml(f.href)}" as="font" type="font/woff2" crossorigin />`)
  const styles = minifyCss(`${fontFaceCss(fonts)}\n${css}`)
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="${escapeHtml(PORTFOLIO_PAGE_CSP)}" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="index, follow" />
    <meta name="theme-color" content="#252B2B" />
    <meta name="color-scheme" content="light" />
    <link rel="icon" href="${escapeHtml(base)}favicon.svg" type="image/svg+xml" />
    ${preloads.join('\n    ')}
    ${seoTags({ kind: 'portfolio', siteUrl: site, title, description })}
    <script type="application/ld+json">${jsonForScript(personJsonLd(site))}</script>
    <style>${styles}</style>
  </head>
  <body>
    ${body}
  </body>
</html>
`
}

/* --------------------------------------------------------- SPA shell */

export const SEO_START = '<!-- seo:start -->'
export const SEO_END = '<!-- seo:end -->'

/** Reads <title> and meta description from the built index.html (single source of truth). */
export function readShellMeta(html: string): { title: string; description: string } {
  const title = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim()
  const description = /<meta\s+name=(["'])description\1\s+content=(["'])([\s\S]*?)\2[^>]*>/i.exec(html)?.[3]?.trim()
  return {
    title: decodeEntities(title || `${SITE_NAME} — ${PROFILE.name}`),
    description: decodeEntities(description || portfolioMeta().description),
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/**
 * Puts absolute canonical/OG/Twitter tags into the built index.html: replaces the
 * `<!-- seo:start --> … <!-- seo:end -->` block (or strips stray tags and appends one),
 * and makes the <noscript> portfolio link absolute so it also works from 404.html.
 * Idempotent.
 */
export function injectShellSeo(html: string, opts: { siteUrl: string; basePath: string }): string {
  const { title, description } = readShellMeta(html)
  const block = `${SEO_START}\n    ${seoTags({ kind: 'site', siteUrl: opts.siteUrl, title, description })}\n    ${SEO_END}`
  let out: string
  const start = html.indexOf(SEO_START)
  const end = html.indexOf(SEO_END)
  if (start >= 0 && end > start) {
    out = html.slice(0, start) + block + html.slice(end + SEO_END.length)
  } else {
    out = html
      .replace(/\s*<link\s+rel=["']canonical["'][^>]*>/gi, '')
      .replace(/\s*<meta\s+(?:property|name)=["'](?:og|twitter|profile):[^"']*["'][^>]*>/gi, '')
      .replace(/<\/head>/i, `  ${block}\n  </head>`)
  }
  const base = normalizeBasePath(opts.basePath)
  return out.replace(/<noscript>[\s\S]*?<\/noscript>/gi, (ns) =>
    ns.replace(/href=(["'])(?:\.\/)?portfolio\/\1/g, `href=$1${base}${PORTFOLIO_PATH}$1`),
  )
}

/** 404.html for static hosts: the SPA shell, marked noindex and without a canonical. */
export function notFoundPage(shellHtml: string): string {
  const html = shellHtml.replace(/\s*<link\s+rel=["']canonical["'][^>]*>/i, '')
  const robots = '<meta name="robots" content="noindex" />'
  if (/<meta\s+charset=[^>]*>/i.test(html)) return html.replace(/(<meta\s+charset=[^>]*>)/i, `$1\n    ${robots}`)
  return html.replace(/<head>/i, `<head>\n    ${robots}`)
}

/* ------------------------------------------------------- crawler files */

export function sitemapXml(siteUrl: string, lastmod: string): string {
  const site = normalizeSiteUrl(siteUrl)
  const day = lastmod.slice(0, 10)
  const urls = [site, site + PORTFOLIO_PATH]
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>\n    <loc>${escapeHtml(u)}</loc>\n    <lastmod>${day}</lastmod>\n  </url>`).join('\n')}
</urlset>
`
}

export function robotsTxt(siteUrl: string): string {
  const site = normalizeSiteUrl(siteUrl)
  return `# ${SITE_NAME}
User-agent: *
Allow: /

Sitemap: ${site}sitemap.xml
`
}

export function healthJson(opts: { name: string; version?: string; builtAt: string; commit?: string | null; basePath: string; siteUrl: string }): string {
  const body: Record<string, unknown> = { status: 'ok', name: opts.name }
  if (opts.version) body.version = opts.version
  body.builtAt = opts.builtAt
  if (opts.commit) body.commit = opts.commit
  body.basePath = normalizeBasePath(opts.basePath)
  body.siteUrl = normalizeSiteUrl(opts.siteUrl)
  return `${JSON.stringify(body, null, 2)}\n`
}

/** Commit SHA from common CI environments (GitHub Actions, Netlify, Vercel, Cloudflare, generic). */
export function commitFromEnv(env: Record<string, string | undefined>): string | null {
  const sha = env.COMMIT_SHA || env.GITHUB_SHA || env.COMMIT_REF || env.VERCEL_GIT_COMMIT_SHA || env.CF_PAGES_COMMIT_SHA || ''
  return /^[0-9a-f]{7,40}$/i.test(sha.trim()) ? sha.trim() : null
}
