import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PROFILE } from '@/content/profile'
import { HARMONY } from '@/content/stations'
import { DEFAULT_SITE_URL, clampText, normalizeBasePath, normalizeSiteUrl, resolveSiteHref, resolveSiteUrl } from './site'
import {
  SEO_END,
  SEO_START,
  commitFromEnv,
  healthJson,
  injectShellSeo,
  jsonForScript,
  minifyCss,
  notFoundPage,
  renderPortfolioPage,
  robotsTxt,
  sitemapXml,
} from './staticPage'

const SITE = 'https://example.org/miw/'
// Vitest runs from the repository root.
const INDEX_HTML = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')

const page = renderPortfolioPage({
  basePath: '/miw/',
  siteUrl: SITE,
  css: '/* c */ .pf { color: red ; }',
  fonts: [
    { family: 'Barlow', weight: 400, href: '/miw/assets/pf-barlow-400-abc.woff2', preload: true },
    { family: 'IBM Plex Mono', weight: 600, href: '/miw/assets/pf-mono-600-def.woff2' },
  ],
})

const meta = (html: string, attr: 'name' | 'property', key: string) =>
  new RegExp(`<meta ${attr}="${key.replace(/[.:]/g, '\\$&')}" content="([^"]*)"`).exec(html)?.[1]

describe('renderPortfolioPage', () => {
  it('is a complete, English, script-free document with one h1', () => {
    expect(page.startsWith('<!doctype html>')).toBe(true)
    expect(page).toContain('<html lang="en">')
    expect(page).toContain('<meta charset="utf-8" />')
    expect(page).toContain('<meta name="viewport"')
    expect(page.match(/<h1[\s>]/g)).toHaveLength(1)
    expect(page).not.toMatch(/<script(?![^>]*type="application\/ld\+json")/)
    expect(page).toContain('http-equiv="Content-Security-Policy"')
  })

  it('has a title, description, canonical, Open Graph and Twitter tags with absolute URLs', () => {
    expect(page).toMatch(new RegExp(`<title>${PROFILE.name} — `))
    expect(meta(page, 'name', 'description')!.length).toBeGreaterThan(50)
    expect(meta(page, 'name', 'description')!.length).toBeLessThanOrEqual(160)
    expect(page).toContain(`<link rel="canonical" href="${SITE}portfolio/" />`)
    expect(meta(page, 'property', 'og:url')).toBe(`${SITE}portfolio/`)
    expect(meta(page, 'property', 'og:type')).toBe('profile')
    expect(meta(page, 'property', 'og:image')).toBe(`${SITE}og-image.png`)
    expect(meta(page, 'property', 'og:image:width')).toBe('1200')
    expect(meta(page, 'property', 'og:image:height')).toBe('630')
    expect(meta(page, 'name', 'twitter:card')).toBe('summary_large_image')
    expect(meta(page, 'name', 'twitter:image')).toBe(`${SITE}og-image.png`)
    expect(meta(page, 'property', 'profile:last_name')).toBe('McKeown')
  })

  it('embeds a factual schema.org Person (name, job, employer, school, profiles only)', () => {
    const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(page)![1]
    expect(json).not.toMatch(/<|>/)
    const ld = JSON.parse(json)
    expect(Object.keys(ld).sort()).toEqual(['@context', '@type', 'alumniOf', 'jobTitle', 'name', 'sameAs', 'url', 'worksFor'])
    expect(ld['@type']).toBe('Person')
    expect(ld.name).toBe(PROFILE.name)
    expect(ld.jobTitle).toBe(HARMONY.role)
    expect(ld.worksFor).toEqual({ '@type': 'Organization', name: HARMONY.company, url: HARMONY.link.url })
    expect(ld.alumniOf).toEqual({ '@type': 'CollegeOrUniversity', name: 'Texas A&M University' })
    expect(ld.sameAs).toContain(PROFILE.github.url)
    if (PROFILE.linkedin?.verified) expect(ld.sameAs).toContain(PROFILE.linkedin.url)
    expect(ld.url).toBe(`${SITE}portfolio/`)
  })

  it('inlines minified CSS with self-hosted font faces and preloads the critical fonts', () => {
    expect(page).toContain(".pf{color:red}")
    expect(page).not.toContain('/* c */')
    expect(page).toContain("@font-face{font-family:'Barlow';font-style:normal;font-weight:400;font-display:swap;src:url(/miw/assets/pf-barlow-400-abc.woff2)")
    expect(page).toContain('<link rel="preload" href="/miw/assets/pf-barlow-400-abc.woff2" as="font" type="font/woff2" crossorigin />')
    expect(page).not.toContain('pf-mono-600-def.woff2" as="font"')
  })

  it('links the factory and favicon through the base path', () => {
    expect(page).toContain('<link rel="icon" href="/miw/favicon.svg"')
    expect(page).toMatch(/<a class="pf-btn pf-btn--primary" href="\/miw\/">Enter the 3D factory/)
  })
})

