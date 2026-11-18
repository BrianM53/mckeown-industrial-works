import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { events } from '@/core/events'
import { PROFILE } from '@/content/profile'
import { HARMONY } from '@/content/stations'
import { useGameStore } from '@/state/game'
import { useSettings } from '@/state/settings'
import { useUIStore } from '@/state/ui'
import { renderInMode, resetUIState } from '../testing/helpers'
import UIRoot from '../UIRoot'
import { TopBar } from './TopBar'

beforeEach(() => resetUIState())
afterEach(() => cleanup())

const consent = () => useSettings.getState().audioConsent
const muted = () => useSettings.getState().muted

describe('Top bar', () => {
  it('shows the wordmark and Brian’s real role', () => {
    renderInMode(<TopBar mode="game" />)
    const bar = screen.getByTestId('topbar')
    expect(bar).toHaveTextContent('McKEOWN INDUSTRIAL WORKS')
    expect(bar).toHaveTextContent(`${PROFILE.name} · ${HARMONY.role}, ${HARMONY.company}`)
  })

  it('always offers "Skip game → View portfolio" to the static page', () => {
    renderInMode(<TopBar mode="game" />)
    const skip = screen.getByTestId('skip-game')
    expect(skip).toHaveTextContent(/skip game → view portfolio/i)
    expect(skip).toHaveAttribute('href', '/portfolio/')
  })

  it('in game mode the first tab stop is a skip link to the portfolio page (not in fallback)', async () => {
    const user = userEvent.setup()
    const { unmount } = renderInMode(<TopBar mode="game" />)
    await user.tab()
    expect(document.activeElement).toBe(screen.getByTestId('skip-link'))
    expect(screen.getByTestId('skip-link')).toHaveAttribute('href', '/portfolio/')
    unmount()
    renderInMode(<TopBar mode="fallback" />, 'fallback')
    expect(screen.queryByTestId('skip-link')).toBeNull()
  })

  it('buttons toggle their panels', async () => {
    const user = userEvent.setup()
    renderInMode(<TopBar mode="game" />)
    await user.click(screen.getByTestId('open-directory'))
    expect(useUIStore.getState().panel?.id).toBe('directory')
    await user.click(screen.getByTestId('open-directory'))
    expect(useUIStore.getState().panel).toBeNull()
    await user.click(screen.getByTestId('open-quicklinks'))
    expect(useUIStore.getState().panel?.id).toBe('quicklinks')
    await user.click(screen.getByTestId('open-contact'))
    expect(useUIStore.getState().panel?.id).toBe('contact')
    await user.click(screen.getByTestId('open-settings'))
    expect(useUIStore.getState().panel?.id).toBe('settings')
    await user.click(screen.getByTestId('open-help'))
    expect(useUIStore.getState().panel?.id).toBe('help')
    await user.click(screen.getByRole('button', { name: /mckeown industrial works/i }))
    expect(useUIStore.getState().panel?.id).toBe('about')
  })

  it('the narrow-screen menu button is a disclosure', async () => {
    const user = userEvent.setup()
    renderInMode(<TopBar mode="game" />)
    const btn = screen.getByRole('button', { name: 'Menu' })
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    await user.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Escape}')
    // Esc handling lives in the global keyboard hook (UIRoot); here a second click closes it.
    await user.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'false')
  })

  it('the narrow-screen menu closes when keyboard focus leaves it', async () => {
    const user = userEvent.setup()
    renderInMode(<TopBar mode="game" />)
    const btn = screen.getByRole('button', { name: 'Menu' })
    await user.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    screen.getByTestId('open-help').focus() // still inside the menu
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    act(() => screen.getByTestId('skip-game').focus()) // Tab past the last item
    expect(btn).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('Sound toggle (opt-in)', () => {
  it('rendering never grants consent or unmutes', () => {
    act(() => useGameStore.setState({ status: 'ready' }))
    renderInMode(<UIRoot mode="game" />)
    expect(consent()).toBe(false)
    expect(screen.getByTestId('sound-toggle')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('sound-toggle')).toHaveTextContent(/off/i)
  })

  it('first click records consent and turns sound on; later clicks toggle mute', async () => {
    const user = userEvent.setup()
    const sfx: string[] = []
    const off = events.on('sfx', (p) => sfx.push(p.name))
    renderInMode(<TopBar mode="game" />)
    const btn = screen.getByTestId('sound-toggle')
    expect(consent()).toBe(false)

    await user.click(btn)
    expect(consent()).toBe(true)
    expect(muted()).toBe(false)
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    expect(btn).toHaveTextContent(/on/i)
    expect(sfx).toContain('ui-click')

    await user.click(btn)
    expect(muted()).toBe(true)
    expect(consent()).toBe(true)
    expect(btn).toHaveAttribute('aria-pressed', 'false')

    await user.click(btn)
    expect(muted()).toBe(false)
    off()
  })

  it('is inert in the HTML fallback (no audio engine runs there) and never grants consent', async () => {
    const user = userEvent.setup()
    renderInMode(<TopBar mode="fallback" />, 'fallback')
    const btn = screen.getByTestId('sound-toggle')
    expect(btn).toHaveAttribute('aria-disabled', 'true')
    expect(btn).toHaveAccessibleName(/plays in the 3d factory only/i)
    await user.click(btn)
    expect(consent()).toBe(false)
    expect(btn).toHaveAttribute('aria-pressed', 'false')
  })

  it('reflects consent granted elsewhere (Settings) without changing it', () => {
    renderInMode(<TopBar mode="game" />)
    act(() => useSettings.getState().set({ audioConsent: true, muted: false }))
    expect(screen.getByTestId('sound-toggle')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByTestId('sound-toggle'))
    expect(muted()).toBe(true)
  })
})
