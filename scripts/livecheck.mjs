// Post-deploy browser check: boots a deployed (production) build headlessly and reports
// time to top bar, time until the 3D world finished loading, canvas presence and console errors.
// Usage: node scripts/livecheck.mjs <url> <screenshot.png>
import { chromium } from '@playwright/test'
const url = process.argv[2]
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 200)))
page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url().slice(-80) + ' ' + (r.failure()?.errorText ?? '')))
const t0 = Date.now()
await page.goto(url + '?quality=low', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-testid="topbar"]', { timeout: 30000 })
const topbarMs = Date.now() - t0
let loaded = false
try { await page.waitForSelector('[data-testid="loading-screen"]', { state: 'detached', timeout: 180000 }); loaded = true } catch {}
const loadedMs = Date.now() - t0
await page.waitForTimeout(4000)
await page.screenshot({ path: process.argv[3], timeout: 120000 })
const canvas = await page.locator('canvas').count()
console.log(JSON.stringify({ topbarMs, loaded, loadedMs, canvas, hasDebug: await page.evaluate(() => typeof window.__MIW__ !== 'undefined'), errors }, null, 1))
await browser.close()
