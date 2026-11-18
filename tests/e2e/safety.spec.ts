/**
 * §12.11 OSHA restricted zone (inspector, respawn at the safe checkpoint, cooldown) and
 * §12.13 Night Shift (lights always come back, the player is never stranded in darkness).
 */
import { expect, test, type Page } from '@playwright/test'
import { dist2, holdUntilMoved, playerState, setCamera, teleport, uiState, useGamePage, waitStill } from './helpers'

const g = useGamePage({ needs: ['osha.getState', 'osha.reset', 'nightShift.getState', 'nightShift.start'] })

interface Osha {
  state: string
  zoneId: string | null
  cooldownRemaining: number
  stats: { warnings: number; alerts: number; tackles: number; aborts: number }
}
const osha = (p: Page): Promise<Osha> => p.evaluate(() => window.__MIW__.osha.getState())
const lighting = (p: Page): Promise<{ level: number; emergency: number }> => p.evaluate(() => window.__MIW__.core.runtime().lighting)
const night = (p: Page): Promise<{ phase: string; level: number; emergency: number; cooldownRemaining: number }> => p.evaluate(() => window.__MIW__.nightShift.getState())
const INTAKE: [number, number] = [0, 32]
// Transformer yard: rect x 15.5..19.5, z −6.5..−2.5; chain gap on its west side at (15.15, −4.5).
const OUTSIDE: [number, number] = [13.8, -4.5]

/** Walk east through the chain gap into the transformer yard with the real keyboard. */
async function walkIntoYard(p: Page): Promise<void> {
  await teleport(p, OUTSIDE[0], OUTSIDE[1], -Math.PI / 2)
  await setCamera(p, { yaw: -Math.PI / 2, pitch: 0.17 })
  await waitStill(p)
  await p.keyboard.down('KeyW')
  try {
    await expect.poll(async () => (await playerState(p)).position[0], { message: 'walked into the yard', timeout: 60_000, intervals: [100] }).toBeGreaterThan(15.7)
  } finally {
    await p.keyboard.up('KeyW')
  }
}

test.describe('§12.11 OSHA restricted zone', () => {
  test('§12.11 entering a restricted zone → inspector tackle → respawn at intake within 4 s; re-entry during cooldown only warns', async () => {
    const p = g.page
    await p.evaluate(() => {
      window.__MIW__.ui.closePanel()
      window.__MIW__.osha.reset()
    })
    const s0 = await osha(p)
    expect(s0.state).toBe('patrol')

    await walkIntoYard(p)
    // Measure inside the page so Playwright's polling latency does not count:
    // 1) fast-forward sim time in 0.1 s steps until contact (whistle → sprint → tackle),
    // 2) then watch every rendered frame until the worker is back at intake (the tackle and
    //    respawn sequence runs on real-time timers, ~2.2 s).
    const timing = await p.evaluate(
      async ({ tackles0, intake }) => {
        const api = window.__MIW__
        const t0 = api.clock.get().t as number
        let st = api.osha.getState()
        for (let i = 0; i < 40 && st.stats.tackles === tackles0; i++) {
          api.clock.advance(0.1)
          st = api.osha.getState()
        }
        const simToContact = (api.clock.get().t as number) - t0
        if (st.stats.tackles === tackles0) return { simToContact, realToRespawn: -1, frames: 0, frameMs: 0, state: st }
        const contactAt = performance.now()
        let frames = 0
        let last = contactAt
        let worst = 0
        for (;;) {
          await new Promise((r) => requestAnimationFrame(() => r(null)))
          const now = performance.now()
          worst = Math.max(worst, now - last)
          last = now
          frames++
          const pos = api.player.getState().position as number[]
          if (Math.hypot(pos[0] - intake[0], pos[2] - intake[1]) < 1) break
          if (now - contactAt > 30_000) break
        }
        return { simToContact, realToRespawn: (last - contactAt) / 1000, frames, frameMs: worst, state: api.osha.getState() }
      },
      { tackles0: s0.stats.tackles, intake: INTAKE },
    )
    test.info().annotations.push({
      type: 'osha-timing',
      description: `sim entry→contact ${timing.simToContact.toFixed(2)} s, real contact→respawn ${timing.realToRespawn.toFixed(2)} s over ${timing.frames} frames (longest frame ${Math.round(timing.frameMs)} ms)`,
    })
    expect(timing.realToRespawn, `tackle happened: ${JSON.stringify(timing.state)}`).toBeGreaterThan(0)
    expect(timing.state.zoneId).toBe('transformer-yard')
    expect(timing.simToContact, 'whistle → contact is quick').toBeLessThan(2)
    // The respawn is only observable on a rendered frame: allow one (SwiftShader) frame of latency.
    expect(timing.simToContact + timing.realToRespawn, 'entry → respawn at intake').toBeLessThan(4 + timing.frameMs / 1000)
    const back = await playerState(p)
    expect(dist2([back.position[0], back.position[2]], INTAKE)).toBeLessThan(1)
    await expect.poll(async () => (await playerState(p)).locked, { timeout: 30_000 }).toEqual([])
    const pl = await playerState(p)
    expect(pl.mode).toBe('foot')
    expect(pl.visible).toBe(true)
    await p.evaluate(() => window.__MIW__.clock.advance(0.2))
    await expect.poll(async () => (await osha(p)).state, { timeout: 30_000 }).toBe('cooldown')

    // re-entry within the cooldown: a warning, no second tackle
    const before = await osha(p)
    await walkIntoYard(p)
    await p.evaluate(() => window.__MIW__.clock.advance(0.5))
    await expect.poll(async () => (await osha(p)).stats.warnings, { timeout: 30_000 }).toBeGreaterThan(before.stats.warnings)
    await p.evaluate(() => window.__MIW__.clock.advance(3))
    const after = await osha(p)
    expect(after.stats.tackles, 'no tackle during cooldown').toBe(before.stats.tackles)
    const still = await playerState(p)
    expect(still.position[0], 'still standing in the yard (not respawned)').toBeGreaterThan(15.2)
    // the player can simply walk out again
    await teleport(p, 10, -9, Math.PI)
    await waitStill(p)
  })
})

