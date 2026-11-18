/**
 * §12.8 Forklift: enter, steer, collide, exit, overturn and R-recover — repeatedly, no softlocks.
 * Real keys (E / W / A / D / R) where the frame rate allows; __MIW__.forklift.drive(throttle, steer, ms)
 * (physics-time, frame-rate independent) for the longer crash runs.
 */
import { expect, test, type Page } from '@playwright/test'
import { dist2, frames, playerState, teleport, uiState, useGamePage, waitStill } from './helpers'

const g = useGamePage({ needs: ['forklift.enter', 'forklift.getState', 'forklift.drive', 'forklift.flip'] })

interface ForkliftState {
  position: [number, number, number]
  yaw: number
  speed: number
  upright: boolean
  upDot: number
  occupied: boolean
  driveLeft: number
  lastImpact: { ago: number; strength: number }
  hint: string | null
}
const fork = (p: Page): Promise<ForkliftState> => p.evaluate(() => window.__MIW__.forklift.getState())
const HOME: [number, number] = [-11, 29]

/** Put the forklift back in its bay, upright and empty, with the worker on foot. */
async function resetForklift(p: Page): Promise<void> {
  await p.evaluate(() => window.__MIW__.ui.closePanel())
  if ((await fork(p)).occupied) {
    await p.evaluate(() => window.__MIW__.forklift.exit())
    await expect.poll(async () => (await playerState(p)).mode, { timeout: 30_000 }).toBe('foot')
  }
  await p.evaluate(() => window.__MIW__.forklift.returnHome())
  await expect
    .poll(async () => {
      const f = await fork(p)
      return f.upright && !f.occupied && dist2([f.position[0], f.position[2]], HOME) < 1
    }, { timeout: 60_000 })
    .toBe(true)
}

/** Walk-up spot on the driver's side (north of the bay spot), facing the forklift. */
async function standNextToForklift(p: Page): Promise<void> {
  await teleport(p, -11.3, 27.3, Math.PI)
  await waitStill(p)
}

async function enterWithE(p: Page): Promise<void> {
  await expect.poll(async () => (await uiState(p)).prompt?.id ?? null, { timeout: 60_000 }).toBe('forklift')
  await p.keyboard.press('KeyE')
  await expect.poll(async () => (await fork(p)).occupied, { timeout: 30_000 }).toBe(true)
  await expect.poll(async () => (await playerState(p)).mode, { timeout: 30_000 }).toBe('forklift')
  await expect.poll(async () => (await p.evaluate(() => window.__MIW__.camera.getState().follow)) as string, { timeout: 30_000 }).toBe('forklift')
}

async function exitWithE(p: Page): Promise<void> {
  await expect.poll(async () => (await uiState(p)).prompt?.id ?? null, { timeout: 60_000 }).toBe('forklift-exit')
  await p.keyboard.press('KeyE')
  await expect.poll(async () => (await fork(p)).occupied, { timeout: 30_000 }).toBe(false)
  await expect.poll(async () => (await playerState(p)).mode, { timeout: 30_000 }).toBe('foot')
  const pl = await playerState(p)
  const f = await fork(p)
  expect(pl.visible).toBe(true)
  expect(pl.locked).toEqual([])
  expect(dist2([pl.position[0], pl.position[2]], [f.position[0], f.position[2]]), 'worker placed beside the forklift').toBeLessThan(3.5)
}

/** Hold keys until the forklift satisfies `done` (real keyboard, frame-rate independent). */
async function holdUntil(p: Page, keys: string[], done: (f: ForkliftState) => boolean, timeout = 90_000): Promise<ForkliftState> {
  for (const k of keys) await p.keyboard.down(k)
  let last: ForkliftState | null = null
  try {
    await expect
      .poll(async () => {
        last = await fork(p)
        return done(last)
      }, { timeout, intervals: [150] })
      .toBe(true)
  } finally {
    for (const k of [...keys].reverse()) await p.keyboard.up(k)
  }
  return last as unknown as ForkliftState
}

async function driveFor(p: Page, throttle: number, steer: number, ms: number): Promise<ForkliftState> {
  await p.evaluate(([t, s, m]) => window.__MIW__.forklift.drive(t, s, m), [throttle, steer, ms] as const)
  await expect.poll(async () => (await fork(p)).driveLeft, { timeout: 120_000 }).toBe(0)
  await frames(p, 2)
  return fork(p)
}

