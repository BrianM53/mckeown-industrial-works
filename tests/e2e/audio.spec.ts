/**
 * §12.14 Audio: no AudioContext / no sound before consent; the Sound button starts audio;
 * mute and the volume sliders drive the mixer gains.
 */
import { expect, test, type Page } from '@playwright/test'
import { frames, holdForFrames, useGamePage } from './helpers'

const g = useGamePage({ probes: true, needs: ['audio.getState', 'settings.get'] })

interface AudioState {
  contextState: string
  consent: boolean
  muted: boolean
  masterGain: number
  musicGain: number
  sfxGain: number
  duck: number
  activeVoices: number
  contextsCreated: number
  lastPlayed: string[]
}
const audio = (p: Page): Promise<AudioState> => p.evaluate(() => window.__MIW__.audio.getState())
const constructed = (p: Page): Promise<number> => p.evaluate(() => window.__e2e?.audioContexts ?? -1)

/** The Sound toggle lives in the top bar (or behind the Menu button on narrow screens). */
async function clickSound(p: Page): Promise<void> {
  const btn = p.getByTestId('sound-toggle')
  if (!(await btn.isVisible())) await p.locator('.miw-topbar__menu-btn').click()
  await btn.click()
}

test.describe.configure({ mode: 'serial' }) // consent is per session: the steps build on each other

test.describe('§12.14 audio consent, mute and volume', () => {
  test('§12.14 no AudioContext and no sound before consent, even after interacting with the world', async () => {
    const p = g.page
    let a = await audio(p)
    expect(a.consent).toBe(false)
    expect(a.contextState).toBe('none')
    expect(a.contextsCreated).toBe(0)
    expect(await constructed(p)).toBe(0)
    // visitor clicks around, walks, opens a panel, presses E: still silent
    await p.mouse.click(300, 400) // a user gesture on the canvas
    await holdForFrames(p, ['KeyW'], 3)
    await p.getByTestId('open-directory').click()
    await expect(p.getByTestId('panel-directory')).toBeVisible()
    await p.keyboard.press('Escape')
    await p.evaluate(() => window.__MIW__.audio.play('ui-click'))
    await frames(p, 2)
    a = await audio(p)
    expect(a.contextState).toBe('none')
    expect(a.contextsCreated).toBe(0)
    expect(a.activeVoices).toBe(0)
    expect(await constructed(p)).toBe(0)
    await expect(p.getByTestId('sound-toggle')).toHaveAttribute('aria-pressed', 'false')
  })

  test('§12.14 the Sound button grants consent and starts the audio engine', async () => {
    const p = g.page
    await clickSound(p)
    await expect.poll(async () => (await audio(p)).contextState, { timeout: 30_000 }).toBe('running')
    const a = await audio(p)
    expect(a.consent).toBe(true)
    expect(a.muted).toBe(false)
    expect(a.contextsCreated).toBe(1)
    expect(await constructed(p)).toBe(1)
    expect(a.masterGain).toBeGreaterThan(0)
    await expect.poll(async () => (await audio(p)).lastPlayed, { timeout: 30_000 }).toContain('ui-click')
    await expect(p.getByTestId('sound-toggle')).toHaveAttribute('aria-pressed', 'true')
  })

  test('§12.14 Sound button mutes (master gain 0) and unmutes', async () => {
    const p = g.page
    await clickSound(p) // mute
    await expect.poll(async () => (await audio(p)).masterGain, { timeout: 10_000 }).toBe(0)
    await expect(p.getByTestId('sound-toggle')).toHaveAttribute('aria-pressed', 'false')
    await expect.poll(async () => (await audio(p)).contextState, { timeout: 30_000 }).toBe('suspended')
    const voices = (await audio(p)).activeVoices
    await p.evaluate(() => window.__MIW__.audio.play('boing'))
    await frames(p, 1)
    expect((await audio(p)).activeVoices, 'muted: play() adds no voices').toBeLessThanOrEqual(voices)
    await clickSound(p) // unmute
    await expect.poll(async () => (await audio(p)).contextState, { timeout: 30_000 }).toBe('running')
    expect((await audio(p)).masterGain).toBeGreaterThan(0)
    expect((await audio(p)).contextsCreated, 'one AudioContext for the session').toBe(1)
  })

  test('§12.14 Settings: mute switch and master / music / effects sliders control the gains', async () => {
    const p = g.page
    await p.getByTestId('open-settings').click()
    const panel = p.getByTestId('panel-settings')
    await expect(panel).toBeVisible()
    const slider = (name: string) => panel.getByLabel(name, { exact: true })
    const settings = (): Promise<{ masterVolume: number; musicVolume: number; sfxVolume: number; muted: boolean }> => p.evaluate(() => window.__MIW__.settings.get())

    await slider('Master volume').focus()
    await p.keyboard.press('End')
    await expect.poll(async () => (await settings()).masterVolume).toBe(1)
    await expect.poll(async () => (await audio(p)).masterGain).toBeCloseTo(1, 3)
    await p.keyboard.press('Home')
    await expect.poll(async () => (await audio(p)).masterGain).toBe(0)
    for (let i = 0; i < 10; i++) await p.keyboard.press('ArrowRight') // 10 × 0.05 = 0.5
    await expect.poll(async () => (await settings()).masterVolume).toBeCloseTo(0.5, 5)
    await expect.poll(async () => (await audio(p)).masterGain).toBeCloseTo(0.25, 3) // perceptual curve v²

    await slider('Music volume').focus()
    await p.keyboard.press('Home')
    await expect.poll(async () => (await audio(p)).musicGain).toBe(0)
    await p.keyboard.press('End')
    await expect.poll(async () => {
      const a = await audio(p)
      return Math.abs(a.musicGain - 1 * (1 - a.duck))
    }).toBeLessThan(0.01)

    await slider('Effects volume').focus()
    await p.keyboard.press('Home')
    await expect.poll(async () => (await audio(p)).sfxGain).toBe(0)
    await p.keyboard.press('End')
    await expect.poll(async () => (await audio(p)).sfxGain).toBeCloseTo(1, 3)

    const mute = panel.getByRole('switch', { name: 'Mute all sound' })
    await mute.check()
    await expect.poll(async () => (await audio(p)).masterGain).toBe(0)
    expect((await settings()).muted).toBe(true)
    await expect(p.getByTestId('sound-toggle')).toHaveAttribute('aria-pressed', 'false')
    await mute.uncheck()
    await expect.poll(async () => (await audio(p)).masterGain).toBeCloseTo(0.25, 3)
    await p.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
  })
})
