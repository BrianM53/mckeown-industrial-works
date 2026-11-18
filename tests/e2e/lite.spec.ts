/**
 * HTML-only paths (no 3D): §12.2 menu/directory/panels keyboard accessible without WebGL,
 * §12.3 the five principal stations via the directory's "Open now", §12.15 no-WebGL fallback,
 * §12.18 axe-core accessibility checks.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { installProbes, trackErrors } from './helpers'

async function gotoLite(page: Page, path = '/?lite=1'): Promise<void> {
  await page.goto(path)
  await expect(page.getByTestId('fallback-portfolio')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('topbar')).toBeVisible()
}

/** testid of the element that currently has focus (or its closest ancestor with one). */
const focusedInfo = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) return { testId: null as string | null, tag: 'body', inDialog: false, name: '' }
    return {
      testId: el.getAttribute('data-testid') ?? el.closest('[data-testid]')?.getAttribute('data-testid') ?? null,
      tag: el.tagName.toLowerCase(),
      inDialog: !!el.closest('[role="dialog"]'),
      name: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 80),
    }
  })

/** Every external link inside `scope` opens in a new tab without leaking the opener. */
async function expectSafeExternalLinks(scope: Locator, min = 0): Promise<string[]> {
  const links = await scope.locator('a[href^="http"]').evaluateAll((els) =>
    els.map((a) => ({ href: a.getAttribute('href') ?? '', target: a.getAttribute('target'), rel: a.getAttribute('rel') ?? '' })),
  )
  expect(links.length).toBeGreaterThanOrEqual(min)
  for (const l of links) {
    expect(() => new URL(l.href), l.href).not.toThrow()
    expect(new URL(l.href).protocol, l.href).toBe('https:')
    expect(l.target, `${l.href} target`).toBe('_blank')
    expect(l.rel, `${l.href} rel`).toContain('noopener')
    expect(l.rel, `${l.href} rel`).toContain('noreferrer')
  }
  return links.map((l) => l.href)
}

test.describe('§12.2 HTML menu, directory and panels without 3D', () => {
  test('§12.2 lite mode renders the menu, directory and portfolio without creating a WebGL context', async ({ page }) => {
    const log = trackErrors(page)
    await installProbes(page)
    await gotoLite(page)
    await expect(page.getByTestId('fallback-portfolio')).toHaveAttribute('data-reason', 'requested')
    await expect(page.locator('canvas')).toHaveCount(0)
    expect(await page.evaluate(() => window.__e2e?.webgl ?? -1)).toBe(0)
    expect(await page.evaluate(() => window.__MIW__?.ready === true)).toBe(false)
    for (const id of ['open-directory', 'open-quicklinks', 'open-contact', 'open-settings', 'open-help', 'skip-game']) {
      await expect(page.getByTestId(id), id).toBeVisible()
    }
    await expect(page.getByTestId('portfolio-document')).toContainText('Brian McKeown')
    expect(log.take()).toEqual([])
  })

  test('§12.2 top bar is reachable with Tab and every control has an accessible name', async ({ page }) => {
    await gotoLite(page)
    const seen = new Set<string>()
    const want = ['open-directory', 'open-quicklinks', 'open-contact', 'open-settings', 'open-help']
    for (let i = 0; i < 25 && !want.every((w) => seen.has(w)); i++) {
      await page.keyboard.press('Tab')
      const f = await focusedInfo(page)
      if (f.testId) seen.add(f.testId)
      expect(f.name.length, `focused ${f.tag} ${f.testId ?? ''} has a name`).toBeGreaterThan(0)
    }
    for (const w of want) expect(seen.has(w), `${w} reachable by Tab`).toBe(true)
    // order follows the visual order: directory before contact before settings
    const order = [...seen]
    expect(order.indexOf('open-directory')).toBeLessThan(order.indexOf('open-contact'))
    expect(order.indexOf('open-contact')).toBeLessThan(order.indexOf('open-settings'))
  })

  test('§12.2 keyboard: M opens the directory, focus moves into the dialog, Esc closes and focus returns', async ({ page }) => {
    await gotoLite(page)
    await page.keyboard.press('m')
    const dlg = page.getByTestId('panel-directory')
    await expect(dlg).toBeVisible()
    await expect(dlg).toHaveAttribute('role', 'dialog')
    await expect(dlg).toHaveAttribute('aria-modal', 'true')
    await expect.poll(async () => (await focusedInfo(page)).inDialog).toBe(true)
    // Tab cycles inside the modal
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab')
      expect((await focusedInfo(page)).inDialog, `Tab ${i + 1} stays inside the dialog`).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)

    // open from the top-bar button with Enter → Esc returns focus to that button
    await page.getByTestId('open-directory').focus()
    await page.keyboard.press('Enter')
    await expect(dlg).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
    await expect(page.getByTestId('open-directory')).toBeFocused()

    // P → portfolio quick links, ? → help
    await page.keyboard.press('p')
    await expect(page.getByTestId('panel-quicklinks')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('panel-quicklinks')).toHaveCount(0)
    await page.keyboard.press('?')
    await expect(page.getByTestId('panel-help')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('panel-help')).toHaveCount(0)
  })
})

