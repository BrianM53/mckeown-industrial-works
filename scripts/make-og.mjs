#!/usr/bin/env node
/**
 * Renders the 1200×630 social card (Open Graph / Twitter) to public/og-image.png.
 *
 *   node scripts/make-og.mjs [--out public/og-image.png] [--html card.html]
 *
 * Uses Playwright's Chromium (devDependency; `npx playwright install chromium` if missing) and the
 * same vector factory art as the HTML portfolio (src/portfolio/FactoryArt.tsx, loaded through tsx).
 * The name and headline come from src/content/profile.ts; fonts are the bundled @fontsource files,
 * embedded as data URIs, so nothing is fetched from the network.
 * The PNG is committed. Re-run after changing the name/headline or the art (or replace the file with
 * a real scene screenshot of the same size).
 */
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tsImport } from 'tsx/esm/api'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : def
}
const out = resolve(process.cwd(), opt('out', resolve(ROOT, 'public/og-image.png')))
const htmlOut = opt('html', null)

const { PROFILE } = await tsImport('../src/content/profile.ts', import.meta.url)
const { SITE_NAME, OG_IMAGE } = await tsImport('../src/portfolio/site.ts', import.meta.url)
const { FactoryArt, FactoryMark } = await tsImport('../src/portfolio/FactoryArt.tsx', import.meta.url)
const { createElement } = await tsImport('react', import.meta.url)
const { renderToStaticMarkup } = await tsImport('react-dom/server', import.meta.url)

const font = (pkg, file) => `data:font/woff2;base64,${readFileSync(require.resolve(`@fontsource/${pkg}/files/${file}`)).toString('base64')}`
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const art = renderToStaticMarkup(createElement(FactoryArt, { className: 'art' }))
const mark = renderToStaticMarkup(createElement(FactoryMark, { className: 'mark' }))
const nameLines = PROFILE.name.trim().split(/\s+/)
const W = OG_IMAGE.width
const H = OG_IMAGE.height

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
@font-face{font-family:'Barlow Condensed';font-weight:700;src:url(${font('barlow-condensed', 'barlow-condensed-latin-700-normal.woff2')}) format('woff2')}
@font-face{font-family:'Barlow';font-weight:600;src:url(${font('barlow', 'barlow-latin-600-normal.woff2')}) format('woff2')}
@font-face{font-family:'IBM Plex Mono';font-weight:600;src:url(${font('ibm-plex-mono', 'ibm-plex-mono-latin-600-normal.woff2')}) format('woff2')}
html,body{margin:0}
body{width:${W}px;height:${H}px;overflow:hidden;background:#252b2b}
.card{position:relative;width:${W}px;height:${H}px;overflow:hidden;color:#eae3d2;font-family:'Barlow',sans-serif;
  background:radial-gradient(ellipse 48% 70% at 84% 96%,rgba(255,176,90,.24),transparent 70%),
             radial-gradient(ellipse 60% 60% at 8% 0%,rgba(99,140,136,.18),transparent 70%),#252b2b}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(234,227,210,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(234,227,210,.05) 1px,transparent 1px);background-size:40px 40px}
.text{position:absolute;left:72px;top:64px;width:620px}
.brand{display:flex;align-items:center;gap:14px;font:600 22px/1 'IBM Plex Mono',monospace;letter-spacing:.16em;text-transform:uppercase;color:#e9b63f}
.mark{width:42px;height:42px;color:#e9b63f}
.name{margin:48px 0 0;font:700 136px/.88 'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:.005em;color:#eae3d2}
.rule{width:96px;height:6px;margin:30px 0 0;background:#e9b63f}
.role{margin:24px 0 0;font:600 38px/1.2 'Barlow',sans-serif;color:#eae3d2}
.tag{margin:16px 0 0;font:600 21px/1.4 'IBM Plex Mono',monospace;color:#cdc6b6;letter-spacing:.02em}
.art{position:absolute;right:-6px;bottom:36px;width:560px;height:320px}
.ground{position:absolute;left:0;right:0;bottom:36px;height:32px;background:#1a1e1f}
.stripe{position:absolute;left:0;right:0;bottom:0;height:36px;background:repeating-linear-gradient(-45deg,#e9b63f 0 22px,#1a1e1f 22px 44px)}
</style></head><body><div class="card">
<div class="grid"></div>
<div class="ground"></div>
${art}
<div class="text">
  <div class="brand">${mark}<span>${esc(SITE_NAME)}</span></div>
  <h1 class="name">${nameLines.map(esc).join('<br>')}</h1>
  <div class="rule"></div>
  <p class="role">${esc(PROFILE.headline)}</p>
  <p class="tag">An explorable 3D factory portfolio</p>
</div>
<div class="stripe"></div>
</div></body></html>`

if (htmlOut) writeFileSync(resolve(process.cwd(), htmlOut), html)

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  await page.setContent(html, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  const missing = await page.evaluate(() =>
    ['700 20px "Barlow Condensed"', '600 20px "Barlow"', '600 20px "IBM Plex Mono"'].filter((f) => !document.fonts.check(f)),
  )
  if (missing.length) throw new Error(`fonts failed to load: ${missing.join(', ')}`)
  mkdirSync(dirname(out), { recursive: true })
  await page.screenshot({ path: out, type: 'png', clip: { x: 0, y: 0, width: W, height: H } })
  console.log(`[make-og] wrote ${out} (${W}×${H})`)
} finally {
  await browser.close()
}
