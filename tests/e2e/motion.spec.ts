/**
 * §12.17 Reduced motion: prefers-reduced-motion turns the setting on, disables camera shake
 * and CSS motion, and keeps non-motion feedback (captions) for events.
 */
import { expect, test, type Page } from '@playwright/test'
import { closeOverlays, setCamera, teleport, useGamePage, waitStill } from './helpers'

const g = useGamePage({ reducedMotion: true })

/** Emit a strong camera shake and record the camera position over the next rendered frames. */
async function shakeSamples(p: Page, n = 8): Promise<number> {
  return p.evaluate(async (count: number) => {
    const api = window.__MIW__
    const pos = () => api.camera.getState().position as number[]
    const ref = pos()
    let max = 0
    api.audio.emit('shake', { intensity: 1, duration: 2.5 })
    for (let i = 0; i < count; i++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      const q = pos()
      max = Math.max(max, Math.hypot(q[0] - ref[0], q[1] - ref[1], q[2] - ref[2]))
    }
    return max
  }, n)
}

async function settle(p: Page): Promise<void> {
  await teleport(p, 0, 21.5, 0)
  await setCamera(p, { yaw: 0, pitch: 0.17, distance: 5.5 })
  await waitStill(p)
  // camera at rest: two identical consecutive positions
  await expect
    .poll(async () => p.evaluate(async () => {
      const a = window.__MIW__.camera.getState().position as number[]
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      const b = window.__MIW__.camera.getState().position as number[]
      return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
    }), { timeout: 60_000 })
    .toBeLessThan(0.002)
}

test.describe('§12.17 reduced motion', () => {
  test('§12.17 prefers-reduced-motion turns on the reduced-motion setting and CSS', async () => {
    const p = g.page
    const s = (await p.evaluate(() => window.__MIW__.settings.get())) as { reducedMotion: boolean; reducedMotionSource: string }
    expect(s.reducedMotion).toBe(true)
    expect(s.reducedMotionSource).toBe('system')
    await expect(p.locator('html')).toHaveClass(/miw-reduced-motion/)
  })

  test('§12.17 camera shake is ignored with reduced motion (and does move the camera without it)', async () => {
    const p = g.page
    await closeOverlays(p)
    await settle(p)
    const reduced = await shakeSamples(p)
    expect(reduced, 'camera displacement under reduced motion').toBeLessThan(0.005)
    // control: the same shake visibly moves the camera when the visitor opts back into motion
    await p.evaluate(() => window.__MIW__.settings.set({ reducedMotion: false, reducedMotionSource: 'user' }))
    try {
      await settle(p)
      const full = await shakeSamples(p)
      expect(full, 'shake measurably moves the camera with motion enabled').toBeGreaterThan(0.01)
    } finally {
      await p.evaluate(() => window.__MIW__.settings.set({ reducedMotion: true, reducedMotionSource: 'user' }))
    }
    await expect(p.locator('html')).toHaveClass(/miw-reduced-motion/)
  })

  test('§12.17 Night Shift with reduced motion: no light flicker, and a caption announces it', async () => {
    const p = g.page
    await closeOverlays(p)
    expect(await p.evaluate(() => window.__MIW__.nightShift.start())).toBe(true)
    await expect(p.getByTestId('captions')).not.toBeEmpty({ timeout: 30_000 })
    // power-down: the light level only ever goes down (no strobing)
    const levels = (await p.evaluate(() => {
      const out: number[] = []
      for (let i = 0; i < 40; i++) {
        window.__MIW__.clock.advance(0.1)
        out.push(window.__MIW__.core.runtime().lighting.level as number)
      }
      return out
    })) as number[]
    for (let i = 1; i < levels.length; i++) expect(levels[i], `level ${i}: ${levels.join(',')}`).toBeLessThanOrEqual(levels[i - 1] + 1e-6)
    await p.evaluate(() => window.__MIW__.nightShift.restore())
    await p.evaluate(() => window.__MIW__.clock.advance(5))
    await expect.poll(async () => (await p.evaluate(() => window.__MIW__.core.runtime().lighting.level)) as number, { timeout: 30_000 }).toBeGreaterThan(0.95)
  })
})
