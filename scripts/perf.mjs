#!/usr/bin/env node
/**
 * Performance capture for McKeown Industrial Works. docs/PERF.md describes the method and the results.
 *
 * Per quality tier (one cold page load each, forced with ?quality=<tier>&noevents=1) it records:
 *   - load timing: first contentful paint, top bar visible (first meaningful UI), __MIW__.ready
 *   - bytes fetched before the top bar and before ready (Resource Timing, decoded sizes; gzip sizes too
 *     when --dist is the build being served)
 *   - per viewpoint: fps from its own requestAnimationFrame sampling (mean + p50/p95 frame time) and
 *     __MIW__.perf.stats() (draw calls, triangles, geometries, textures, shader programs)
 * plus the WebGL renderer string actually used (WEBGL_debug_renderer_info) and the bundle sizes of --dist.
 *
 * It needs a page with the debug hooks (window.__MIW__): the TEST build or the dev server.
 *   npm run build:test && npm run preview:test                 # TEST build on http://127.0.0.1:4174/
 *   node scripts/perf.mjs --url http://127.0.0.1:4174/ --dist dist-test --json perf.json
 *   node scripts/perf.mjs --url http://127.0.0.1:5173/          # dev server (load timing is NOT representative)
 *   node scripts/perf.mjs --probe                               # only list the WebGL backends and what they report
 *   node scripts/perf.mjs --sizes dist                          # only the bundle size table of a build
 *
 * Options:
 *   --gl auto|d3d12|vulkan|gl|egl|swiftshader   WebGL backend. auto (default) probes the hardware backends in order
 *                         and uses the first whose renderer is not a software rasterizer, else SwiftShader.
 *   --headful             launch a headed browser (needs a display; on a headless Linux box use xvfb-run)
 *   --qualities low,medium,high   tiers to measure (default all three)
 *   --views spawn,aisle,plaza,launch,server,rec   viewpoints (default all six)
 *   --size 1280x720       viewport in CSS px (DPR 1)
 *   --settle 4000         ms to wait after each teleport (and at least --minFrames frames)
 *   --sample 5000         ms of fps sampling per viewpoint (and at least --minFrames frames)
 *   --minFrames 6         minimum frames in the settle and in the sample windows (SwiftShader can be < 1 fps)
 *   --dist <dir>          build output whose assets/ to size (gzip level 9 + brotli); skipped if missing
 *   --json <path>         write every raw number as JSON
 *   --timeout 300000      per page load / per wait (ms)
 * The printed Markdown tables are what docs/PERF.md quotes.
 */
import { chromium } from '@playwright/test'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { cpus, loadavg, totalmem, release } from 'node:os'
import { join, extname, basename } from 'node:path'
import { gzipSync, brotliCompressSync, constants as zc } from 'node:zlib'

const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : def
}
const flag = (name) => args.includes(`--${name}`)

const base = opt('url', 'http://127.0.0.1:4174/')
const glChoice = opt('gl', 'auto')
const headful = flag('headful')
const qualities = opt('qualities', 'low,medium,high').split(',').filter(Boolean)
const [vw, vh] = opt('size', '1280x720').split('x').map(Number)
const settleMs = Number(opt('settle', '4000'))
const sampleMs = Number(opt('sample', '5000'))
const minFrames = Number(opt('minFrames', '6'))
const timeout = Number(opt('timeout', '300000'))
const distDir = opt('dist', flag('sizes') ? opt('sizes', 'dist') : 'dist')
const jsonOut = opt('json')

/** Viewpoints: [x, z, yaw] of the worker; the camera sits behind at the default third-person boom. */
const VIEWS = [
  { id: 'spawn', name: 'Spawn (Visitor Intake)', at: [0, 32, 0] },
  { id: 'aisle', name: 'Production aisle', at: [0, 12, 0] },
  { id: 'plaza', name: 'Tower plaza', at: [0, -2, 0] },
  { id: 'launch', name: 'Launch yard', at: [6, -20, -0.62] },
  { id: 'server', name: 'Server hall', at: [-36, -9, Math.PI / 2] },
  { id: 'rec', name: 'Rec yard', at: [38, -14, -Math.PI / 2] },
]
const views = (opt('views') ? opt('views').split(',') : VIEWS.map((v) => v.id)).map((id) => {
  const v = VIEWS.find((x) => x.id === id)
  if (!v) throw new Error(`unknown view ${id}; known: ${VIEWS.map((x) => x.id).join(', ')}`)
  return v
})
/** Default third-person boom (src/player/constants.ts: defaultPitch 10°, defaultDistance 5.5 m). */
const CAMERA = { pitch: (10 * Math.PI) / 180, distance: 5.5 }

