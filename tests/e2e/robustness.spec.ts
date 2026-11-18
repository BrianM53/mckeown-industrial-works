/**
 * §12.16 No uncaught runtime errors or leaking handlers after repeated panel opens, scene
 * resets and navigation. (Every spec file also fails a test on console errors via useGamePage.)
 */
import { expect, test, type Page } from '@playwright/test'
import { closeOverlays, frames, playerState, dist2, useGamePage } from './helpers'

const g = useGamePage({ needs: ['core.counts', 'audio.liveHandles', 'factory.reset', 'forklift.enter'] })

interface Counts {
  events: number
  clockSubs: number
  interactables: number
}
const counts = (p: Page): Promise<Counts> => p.evaluate(() => window.__MIW__.core.counts())
const liveHandles = (p: Page): Promise<number> => p.evaluate(() => window.__MIW__.audio.liveHandles())

async function panelCycle(p: Page): Promise<void> {
  // directory via button + Esc
  await p.getByTestId('open-directory').click()
  await expect(p.getByTestId('panel-directory')).toBeVisible()
  await p.keyboard.press('Escape')
  await expect(p.getByTestId('panel-directory')).toHaveCount(0)
  // quick links via button + ✕
  await p.getByTestId('open-quicklinks').click()
  await expect(p.getByTestId('panel-quicklinks')).toBeVisible()
  await p.getByTestId('panel-quicklinks').getByTestId('panel-close').click()
  await expect(p.getByTestId('panel-quicklinks')).toHaveCount(0)
  // a few more panel types through the store
  for (const id of ['resume', 'console', 'settings', 'github']) {
    // the console panel has no panel-<id> testid: find it by its dialog name
    const loc = id === 'console' ? p.getByRole('dialog', { name: 'Line Supervisor Console' }) : p.getByTestId(`panel-${id}`)
    await p.evaluate((pid) => window.__MIW__.ui.openPanel(pid), id)
    await expect(loc).toBeVisible()
    await p.evaluate(() => window.__MIW__.ui.closePanel())
    await expect(loc).toHaveCount(0)
  }
}

test.describe('§12.16 leaks and runtime errors', () => {
  test('§12.16 handler / subscription counts stay flat across 10 panel cycles, factory resets, forklift rides and fast travel', async () => {
    const p = g.page
    await closeOverlays(p)
    // warm-up: lazy panel chunks load once, the first-open code paths run
    await panelCycle(p)
    await frames(p, 3)
    const c0 = await counts(p)
    const h0 = await liveHandles(p)
    const domNodes0 = await p.evaluate(() => document.querySelectorAll('*').length)

    for (let i = 0; i < 10; i++) await panelCycle(p)

    // scene resets: factory hard reset + a full launch cycle
    await p.evaluate(() => window.__MIW__.factory.reset(true))
    await p.evaluate(() => window.__MIW__.factory.skipToLaunch())
    const id0 = (await p.evaluate(() => window.__MIW__.factory.getState().rocket.id)) as number
    await p.evaluate((id) => {
      const f = window.__MIW__.factory
      for (let t = 0; t < 900 && !(f.getState().rocket.id === id + 1 && f.getState().rocket.phase === 'assembling'); t += 2) f.advance(2)
    }, id0)
    expect(await p.evaluate(() => window.__MIW__.factory.getState().rocket.id)).toBe(id0 + 1)

    // forklift rides (enter/exit wire and unwire input + camera follow)
    for (let i = 0; i < 2; i++) {
      await p.evaluate(() => window.__MIW__.player.teleport(-11.3, 27.3, Math.PI))
      await expect.poll(async () => p.evaluate(() => window.__MIW__.forklift.enter() || window.__MIW__.forklift.getState().occupied)).toBe(true)
      await frames(p, 2)
      await p.evaluate(() => window.__MIW__.forklift.exit())
      await expect.poll(async () => (await playerState(p)).mode, { timeout: 30_000 }).toBe('foot')
    }
    await p.evaluate(() => window.__MIW__.forklift.returnHome())

    // navigation: directory fast travel there and back
    for (const [key, at] of [['server', [-27, -9]], ['radio', [27, 11]]] as const) {
      await p.getByTestId('open-directory').click()
      await p.getByTestId(`dest-${key}`).getByRole('button', { name: /^Travel there/ }).click()
      await expect.poll(async () => {
        const s = await playerState(p)
        return dist2([s.position[0], s.position[2]], [at[0], at[1]])
      }, { timeout: 60_000 }).toBeLessThan(1.5)
    }
    await frames(p, 5)

    const c1 = await counts(p)
    const h1 = await liveHandles(p)
    test.info().annotations.push({ type: 'counts', description: `before ${JSON.stringify(c0)} handles ${h0}; after ${JSON.stringify(c1)} handles ${h1}` })
    expect(c1.events, 'event-bus subscriptions').toBe(c0.events)
    expect(c1.clockSubs, 'sim-clock subscriptions').toBe(c0.clockSubs)
    expect(c1.interactables, 'registered interactables').toBe(c0.interactables)
    expect(h1, 'live audio loop handles').toBe(h0)
    // DOM does not grow with every panel open/close
    const domNodes1 = await p.evaluate(() => document.querySelectorAll('*').length)
    expect(domNodes1).toBeLessThan(domNodes0 + 50)
  })
})
