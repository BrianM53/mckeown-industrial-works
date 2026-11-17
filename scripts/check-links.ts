/**
 * Link checker for every URL the site shows: content links (src/content/links.ts →
 * collectExternalLinks), contact options, credits, and this site's own deployment URLs.
 *
 *   npx tsx scripts/check-links.ts                    # offline: syntax check + owner-review table
 *   npx tsx scripts/check-links.ts --network          # also GET each URL (browser UA, 15 s timeout, redirects followed)
 *   npx tsx scripts/check-links.ts --network --strict # exit 1 when a *verified* link is broken or unreachable
 *   npx tsx scripts/check-links.ts --json out.json    # also write a machine-readable report
 *   npm run check:links -- --network                  # same thing through npm
 *
 * Exit codes: 0 = fine · 1 = syntax error (always fatal) or, with --strict, a failing verified link · 2 = bad usage.
 * LinkedIn answers automated requests with HTTP 999; that is reported as "blocked-by-site (manual check)", never a failure.
 * Unverified links (verified: false in content) are listed for owner review and never fail the run.
 * SITE_URL (env) sets the deployment URLs that are listed (default: the GitHub Pages URL).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RESUME } from '../src/content/resume'
import { classifyStatus, collectAllLinks, failsStrict, uniqueUrls, validateUrl, type AuditLink, type NetVerdict } from '../src/portfolio/linkAudit'
import { isExternalHref, resolveSiteUrl } from '../src/portfolio/site'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/* ------------------------------------------------------------------ args */

const argv = process.argv.slice(2)
const flags = new Set(argv.filter((a) => a.startsWith('-')))
if (flags.has('--help') || flags.has('-h')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*?\n?/, '').replace(/^ \* ?/gm, ''))
  process.exit(0)
}
const known = ['--network', '--strict', '--json', '--timeout', '--help', '-h']
const unknown = [...flags].filter((f) => !known.includes(f))
if (unknown.length) {
  console.error(`Unknown option(s): ${unknown.join(', ')}. Run with --help.`)
  process.exit(2)
}
const network = flags.has('--network')
const strict = flags.has('--strict')
const jsonPath = valueOf('--json')
const timeoutMs = Number(valueOf('--timeout') ?? 15000)
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error('--timeout expects milliseconds')
  process.exit(2)
}

function valueOf(flag: string): string | undefined {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined
}

/* ---------------------------------------------------------------- styling */

const useColor = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code: number) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s)
const red = paint(31)
const green = paint(32)
const yellow = paint(33)
const dim = paint(2)
const bold = paint(1)

/* ------------------------------------------------------------------- run */

interface Row extends AuditLink {
  syntax: string[]
  status?: number
  finalUrl?: string
  ms?: number
  verdict?: NetVerdict
  netLabel?: string
  result: string
  level: 'ok' | 'review' | 'warn' | 'fail'
}

const siteUrl = resolveSiteUrl(process.env)
const links = collectAllLinks(siteUrl)
const rows: Row[] = links.map((l) => {
  const v = validateUrl(l.url)
  return { ...l, syntax: v.problems, result: '', level: 'ok' }
})

