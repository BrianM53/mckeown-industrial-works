/**
 * §12.5 movement + bounds, §12.6 third-person camera, §12.7 interaction, §12.3 directory travel
 * in the 3D world. One game page for the whole file (SwiftShader boot is slow).
 */
import { expect, test, type Page } from '@playwright/test'
import {
  angleDiff,
  cameraState,
  closeOverlays,
  dist2,
  expectNoRuntimeErrors,
  forwardXZ,
  frames,
  gotoGame,
  holdForFrames,
  holdUntilMoved,
  playerState,
  setCamera,
  sharedPage,
  teleport,
  trackErrors,
  uiState,
  waitStill,
  type CameraState,
  type ErrorLog,
} from './helpers'

let page: Page
let log: ErrorLog

test.beforeAll(async ({ browser }, info) => {
  page = await sharedPage(browser, info)
  log = trackErrors(page)
  await gotoGame(page)
})
test.afterAll(async () => {
  await page?.context().close()
})
test.afterEach(async () => {
  await page.keyboard.up('Shift').catch(() => {})
  await expectNoRuntimeErrors(page, log)
})

const DEG = Math.PI / 180
/** Angle (rad) between two ground-plane vectors. */
const between = (a: [number, number], b: [number, number]) => {
  const dot = a[0] * b[0] + a[1] * b[1]
  return Math.acos(Math.max(-1, Math.min(1, dot / (Math.hypot(...a) * Math.hypot(...b)))))
}

/** Drag across the canvas centre with the mouse (orbit). Positive dx = drag right. */
async function dragOrbit(p: Page, dx: number, dy = 0): Promise<void> {
  const vp = p.viewportSize() ?? { width: 1280, height: 720 }
  const x0 = Math.round(vp.width / 2 - dx / 2)
  const y0 = Math.round(vp.height / 2 - dy / 2)
  await p.mouse.move(x0, y0)
  await p.mouse.down({ button: 'left' })
  await p.mouse.move(x0 + dx, y0 + dy, { steps: 12 })
  await p.mouse.up({ button: 'left' })
}

/** Wait until the camera yaw stops changing (orbit smoothing done). */
async function settledCamera(p: Page): Promise<CameraState> {
  let prev: CameraState | null = null
  let cam: CameraState | null = null
  await expect
    .poll(
      async () => {
        cam = await cameraState(p)
        const pv = prev as CameraState | null
        const d = pv ? Math.abs(angleDiff(cam.yaw, pv.yaw)) + Math.abs(cam.pitch - pv.pitch) + Math.abs(cam.distance - pv.distance) : 1
        prev = cam
        return d
      },
      { timeout: 60_000, intervals: [400] },
    )
    .toBeLessThan(0.003)
  return cam as unknown as CameraState
}

