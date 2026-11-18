/**
 * Shared helpers for the §12 e2e specs.
 *
 * - The game is driven through the test build's `window.__MIW__` debug hooks (see
 *   src/core/debug.ts and each module's registerDebug call).
 * - Headless Chromium renders with SwiftShader at ~1–5 fps: never assert on wall-clock animation
 *   timing; poll state with generous timeouts and fast-forward sim time with __MIW__.clock.advance.
 */
import { expect, test, type Browser, type BrowserContextOptions, type ConsoleMessage, type Page, type TestInfo } from '@playwright/test'

declare global {
  interface Window {
    // Debug hook root (test build only). Typed loosely on purpose: specs read what they need.
    __MIW__: any
    /** Counters installed by init scripts (WebGL / AudioContext creation). */
    __e2e?: { webgl: number; audioContexts: number }
  }
}

/** Default game query: low quality, no involuntary ambient events, seeded outcomes. */
export const GAME_QUERY = 'quality=low&noevents=1&seed=7'
export const READY_TIMEOUT = 240_000

export type Vec3 = [number, number, number]

export interface PlayerState {
  position: Vec3
  facing: number
  speed: number
  mode: string
  grounded: boolean
  locked: string[]
  visible: boolean
  target: string | null
}

export interface CameraState {
  type: string
  isPerspective: boolean
  fov: number
  position: Vec3
  yaw: number
  pitch: number
  distance: number
  targetDistance: number
  allowed: number
  follow: string
  workerOnScreen: boolean
  interior: string | null
}

// ---------------------------------------------------------------- console / runtime errors

/**
 * Known third-party noise that is not a product error (deprecation notices printed by
 * three.js / Rapier, and Chromium's own GPU driver chatter under SwiftShader).
 */
const IGNORED = [
  /THREE\.Clock/i,
  /deprecated parameters for the initialization function/i,
  /using deprecated parameters/i,
  /GL Driver Message/i,
  /GPU stall due to ReadPixels/i,
  /Automatic fallback to software WebGL has been deprecated/i,
  // Environment, not product: WSL/host network interfaces flapping aborts in-flight requests.
  // gotoGame() reloads when this breaks the boot.
  /net::ERR_NETWORK_CHANGED/i,
]

export interface ErrorLog {
  /** Everything collected so far (errors + page errors), minus ignored noise. */
  all: string[]
  /** Return and clear the errors collected since the last call. */
  take(): string[]
}

/** Collect console errors and uncaught page errors for a page. */
export function trackErrors(page: Page): ErrorLog {
  const all: string[] = []
  let cursor = 0
  const push = (text: string) => {
    if (IGNORED.some((re) => re.test(text))) return
    all.push(text.slice(0, 600))
  }
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') push(`console.error: ${m.text()}`)
  })
  page.on('pageerror', (e) => push(`pageerror: ${e.message}`))
  return {
    all,
    take() {
      const out = all.slice(cursor)
      cursor = all.length
      return out
    },
  }
}

/** Debug-root errors (`__MIW__.errors`) and module slots that reported 'error'. */
export async function debugErrors(page: Page): Promise<{ errors: string[]; failedModules: string[] }> {
  return page.evaluate(() => {
    const r = window.__MIW__
    if (!r) return { errors: [], failedModules: [] }
    const modules = (r.modules ?? {}) as Record<string, string>
    return {
      errors: [...((r.errors ?? []) as string[])],
      failedModules: Object.entries(modules)
        .filter(([, v]) => v === 'error')
        .map(([k]) => k),
    }
  })
}

/** Assert no console/page errors since the last check and no module/debug errors. */
export async function expectNoRuntimeErrors(page: Page, log: ErrorLog): Promise<void> {
  const fresh = log.take()
  expect(fresh, 'console errors / uncaught exceptions').toEqual([])
  if (page.isClosed()) return
  const dbg = await debugErrors(page).catch(() => ({ errors: [], failedModules: [] }))
  expect(dbg.failedModules, 'module slots in error state').toEqual([])
  expect(dbg.errors, '__MIW__.errors').toEqual([])
}