const COMMON = ['--mute-audio', '--autoplay-policy=user-gesture-required']
const G = ['--ignore-gpu-blocklist']
/** WebGL backends. Hardware candidates first; software rasterizers are rejected by the probe. */
const BACKENDS = {
  // WSL2: GPU paravirtualization through /dev/dxg and Mesa's d3d12 Gallium driver, used by ANGLE's GL-on-EGL path.
  d3d12: { label: 'ANGLE GL-EGL on Mesa D3D12 (WSL2 GPU-PV)', env: { GALLIUM_DRIVER: 'd3d12' }, args: [...G, '--use-angle=gl-egl'] },
  vulkan: { label: 'ANGLE Vulkan', args: [...G, '--use-angle=vulkan', '--enable-features=Vulkan'] },
  gl: { label: 'ANGLE desktop GL', args: [...G, '--use-angle=gl'] },
  egl: { label: 'ANGLE GL-EGL', args: [...G, '--use-angle=gl-egl'] },
  swiftshader: { label: 'SwiftShader (CPU, same as scripts/shot.mjs)', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...G] },
}
const SOFTWARE = /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render|microsoft basic/i
const AUTO_ORDER = [...(existsSync('/dev/dxg') ? ['d3d12'] : []), 'vulkan', 'gl', 'egl']

const log = (o) => console.error(JSON.stringify(o))
const round = (n, d = 1) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null)
const kb = (b) => (b == null ? '–' : (b / 1024).toFixed(1))

async function launch(name) {
  const b = BACKENDS[name]
  return chromium.launch({
    headless: !headful,
    args: [...COMMON, ...b.args],
    env: { ...process.env, ...(b.env ?? {}) },
    timeout: 60000,
  })
}

/** Renderer/vendor strings a page sees with this backend (blank page, no app). */
async function probe(name) {
  const t0 = Date.now()
  let browser
  try {
    browser = await launch(name)
    const page = await browser.newPage()
    await page.setContent('<canvas id="c" width="64" height="64"></canvas>')
    const info = await page.evaluate(() => {
      const gl = document.getElementById('c').getContext('webgl2')
      if (!gl) return { webgl2: false }
      const ext = gl.getExtension('WEBGL_debug_renderer_info')
      return {
        webgl2: true,
        renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      }
    })
    return { backend: name, ...info, software: !info.webgl2 || SOFTWARE.test(info.renderer ?? ''), browser: browser.version(), ms: Date.now() - t0 }
  } catch (e) {
    return { backend: name, error: String(e).split('\n')[0].slice(0, 200), software: true, ms: Date.now() - t0 }
  } finally {
    await browser?.close().catch(() => {})
  }
}

async function chooseBackend() {
  const probes = []
  if (glChoice !== 'auto') {
    if (!BACKENDS[glChoice]) throw new Error(`unknown --gl ${glChoice}; known: auto, ${Object.keys(BACKENDS).join(', ')}`)
    probes.push(await probe(glChoice))
    return { name: glChoice, probes }
  }
  for (const name of AUTO_ORDER) {
    const p = await probe(name)
    probes.push(p)
    log({ probe: p })
    if (!p.error && !p.software) return { name, probes }
  }
  probes.push(await probe('swiftshader'))
  return { name: 'swiftshader', probes }
}

