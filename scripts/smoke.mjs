#!/usr/bin/env node
/**
 * Smoke test for a built or deployed site (no dependencies; Node 20+).
 *
 *   node scripts/smoke.mjs [baseUrl] [--wait <ms>] [--timeout <ms>] [--retries <n>] [--json <file>]
 *
 *   baseUrl     default http://127.0.0.1:4173/ (`npm run preview`). Include the base path when there is
 *               one, e.g. https://brianm53.github.io/mckeown-industrial-works/
 *   --wait      keep retrying the first request for up to <ms> (a preview server that is still starting,
 *               a CDN that is still propagating). Default 0.
 *   --timeout   per-request timeout in ms (default 15000)
 *   --retries   extra attempts per request on network errors / 5xx (default 2)
 *
 * Checks: the SPA shell (/), the static portfolio (/portfolio/, must work without JS), health.json,
 * sitemap.xml, robots.txt, 404.html, a hashed JS and CSS asset referenced by index.html, the social
 * card image, a portfolio font, and that an unknown path still gets the SPA shell.
 * Prints a summary table and exits 1 if anything fails.
 */
import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def
}
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')))
let base = positional[0] ?? 'http://127.0.0.1:4173/'
if (!/^https?:\/\//.test(base)) {
  console.error(`smoke: base URL must start with http:// or https:// (got "${base}")`)
  process.exit(2)
}
if (!base.endsWith('/')) base += '/'
const waitMs = Number(opt('wait', '0'))
const timeoutMs = Number(opt('timeout', '15000'))
const retries = Number(opt('retries', '2'))
const jsonOut = opt('json', null)

const results = []

/** GET with timeout + retries. Returns { status, headers, body (Buffer), text, url, ms } or { error }. */
async function get(path, { attempts = retries + 1 } = {}) {
  const url = new URL(path, base).toString()
  let last
  for (let i = 0; i < attempts; i++) {
    const t0 = performance.now()
    try {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'miw-smoke/1.0' } })
      const body = Buffer.from(await res.arrayBuffer())
      last = { url, status: res.status, headers: res.headers, body, text: body.toString('utf8'), finalUrl: res.url, ms: performance.now() - t0 }
      if (res.status < 500) return last
    } catch (e) {
      last = { url, error: e?.name === 'TimeoutError' ? `timeout after ${timeoutMs} ms` : (e?.cause?.code ?? e?.message ?? String(e)), ms: performance.now() - t0 }
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1000 * (i + 1)))
  }
  return last
}

/** Runs one named check; `fn` throws (or returns a string detail) */
async function check(name, path, fn, { allowStatus = [200] } = {}) {
  const res = await get(path)
  const row = { name, url: res.url, status: res.status ?? null, ms: Math.round(res.ms ?? 0), ok: false, detail: '' }
  try {
    if (res.error) throw new Error(res.error)
    if (!allowStatus.includes(res.status)) throw new Error(`HTTP ${res.status} (expected ${allowStatus.join(' or ')})`)
    row.detail = (await fn(res)) || ''
    row.ok = true
  } catch (e) {
    row.detail = e?.message ?? String(e)
  }
  results.push(row)
  return res
}

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

const isHtml = (r) => /text\/html/i.test(r.headers.get('content-type') ?? '')

// Wait for the server (preview starting up / deploy propagating).
if (waitMs > 0) {
  const until = Date.now() + waitMs
  for (;;) {
    const r = await get('', { attempts: 1 })
    if (r && !r.error && r.status < 500) break
    if (Date.now() > until) {
      console.error(`smoke: ${base} did not respond within ${waitMs} ms (${r?.error ?? `HTTP ${r?.status}`})`)
      process.exit(1)
    }
    await new Promise((res) => setTimeout(res, 1000))
  }
}