// ---------------------------------------------------------------- init scripts

/**
 * Counts WebGL context and AudioContext creation (window.__e2e). With `blockWebGL`, every
 * webgl/webgl2/experimental-webgl getContext call returns null (simulates no WebGL support).
 */
export async function installProbes(page: Page, opts: { blockWebGL?: boolean } = {}): Promise<void> {
  await page.addInitScript((block: boolean) => {
    const probe = { webgl: 0, audioContexts: 0 }
    Object.defineProperty(window, '__e2e', { value: probe, configurable: true })
    const orig = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (/webgl/i.test(type)) {
        if (block) return null
        probe.webgl++
      }
      return (orig as (this: HTMLCanvasElement, ...a: unknown[]) => unknown).call(this, type, ...rest)
    } as typeof HTMLCanvasElement.prototype.getContext
    if (block) {
      try {
        // OffscreenCanvas could also provide WebGL; make it consistent.
        const off = (globalThis as unknown as { OffscreenCanvas?: { prototype: { getContext: unknown } } }).OffscreenCanvas
        if (off) {
          const o = off.prototype.getContext as (this: unknown, type: string, ...rest: unknown[]) => unknown
          off.prototype.getContext = function (this: unknown, type: string, ...rest: unknown[]) {
            if (/webgl/i.test(type)) return null
            return o.call(this, type, ...rest)
          }
        }
      } catch {
        /* ignore */
      }
    }
    for (const name of ['AudioContext', 'webkitAudioContext'] as const) {
      const w = window as unknown as Record<string, unknown>
      const Ctor = w[name] as (new (...a: unknown[]) => object) | undefined
      if (typeof Ctor !== 'function') continue
      const Wrapped = class extends (Ctor as new (...a: unknown[]) => object) {
        constructor(...a: unknown[]) {
          super(...a)
          probe.audioContexts++
        }
      }
      w[name] = Wrapped
    }
  }, !!opts.blockWebGL)
}

// ---------------------------------------------------------------- boot

/**
 * A page that lives for a whole spec file (created in beforeAll). `browser.newPage()` would not
 * inherit the project's `use` options, so copy the ones that matter (base URL, device emulation).
 */
export async function sharedPage(browser: Browser, info: TestInfo, extra: BrowserContextOptions = {}): Promise<Page> {
  const u = info.project.use
  const ctx = await browser.newContext({
    baseURL: u.baseURL,
    viewport: u.viewport ?? undefined,
    deviceScaleFactor: u.deviceScaleFactor,
    isMobile: u.isMobile,
    hasTouch: u.hasTouch,
    userAgent: u.userAgent,
    ...extra,
  })
  return ctx.newPage()
}

/**
 * Load the 3D factory and wait until every module slot reported ready.
 * `query` replaces the default GAME_QUERY (pass '' for none).
 */