/** Raw / gzip / brotli sizes of <dist>/assets, grouped by kind, plus what index.html loads up front. */
function bundleSizes(dist) {
  const dir = join(dist, 'assets')
  if (!existsSync(dir)) return null
  const files = readdirSync(dir)
    .filter((f) => statSync(join(dir, f)).isFile())
    .map((f) => {
      const buf = readFileSync(join(dir, f))
      const ext = extname(f).slice(1).toLowerCase()
      const kind = ext === 'js' ? 'js' : ext === 'css' ? 'css' : /^(woff2?|ttf|otf)$/.test(ext) ? 'font' : /^(png|jpe?g|webp|avif|svg|gif)$/.test(ext) ? 'image' : ext === 'wasm' ? 'wasm' : 'other'
      return {
        file: f,
        kind,
        raw: buf.length,
        gzip: gzipSync(buf, { level: 9 }).length,
        brotli: brotliCompressSync(buf, { params: { [zc.BROTLI_PARAM_QUALITY]: 11 } }).length,
      }
    })
    .sort((a, b) => b.raw - a.raw)
  const html = existsSync(join(dist, 'index.html')) ? readFileSync(join(dist, 'index.html'), 'utf8') : ''
  const upfront = new Set([...html.matchAll(/(?:src|href)="[^"]*assets\/([^"]+)"/g)].map((m) => m[1]))
  const sum = (list, k) => list.reduce((s, f) => s + f[k], 0)
  const kinds = {}
  for (const f of files) {
    const k = (kinds[f.kind] ??= { count: 0, raw: 0, gzip: 0, brotli: 0 })
    k.count++
    k.raw += f.raw
    k.gzip += f.gzip
    k.brotli += f.brotli
  }
  const first = files.filter((f) => upfront.has(f.file))
  return {
    dist,
    files,
    kinds,
    total: { count: files.length, raw: sum(files, 'raw'), gzip: sum(files, 'gzip'), brotli: sum(files, 'brotli') },
    upfront: { files: first.map((f) => f.file), raw: sum(first, 'raw'), gzip: sum(first, 'gzip'), brotli: sum(first, 'brotli') },
    indexHtml: html ? { raw: Buffer.byteLength(html), gzip: gzipSync(html, { level: 9 }).length } : null,
  }
}

/** Installed before any page script: timing marks for the top bar and __MIW__.ready, plus a rAF frame log. */
function initScript() {
  performance.setResourceTimingBufferSize(10000)
  const raf = window.requestAnimationFrame.bind(window)
  // topbarDom: first poll that saw it laid out and visible; topbar: the next animation frame (≈ when it is painted)
  const marks = (window.__perf = { topbarDom: null, topbar: null, ready: null, frames: 0, ft: [], busy: 0 })
  // Main-thread time spent inside the page's own rAF callbacks (R3F frame loop: physics, sim, render submission).
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      const s = performance.now()
      try {
        cb(t)
      } finally {
        marks.busy += performance.now() - s
      }
    })
  // Main-thread time blocked on shader compile/link: the first synchronous program query after linkProgram waits for
  // the GPU process to finish compiling (three.js queries every new program), so these calls carry the compile cost.
  marks.shader = { ms: 0, calls: 0, links: 0 }
  const proto = window.WebGL2RenderingContext?.prototype
  if (proto) {
    for (const name of ['getProgramParameter', 'getShaderParameter', 'getProgramInfoLog', 'getShaderInfoLog', 'getUniformLocation', 'getAttribLocation', 'getActiveUniform', 'getActiveAttrib']) {
      const orig = proto[name]
      proto[name] = function (...a) {
        const s = performance.now()
        try {
          return orig.apply(this, a)
        } finally {
          marks.shader.ms += performance.now() - s
          marks.shader.calls++
        }
      }
    }
    const link = proto.linkProgram
    proto.linkProgram = function (...a) {
      marks.shader.links++
      return link.apply(this, a)
    }
  }
  // When each module slot reported 'ready'.
  marks.modules = {}
  const visible = (el) => {
    if (!el) return false
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.5
  }
  const poll = () => {
    const now = performance.now()
    if (marks.topbarDom === null && visible(document.querySelector('[data-testid="topbar"]'))) {
      marks.topbarDom = now
      raf(() => (marks.topbar = performance.now()))
    }
    for (const [k, v] of Object.entries(window.__MIW__?.modules ?? {})) if (v === 'ready' && !(k in marks.modules)) marks.modules[k] = now
    if (marks.ready === null && window.__MIW__?.ready === true) {
      marks.ready = now
      marks.shaderAtReady = { ...marks.shader }
      marks.ftAtReady = marks.ft.length
    }
    if (marks.topbarDom === null || marks.ready === null) setTimeout(poll, 20)
  }
  poll()
  let last = 0
  const frame = (t) => {
    marks.frames++
    if (last) {
      marks.ft.push(t - last)
      if (marks.ft.length > 20000) marks.ft.splice(0, 10000)
    }
    last = t
    raf(frame)
  }
  raf(frame)
}