test.describe('§12.6 third-person camera', () => {
  test('§12.6 default view is a perspective third-person camera at human scale (not top-down/isometric)', async () => {
    const cam = await cameraState(page)
    const pl = await playerState(page)
    expect(cam.type).toBe('PerspectiveCamera')
    expect(cam.isPerspective).toBe(true)
    expect(cam.fov).toBeGreaterThanOrEqual(40)
    expect(cam.fov).toBeLessThanOrEqual(75)
    expect(cam.follow).toBe('player')
    expect(cam.distance).toBeGreaterThanOrEqual(2.2)
    expect(cam.distance).toBeLessThanOrEqual(9)
    // shoulder-height chase camera: shallow pitch, a few meters above the worker's feet
    expect(cam.pitch).toBeLessThan(35 * DEG)
    const height = cam.position[1] - pl.position[1]
    expect(height).toBeGreaterThan(0.8)
    expect(height).toBeLessThan(5)
    const horiz = dist2([cam.position[0], cam.position[2]], [pl.position[0], pl.position[2]])
    expect(horiz).toBeGreaterThan(2)
    expect(horiz).toBeGreaterThan(height) // looking across the floor, not down at it
    expect(cam.workerOnScreen).toBe(true)
    // camera sits behind the worker: camera → worker points along the camera yaw's forward
    const toWorker: [number, number] = [pl.position[0] - cam.position[0], pl.position[2] - cam.position[2]]
    expect(between(toWorker, forwardXZ(cam.yaw))).toBeLessThan(10 * DEG)
  })

  test('§12.6 mouse drag orbits a full 360° around the worker', async () => {
    await closeOverlays(page)
    await teleport(page, 0, 21.5, 0)
    let cam = await settledCamera(page)
    const startYaw = cam.yaw
    let total = 0
    for (let i = 0; i < 4; i++) {
      const before = cam.yaw
      await dragOrbit(page, 302) // 0.0052 rad/px → ~90°
      cam = await settledCamera(page)
      const step = angleDiff(cam.yaw, before)
      expect(Math.abs(step), `quarter turn ${i + 1}`).toBeGreaterThan(60 * DEG)
      expect(Math.abs(step), `quarter turn ${i + 1}`).toBeLessThan(120 * DEG)
      total += step
      expect(cam.workerOnScreen, `worker on screen after quarter ${i + 1}`).toBe(true)
      expect(cam.isPerspective).toBe(true)
    }
    expect(Math.abs(total)).toBeGreaterThan(300 * DEG)
    expect(Math.abs(total)).toBeLessThan(420 * DEG)
    expect(Math.abs(angleDiff(cam.yaw, startYaw + total))).toBeLessThan(0.05)
    // vertical drag pitches the camera within its limits (never flips to top-down)
    await dragOrbit(page, 0, 400)
    cam = await settledCamera(page)
    expect(cam.pitch).toBeGreaterThanOrEqual(-20 * DEG - 0.01)
    expect(cam.pitch).toBeLessThanOrEqual(65 * DEG + 0.01)
    await dragOrbit(page, 0, -1200)
    cam = await settledCamera(page)
    expect(cam.pitch).toBeGreaterThanOrEqual(-20 * DEG - 0.01)
    expect(cam.workerOnScreen).toBe(true)
  })

  test('§12.6 WASD stays camera-relative after orbiting with the mouse', async () => {
    await closeOverlays(page)
    await teleport(page, 0, 21.5, 0)
    await setCamera(page, { yaw: 0, pitch: 10 * DEG })
    await dragOrbit(page, -200) // orbit ~60° without the debug hook
    const cam = await settledCamera(page)
    expect(Math.abs(cam.yaw)).toBeGreaterThan(30 * DEG)
    const { start, end } = await holdUntilMoved(page, ['KeyW'])
    const d: [number, number] = [end.position[0] - start.position[0], end.position[2] - start.position[2]]
    expect(between(d, forwardXZ(cam.yaw))).toBeLessThan(20 * DEG)
  })

  test('§12.6 mouse wheel zooms between the near and far limits', async () => {
    await closeOverlays(page)
    await teleport(page, 0, 21.5, 0)
    await setCamera(page, { yaw: 0, pitch: 10 * DEG, distance: 5.5 })
    const vp = page.viewportSize() ?? { width: 1280, height: 720 }
    await page.mouse.move(vp.width / 2, vp.height / 2)
    // one wheel event zooms a bounded step, so scroll in notches like a real wheel
    const wheelUntil = async (dy: number, done: (c: CameraState) => boolean) => {
      for (let i = 0; i < 20; i++) {
        const c = await cameraState(page)
        if (done(c)) return c
        await page.mouse.wheel(0, dy)
        await frames(page, 1)
      }
      return cameraState(page)
    }
    let c = await wheelUntil(400, (x) => x.targetDistance >= 8.99) // zoom out
    expect(c.targetDistance).toBeGreaterThan(8.9)
    expect(c.targetDistance).toBeLessThanOrEqual(9.001)
    await expect.poll(async () => (await cameraState(page)).distance, { timeout: 60_000 }).toBeGreaterThan(8.5)
    await page.mouse.wheel(0, 400) // past the limit: clamps
    await frames(page, 2)
    expect((await cameraState(page)).targetDistance).toBeLessThanOrEqual(9.001)
    expect((await cameraState(page)).distance).toBeLessThanOrEqual(9.01)
    c = await wheelUntil(-400, (x) => x.targetDistance <= 2.21) // zoom in
    expect(c.targetDistance).toBeLessThan(2.3)
    expect(c.targetDistance).toBeGreaterThanOrEqual(2.199)
    await expect.poll(async () => (await cameraState(page)).distance, { timeout: 60_000 }).toBeLessThan(2.6)
    const cam = await cameraState(page)
    expect(cam.distance).toBeGreaterThanOrEqual(2.19)
    expect(cam.isPerspective).toBe(true)
    // keyboard zoom (-) also works
    await holdForFrames(page, ['Minus'], 4)
    await expect.poll(async () => (await cameraState(page)).targetDistance, { timeout: 30_000 }).toBeGreaterThan(2.3)
    await page.evaluate(() => window.__MIW__.camera.set({ distance: 5.5, immediate: true }))
  })

  test('§12.6 spring arm pulls the camera in front of the perimeter wall', async () => {
    await closeOverlays(page)
    // facing west next to the east wall (x = 50): the boom behind the worker points into the wall
    await teleport(page, 48.4, 0, Math.PI / 2)
    await setCamera(page, { yaw: Math.PI / 2, pitch: 10 * DEG, distance: 5.5 })
    await expect.poll(async () => (await cameraState(page)).distance, { timeout: 60_000 }).toBeLessThan(2.5)
    const cam = await cameraState(page)
    expect(cam.targetDistance).toBeGreaterThan(5)
    expect(cam.position[0]).toBeLessThan(50)
    expect(cam.workerOnScreen).toBe(true)
    // stepping away from the wall lets the boom ease back out
    await teleport(page, 40, 0, Math.PI / 2)
    await expect.poll(async () => (await cameraState(page)).distance, { timeout: 90_000 }).toBeGreaterThan(5)
  })

  test('§12.6 indoors the camera stays inside, with a shorter boom under the eaves', async () => {
    await closeOverlays(page)
    // Personnel Office: footprint x 7..17, z 24..34, eave 6 m
    await teleport(page, 9.5, 31, Math.PI)
    await page.evaluate(() => window.__MIW__.camera.set({ yaw: Math.PI, pitch: 30 * (Math.PI / 180), distance: 9, immediate: true }))
    await expect.poll(async () => (await page.evaluate(() => window.__MIW__.core.runtime().interior)) as string | null, { timeout: 30_000 }).toBe('personnel')
    await expect.poll(async () => (await cameraState(page)).distance, { timeout: 60_000 }).toBeLessThanOrEqual(4.25)
    const cam = await settledCamera(page)
    expect(cam.interior).toBe('personnel')
    expect(cam.distance).toBeLessThanOrEqual(4.25)
    expect(cam.position[1]).toBeLessThan(6 - 0.4 + 0.05)
    expect(cam.position[0]).toBeGreaterThan(7)
    expect(cam.position[0]).toBeLessThan(17)
    expect(cam.position[2]).toBeGreaterThan(24)
    expect(cam.position[2]).toBeLessThan(34)
    expect(cam.workerOnScreen).toBe(true)
    // back outside: interior clears
    await teleport(page, 0, 21.5, 0)
    await expect.poll(async () => (await page.evaluate(() => window.__MIW__.core.runtime().interior)) as string | null, { timeout: 30_000 }).toBeNull()
  })

  test('§12.6 C recenters the camera behind the worker', async () => {
    await closeOverlays(page)
    const yaw = 0.4
    await teleport(page, 0, 21.5, yaw)
    await setCamera(page, { yaw, pitch: 10 * DEG })
    await dragOrbit(page, 260) // ~77° away
    const away = await settledCamera(page)
    expect(Math.abs(angleDiff(away.yaw, yaw))).toBeGreaterThan(45 * DEG)
    await page.keyboard.press('KeyC')
    await expect.poll(async () => Math.abs(angleDiff((await cameraState(page)).yaw, yaw)), { timeout: 60_000 }).toBeLessThan(0.06)
    const pl = await playerState(page)
    expect(Math.abs(angleDiff(pl.facing, yaw))).toBeLessThan(0.05)
  })
})

