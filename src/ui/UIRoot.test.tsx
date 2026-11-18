import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { actions } from '@/core/actions'
import { events } from '@/core/events'
import { useGameStore } from '@/state/game'
import { useUIStore } from '@/state/ui'
import { preloadPanels } from './panels/registry'
import { resetUIState } from './testing/helpers'
import { useTopbarMenu } from './topbar/menuStore'
import UIRoot from './UIRoot'

beforeEach(() => resetUIState())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const panelId = () => useUIStore.getState().panel?.id ?? null

describe('UIRoot — fallback mode (no WebGL)', () => {
  it('renders the top bar and quick links without touching WebGL', async () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    const user = userEvent.setup()
    render(<UIRoot mode="fallback" />)
    expect(screen.getByTestId('topbar')).toBeInTheDocument()
    expect(screen.queryByTestId('hud')).toBeNull()
    expect(screen.queryByTestId('touch-controls')).toBeNull()
    expect(screen.queryByTestId('loading-screen')).toBeNull()

    await user.click(screen.getByTestId('open-quicklinks'))
    const menu = await screen.findByRole('dialog', { name: /portfolio quick links/i })
    for (const name of [/résumé/i, /harmony ai/i, /code story/i, /github/i, /contact/i, /about/i, /directory/i, /settings/i, /help/i]) {
      expect(within(menu).getAllByRole('button', { name }).length).toBeGreaterThan(0)
    }
    expect(within(menu).getByRole('link', { name: /view portfolio page/i })).toHaveAttribute('href', '/portfolio/')
    // nothing to earn without the 3D world
    expect(within(menu).queryByTestId('ql-achievements')).toBeNull()

    await user.click(within(menu).getByTestId('ql-resume'))
    expect(await screen.findByTestId('panel-resume')).toBeInTheDocument()
    expect(getContext).not.toHaveBeenCalled()
    expect(document.querySelector('canvas')).toBeNull()
  })

  it('every portfolio panel opens and closes from the keyboard-accessible menu', async () => {
    const user = userEvent.setup()
    render(<UIRoot mode="fallback" />)
    for (const id of ['resume', 'harmony', 'codestory', 'github', 'contact', 'about'] as const) {
      await user.click(screen.getByTestId('open-quicklinks'))
      await screen.findByTestId('panel-quicklinks')
      await user.click(screen.getByTestId(`ql-${id}`))
      expect(await screen.findByTestId(`panel-${id}`)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Close panel' }))
      expect(screen.queryByRole('dialog')).toBeNull()
    }
  })

  it('marks the document for fallback layout', () => {
    render(<UIRoot mode="fallback" />)
    expect(document.documentElement.dataset.miwMode).toBe('fallback')
  })
})