/** Waits until `ms` passed AND `frames` more frames rendered (capped by timeout). Returns {elapsed, frames}. */
async function waitFrames(page, ms, frames) {
  return page.evaluate(
    ([ms, frames, cap]) =>
      new Promise((resolve) => {
        const f0 = window.__perf.frames
        const t0 = performance.now()
        const tick = () => {
          const el = performance.now() - t0
          const n = window.__perf.frames - f0
          if ((el >= ms && n >= frames) || el >= cap) resolve({ elapsed: el, frames: n })
          else setTimeout(tick, 50)
        }
        tick()
      }),
    [ms, frames, timeout],
  )
}

async function measureTier(browser, quality, sizes) {
  const context = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 })
  await context.addInitScript(initScript)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 300)))
  const url = base + (base.includes('?') ? '&' : '?') + `quality=${quality}&noevents=1`
  const t0 = Date.now()
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout })
  await page.waitForFunction(() => window.__MIW__?.ready === true && window.__perf?.ready !== null, null, { timeout, polling: 100 })
  const wallReady = Date.now() - t0
  const hooks = await page.evaluate(() => ({ perf: !!window.__MIW__?.perf?.stats, player: !!window.__MIW__?.player?.teleport, camera: !!window.__MIW__?.camera?.set }))
  if (!hooks.perf || !hooks.player || !hooks.camera) throw new Error(`debug hooks missing (${JSON.stringify(hooks)}): serve the TEST build or the dev server`)

  const load = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0]
    const fcp = performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint')
    const { topbar, ready } = window.__perf
    const res = performance.getEntriesByType('resource')
    const upTo = (t) => {
      const list = res.filter((r) => r.responseEnd <= t)
      return { count: list.length, decoded: list.reduce((s, r) => s + (r.decodedBodySize || 0), 0), transfer: list.reduce((s, r) => s + (r.transferSize || 0), 0), names: list.map((r) => r.name) }
    }
    const canvas = document.querySelector('canvas')
    let renderer = null
    try {
      const gl = canvas?.getContext('webgl2')
      const ext = gl?.getExtension('WEBGL_debug_renderer_info')
      renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null
    } catch {
      /* ignore */
    }
    return {
      renderer,
      topbarDom: window.__perf.topbarDom,
      dcl: nav?.domContentLoadedEventEnd ?? null,
      loadEvent: nav?.loadEventEnd ?? null,
      fcp: fcp?.startTime ?? null,
      topbar,
      ready,
      beforeTopbar: upTo(topbar ?? 0),
      beforeReady: upTo(ready ?? performance.now()),
      firstUi: Math.max(topbar ?? 0, fcp?.startTime ?? 0),
      shaderAtReady: window.__perf.shaderAtReady,
      // Frame gaps before ready: the longest stretch with no rendered frame (page frozen: no loading animation, clicks
      // wait) and the total time spent in frames longer than 100 ms. (The Long Tasks API misses rAF work, so not used.)
      gaps: (() => {
        const ft = window.__perf.ft.slice(0, window.__perf.ftAtReady ?? window.__perf.ft.length)
        return { frames: ft.length, maxMs: ft.reduce((a, x) => Math.max(a, x), 0), over100Ms: ft.filter((x) => x > 100).reduce((a, x) => a + x, 0), over1s: ft.filter((x) => x > 1000).length }
      })(),
      modules: Object.fromEntries(Object.entries(window.__perf.modules).map(([k, v]) => [k, Math.round(v)])),
      heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
      canvas: canvas ? [canvas.width, canvas.height] : null,
    }
  })
  // gzip bytes of the hashed assets fetched, when --dist is the build being served
  if (sizes) {
    const byName = new Map(sizes.files.map((f) => [f.file, f]))
    for (const k of ['beforeTopbar', 'beforeReady']) {
      const assets = load[k].names.filter((n) => new URL(n).pathname.includes('/assets/'))
      const matched = assets.map((n) => byName.get(basename(new URL(n).pathname))).filter(Boolean)
      // only meaningful when --dist is the build being served (every fetched hashed asset found)
      load[k].gzipAssets = matched.length && matched.length === assets.length ? matched.reduce((s, f) => s + f.gzip, 0) : null
      load[k].matchedAssets = `${matched.length}/${assets.length}`
    }
  }
  for (const k of ['beforeTopbar', 'beforeReady']) delete load[k].names

  const rows = []
  for (const v of views) {
    const [x, z, yaw] = v.at
    await page.evaluate(([x, z, yaw, c]) => {
      window.__MIW__.ui?.closePanel?.()
      window.__MIW__.player.teleport(x, z, yaw)
      window.__MIW__.camera.set({ yaw, pitch: c.pitch, distance: c.distance, immediate: true })
    }, [x, z, yaw, CAMERA])
    const s0 = await page.evaluate(() => ({ n: window.__perf.frames, shader: { ...window.__perf.shader } }))
    const settle = await waitFrames(page, settleMs, minFrames)
    const f0 = await page.evaluate((s0) => {
      const p = window.__perf
      const n = p.frames - s0.n
      return {
        n: p.frames,
        t: performance.now(),
        busy: p.busy,
        // first-visit hitch: the longest frame after the teleport, and new shader programs linked while settling
        settleMaxFrameMs: n > 0 ? Math.max(...p.ft.slice(-n)) : null,
        settleShaderMs: p.shader.ms - s0.shader.ms,
        settleLinks: p.shader.links - s0.shader.links,
      }
    }, s0)
    Object.assign(settle, { maxFrameMs: f0.settleMaxFrameMs, shaderMs: f0.settleShaderMs, links: f0.settleLinks })
    await waitFrames(page, sampleMs, minFrames)
    const r = await page.evaluate((f0) => {
      const p = window.__perf
      const now = performance.now()
      const n = p.frames - f0.n
      const ft = (n > 0 ? p.ft.slice(-n) : []).sort((a, b) => a - b)
      const q = (x) => (ft.length ? ft[Math.min(ft.length - 1, Math.floor(x * ft.length))] : null)
      return {
        frames: p.frames - f0.n,
        seconds: (now - f0.t) / 1000,
        fps: ((p.frames - f0.n) * 1000) / (now - f0.t),
        p50ms: q(0.5),
        p95ms: q(0.95),
        cpuMs: n > 0 ? (p.busy - f0.busy) / n : null,
        stats: window.__MIW__.perf.stats(),
        player: window.__MIW__.player.getState?.()?.position ?? null,
        interior: window.__MIW__.camera.getState?.()?.interior ?? null,
      }
    }, f0)
    rows.push({ view: v.id, name: v.name, at: v.at, settle, ...r })
    log({ quality, view: v.id, fps: round(r.fps), calls: r.stats.calls, tris: r.stats.triangles, p95: round(r.p95ms) })
  }
  await context.close()
  return { quality, url, wallReadyMs: wallReady, load, rows, errors: errors.slice(0, 20) }
}

