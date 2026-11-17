/**
 * Static prerender: runs after `vite build` (package.json "build" / "build:test"):
 *
 *   tsx scripts/prerender.tsx
 *
 * Environment (all optional):
 *   OUT_DIR    build output directory              (default "dist"; "dist-test" for the test build)
 *   BASE_PATH  public base path, as given to Vite  (default "/"; "/mckeown-industrial-works/" on GitHub Pages)
 *   SITE_URL   absolute public URL for canonical / Open Graph tags
 *              (default https://brianm53.github.io/mckeown-industrial-works/; on Netlify/Vercel the host's
 *              production URL is used when SITE_URL is unset)
 *   COMMIT_SHA commit id for health.json (GitHub/Netlify/Vercel/Cloudflare SHAs are detected automatically)
 *
 * Writes into OUT_DIR:
 *   portfolio/index.html   the whole portfolio as static, script-free HTML (inlined CSS, self-hosted fonts)
 *   assets/pf-*.woff2      content-hashed copies of the fonts that page uses
 *   index.html             + absolute canonical / Open Graph / Twitter tags (in the <!-- seo:start --> block)
 *   404.html               copy of the SPA shell for static hosts' not-found fallback (noindex)
 *   sitemap.xml, robots.txt, health.json
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROFILE } from '../src/content/profile'
import { normalizeBasePath, resolveSiteUrl } from '../src/portfolio/site'
import {
  PORTFOLIO_CSS_FILES,
  PORTFOLIO_FONTS,
  commitFromEnv,
  healthJson,
  injectShellSeo,
  notFoundPage,
  renderPortfolioPage,
  robotsTxt,
  sitemapXml,
  type ResolvedFont,
} from '../src/portfolio/staticPage'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requireFromHere = createRequire(import.meta.url)
const env = process.env

const outDir = resolve(ROOT, env.OUT_DIR?.trim() || 'dist')
const basePath = normalizeBasePath(env.BASE_PATH)
const siteUrl = resolveSiteUrl(env)
const builtAt = new Date().toISOString()
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { name: string; version?: string }

const written: { file: string; bytes: number }[] = []

function fail(message: string): never {
  console.error(`[prerender] ERROR: ${message}`)
  process.exit(1)
}

function write(rel: string, data: string | Buffer): void {
  const file = join(outDir, rel)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, data)
  written.push({ file: relative(outDir, file), bytes: typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength })
}

const indexPath = join(outDir, 'index.html')
if (!existsSync(indexPath)) fail(`${relative(ROOT, indexPath)} not found. Run "vite build" first with the same OUT_DIR.`)

// 1. Fonts: content-hashed copies under assets/ (immutable-cacheable like Vite's own assets).
const fonts: ResolvedFont[] = PORTFOLIO_FONTS.map((f) => {
  let source: string
  try {
    source = requireFromHere.resolve(`@fontsource/${f.pkg}/files/${f.file}`)
  } catch {
    fail(`font @fontsource/${f.pkg}/files/${f.file} is missing (npm ci?)`)
  }
  const data = readFileSync(source)
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 10)
  const name = `pf-${f.file.replace(/\.woff2$/, '')}-${hash}.woff2`
  write(`assets/${name}`, data)
  return { family: f.family, weight: f.weight, preload: f.preload, href: `${basePath}assets/${name}` }
})

// 2. Styles: read as text (not a bundler import) and inlined by the page renderer.
const css = PORTFOLIO_CSS_FILES.map((p) => readFileSync(join(ROOT, p), 'utf8')).join('\n')

// 3. The static portfolio.
const page = renderPortfolioPage({ basePath, siteUrl, css, fonts })
write('portfolio/index.html', page)

// 4. SPA shell: absolute SEO tags, plus a 404 copy for static hosts.
const shell = injectShellSeo(readFileSync(indexPath, 'utf8'), { siteUrl, basePath })
write('index.html', shell)
write('404.html', notFoundPage(shell))

// 5. Crawler files and health check.
write('sitemap.xml', sitemapXml(siteUrl, builtAt))
write('robots.txt', robotsTxt(siteUrl))
write('health.json', healthJson({ name: pkg.name, version: pkg.version, builtAt, commit: commitFromEnv(env), basePath, siteUrl }))

// 6. Sanity checks: fail the build rather than ship a broken page.
const problems: string[] = []
const h1s = page.match(/<h1[\s>]/g)?.length ?? 0
if (h1s !== 1) problems.push(`portfolio page has ${h1s} <h1> elements (expected 1)`)
if (!page.includes(PROFILE.name)) problems.push('portfolio page does not contain the profile name')
if (/<script(?![^>]*type="application\/ld\+json")/i.test(page)) problems.push('portfolio page contains an executable <script>')
if (!page.includes(`<link rel="canonical" href="${siteUrl}portfolio/"`)) problems.push('portfolio page canonical is missing')
if (!shell.includes(`<link rel="canonical" href="${siteUrl}"`)) problems.push('index.html canonical was not injected')
if (!shell.includes(`content="${siteUrl}og-image.png"`)) problems.push('index.html og:image is not absolute')
if (!existsSync(join(outDir, 'og-image.png'))) problems.push('og-image.png is missing from the build (public/og-image.png)')
if (problems.length) fail(problems.join('\n  '))

const kb = (n: number) => `${(n / 1024).toFixed(1)} kB`
const width = Math.max(...written.map((w) => w.file.length))
console.log(`[prerender] ${relative(ROOT, outDir) || '.'}  base=${basePath}  site=${siteUrl}`)
for (const w of written) console.log(`  ${w.file.padEnd(width)}  ${kb(w.bytes).padStart(9)}`)
