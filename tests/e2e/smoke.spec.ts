/**
 * §12.1 build + deployed routes, §12.4 link syntax / owner-review flags.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { expectNoRuntimeErrors, gotoGame, installProbes, trackErrors } from './helpers'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const DIST = join(ROOT, 'dist-test')

test.describe('§12.1 build and deployed routes', () => {
  test('§12.1 test build output exists (SPA shell, static portfolio, health, sitemap, robots, 404)', () => {
    for (const f of ['index.html', 'portfolio/index.html', 'health.json', 'sitemap.xml', 'robots.txt', '404.html']) {
      expect(existsSync(join(DIST, f)), `dist-test/${f}`).toBe(true)
    }
    const index = readFileSync(join(DIST, 'index.html'), 'utf8')
    expect(index).toMatch(/<script[^>]+type="module"[^>]+src="[^"]*assets\/[^"]+\.js"/)
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    // documented commands (ARCHITECTURE §1 / README) exist
    for (const s of ['build', 'build:test', 'preview', 'preview:test', 'test', 'test:e2e']) expect(pkg.scripts[s], `npm script ${s}`).toBeTruthy()
  })

  test('§12.1 health.json, sitemap.xml and robots.txt are served', async ({ request }) => {
    const health = await request.get('/health.json')
    expect(health.ok()).toBe(true)
    const h = (await health.json()) as { status: string; name: string; version: string }
    expect(h.status).toBe('ok')
    expect(h.name).toBe('mckeown-industrial-works')
    expect(h.version).toMatch(/^\d+\.\d+\.\d+/)

    const sitemap = await request.get('/sitemap.xml')
    expect(sitemap.ok()).toBe(true)
    const xml = await sitemap.text()
    expect(xml).toContain('<urlset')
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    expect(locs.length).toBeGreaterThanOrEqual(2)
    for (const l of locs) expect(() => new URL(l)).not.toThrow()
    expect(locs.some((l) => l.endsWith('/portfolio/'))).toBe(true)

    const robots = await request.get('/robots.txt')
    expect(robots.ok()).toBe(true)
    expect(await robots.text()).toMatch(/User-agent/i)
  })

  test('§12.1 /portfolio/ static page works without JavaScript', async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false })
    const page = await ctx.newPage()
    const resp = await page.goto('/portfolio/')
    expect(resp?.ok()).toBe(true)
    await expect(page.locator('h1').first()).toBeVisible()
    await expect(page.locator('h1').first()).toContainText(/Brian/i)
    // real content and a way to reach Brian
    await expect(page.locator('a[href^="https://github.com/BrianM53"]').first()).toBeAttached()
    expect(await page.locator('h2').count()).toBeGreaterThanOrEqual(3)
    await ctx.close()
  })

  test('§12.1 /portfolio/ with JavaScript loads without console errors', async ({ page }) => {
    const log = trackErrors(page)
    const resp = await page.goto('/portfolio/')
    expect(resp?.ok()).toBe(true)
    await expect(page.locator('h1').first()).toBeVisible()
    await page.waitForLoadState('load')
    expect(log.take()).toEqual([])
  })

  test('§12.1 unknown paths still get a working page (SPA shell / 404 fallback)', async ({ page, request }) => {
    const notFound = await request.get('/404.html')
    expect(notFound.ok()).toBe(true)
    expect(await notFound.text()).toMatch(/<html/i)
    const log = trackErrors(page)
    await page.goto('/no/such/route?lite=1')
    await expect(page.getByTestId('topbar')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('fallback-portfolio')).toBeVisible({ timeout: 60_000 })
    expect(log.take()).toEqual([])
  })

  test('§12.1 deep link ?panel=<id> opens a portfolio panel on load (HTML mode)', async ({ page }) => {
    const log = trackErrors(page)
    await page.goto('/?lite=1&panel=github')
    const panel = page.getByTestId('panel-github')
    await expect(panel).toBeVisible({ timeout: 60_000 })
    await expect(panel.locator('a[href="https://github.com/BrianM53"]').first()).toBeAttached()
    expect(log.take()).toEqual([])
  })

  test('§12.1 deployed root boots the 3D factory with every module ready and no console errors', async ({ page }) => {
    const log = trackErrors(page)
    await installProbes(page)
    await gotoGame(page)
    const modules = (await page.evaluate(() => window.__MIW__.modules)) as Record<string, string>
    expect(Object.keys(modules).length).toBeGreaterThan(5)
    for (const [name, status] of Object.entries(modules)) expect(status, `module ${name}`).toBe('ready')
    await expect(page.locator('canvas').first()).toBeVisible()
    expect((await page.evaluate(() => window.__e2e?.webgl ?? 0)) > 0).toBe(true)
    await expect(page.getByTestId('topbar')).toBeVisible()
    await expect(page.getByTestId('hud')).toBeAttached()
    await expectNoRuntimeErrors(page, log)
  })
})

test.describe('§12.4 external links', () => {
  test('§12.4 link audit: every configured URL is syntactically valid and unverified URLs are flagged for owner review', () => {
    const outDir = join(ROOT, 'test-results')
    mkdirSync(outDir, { recursive: true })
    const out = join(outDir, 'e2e-link-audit.json')
    // Offline audit (no network): exits non-zero on any syntax error.
    execFileSync('npx', ['tsx', 'scripts/check-links.ts', '--json', out], { cwd: ROOT, stdio: 'pipe', timeout: 120_000 })
    const report = JSON.parse(readFileSync(out, 'utf8')) as {
      links: { url: string; verified: boolean; syntax: string[]; result: string; level: string; where: string }[]
    }
    expect(report.links.length).toBeGreaterThan(5)
    for (const l of report.links) {
      expect(l.syntax, `${l.where} ${l.url}`).toEqual([])
      expect(() => new URL(l.url), l.url).not.toThrow()
      expect(['https:', 'mailto:']).toContain(new URL(l.url).protocol)
      if (!l.verified) expect(l.result, `${l.where} must be flagged`).toMatch(/owner review|unverified/i)
      else expect(l.level).not.toBe('error')
    }
  })

  test('§12.4 rendered external links (static portfolio) are valid and open in a new tab safely', async ({ page }) => {
    await page.goto('/portfolio/')
    await expect(page.locator('h1').first()).toBeVisible()
    const links = await page.locator('a[href^="http"], a[href^="mailto:"]').evaluateAll((els) =>
      els.map((a) => ({ href: (a as HTMLAnchorElement).href, raw: a.getAttribute('href') ?? '', target: a.getAttribute('target'), rel: a.getAttribute('rel') ?? '' })),
    )
    expect(links.length).toBeGreaterThan(5)
    const origin = new URL(page.url()).origin
    for (const l of links) {
      const u = new URL(l.raw, page.url())
      expect(['https:', 'http:', 'mailto:'], l.raw).toContain(u.protocol)
      if (u.protocol === 'http:') expect(u.origin, `insecure external link ${l.raw}`).toBe(origin)
      if (u.protocol.startsWith('http') && u.origin !== origin) {
        expect(l.target, `${l.raw} target`).toBe('_blank')
        expect(l.rel, `${l.raw} rel`).toContain('noopener')
        expect(l.rel, `${l.raw} rel`).toContain('noreferrer')
      }
    }
  })
})