function mdSizes(s) {
  const out = []
  out.push(`Bundle: \`${s.dist}/assets\` — ${s.total.count} files, ${kb(s.total.raw)} KiB raw, ${kb(s.total.gzip)} KiB gzip, ${kb(s.total.brotli)} KiB brotli`)
  out.push(`Loaded up front by index.html (${s.upfront.files.length} files): ${kb(s.upfront.raw)} KiB raw, ${kb(s.upfront.gzip)} KiB gzip`)
  out.push('')
  out.push('| Kind | Files | Raw KiB | Gzip KiB | Brotli KiB |')
  out.push('|---|---:|---:|---:|---:|')
  for (const [k, v] of Object.entries(s.kinds).sort((a, b) => b[1].raw - a[1].raw)) out.push(`| ${k} | ${v.count} | ${kb(v.raw)} | ${kb(v.gzip)} | ${kb(v.brotli)} |`)
  out.push('')
  out.push('| Largest JS chunks | Raw KiB | Gzip KiB | Brotli KiB | Up front |')
  out.push('|---|---:|---:|---:|:---:|')
  for (const f of s.files.filter((f) => f.kind === 'js').slice(0, 12)) out.push(`| \`${f.file}\` | ${kb(f.raw)} | ${kb(f.gzip)} | ${kb(f.brotli)} | ${s.upfront.files.includes(f.file) ? 'yes' : ''} |`)
  return out.join('\n')
}