test.describe('§12.5 player movement', () => {
  const CASES: { keys: string[]; offset: number; name: string }[] = [
    { name: 'W (forward)', keys: ['KeyW'], offset: 0 },
    { name: 'S (back)', keys: ['KeyS'], offset: Math.PI },
    { name: 'A (left)', keys: ['KeyA'], offset: Math.PI / 2 },
    { name: 'D (right)', keys: ['KeyD'], offset: -Math.PI / 2 },
    { name: 'W+A', keys: ['KeyW', 'KeyA'], offset: Math.PI / 4 },
    { name: 'W+D', keys: ['KeyW', 'KeyD'], offset: -Math.PI / 4 },
    { name: 'S+A', keys: ['KeyS', 'KeyA'], offset: (3 * Math.PI) / 4 },
    { name: 'S+D', keys: ['KeyS', 'KeyD'], offset: (-3 * Math.PI) / 4 },
  ]

  test('§12.5 keyboard moves the worker in 4 cardinal + 4 diagonal directions relative to the camera', async () => {
    await closeOverlays(page)
    const camYaw = 0.6 // deliberately not aligned with the world axes
    const report: string[] = []
    for (const c of CASES) {
      await teleport(page, 0, 21.5, camYaw)
      const cam = await setCamera(page, { yaw: camYaw, pitch: 10 * DEG })
      await waitStill(page)
      const { start, end } = await holdUntilMoved(page, c.keys)
      const d: [number, number] = [end.position[0] - start.position[0], end.position[2] - start.position[2]]
      const want = forwardXZ(cam.yaw + c.offset)
      const err = between(d, want)
      report.push(`${c.name}: moved (${d[0].toFixed(2)}, ${d[1].toFixed(2)}) want (${want[0].toFixed(2)}, ${want[1].toFixed(2)}) err ${(err / DEG).toFixed(1)}°`)
      expect(err, report.join('\n')).toBeLessThan(20 * DEG)
      const camAfter = await cameraState(page)
      expect(camAfter.workerOnScreen, `${c.name}: camera keeps the worker in view`).toBe(true)
    }
    test.info().annotations.push({ type: 'directions', description: report.join(' | ') })
  })

  test('§12.5 arrow keys and Shift-run also move the worker', async () => {
    await closeOverlays(page)
    await teleport(page, 0, 21.5, 0)
    await setCamera(page, { yaw: 0, pitch: 10 * DEG })
    const { start, end } = await holdUntilMoved(page, ['ArrowLeft'])
    const d: [number, number] = [end.position[0] - start.position[0], end.position[2] - start.position[2]]
    expect(between(d, forwardXZ(Math.PI / 2))).toBeLessThan(20 * DEG) // left of north = west
    // Shift = run: faster than walking
    await teleport(page, 0, 21.5, -Math.PI / 2)
    await setCamera(page, { yaw: -Math.PI / 2, pitch: 10 * DEG })
    await page.keyboard.down('Shift')
    await page.keyboard.down('KeyW')
    let top = 0
    try {
      await expect
        .poll(
          async () => {
            top = Math.max(top, Math.abs((await playerState(page)).speed))
            return top
          },
          { timeout: 60_000, intervals: [100] },
        )
        .toBeGreaterThan(4.6) // walk 4.2 m/s, run 7.2 m/s
    } finally {
      await page.keyboard.up('KeyW')
      await page.keyboard.up('Shift')
    }
    await waitStill(page)
  })

  test('§12.5 the worker cannot leave the world bounds (perimeter walls)', async () => {
    await closeOverlays(page)
    // Perimeter walls stand on WORLD_BOUNDS (x ±50, z −48 / 40); the controller also clamps the
    // worker to PLAYABLE_BOUNDS (x ±49, z −47 / 39). Start 2 m inside and run at each edge.
    const walls: { name: string; at: [number, number]; yaw: number; ok: (x: number, z: number) => boolean }[] = [
      { name: 'east (x=50)', at: [47, 0], yaw: -Math.PI / 2, ok: (x) => x <= 49.05 },
      { name: 'west (x=-50)', at: [-47, 0], yaw: Math.PI / 2, ok: (x) => x >= -49.05 },
      { name: 'north (z=-48)', at: [0, -45], yaw: 0, ok: (_x, z) => z >= -47.05 },
      { name: 'south (z=40)', at: [20, 37], yaw: Math.PI, ok: (_x, z) => z <= 39.05 },
    ]
    for (const w of walls) {
      await teleport(page, w.at[0], w.at[1], w.yaw)
      await setCamera(page, { yaw: w.yaw, pitch: 10 * DEG })
      // run into the wall for a good while (≥ 8 frames ≈ several meters of attempted travel)
      await page.keyboard.down('Shift')
      await holdForFrames(page, ['KeyW'], 10)
      await page.keyboard.up('Shift')
      const s = await waitStill(page)
      const [x, , z] = s.position
      expect(w.ok(x, z), `${w.name}: worker at (${x}, ${z})`).toBe(true)
      expect(Number.isFinite(x) && Number.isFinite(z)).toBe(true)
      // it actually reached the edge (proves the keys were held long enough)
      expect(dist2([x, z], w.at), `${w.name}: ran to the edge`).toBeGreaterThan(1.5)
      expect(s.position[1]).toBeGreaterThan(-0.5)
    }
  })
})