export async function gotoGame(page: Page, query: string = GAME_QUERY, needs: string[] = []): Promise<void> {
  // A host network-interface change aborts in-flight module requests (net::ERR_NETWORK_CHANGED);
  // the app then never reports ready. That is an environment glitch: reload (at most twice).
  let changedAt = 0
  const onFail = (r: { failure(): { errorText: string } | null }) => {
    if (/ERR_NETWORK_CHANGED/.test(r.failure()?.errorText ?? '')) changedAt = changedAt || Date.now()
  }
  page.on('requestfailed', onFail)
  try {
    for (let attempt = 0; ; attempt++) {
      changedAt = 0
      await page.goto(`/${query ? `?${query}` : ''}`, { waitUntil: 'domcontentloaded' })
      const deadline = Date.now() + READY_TIMEOUT
      let ready = false
      let retry = false
      while (!ready && Date.now() < deadline) {
        ready = await page.evaluate(() => window.__MIW__?.ready === true).catch(() => false)
        if (ready) break
        // give a half-broken boot 30 s to recover before reloading
        if (changedAt && attempt < 2 && Date.now() - changedAt > 30_000) {
          retry = true
          break
        }
        await page.waitForTimeout(1000)
      }
      if (ready) break
      if (retry) continue
      throw new Error(`the 3D world did not report ready within ${READY_TIMEOUT} ms`)
    }
  } finally {
    page.off('requestfailed', onFail)
  }
  const required = ['player.getState', 'camera.getState', 'ui.getState', 'core.counts', 'clock.advance', ...needs]
  await page.waitForFunction(
    (paths: string[]) =>
      paths.every((p) => {
        let cur: unknown = window.__MIW__
        for (const k of p.split('.')) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[k] : undefined
        return typeof cur === 'function'
      }),
    required,
    { timeout: 120_000, polling: 500 },
  )
  // The loading screen fades out after 'ready'.
  await expect(page.getByTestId('loading-screen')).toHaveCount(0, { timeout: 60_000 })
}

/** Wait for `n` rendered frames (requestAnimationFrame ticks). */
export async function frames(page: Page, n = 2): Promise<void> {
  await page.evaluate(
    (count: number) =>
      new Promise<void>((resolve) => {
        let left = count
        const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick))
        requestAnimationFrame(tick)
      }),
    n,
  )
}

// ---------------------------------------------------------------- player / camera

export const playerState = (page: Page): Promise<PlayerState> => page.evaluate(() => window.__MIW__.player.getState())
export const cameraState = (page: Page): Promise<CameraState> => page.evaluate(() => window.__MIW__.camera.getState())
export const uiState = (page: Page): Promise<{ panel: { id: string } | null; dialogue: unknown; prompt: { id: string; verb: string; label: string } | null; routeTarget: string | null }> =>
  page.evaluate(() => window.__MIW__.ui.getState())

export const dist2 = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** Teleport the worker and wait until the controller reports the new position. */
export async function teleport(page: Page, x: number, z: number, yaw: number): Promise<PlayerState> {
  await expect
    .poll(async () => page.evaluate(([px, pz, py]) => window.__MIW__.player.teleport(px, pz, py) as boolean, [x, z, yaw] as const), {
      message: 'player.teleport accepted',
      timeout: 30_000,
    })
    .toBe(true)
  let last: PlayerState | null = null
  await expect
    .poll(
      async () => {
        last = await playerState(page)
        return dist2([last.position[0], last.position[2]], [x, z])
      },
      { message: `worker at (${x}, ${z})`, timeout: 30_000 },
    )
    .toBeLessThan(0.3)
  return last as unknown as PlayerState
}

/** Set the orbit camera immediately and wait for it to report the new yaw/pitch/zoom. */
export async function setCamera(page: Page, opts: { yaw?: number; pitch?: number; distance?: number }): Promise<CameraState> {
  await page.evaluate((o) => window.__MIW__.camera.set({ ...o, immediate: true }), opts)
  let cam: CameraState | null = null
  await expect
    .poll(
      async () => {
        cam = await cameraState(page)
        return opts.yaw === undefined ? 0 : Math.abs(angleDiff(cam.yaw, opts.yaw))
      },
      { timeout: 30_000 },
    )
    .toBeLessThan(0.02)
  return cam as unknown as CameraState
}

/** Smallest signed difference a − b, wrapped to (−π, π]. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d <= -Math.PI) d += Math.PI * 2
  return d
}

/** forward(yaw) on the ground plane (ARCHITECTURE §2: yaw 0 = north = −Z). */
export const forwardXZ = (yaw: number): [number, number] => [-Math.sin(yaw), -Math.cos(yaw)]