// Local résumé PDF (pdfUrl relative to /public): must exist and be a real PDF, never a broken download.
const localChecks: { what: string; ok: boolean; detail: string }[] = []
if (RESUME.pdfUrl && !isExternalHref(RESUME.pdfUrl)) {
  const file = resolve(ROOT, 'public', RESUME.pdfUrl.replace(/^\.?\//, ''))
  let ok = false
  let detail = `missing: ${file}`
  if (existsSync(file)) {
    const head = readFileSync(file).subarray(0, 5).toString('latin1')
    ok = head === '%PDF-'
    detail = ok ? `found ${file}` : `${file} is not a PDF (starts with ${JSON.stringify(head)})`
  }
  localChecks.push({ what: `resume.pdfUrl (${RESUME.pdfUrl})`, ok, detail })
}

if (network) {
  const urls = uniqueUrls(rows.filter((r) => r.syntax.length === 0 && /^https:/i.test(r.url)))
  const results = new Map<string, Awaited<ReturnType<typeof probe>>>()
  await pool(urls, 4, async (u) => {
    results.set(u, await probe(u))
  })
  for (const r of rows) {
    const res = results.get(r.url.trim())
    if (!res) continue
    r.ms = res.ms
    r.finalUrl = res.finalUrl
    if (res.status !== undefined) {
      r.status = res.status
      const c = classifyStatus(res.status)
      r.verdict = c.verdict
      r.netLabel = c.label
    } else {
      r.verdict = 'unreachable'
      r.netLabel = res.error ?? 'unreachable'
    }
  }
}

let syntaxErrors = 0
let strictFailures = 0
for (const r of rows) {
  if (r.syntax.length) {
    syntaxErrors++
    r.level = 'fail'
    r.result = `SYNTAX: ${r.syntax.join('; ')}`
    continue
  }
  if (!network || /^mailto:/i.test(r.url)) {
    r.level = r.verified ? 'ok' : 'review'
    r.result = r.verified ? 'syntax ok' : 'unverified (owner review)'
    continue
  }
  const v = r.verdict ?? 'unreachable'
  if (v === 'ok') {
    r.level = r.verified ? 'ok' : 'review'
    r.result = r.verified ? 'ok' : 'ok, unverified (owner review)'
  } else if (v === 'blocked') {
    r.level = 'review'
    r.result = r.netLabel ?? 'blocked-by-site (manual check)'
  } else if (v === 'rate-limited') {
    r.level = 'warn'
    r.result = r.netLabel ?? 'rate-limited'
  } else {
    const fails = strict && failsStrict(r.verified, v)
    if (fails) strictFailures++
    r.level = r.verified ? 'fail' : 'review'
    r.result = `${r.netLabel ?? v}${r.verified ? '' : ', unverified (owner review)'}`
  }
}
const localFailures = localChecks.filter((c) => !c.ok).length

/* ---------------------------------------------------------------- report */

console.log(bold(`Link audit: ${rows.length} links, ${uniqueUrls(rows).length} unique URLs`) + dim(`  (network ${network ? 'on' : 'off'}, strict ${strict ? 'on' : 'off'}, site ${siteUrl})`))
console.log()
const header = ['#', 'RESULT', 'HTTP', 'TIME', 'VERIFIED', 'WHERE', 'URL']
const table = rows.map((r, i) => [
  String(i + 1),
  r.result,
  r.status !== undefined ? String(r.status) : network && !/^mailto:/i.test(r.url) && !r.syntax.length ? '-' : '',
  r.ms !== undefined ? `${Math.round(r.ms)}ms` : '',
  r.verified ? 'yes' : 'NO',
  r.where,
  r.url + (r.finalUrl && stripSlash(r.finalUrl) !== stripSlash(r.url) ? `  -> ${r.finalUrl}` : ''),
])
const widths = header.map((h, c) => Math.max(h.length, ...table.map((row) => (c === header.length - 1 ? 0 : row[c].length))))
const fmt = (cells: string[]) => cells.map((cell, c) => (c === cells.length - 1 ? cell : cell.padEnd(widths[c]))).join('  ')
console.log(dim(fmt(header)))
table.forEach((cells, i) => {
  const level = rows[i].level
  const line = fmt(cells)
  console.log(level === 'fail' ? red(line) : level === 'warn' ? yellow(line) : level === 'review' ? yellow(line) : line)
})

for (const c of localChecks) console.log(`\n${c.ok ? green('ok') : red('FAIL')}  ${c.what}: ${c.detail}`)

const review = rows.filter((r) => r.level === 'review' || (!r.verified && r.note))
if (review.length) {
  console.log(bold('\nOwner review'))
  const seen = new Set<string>()
  for (const r of review) {
    const key = `${r.where}|${r.url}`
    if (seen.has(key)) continue
    seen.add(key)
    console.log(`  - ${r.where}: ${r.result}${r.note ? `. ${r.note}` : ''}`)
  }
}

const counts = rows.reduce<Record<string, number>>((acc, r) => ((acc[r.level] = (acc[r.level] ?? 0) + 1), acc), {})
console.log(
  `\n${bold('Summary')}: ${counts.ok ?? 0} ok, ${counts.review ?? 0} for owner review, ${counts.warn ?? 0} warnings, ${counts.fail ?? 0} failing` +
    (syntaxErrors ? red(` (${syntaxErrors} syntax error${syntaxErrors === 1 ? '' : 's'})`) : '') +
    (!network ? dim('. Run with --network to check that the URLs resolve.') : ''),
)

if (jsonPath) {
  const report = { generatedAt: new Date().toISOString(), siteUrl, network, strict, links: rows, localChecks }
  writeFileSync(resolve(process.cwd(), jsonPath), `${JSON.stringify(report, null, 2)}\n`)
  console.log(dim(`Report written to ${jsonPath}`))
}

const exitCode = syntaxErrors > 0 || localFailures > 0 || strictFailures > 0 ? 1 : 0
if (exitCode) console.log(red(`\nFAILED: ${[syntaxErrors && `${syntaxErrors} syntax`, localFailures && `${localFailures} local file`, strictFailures && `${strictFailures} verified link`].filter(Boolean).join(', ')} problem(s).`))
process.exit(exitCode)

/* --------------------------------------------------------------- helpers */

async function probe(url: string): Promise<{ status?: number; finalUrl?: string; ms: number; error?: string }> {
  let last: { status?: number; finalUrl?: string; ms: number; error?: string } = { ms: 0 }
  for (let attempt = 0; attempt < 2; attempt++) {
    const t0 = performance.now()
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'User-Agent': BROWSER_UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      })
      await res.body?.cancel().catch(() => {})
      last = { status: res.status, finalUrl: res.url, ms: performance.now() - t0 }
      if (res.status < 500 && res.status !== 429) return last
    } catch (e) {
      const err = e as Error & { cause?: { code?: string } }
      last = { ms: performance.now() - t0, error: err.name === 'TimeoutError' ? `timeout after ${timeoutMs / 1000} s` : (err.cause?.code ?? err.message) }
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 1500))
  }
  return last
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++])
  })
  await Promise.all(workers)
}

function stripSlash(u: string): string {
  return u.replace(/\/+$/, '')
}