describe('UIRoot — keyboard shortcuts', () => {
  it('M toggles the directory, P the quick links, ? opens help', async () => {
    const user = userEvent.setup()
    render(<UIRoot mode="game" />)
    await user.keyboard('m')
    expect(panelId()).toBe('directory')
    await screen.findByTestId('panel-directory')
    await user.keyboard('m')
    expect(panelId()).toBeNull()
    await user.keyboard('p')
    expect(panelId()).toBe('quicklinks')
    await user.keyboard('p')
    expect(panelId()).toBeNull()
    await user.keyboard('?')
    expect(panelId()).toBe('help')
  })

  it('ignores shortcuts while typing and with modifier keys (Ctrl+P prints)', () => {
    render(
      <>
        <input aria-label="Field" />
        <UIRoot mode="game" />
      </>,
    )
    fireEvent.keyDown(screen.getByLabelText('Field'), { key: 'm' })
    expect(panelId()).toBeNull()
    fireEvent.keyDown(window, { key: 'p', ctrlKey: true })
    expect(panelId()).toBeNull()
  })

  it('Esc with nothing open opens the pause menu (game mode only)', () => {
    const { unmount } = render(<UIRoot mode="game" />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(panelId()).toBe('quicklinks')
    act(() => useUIStore.getState().closePanel())
    unmount()
    render(<UIRoot mode="fallback" />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(panelId()).toBeNull()
  })

  it('Esc closes a panel even when focus is outside it (e.g. on the top bar)', async () => {
    render(<UIRoot mode="game" />)
    act(() => useUIStore.getState().openPanel('help'))
    await screen.findByTestId('panel-help')
    screen.getByTestId('open-directory').focus()
    fireEvent.keyDown(screen.getByTestId('open-directory'), { key: 'Escape' })
    expect(panelId()).toBeNull()
  })

  it('Esc closes the dialogue bubble first', () => {
    render(<UIRoot mode="game" />)
    act(() => useUIStore.getState().openDialogue({ npcId: 'x', name: 'Dot', role: 'Visitor Intake', lines: ['Hello.'] }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(useUIStore.getState().dialogue).toBeNull()
    expect(panelId()).toBeNull()
  })

  it('Esc closes the narrow-screen menu before anything else', () => {
    render(<UIRoot mode="game" />)
    act(() => useTopbarMenu.getState().setOpen(true))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(useTopbarMenu.getState().open).toBe(false)
    expect(panelId()).toBeNull()
  })

  it('handles the map / menu / quicklinks / help actions (touch buttons)', () => {
    render(<UIRoot mode="game" />)
    act(() => actions.trigger('map'))
    expect(panelId()).toBe('directory')
    act(() => actions.trigger('menu'))
    expect(panelId()).toBe('quicklinks')
    act(() => actions.trigger('help'))
    expect(panelId()).toBe('help')
    act(() => actions.trigger('quicklinks'))
    expect(panelId()).toBe('quicklinks')
  })

  it('is StrictMode-safe: exactly one handler per key/action, and no leaked bus subscribers', () => {
    act(() => useGameStore.setState({ status: 'ready', modulesLoaded: 10, modulesTotal: 10 }))
    const before = events.count()
    const { unmount } = render(
      <StrictMode>
        <UIRoot mode="game" />
      </StrictMode>,
    )
    fireEvent.keyDown(window, { key: 'm' }) // a leaked duplicate listener would toggle twice (net: closed)
    expect(panelId()).toBe('directory')
    act(() => actions.trigger('help'))
    expect(panelId()).toBe('help')
    act(() => events.emit('achievement', { id: 'goal' }))
    expect(screen.getAllByText('Back of the Net')).toHaveLength(1) // one toast, not one per subscriber
    unmount()
    expect(events.count()).toBe(before)
  })

  it('unregisters every listener on unmount', () => {
    const { unmount } = render(<UIRoot mode="game" />)
    unmount()
    act(() => actions.trigger('map'))
    fireEvent.keyDown(window, { key: 'm' })
    expect(panelId()).toBeNull()
  })
})

describe('UIRoot — loading screen', () => {
  it('shows progress while loading and leaves once the world is ready', async () => {
    act(() => useGameStore.setState({ status: 'loading', modulesLoaded: 3, modulesTotal: 10 }))
    render(<UIRoot mode="game" />)
    const loading = screen.getByTestId('loading-screen')
    expect(loading).toHaveTextContent(/powering up the factory/i)
    expect(within(loading).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '30')
    expect(loading).toHaveTextContent('3/10 systems online')
    // navigation stays usable above it
    fireEvent.click(within(loading).getByRole('button', { name: /portfolio quick links/i }))
    expect(panelId()).toBe('quicklinks')
    act(() => useUIStore.getState().closePanel())

    act(() => useGameStore.setState({ status: 'ready', modulesLoaded: 10 }))
    await waitFor(() => expect(screen.queryByTestId('loading-screen')).toBeNull(), { timeout: 2000 })
  })

  it('is indeterminate (no fake 0%) until the first module slot registers', () => {
    act(() => useGameStore.setState({ status: 'loading', modulesLoaded: 0, modulesTotal: 0 }))
    render(<UIRoot mode="game" />)
    const bar = within(screen.getByTestId('loading-screen')).getByRole('progressbar')
    expect(bar).not.toHaveAttribute('aria-valuenow')
    expect(bar).toHaveAttribute('aria-valuetext', 'Starting the 3D engine')
    act(() => useGameStore.setState({ modulesLoaded: 1, modulesTotal: 4 }))
    expect(bar).toHaveAttribute('aria-valuenow', '25')
  })
})

describe('UIRoot — panel switching', () => {
  it('switches between warmed panels synchronously, with no loading flash or backdrop gap', async () => {
    await preloadPanels()
    render(<UIRoot mode="game" />)
    act(() => useUIStore.getState().openPanel('quicklinks'))
    expect(screen.getByTestId('panel-quicklinks')).toBeInTheDocument()
    act(() => useUIStore.getState().openPanel('resume'))
    expect(screen.getByTestId('panel-resume')).toBeInTheDocument()
    expect(screen.queryByTestId('panel-loading')).toBeNull()
    act(() => useUIStore.getState().openPanel('project', { projectId: 'row-pergfect' }))
    expect(screen.getByTestId('panel-project')).toBeInTheDocument()
  })
})

describe('UIRoot — debug hooks', () => {
  it('registers __MIW__.ui with openPanel / closePanel / getState', () => {
    render(<UIRoot mode="game" />)
    const ui = (window as unknown as { __MIW__?: { ui?: Record<string, (...a: unknown[]) => unknown> } }).__MIW__?.ui
    expect(ui).toBeDefined()
    act(() => {
      ui!.openPanel('project', { projectId: 'row-pergfect' })
    })
    expect(ui!.getState()).toMatchObject({ panel: { id: 'project', params: { projectId: 'row-pergfect' } }, dialogue: null, prompt: null, routeTarget: null })
    act(() => {
      ui!.closePanel()
    })
    expect(panelId()).toBeNull()
  })
})