test.describe('§12.8 forklift', () => {
  test('§12.8 enter with E, drive with W, steer with D, exit with E — twice in a row', async () => {
    const p = g.page
    for (let round = 1; round <= 2; round++) {
      await resetForklift(p)
      await standNextToForklift(p)
      await enterWithE(p)
      const f0 = await fork(p)
      // throttle (W): rolls out of the bay
      const f1 = await holdUntil(p, ['KeyW'], (f) => dist2([f.position[0], f.position[2]], [f0.position[0], f0.position[2]]) > 1)
      expect(f1.upright, `round ${round}: still upright after driving`).toBe(true)
      // steer (W + D): heading changes
      const yaw0 = (await fork(p)).yaw
      const f2 = await holdUntil(p, ['KeyW', 'KeyD'], (f) => Math.abs(Math.atan2(Math.sin(f.yaw - yaw0), Math.cos(f.yaw - yaw0))) > 0.25)
      expect(f2.upright).toBe(true)
      // the worker rides along (hidden, locked) while driving
      const pl = await playerState(p)
      expect(pl.mode).toBe('forklift')
      // stop, then exit with E
      await holdUntil(p, ['KeyS'], (f) => Math.abs(f.speed) < 0.3, 60_000).catch(() => undefined)
      await exitWithE(p)
    }
  })

  test('§12.8 the forklift collides with props and walls instead of passing through them', async () => {
    const p = g.page
    await resetForklift(p)
    await standNextToForklift(p)
    expect(await p.evaluate(() => window.__MIW__.forklift.enter())).toBe(true)
    await expect.poll(async () => (await playerState(p)).mode, { timeout: 30_000 }).toBe('forklift')
    // ram the warehouse box pyramid (props) from the east
    const props0 = (await p.evaluate(() => window.__MIW__.forklift.props())) as { bumps: number; displaced: unknown[] }
    await p.evaluate(() => window.__MIW__.forklift.teleport(-36.6, 30, Math.PI / 2))
    await frames(p, 2)
    await driveFor(p, 1, 0, 1800)
    const props1 = (await p.evaluate(() => window.__MIW__.forklift.props())) as { bumps: number; displaced: unknown[] }
    expect(props1.bumps > props0.bumps || props1.displaced.length > props0.displaced.length, `props bumped: ${JSON.stringify({ props0, props1 })}`).toBe(true)
    // floor it into the east perimeter wall (x = 50): it stops at the wall
    await p.evaluate(() => window.__MIW__.forklift.teleport(44, 1, -Math.PI / 2))
    await frames(p, 2)
    const f = await driveFor(p, 1, 0, 4000)
    expect(Number.isFinite(f.position[0]) && Number.isFinite(f.position[2])).toBe(true)
    expect(f.position[0], 'forklift stays inside the east wall').toBeLessThan(50)
    expect(f.position[1]).toBeGreaterThan(-0.5)
    const impact = await fork(p)
    expect(impact.lastImpact.strength, 'an impact was registered').toBeGreaterThan(0)
    // still drivable afterwards (reverse away from the wall)
    if (!(await fork(p)).upright) await p.evaluate(() => window.__MIW__.forklift.recover())
    const back = await driveFor(p, -1, 0, 1200)
    expect(back.position[0]).toBeLessThan(f.position[0] - 0.3)
    await p.evaluate(() => window.__MIW__.forklift.exit())
    await expect.poll(async () => (await playerState(p)).mode, { timeout: 30_000 }).toBe('foot')
  })

  test('§12.8 overturn and R-recover work repeatedly (twice) and the forklift drives again', async () => {
    const p = g.page
    await resetForklift(p)
    await standNextToForklift(p)
    await enterWithE(p)
    await driveFor(p, 1, 0, 900) // out of the bay a little
    for (let i = 1; i <= 2; i++) {
      await p.evaluate(() => window.__MIW__.forklift.flip())
      await expect.poll(async () => (await fork(p)).upright, { message: `flip ${i} detected`, timeout: 90_000 }).toBe(false)
      expect((await fork(p)).occupied).toBe(true)
      // R (player module → forklift service). Manual recover has a short cooldown: retry the key.
      await expect
        .poll(async () => {
          if ((await fork(p)).upright) return true
          await p.keyboard.press('KeyR')
          await frames(p, 2)
          return (await fork(p)).upright
        }, { message: `R recovers flip ${i}`, timeout: 60_000, intervals: [700] })
        .toBe(true)
      const f = await fork(p)
      expect(f.upDot).toBeGreaterThan(0.9)
      expect(f.occupied, 'recovering does not eject the driver').toBe(true)
    }
    const before = await fork(p)
    const after = await driveFor(p, 1, 0, 900)
    expect(dist2([after.position[0], after.position[2]], [before.position[0], before.position[2]]), 'drives after recovery').toBeGreaterThan(0.5)
    await exitWithE(p)
  })

  test('§12.8 on foot: E on a tipped-over forklift sets it upright, then E drives it', async () => {
    const p = g.page
    await resetForklift(p)
    await p.evaluate(() => window.__MIW__.forklift.flip())
    await expect.poll(async () => (await fork(p)).upright, { timeout: 90_000 }).toBe(false)
    const f = await fork(p)
    await teleport(p, f.position[0] - 0.3, f.position[2] - 2.0, Math.PI)
    await expect.poll(async () => (await uiState(p)).prompt, { timeout: 60_000 }).toMatchObject({ id: 'forklift', verb: 'Upright' })
    await p.keyboard.press('KeyE')
    await expect.poll(async () => (await fork(p)).upright, { timeout: 60_000 }).toBe(true)
    expect((await fork(p)).occupied).toBe(false)
    expect((await playerState(p)).mode).toBe('foot')
    // and it is drivable again
    const f2 = await fork(p)
    await teleport(p, f2.position[0] - 0.3, f2.position[2] - 1.7, Math.PI)
    await enterWithE(p)
    await exitWithE(p)
  })
})