test.describe('§12.7 interaction', () => {
  // Résumé-O-Matic: interact point (9.6, 29), radius 2.5, printer to the east.
  test('§12.7 nearby target shows a prompt and E opens its panel; out-of-range targets are ignored', async () => {
    await closeOverlays(page)
    await teleport(page, 9.6, 32.4, Math.PI) // inside the office, 3.4 m from the printer's interact point
    await frames(page, 3)
    await expect.poll(async () => (await uiState(page)).prompt?.id ?? null, { timeout: 15_000 }).not.toBe('station:resume')
    await page.keyboard.press('KeyE')
    await frames(page, 3)
    expect((await uiState(page)).panel?.id ?? null).not.toBe('resume')
    await page.evaluate(() => {
      window.__MIW__.ui.closePanel()
    })

    await teleport(page, 8.6, 29, -Math.PI / 2) // 1 m away, facing the printer
    await expect.poll(async () => (await uiState(page)).prompt?.id ?? null, { timeout: 60_000 }).toBe('station:resume')
    await expect(page.getByTestId('interaction-prompt')).toContainText('Résumé-O-Matic 3000')
    await page.keyboard.press('KeyE')
    await expect(page.getByTestId('panel-resume')).toBeVisible({ timeout: 60_000 })
    expect((await uiState(page)).panel?.id).toBe('resume')
  })

  test('§12.7 interaction and movement do not activate through an open overlay', async () => {
    await closeOverlays(page)
    await teleport(page, 8.6, 29, -Math.PI / 2)
    await expect.poll(async () => (await uiState(page)).prompt?.id ?? null, { timeout: 60_000 }).toBe('station:resume')
    await page.evaluate(() => window.__MIW__.ui.openPanel('directory'))
    await expect(page.getByTestId('panel-directory')).toBeVisible()
    const before = await playerState(page)
    await page.keyboard.press('KeyE')
    await holdForFrames(page, ['KeyW'], 4)
    await frames(page, 2)
    expect((await uiState(page)).panel?.id).toBe('directory')
    await expect(page.getByTestId('panel-resume')).toHaveCount(0)
    const after = await playerState(page)
    expect(dist2([after.position[0], after.position[2]], [before.position[0], before.position[2]])).toBeLessThan(0.05)
    // closing the overlay hands input back to the world
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('panel-directory')).toHaveCount(0)
    await expect.poll(async () => (await uiState(page)).prompt?.id ?? null, { timeout: 60_000 }).toBe('station:resume')
  })
})

