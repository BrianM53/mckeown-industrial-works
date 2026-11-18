/**
 * §12.15 Mobile breakpoint (Pixel 7 project): touch controls visible and working, panels usable,
 * no horizontal overflow.
 */
import { expect, test, type Page } from '@playwright/test'
import { dist2, playerState, useGamePage, waitStill } from './helpers'

const g = useGamePage()

/** Real touch input through the DevTools protocol (Chromium turns it into touch pointer events). */
async function touchDrag(p: Page, from: { x: number; y: number }, to: { x: number; y: number }, hold: () => Promise<void>): Promise<void> {
  const cdp = await p.context().newCDPSession(p)
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y, id: 1 }] })
    const steps = 6
    for (let i = 1; i <= steps; i++) {
      const x = from.x + ((to.x - from.x) * i) / steps
      const y = from.y + ((to.y - from.y) * i) / steps
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] })
    }
    await hold()
  } finally {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).catch(() => {})
    await cdp.detach().catch(() => {})
  }
}

/**
 * The touch layer: the <section data-testid="touch-controls"> itself has no box (all of its
 * children are position: fixed), so check the joystick zone and the Interact button instead.
 */
async function expectTouchUi(p: Page): Promise<void> {
  await expect(p.getByTestId('touch-controls')).toBeAttached({ timeout: 30_000 })
  await expect(p.locator('.miw-touch__stick-zone')).toBeVisible()
  await expect(p.getByTestId('touch-interact')).toBeVisible()
}

async function ensureTouchUi(p: Page): Promise<void> {
  if (!(await p.getByTestId('touch-interact').isVisible())) {
    // a first touch switches the UI to touch mode (coarse pointer detection can lag in emulation)
    const vp = p.viewportSize() ?? { width: 412, height: 839 }
    await p.touchscreen.tap(vp.width / 2, vp.height / 2)
  }
  await expectTouchUi(p)
}

test.describe('§12.15 mobile breakpoint', () => {
  test('§12.15 mobile: touch controls are visible and the stick moves the worker', async () => {
    const p = g.page
    await ensureTouchUi(p)
    await p.evaluate(() => window.__MIW__.player.teleport(0, 21.5, 0))
    const start = await waitStill(p)
    const zone = await p.locator('.miw-touch__stick-zone').boundingBox()
    expect(zone, 'joystick zone').not.toBeNull()
    const c = { x: zone!.x + zone!.width / 2, y: zone!.y + zone!.height / 2 }
    await touchDrag(p, c, { x: c.x, y: c.y - 60 }, async () => {
      await expect
        .poll(async () => {
          const s = await playerState(p)
          return dist2([s.position[0], s.position[2]], [start.position[0], start.position[2]])
        }, { message: 'worker walks while the stick is held', timeout: 60_000, intervals: [150] })
        .toBeGreaterThan(0.8)
    })
    const end = await waitStill(p)
    // pushed "up" = forward (camera faces north here): moved towards −Z
    expect(end.position[2]).toBeLessThan(start.position[2] - 0.5)
  })

  test('§12.15 mobile: menu, directory and portfolio panels are usable and fit the screen', async () => {
    const p = g.page
    const vp = p.viewportSize() ?? { width: 412, height: 839 }
    // narrow top bar collapses into a menu
    const menuBtn = p.locator('.miw-topbar__menu-btn')
    await expect(menuBtn).toBeVisible()
    await menuBtn.tap()
    await expect(p.getByTestId('open-directory')).toBeVisible()
    await p.getByTestId('open-directory').tap()
    const dir = p.getByTestId('panel-directory')
    await expect(dir).toBeVisible()
    const box = await dir.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(-1)
    expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 1)
    await p.getByTestId('dest-personnel').getByRole('button', { name: /^Open now/ }).tap()
    const resume = p.getByTestId('panel-resume')
    await expect(resume).toBeVisible()
    const rb = await resume.boundingBox()
    expect(rb!.x + rb!.width).toBeLessThanOrEqual(vp.width + 1)
    await expect(resume).toContainText('Brian McKeown')
    // panel body scrolls (long content stays reachable on a phone)
    const scrolled = await resume.locator('.miw-panel__body').evaluate((el) => {
      el.scrollTop = 400
      return { top: el.scrollTop, overflow: el.scrollHeight > el.clientHeight }
    })
    if (scrolled.overflow) expect(scrolled.top).toBeGreaterThan(0)
    await resume.getByTestId('panel-close').tap()
    await expect(resume).toHaveCount(0)
    await expectTouchUi(p)
    // no horizontal page scroll at this breakpoint
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })
})