function mdTiers(tiers) {
  const out = []
  out.push('| Tier | FCP ms | Top bar (rAF) ms | First UI ms | Ready ms | Shader-blocked ms → ready (programs) | Longest frame gap ms → ready | Time in >100 ms frames → ready | Requests → ready | Decoded KiB → ready | Gzip KiB → ready | JS heap MB |')
  out.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
  for (const t of tiers) {
    const l = t.load
    out.push(`| ${t.quality} | ${round(l.fcp, 0)} | ${round(l.topbar, 0)} | ${round(l.firstUi, 0)} | ${round(l.ready, 0)} | ${round(l.shaderAtReady?.ms, 0)} (${l.shaderAtReady?.links ?? '–'}) | ${round(l.gaps?.maxMs, 0)} | ${round(l.gaps?.over100Ms, 0)} | ${l.beforeReady.count} | ${kb(l.beforeReady.decoded)} | ${kb(l.beforeReady.gzipAssets)} | ${round(l.heapMB, 0)} |`)
  }
  out.push('')
  out.push('| Tier | Viewpoint | FPS | p50 ms | p95 ms | rAF CPU ms/frame | Worst frame after teleport ms (new programs) | Draw calls | Triangles | Geometries | Textures | Programs |')
  out.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
  for (const t of tiers)
    for (const r of t.rows)
      out.push(`| ${t.quality} | ${r.name} | ${round(r.fps)} | ${round(r.p50ms, 0)} | ${round(r.p95ms, 0)} | ${round(r.cpuMs, 1)} | ${round(r.settle.maxFrameMs, 0)} (${r.settle.links}) | ${r.stats.calls} | ${r.stats.triangles.toLocaleString('en-US')} | ${r.stats.geometries} | ${r.stats.textures} | ${r.stats.programs} |`)
  return out.join('\n')
}

// ---------------------------------------------------------------------------------------------------
const env = {
  date: new Date().toISOString(),
  os: `${process.platform} ${release()}`,
  cpu: `${cpus()[0]?.model ?? '?'} × ${cpus().length}`,
  memGB: round(totalmem() / 2 ** 30, 0),
  node: process.version,
  loadavgStart: loadavg().map((x) => round(x, 2)),
}

if (flag('sizes')) {
  const s = bundleSizes(distDir)
  if (!s) throw new Error(`no ${distDir}/assets`)
  console.log(mdSizes(s))
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ env, sizes: s }, null, 1))
  process.exit(0)
}

if (flag('probe')) {
  for (const name of Object.keys(BACKENDS)) console.log(JSON.stringify(await probe(name)))
  process.exit(0)
}

const { name: backend, probes } = await chooseBackend()
const used = probes.find((p) => p.backend === backend)
log({ backend, renderer: used?.renderer })
const sizes = bundleSizes(distDir)
const browser = await launch(backend)
env.browser = browser.version()
const tiers = []
try {
  for (const q of qualities) tiers.push(await measureTier(browser, q, sizes))
  // the renderer string the app itself got (same backend, but confirm on the real page)
} finally {
  await browser.close()
}
env.loadavgEnd = loadavg().map((x) => round(x, 2))

const result = { env, url: base, backend, backendLabel: BACKENDS[backend].label, renderer: used?.renderer ?? null, vendor: used?.vendor ?? null, probes, viewport: [vw, vh], settleMs, sampleMs, tiers, sizes }
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(result, null, 1))

console.log(`Renderer: ${result.renderer} (backend ${backend}: ${result.backendLabel}; ${env.browser})`)
console.log(`Machine: ${env.cpu}, ${env.memGB} GB, ${env.os}; load average ${env.loadavgStart.join(' / ')} → ${env.loadavgEnd.join(' / ')}`)
console.log(`URL: ${base} at ${vw}x${vh} (DPR 1), settle ${settleMs} ms + sample ${sampleMs} ms per viewpoint\n`)
for (const t of tiers) console.log(`App canvas renderer (${t.quality}): ${t.load.renderer}`)
for (const t of tiers) console.log(`Module slots ready (ms, ${t.quality}): ${Object.entries(t.load.modules).sort((a, b) => a[1] - b[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`)
console.log('')
console.log(mdTiers(tiers))
if (sizes) console.log('\n' + mdSizes(sizes))
for (const t of tiers) if (t.errors.length) console.log(`\nErrors (${t.quality}):\n- ${t.errors.join('\n- ')}`)