// 1. SPA shell
const shell = await check('SPA shell (/)', '', (r) => {
  assert(isHtml(r), `content-type ${r.headers.get('content-type')}`)
  assert(r.text.includes('<div id="root">'), 'missing <div id="root">')
  assert(/<script type="module"[^>]*src="[^"]+\.js"/.test(r.text), 'no module script')
  assert(/<link rel="canonical" href="https?:\/\//.test(r.text), 'no absolute canonical link (prerender not run?)')
  assert(/<meta property="og:image" content="https?:\/\//.test(r.text), 'og:image is not absolute')
  assert(r.text.includes('portfolio/'), 'noscript link to the portfolio is missing')
  return `${(r.body.length / 1024).toFixed(1)} kB`
})

// 2. Static portfolio
const portfolio = await check('Static portfolio (/portfolio/)', 'portfolio/', (r) => {
  assert(isHtml(r), `content-type ${r.headers.get('content-type')}`)
  assert(r.text.includes('Brian McKeown'), 'name "Brian McKeown" not found')
  assert(/href="https:\/\/(www\.)?tryharmony\.ai\/?"/.test(r.text), 'Harmony AI link not found')
  assert(/href="https:\/\/github\.com\/BrianM53"/.test(r.text), 'GitHub link not found')
  const h1 = r.text.match(/<h1[\s>]/g)?.length ?? 0
  assert(h1 === 1, `${h1} <h1> elements`)
  assert(!/<script(?![^>]*application\/ld\+json)/i.test(r.text), 'contains an executable <script> (page must work without JS)')
  assert(/<link rel="canonical" href="https?:\/\/[^"]*portfolio\/"/.test(r.text), 'canonical link missing')
  assert(r.text.includes('application/ld+json'), 'JSON-LD missing')
  for (const id of ['about', 'harmony-ai', 'code-story', 'projects', 'resume', 'contact', 'about-this-site'])
    assert(r.text.includes(`id="${id}"`), `section #${id} missing`)
  return `${(r.body.length / 1024).toFixed(1)} kB, 7 sections`
})
const portfolioHtml = portfolio?.text ?? ''

// 3. Health
await check('Health (health.json)', 'health.json', (r) => {
  const j = JSON.parse(r.text)
  assert(j.status === 'ok', `status ${JSON.stringify(j.status)}`)
  assert(!Number.isNaN(Date.parse(j.builtAt)), 'builtAt is not a date')
  return `built ${j.builtAt}${j.commit ? ` @ ${String(j.commit).slice(0, 7)}` : ''}`
})

// 4. Sitemap / robots
await check('Sitemap (sitemap.xml)', 'sitemap.xml', (r) => {
  assert(r.text.includes('<urlset'), 'no <urlset>')
  const locs = [...r.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  assert(locs.length >= 2, `${locs.length} URLs`)
  assert(locs.some((l) => l.endsWith('/portfolio/')), 'portfolio/ not listed')
  return `${locs.length} URLs`
})
await check('Robots (robots.txt)', 'robots.txt', (r) => {
  assert(/User-agent:\s*\*/i.test(r.text), 'no User-agent line')
  assert(/^Sitemap:\s*https?:\/\//im.test(r.text), 'no absolute Sitemap line')
})

// 5. 404 page
await check('Not-found page (404.html)', '404.html', (r) => {
  assert(isHtml(r), `content-type ${r.headers.get('content-type')}`)
  assert(r.text.includes('<div id="root">'), 'not the SPA shell')
})

// 6. Hashed assets referenced by the shell
const shellText = shell?.text ?? ''
const js = /<script type="module"[^>]*src="([^"]+\.js)"/.exec(shellText)?.[1]
const css = /<link rel="stylesheet"[^>]*href="([^"]+\.css)"/.exec(shellText)?.[1]
if (js)
  await check(`Entry script (${js.split('/').pop()})`, new URL(js, base).toString(), (r) => {
    assert(/javascript/i.test(r.headers.get('content-type') ?? ''), `content-type ${r.headers.get('content-type')}`)
    assert(r.body.length > 1000, `only ${r.body.length} bytes`)
    return `${(r.body.length / 1024).toFixed(1)} kB${r.headers.get('cache-control') ? `, cache-control: ${r.headers.get('cache-control')}` : ''}`
  })
else results.push({ name: 'Entry script', url: base, status: null, ms: 0, ok: false, detail: 'no module script found in index.html' })
if (css)
  await check(`Stylesheet (${css.split('/').pop()})`, new URL(css, base).toString(), (r) => {
    assert(/text\/css/i.test(r.headers.get('content-type') ?? ''), `content-type ${r.headers.get('content-type')}`)
  })

// 7. Social card + portfolio font
await check('Social card (og-image.png)', 'og-image.png', (r) => {
  assert(r.body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'not a PNG')
  return `${(r.body.length / 1024).toFixed(1)} kB`
})
const font = /url\(([^)]+\.woff2)\)/.exec(portfolioHtml)?.[1]
if (font)
  await check(`Portfolio font (${font.split('/').pop()})`, new URL(font, base).toString(), (r) => {
    assert(r.body.subarray(0, 4).toString('latin1') === 'wOF2', 'not a woff2 file')
  })

// 8. Unknown path → SPA shell (200 with a rewrite, or 404 with 404.html on GitHub Pages)
await check(
  'Unknown path falls back to the app',
  `no-such-page-${Date.now().toString(36)}/`,
  (r) => {
    assert(r.text.includes('<div id="root">'), 'fallback is not the SPA shell')
    return `HTTP ${r.status}`
  },
  { allowStatus: [200, 404] },
)

// Report
const nameW = Math.max(...results.map((r) => r.name.length))
console.log(`Smoke test: ${base}\n`)
for (const r of results)
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(nameW)}  ${String(r.status ?? '-').padStart(3)}  ${String(r.ms).padStart(5)}ms  ${r.detail}`)
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? `, ${failed.length} failed` : ''}.`)
if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify({ base, at: new Date().toISOString(), results }, null, 2)}\n`)
process.exit(failed.length ? 1 : 0)
