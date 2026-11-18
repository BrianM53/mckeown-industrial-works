#!/usr/bin/env node
/**
 * Screenshot & drive helper for visual verification (agents + humans).
 *
 * Usage:
 *   node scripts/shot.mjs [--url http://127.0.0.1:5173/] [--query "quality=low&noevents=1"]
 *        [--size 1280x720] [--gpu] [--timeout 90000]
 *        --shots '<JSON array>'      (or a single shot via --out/--at/--cam/--eval/--keys/--wait)
 *
 * A shot is: {
 *   "out": "shots/name.png",           // required
 *   "at":  [x, z, yaw],                 // teleport the worker (needs __MIW__.player.teleport)
 *   "cam": [yaw, pitch, distance],      // set the camera orbit (needs __MIW__.camera.set)
 *   "eval": "js expression",            // run in page before capture (e.g. "__MIW__.factory.skipToLaunch()")
 *   "keys": "w:800,shift+w:600,a:300",  // hold keys for N ms in sequence (real keyboard events)
 *   "drag": [dx, dy],                   // right-mouse drag across the canvas center by dx,dy px
 *   "wait": 1200                        // ms to wait before capture (default 1200)
 * }
 * Prints console errors, page errors, __MIW__.errors and module status as JSON lines.
 * The page loads ONCE and shots run in order (state carries over between shots).
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : def
}
const flag = (name) => args.includes(`--${name}`)

const base = opt('url', 'http://127.0.0.1:5173/')
const query = opt('query', 'quality=low&noevents=1')
const [w, h] = opt('size', '1280x720').split('x').map(Number)
const timeout = Number(opt('timeout', '120000'))
let shots = []
if (opt('shots')) shots = JSON.parse(opt('shots'))
else if (opt('out')) {
  const parse = (s) => (s ? s.split(',').map(Number) : undefined)
  shots = [{ out: opt('out'), at: parse(opt('at')), cam: parse(opt('cam')), eval: opt('eval'), keys: opt('keys'), wait: Number(opt('wait', '1200')) }]
}
if (!shots.length) {
  console.error('no shots given; see header of scripts/shot.mjs')
  process.exit(2)
}

const launchArgs = flag('gpu')
  ? ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=default']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']

const browser = await chromium.launch({ args: launchArgs })
const page = await browser.newPage({ viewport: { width: w, height: h } })
const logs = []
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push({ type: m.type(), text: m.text().slice(0, 500) })
})
page.on('pageerror', (e) => logs.push({ type: 'pageerror', text: String(e).slice(0, 500) }))

const url = base + (base.includes('?') ? '&' : '?') + query
const t0 = Date.now()
await page.goto(url, { waitUntil: 'domcontentloaded', timeout })
try {
  await page.waitForFunction(() => window.__MIW__?.ready === true, null, { timeout })
} catch {
  console.log(JSON.stringify({ warning: 'world did not report ready', after_ms: Date.now() - t0 }))
}
console.log(JSON.stringify({ ready_ms: Date.now() - t0 }))

for (const s of shots) {
  try {
    if (s.at) await page.evaluate(([x, z, yaw]) => window.__MIW__?.player?.teleport?.(x, z, yaw), s.at)
    if (s.cam)
      await page.evaluate(([yaw, pitch, distance]) => window.__MIW__?.camera?.set?.({ yaw, pitch, distance, immediate: true }), s.cam)
    if (s.eval) {
      const r = await page.evaluate((code) => {
        // eslint-disable-next-line no-eval
        const v = (0, eval)(code)
        try {
          return JSON.stringify(v)?.slice(0, 2000)
        } catch {
          return String(v)
        }
      }, s.eval)
      if (r !== undefined) console.log(JSON.stringify({ eval: s.eval.slice(0, 80), result: r }))
    }
    if (s.drag) {
      await page.mouse.move(w / 2, h / 2)
      await page.mouse.down({ button: 'right' })
      await page.mouse.move(w / 2 + s.drag[0], h / 2 + s.drag[1], { steps: 12 })
      await page.mouse.up({ button: 'right' })
    }
    if (s.keys) {
      for (const part of s.keys.split(',')) {
        const [combo, ms] = part.split(':')
        const keys = combo.split('+').map((k) => (k.length === 1 ? k : k[0].toUpperCase() + k.slice(1)))
        for (const k of keys) await page.keyboard.down(k)
        await page.waitForTimeout(Number(ms || 300))
        for (const k of keys.reverse()) await page.keyboard.up(k)
      }
    }
    await page.waitForTimeout(s.wait ?? 1200)
    // Let two more frames render (HTML entrance animations, late canvas frames) before capturing.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))))).catch(() => {})
    mkdirSync(dirname(s.out), { recursive: true })
    await page.screenshot({ path: s.out, timeout })
    const state = await page.evaluate(() => ({
      player: window.__MIW__?.player?.getState?.(),
      camera: window.__MIW__?.camera?.getState?.(),
    }))
    console.log(JSON.stringify({ shot: s.out, state }))
  } catch (e) {
    console.log(JSON.stringify({ shot: s.out, error: String(e).slice(0, 400) }))
  }
}

const dbg = await page.evaluate(() => ({ errors: window.__MIW__?.errors ?? [], modules: window.__MIW__?.modules ?? {} }))
console.log(JSON.stringify({ debugErrors: dbg.errors, modules: dbg.modules }))
console.log(JSON.stringify({ consoleErrors: logs.slice(0, 40) }))
await browser.close()