/** Wait until the worker has stopped moving (speed ~0 over consecutive samples). */
export async function waitStill(page: Page): Promise<PlayerState> {
  let prev: PlayerState | null = null
  let still = 0
  let last: PlayerState | null = null
  await expect
    .poll(
      async () => {
        last = await playerState(page)
        const p = prev as PlayerState | null
        const moved = p ? dist2([p.position[0], p.position[2]], [last.position[0], last.position[2]]) : 1
        prev = last
        still = moved < 0.01 && Math.abs(last.speed) < 0.05 ? still + 1 : 0
        return still
      },
      { timeout: 60_000, intervals: [250] },
    )
    .toBeGreaterThanOrEqual(2)
  return last as unknown as PlayerState
}

/**
 * Hold keys (real keyboard events) until the worker has moved `minDistance` meters from where
 * it started (frame-rate independent), then release. Returns the start and end states.
 */
export async function holdUntilMoved(page: Page, keys: string[], minDistance = 0.9, timeout = 60_000): Promise<{ start: PlayerState; end: PlayerState }> {
  const start = await playerState(page)
  for (const k of keys) await page.keyboard.down(k)
  try {
    await expect
      .poll(
        async () => {
          const s = await playerState(page)
          return dist2([s.position[0], s.position[2]], [start.position[0], start.position[2]])
        },
        { timeout, intervals: [100] },
      )
      .toBeGreaterThanOrEqual(minDistance)
  } finally {
    for (const k of [...keys].reverse()) await page.keyboard.up(k)
  }
  const end = await waitStill(page)
  return { start, end }
}

/** Hold keys for a fixed number of rendered frames (used where the worker should NOT move far). */
export async function holdForFrames(page: Page, keys: string[], n: number): Promise<void> {
  for (const k of keys) await page.keyboard.down(k)
  try {
    await frames(page, n)
  } finally {
    for (const k of [...keys].reverse()) await page.keyboard.up(k)
  }
}

/** Close any open panel / dialogue so world input reaches the player. */
export async function closeOverlays(page: Page): Promise<void> {
  await page.evaluate(() => window.__MIW__.ui.closePanel())
  await expect.poll(async () => (await uiState(page)).panel).toBeNull()
}

/** Advance simulation time in chunks (keeps each evaluate short). */
export async function advance(page: Page, seconds: number, chunk = 5): Promise<void> {
  let left = seconds
  while (left > 1e-6) {
    const s = Math.min(chunk, left)
    await page.evaluate((v: number) => window.__MIW__.clock.advance(v), s)
    left -= s
  }
}

// ---------------------------------------------------------------- per-file game page

export interface GamePage {
  page: Page
  log: ErrorLog
}

/**
 * Register beforeAll/afterAll/afterEach hooks that boot ONE game page for the whole spec file
 * (SwiftShader boot is slow) and fail any test that produced console errors / page errors /
 * module errors. If a test fails, Playwright restarts the worker and beforeAll boots a fresh page,
 * so every test must set up its own preconditions.
 */
export function useGamePage(opts: { query?: string; reducedMotion?: boolean; probes?: boolean; needs?: string[] } = {}): GamePage {
  const g = {} as GamePage
  test.beforeAll(async ({ browser }, info) => {
    info.setTimeout(READY_TIMEOUT + 120_000)
    g.page = await sharedPage(browser, info, opts.reducedMotion ? { reducedMotion: 'reduce' } : {})
    g.log = trackErrors(g.page)
    if (opts.probes) await installProbes(g.page)
    await gotoGame(g.page, opts.query ?? GAME_QUERY, opts.needs ?? [])
  })
  test.afterAll(async () => {
    await g.page?.context().close()
  })
  test.afterEach(async () => {
    if (!g.page || g.page.isClosed()) return
    for (const k of ['Shift', 'KeyW', 'KeyA', 'KeyS', 'KeyD']) await g.page.keyboard.up(k).catch(() => {})
    await expectNoRuntimeErrors(g.page, g.log)
  })
  return g
}