const PRINCIPAL: { key: string; panel: string; title: RegExp; content: RegExp; link?: RegExp }[] = [
  { key: 'personnel', panel: 'resume', title: /Brian McKeown/, content: /Founding Engineer at Harmony AI/ },
  { key: 'control', panel: 'harmony', title: /Harmony/i, content: /Harmony/i, link: /^https:\/\/www\.tryharmony\.ai\/?$/ },
  { key: 'radio', panel: 'codestory', title: /Code Story/i, content: /Code Story/i, link: /^https:\/\/www\.codestory\.co\// },
  { key: 'server', panel: 'github', title: /GitHub/i, content: /BrianM53/, link: /^https:\/\/github\.com\/BrianM53\/?$/ },
  { key: 'rec', panel: 'rec', title: /Recreation Yard/, content: /\w+/ },
]

test.describe('§12.3 principal stations via the directory', () => {
  test('§12.3 the directory lists the five principal stations first', async ({ page }) => {
    await gotoLite(page)
    await page.getByTestId('open-directory').click()
    await expect(page.getByTestId('dest-personnel')).toBeVisible()
    const ids = await page
      .getByTestId('panel-directory')
      .locator('[data-testid^="dest-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
    expect(ids.slice(0, 5)).toEqual(PRINCIPAL.map((p) => `dest-${p.key}`))
  })

  for (const [i, st] of PRINCIPAL.entries()) {
    test(`§12.3 Open now → ${st.panel} panel renders its content and links, closes with ${i % 2 ? '✕' : 'Esc'}`, async ({ page }) => {
      const log = trackErrors(page)
      await gotoLite(page)
      await page.getByTestId('open-directory').click()
      const dest = page.getByTestId(`dest-${st.key}`)
      await expect(dest).toBeVisible()
      await dest.getByRole('button', { name: /^Open now/ }).click()
      const panel = page.getByTestId(`panel-${st.panel}`)
      await expect(panel).toBeVisible({ timeout: 30_000 })
      await expect(page.getByTestId('panel-directory')).toHaveCount(0)
      await expect(panel).toHaveAttribute('role', 'dialog')
      await expect(page.getByRole('dialog', { name: st.title })).toBeVisible()
      await expect(panel).toContainText(st.content)
      const hrefs = await expectSafeExternalLinks(panel, st.link ? 1 : 0)
      if (st.link) expect(hrefs.some((h) => st.link!.test(h)), `${st.panel} links: ${hrefs.join(', ')}`).toBe(true)
      if (i % 2) await panel.getByTestId('panel-close').click()
      else await page.keyboard.press('Escape')
      await expect(panel).toHaveCount(0)
      expect(log.take()).toEqual([])
    })
  }

  test('§12.3 every directory entry with "Open now" opens and closes its panel (incl. contact and R&D)', async ({ page }) => {
    const log = trackErrors(page)
    await gotoLite(page)
    await page.getByTestId('open-directory').click()
    await expect(page.getByTestId('dest-personnel')).toBeVisible()
    const keys = (await page
      .getByTestId('panel-directory')
      .locator('[data-testid^="dest-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))) as string[]
    expect(keys.length).toBeGreaterThanOrEqual(6)
    for (const k of keys) {
      if (!(await page.getByTestId('panel-directory').isVisible())) await page.getByTestId('open-directory').click()
      const open = page.getByTestId(k).getByRole('button', { name: /^Open now/ })
      if ((await open.count()) === 0) continue
      await open.click()
      const dialog = page.locator('[role="dialog"][aria-modal="true"]')
      await expect(dialog).toHaveCount(1)
      await expect(dialog).toBeVisible()
      // (the Line Supervisor Console panel has no panel-<id> testid, so identify dialogs by name)
      await expect(dialog, `${k} opened a named dialog`).toHaveAccessibleName(/\S/)
      await expect(dialog).not.toHaveAccessibleName('Factory directory')
      await expectSafeExternalLinks(dialog)
      await dialog.getByTestId('panel-close').click()
      await expect(dialog).toHaveCount(0)
    }
    // contact exposes real ways to reach Brian
    await page.getByTestId('open-contact').click()
    const contact = page.getByTestId('panel-contact')
    await expect(contact).toBeVisible()
    const hrefs = await expectSafeExternalLinks(contact, 1)
    expect(hrefs.some((h) => /github\.com\/BrianM53|linkedin\.com\/in\//.test(h))).toBe(true)
    expect(log.take()).toEqual([])
  })
})

test.describe('§12.15 fallback without WebGL', () => {
  test('§12.15 no WebGL → HTML portfolio with working quick links, directory and panels', async ({ page }) => {
    const log = trackErrors(page)
    await installProbes(page, { blockWebGL: true })
    await page.goto('/')
    const fb = page.getByTestId('fallback-portfolio')
    await expect(fb).toBeVisible({ timeout: 60_000 })
    await expect(fb).toHaveAttribute('data-reason', 'no-webgl')
    await expect(page.getByTestId('fallback-notice')).toBeVisible()
    await expect(page.locator('canvas')).toHaveCount(0)
    await expect(page.getByTestId('portfolio-document')).toContainText('Brian McKeown')
    // quick links: one tile per portfolio panel, each opens it
    await page.getByTestId('open-quicklinks').click()
    const ql = page.getByTestId('panel-quicklinks')
    await expect(ql).toBeVisible()
    for (const id of ['resume', 'harmony', 'codestory', 'github', 'contact']) await expect(ql.getByTestId(`ql-${id}`), `quick link ${id}`).toBeVisible()
    await ql.getByTestId('ql-github').click()
    const gh = page.getByTestId('panel-github')
    await expect(gh).toBeVisible()
    const hrefs = await expectSafeExternalLinks(gh, 1)
    expect(hrefs.some((h) => h.startsWith('https://github.com/BrianM53'))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(gh).toHaveCount(0)
    // directory → résumé still works
    await page.getByTestId('open-directory').click()
    await page.getByTestId('dest-personnel').getByRole('button', { name: /^Open now/ }).click()
    await expect(page.getByTestId('panel-resume')).toBeVisible()
    await page.getByTestId('panel-resume').getByTestId('panel-close').click()
    await expect(page.getByTestId('panel-resume')).toHaveCount(0)
    // the static portfolio link is reachable
    await expect(page.getByTestId('skip-game')).toHaveAttribute('href', /portfolio\/?$/)
    expect(log.take()).toEqual([])
  })
})

test.describe('§12.18 accessibility (axe-core)', () => {
  const axe = (page: Page) => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
  const serious = (r: Awaited<ReturnType<AxeBuilder['analyze']>>) =>
    r.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.impact} ${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).slice(0, 4).join(' | ')}`)

  test('§12.18 axe: /?lite=1 has no serious or critical violations', async ({ page }) => {
    await gotoLite(page)
    expect(serious(await axe(page).analyze())).toEqual([])
  })

  test('§12.18 axe: static /portfolio/ has no serious or critical violations', async ({ page }) => {
    await page.goto('/portfolio/')
    await expect(page.locator('h1').first()).toBeVisible()
    expect(serious(await axe(page).analyze())).toEqual([])
  })

  for (const panel of ['resume', 'directory', 'settings', 'contact']) {
    test(`§12.18 axe: open ${panel} panel has no serious or critical violations`, async ({ page }) => {
      await gotoLite(page)
      await page.evaluate((id) => window.__MIW__.ui.openPanel(id), panel)
      const dlg = page.getByTestId(`panel-${panel}`)
      await expect(dlg).toBeVisible()
      // let the entrance animation finish so contrast is measured on final colours
      await page.waitForTimeout(800)
      expect(serious(await axe(page).include(`[data-testid="panel-${panel}"]`).analyze())).toEqual([])
    })
  }
})