test.describe('§12.3 directory reaches the stations in the 3D world', () => {
  const STATIONS: { key: string; name: RegExp; entrance: [number, number] }[] = [
    { key: 'personnel', name: /Personnel Office/, entrance: [4.5, 29] },
    { key: 'control', name: /Control Room/, entrance: [-27, 13] },
    { key: 'radio', name: /Broadcast Booth/, entrance: [27, 11] },
    { key: 'server', name: /Server Hall/, entrance: [-27, -9] },
    { key: 'rec', name: /Recreation Yard/, entrance: [27, -14] },
  ]

  test('§12.3 "Travel there" takes the worker to each of the five principal stations', async () => {
    await closeOverlays(page)
    for (const s of STATIONS) {
      await page.getByTestId('open-directory').click()
      const dest = page.getByTestId(`dest-${s.key}`)
      await expect(dest).toBeVisible()
      await dest.getByRole('button', { name: /^Travel there/ }).click()
      await expect(page.getByTestId('panel-directory')).toHaveCount(0)
      await expect
        .poll(
          async () => {
            const p = await playerState(page)
            return dist2([p.position[0], p.position[2]], s.entrance)
          },
          { message: `arrive at ${s.key}`, timeout: 60_000 },
        )
        .toBeLessThan(1.5)
      // fade finished, worker usable
      await expect.poll(async () => (await playerState(page)).locked.length, { timeout: 30_000 }).toBe(0)
    }
  })
})
