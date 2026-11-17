import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/state/ui'
import UIRoot from '../UIRoot'
import { resetUIState } from '../testing/helpers'
import { ExternalLink, Panel } from './Panel'

beforeEach(() => resetUIState())
afterEach(() => cleanup())

describe('Panel (kit)', () => {
  it('is a labelled modal dialog that takes focus on open', () => {
    render(
      <Panel title="Test panel" kicker="Bay 9" onClose={() => {}}>
        <p>Body</p>
      </Panel>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Test panel' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Test panel' }))
  })

  it('Esc closes the open panel and focus returns to the opener', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button type="button">Opener</button>
        <UIRoot mode="fallback" />
      </>,
    )
    const opener = screen.getByRole('button', { name: 'Opener' })
    opener.focus()
    act(() => useUIStore.getState().openPanel('about'))
    const dialog = await screen.findByRole('dialog', { name: /about this site/i })
    expect(dialog.contains(document.activeElement)).toBe(true)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(useUIStore.getState().panel).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('the visible ✕ closes it', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Panel title="Closable" onClose={onClose}>
        <p>Body</p>
      </Panel>,
    )
    await user.click(screen.getByRole('button', { name: 'Close panel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('clicking the backdrop closes it; clicking inside, or dragging out of the panel, does not', () => {
    const onClose = vi.fn()
    render(
      <Panel title="Backdrop" onClose={onClose}>
        <p>Inside</p>
      </Panel>,
    )
    const backdrop = screen.getByRole('dialog').parentElement!
    fireEvent.pointerDown(screen.getByText('Inside'))
    fireEvent.click(screen.getByText('Inside'))
    expect(onClose).not.toHaveBeenCalled()
    // selection drag that starts inside and ends on the backdrop
    fireEvent.pointerDown(screen.getByText('Inside'))
    fireEvent.click(backdrop)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.pointerDown(backdrop)
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('traps Tab focus inside the dialog', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button type="button">Outside</button>
        <Panel title="Trap" onClose={() => {}} footer={<button type="button">Last</button>}>
          <button type="button">First in body</button>
        </Panel>
      </>,
    )
    screen.getByRole('button', { name: 'Last' }).focus()
    await user.tab()
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close panel' }))
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Last' }))
  })

  it('keeps keyboard events from leaking to game handlers', () => {
    const onWindowKey = vi.fn()
    window.addEventListener('keydown', onWindowKey)
    render(
      <Panel title="Leak" onClose={() => {}}>
        <button type="button">Inner</button>
      </Panel>,
    )
    fireEvent.keyDown(screen.getByRole('button', { name: 'Inner' }), { key: 'w' })
    window.removeEventListener('keydown', onWindowKey)
    expect(onWindowKey).not.toHaveBeenCalled()
  })
})

describe('ExternalLink', () => {
  it('accepts an explicit accessible name and still announces the new tab', () => {
    render(
      <ExternalLink href="https://example.com/" label="View repo: Example">
        View repo
      </ExternalLink>,
    )
    expect(screen.getByRole('link', { name: 'View repo: Example (opens in a new tab)' })).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('opens in a new tab with noopener noreferrer and announces it', () => {
    render(<ExternalLink href="https://example.com/">Example</ExternalLink>)
    const a = screen.getByRole('link', { name: /example\s*\(opens in a new tab\)/i })
    expect(a).toHaveAttribute('target', '_blank')
    expect(a).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