describe('injectShellSeo (real index.html)', () => {
  it('index.html carries the seo markers, relative fallbacks and the noscript links', () => {
    expect(INDEX_HTML).toContain(SEO_START)
    expect(INDEX_HTML).toContain(SEO_END)
    expect(INDEX_HTML).toContain('<meta property="og:image" content="/og-image.png" />')
    const noscript = /<noscript>([\s\S]*?)<\/noscript>/.exec(INDEX_HTML)![1]
    expect(noscript).toContain('href="portfolio/"')
    expect(noscript).toContain(`href="${PROFILE.github.url}"`)
    if (PROFILE.linkedin) expect(noscript).toContain(`href="${PROFILE.linkedin.url}"`)
    expect(noscript).toContain(PROFILE.name)
    expect(noscript).toContain(PROFILE.headline)
    for (const a of noscript.match(/<a [^>]*href="https:[^>]*>/g) ?? []) expect(a).toContain('rel="noopener noreferrer"')
  })

  it('replaces the marker block with absolute canonical/OG/Twitter tags, idempotently', () => {
    const once = injectShellSeo(INDEX_HTML, { siteUrl: SITE, basePath: '/miw/' })
    const twice = injectShellSeo(once, { siteUrl: SITE, basePath: '/miw/' })
    expect(twice).toBe(once)
    expect(once.match(/rel="canonical"/g)).toHaveLength(1)
    expect(once.match(/property="og:image"/g)).toHaveLength(1)
    expect(once).toContain(`<link rel="canonical" href="${SITE}" />`)
    expect(meta(once, 'property', 'og:image')).toBe(`${SITE}og-image.png`)
    expect(meta(once, 'property', 'og:url')).toBe(SITE)
    // og:title / description come from the page's own <title> and meta description
    expect(meta(once, 'property', 'og:title')).toBe(/<title>([^<]*)<\/title>/.exec(INDEX_HTML)![1].replace(/'/g, '&#39;'))
    expect(meta(once, 'property', 'og:description')).toContain('McKeown&#39;s portfolio')
    // the noscript portfolio link becomes absolute so it also works from 404.html at any depth
    expect(once).toContain('href="/miw/portfolio/"')
    expect(once).not.toContain('href="portfolio/"')
  })

  it('still works when the markers are missing (strips stray tags, appends one block)', () => {
    const bare = '<html><head><title>T</title><meta property="og:image" content="/x.png" /><link rel="canonical" href="/" /></head><body></body></html>'
    const out = injectShellSeo(bare, { siteUrl: SITE, basePath: '/' })
    expect(out.match(/property="og:image"/g)).toHaveLength(1)
    expect(out.match(/rel="canonical"/g)).toHaveLength(1)
    expect(out).toContain(SEO_START)
    expect(out.indexOf(SEO_END)).toBeLessThan(out.indexOf('</head>'))
  })

  it('404.html is the shell without canonical, marked noindex right after the charset', () => {
    const shell = injectShellSeo(INDEX_HTML, { siteUrl: SITE, basePath: '/' })
    const nf = notFoundPage(shell)
    expect(nf).not.toContain('rel="canonical"')
    expect(nf).toMatch(/<meta charset="UTF-8" \/>\s*<meta name="robots" content="noindex" \/>/)
    expect(nf).toContain('<div id="root"></div>')
  })
})

describe('crawler and health files', () => {
  it('sitemap lists the root and the portfolio with a lastmod date', () => {
    const xml = sitemapXml(SITE, '2026-11-17T12:00:00.000Z')
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(xml).toContain(`<loc>${SITE}</loc>`)
    expect(xml).toContain(`<loc>${SITE}portfolio/</loc>`)
    expect(xml.match(/<lastmod>2026-11-17<\/lastmod>/g)).toHaveLength(2)
  })

  it('robots allows everything and points at the sitemap', () => {
    const txt = robotsTxt(SITE)
    expect(txt).toMatch(/User-agent: \*\nAllow: \//)
    expect(txt).toContain(`Sitemap: ${SITE}sitemap.xml`)
  })

  it('health.json reports ok, build time and commit when known', () => {
    const j = JSON.parse(healthJson({ name: 'miw', version: '1.0.0', builtAt: '2026-11-17T00:00:00.000Z', commit: 'abc1234', basePath: 'miw', siteUrl: SITE }))
    expect(j).toEqual({ status: 'ok', name: 'miw', version: '1.0.0', builtAt: '2026-11-17T00:00:00.000Z', commit: 'abc1234', basePath: '/miw/', siteUrl: SITE })
    expect(JSON.parse(healthJson({ name: 'miw', builtAt: 'x', basePath: '/', siteUrl: SITE }))).not.toHaveProperty('commit')
  })

  it('reads commit SHAs from CI environments and ignores junk', () => {
    expect(commitFromEnv({ GITHUB_SHA: '0123456789abcdef0123456789abcdef01234567' })).toBe('0123456789abcdef0123456789abcdef01234567')
    expect(commitFromEnv({ COMMIT_REF: 'deadbeef' })).toBe('deadbeef')
    expect(commitFromEnv({ COMMIT_SHA: 'not a sha' })).toBeNull()
    expect(commitFromEnv({})).toBeNull()
  })
})

describe('helpers', () => {
  it('normalizeBasePath', () => {
    expect(normalizeBasePath(undefined)).toBe('/')
    expect(normalizeBasePath('')).toBe('/')
    expect(normalizeBasePath('./')).toBe('/')
    expect(normalizeBasePath('mckeown-industrial-works')).toBe('/mckeown-industrial-works/')
    expect(normalizeBasePath('/mckeown-industrial-works')).toBe('/mckeown-industrial-works/')
    expect(normalizeBasePath('https://x.dev/a/b')).toBe('/a/b/')
  })

  it('normalizeSiteUrl / resolveSiteUrl', () => {
    expect(normalizeSiteUrl('https://x.dev/a?q=1#h')).toBe('https://x.dev/a/')
    expect(() => normalizeSiteUrl('x.dev')).toThrow(/absolute URL/)
    expect(() => normalizeSiteUrl('ftp://x.dev/')).toThrow(/http/)
    expect(resolveSiteUrl({})).toBe(DEFAULT_SITE_URL)
    expect(resolveSiteUrl({ SITE_URL: 'https://brian.dev' })).toBe('https://brian.dev/')
    expect(resolveSiteUrl({ NETLIFY: 'true', URL: 'https://miw.netlify.app' })).toBe('https://miw.netlify.app/')
    expect(resolveSiteUrl({ URL: 'https://not-netlify.example' })).toBe(DEFAULT_SITE_URL)
    expect(resolveSiteUrl({ VERCEL: '1', VERCEL_PROJECT_PRODUCTION_URL: 'miw.vercel.app' })).toBe('https://miw.vercel.app/')
  })

  it('resolveSiteHref', () => {
    expect(resolveSiteHref('/miw/', 'resume/cv.pdf')).toBe('/miw/resume/cv.pdf')
    expect(resolveSiteHref('/miw/', './resume/cv.pdf')).toBe('/miw/resume/cv.pdf')
    expect(resolveSiteHref('/miw/', '/cv.pdf')).toBe('/cv.pdf')
    expect(resolveSiteHref('/miw/', 'https://x.dev/cv.pdf')).toBe('https://x.dev/cv.pdf')
  })

  it('clampText cuts at a word boundary', () => {
    expect(clampText('short', 10)).toBe('short')
    const t = clampText('The quick brown fox jumps over the lazy dog', 20)
    expect(t.length).toBeLessThanOrEqual(20)
    expect(t).toBe('The quick brown fox…')
  })

  it('minifyCss keeps strings and significant spaces', () => {
    const css = `/* x */\n.a > .b ,\n.c { content: ' <' attr(href) '>' ;  margin: calc(1rem + 2px) 0 ; }\n@media (min-width: 48rem) and (min-height: 34rem) { .d { color: red } }\n.pf :where(a) { color: blue }`
    expect(minifyCss(css)).toBe(
      ".a>.b,.c{content:' <' attr(href) '>';margin:calc(1rem + 2px) 0}@media (min-width:48rem) and (min-height:34rem){.d{color:red}}.pf :where(a){color:blue}",
    )
  })

  it('jsonForScript cannot close the script element', () => {
    const s = jsonForScript({ x: '</script><script>alert(1)</script>', amp: 'A&M' })
    expect(s).not.toContain('</script')
    expect(JSON.parse(s)).toEqual({ x: '</script><script>alert(1)</script>', amp: 'A&M' })
  })
})