test.describe('§12.13 Night Shift', () => {
  test('§12.13 pressing the Night Shift button blacks out the factory, then restores normal lighting', async () => {
    const p = g.page
    await p.evaluate(() => window.__MIW__.ui.closePanel())
    await expect.poll(async () => (await night(p)).phase, { timeout: 60_000 }).toBe('idle')
    const lit = await lighting(p)
    expect(lit.level).toBeGreaterThan(0.95)
    // walk up to the button (interact point (-4.2, 19)) and press E
    await teleport(p, -3.3, 19, Math.PI / 2)
    await expect.poll(async () => (await uiState(p)).prompt?.id ?? null, { timeout: 60_000 }).toBe('safety:night-shift-button')
    await p.keyboard.press('KeyE')
    await expect.poll(async () => (await night(p)).phase, { timeout: 30_000 }).not.toBe('idle')
    await p.evaluate(() => window.__MIW__.clock.advance(3.5))
    await expect.poll(async () => (await night(p)).phase).toBe('blackout')
    const dark = await lighting(p)
    expect(dark.level).toBeLessThan(0.5)
    expect(dark.level, 'never pitch black').toBeGreaterThan(0.05)
    expect(dark.emergency).toBeGreaterThan(0.5)

    // not stranded: the worker can move and panels open during the blackout
    await holdUntilMoved(p, ['KeyS'], 0.8)
    await p.evaluate(() => window.__MIW__.ui.openPanel('directory'))
    await expect(p.getByTestId('panel-directory')).toBeVisible()
    await p.keyboard.press('Escape')
    await expect(p.getByTestId('panel-directory')).toHaveCount(0)

    // lights come back
    await p.evaluate(() => window.__MIW__.clock.advance(20))
    await expect.poll(async () => (await lighting(p)).level, { timeout: 30_000 }).toBeGreaterThan(0.95)
    const back = await lighting(p)
    expect(back.emergency).toBeLessThan(0.05)
    const ns = await night(p)
    expect(['cooldown', 'idle']).toContain(ns.phase)
    expect(ns.level).toBeGreaterThan(0.95)
  })

  test('§12.13 a stalled simulation clock cannot strand the player in darkness (watchdog restores light)', async () => {
    const p = g.page
    expect(await p.evaluate(() => window.__MIW__.nightShift.start())).toBe(true)
    await p.evaluate(() => window.__MIW__.clock.advance(3.5))
    await expect.poll(async () => (await night(p)).phase).toBe('blackout')
    expect((await lighting(p)).level).toBeLessThan(0.5)
    await p.evaluate(() => window.__MIW__.clock.setTimeScale(0)) // sim frozen
    try {
      await expect.poll(async () => (await lighting(p)).level, { message: 'watchdog restores the lights', timeout: 150_000, intervals: [2000] }).toBeGreaterThan(0.95)
    } finally {
      await p.evaluate(() => window.__MIW__.clock.setTimeScale(1))
    }
    expect((await lighting(p)).emergency).toBeLessThan(0.05)
  })
})
