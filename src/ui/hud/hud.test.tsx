import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACHIEVEMENTS } from '@/content/achievements'
import { SPAWN_HINT } from '@/content/controls'
import { actions } from '@/core/actions'
import { events } from '@/core/events'
import { runtime } from '@/core/runtime'
import { useGameStore } from '@/state/game'
import { useSettings } from '@/state/settings'
import { useUIStore } from '@/state/ui'
import { PRINCIPAL_ZONES, ZONES } from '@/world/layout'
import { useModality } from '../lib/modality'
import { LITE_OFFER_TEXT, resetLiteOffer } from '../lib/liteOffer'
import { resetUIState } from '../testing/helpers'
import UIRoot from '../UIRoot'
import { HINT_SECONDS } from './ControlsHint'
import { SLOW_SECONDS } from './useSlowDeviceOffer'

function renderGame() {
  act(() => useGameStore.setState({ status: 'ready', modulesLoaded: 10, modulesTotal: 10 }))
  return render(<UIRoot mode="game" />)
}

// UIRoot code-splits the game-mode layers (React.lazy: Hud + TouchControls under one Suspense).
// Resolve those chunks once, with real timers, so every test below renders them synchronously.
beforeAll(async () => {
  resetUIState()
  renderGame()
  await screen.findByTestId('hud')
  cleanup()
})

beforeEach(() => {
  resetUIState()
  runtime.player.speed = 0
  runtime.input.touchMove.x = 0
  runtime.input.touchMove.y = 0
  runtime.input.touchRun = false
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('captions', () => {
  it('show caption events in a polite live region and expire', () => {
    vi.useFakeTimers()
    renderGame()
    const log = screen.getByTestId('captions')
    expect(log).toHaveAttribute('aria-live', 'polite')
    act(() => events.emit('caption', { text: 'Whistle blows', kind: 'sound', duration: 2 }))
    expect(log).toHaveTextContent('Whistle blows')
    act(() => events.emit('caption', { text: 'Attention all staff', kind: 'pa' }))
    expect(log).toHaveTextContent('Attention all staff')
    act(() => vi.advanceTimersByTime(2100))
    expect(log).not.toHaveTextContent('Whistle blows')
  })

  it('are hidden when captions are off, but warnings still surface as toasts', () => {
    useSettings.setState({ captions: false })
    renderGame()
    act(() => events.emit('caption', { text: 'Machine hum', kind: 'sound' }))
    act(() => events.emit('caption', { text: 'Launch in 10 seconds', kind: 'warning' }))
    expect(screen.getByTestId('captions')).not.toHaveTextContent('Machine hum')
    expect(screen.getByTestId('toasts')).toHaveTextContent('Launch in 10 seconds')
  })
})

describe('toasts and achievements', () => {
  it('shows toast events', () => {
    renderGame()
    act(() => events.emit('toast', { text: 'Forklift recovered', kind: 'success' }))
    expect(screen.getByTestId('toasts')).toHaveTextContent('Forklift recovered')
  })

  it('unlocks achievements once, with a toast and a sound', () => {
    renderGame()
    const sfx: string[] = []
    const off = events.on('sfx', (p) => sfx.push(p.name))
    const a = ACHIEVEMENTS.find((x) => x.id === 'goal')!
    act(() => events.emit('achievement', { id: 'goal' }))
    act(() => events.emit('achievement', { id: 'goal' }))
    off()
    expect(useGameStore.getState().achievements.goal).toBe(1)
    const toasts = screen.getByTestId('toasts')
    expect(toasts).toHaveTextContent(`Achievement unlocked: ${a.title}`)
    expect(within(toasts).getAllByText(a.title)).toHaveLength(1)
    expect(sfx.filter((n) => n === 'achievement')).toHaveLength(1)
  })

  it('ignores unknown achievement ids', () => {
    renderGame()
    act(() => events.emit('achievement', { id: 'made-up' }))
    expect(useGameStore.getState().achievements).toEqual({})
    expect(screen.getByTestId('toasts')).toBeEmptyDOMElement()
  })

  it('awards the Full Site Tour after all five principal panels were opened', () => {
    renderGame()
    for (const z of PRINCIPAL_ZONES) act(() => useUIStore.getState().openPanel(ZONES[z].panel!))
    expect(useGameStore.getState().achievements['all-stations']).toBeDefined()
  })
})

describe('interaction prompt', () => {
  it('shows keycap E + verb + label and hides while an overlay is open', () => {
    renderGame()
    act(() => useUIStore.getState().setPrompt({ id: 'station:resume', verb: 'Inspect', label: 'Résumé-O-Matic 3000' }))
    const host = screen.getByTestId('interaction-prompt')
    expect(host).toHaveTextContent('E')
    expect(host).toHaveTextContent('Inspect')
    expect(host).toHaveTextContent('Résumé-O-Matic 3000')
    act(() => useUIStore.getState().openPanel('help'))
    expect(host).toBeEmptyDOMElement()
  })

  it('on touch devices the Interact button carries the label instead', () => {
    useModality.setState({ forced: true })
    renderGame()
    act(() => useUIStore.getState().setPrompt({ id: 'npc:dot', verb: 'Talk', label: 'Dot' }))
    expect(screen.getByTestId('interaction-prompt')).toBeEmptyDOMElement()
    const btn = screen.getByTestId('touch-interact')
    expect(btn).toHaveAccessibleName('Talk: Dot')
    const fired = vi.fn()
    const off = actions.on('interact', fired)
    fireEvent.click(btn)
    off()
    expect(fired).toHaveBeenCalledTimes(1)
  })
})

describe('controls hint', () => {
  it('appears on spawn and hides after ~9 s', () => {
    vi.useFakeTimers()
    renderGame()
    const hint = screen.getByTestId('controls-hint')
    for (const line of SPAWN_HINT.desktop) expect(hint.textContent?.replace(/\s+/g, ' ')).toContain(line)
    act(() => vi.advanceTimersByTime((HINT_SECONDS - 1) * 1000))
    expect(useUIStore.getState().controlsHintVisible).toBe(true)
    act(() => vi.advanceTimersByTime(1500))
    expect(useUIStore.getState().controlsHintVisible).toBe(false)
    act(() => vi.advanceTimersByTime(600))
    expect(screen.queryByTestId('controls-hint')).toBeNull()
  })

  it('hides once the worker has been walking for about a second', () => {
    vi.useFakeTimers()
    renderGame()
    runtime.player.speed = 2
    act(() => vi.advanceTimersByTime(1100))
    expect(useUIStore.getState().controlsHintVisible).toBe(false)
  })

  it('steps aside for good once the visitor talks to someone', () => {
    vi.useFakeTimers()
    renderGame()
    act(() => useUIStore.getState().openDialogue({ npcId: 'greeter', name: 'Dot', role: 'Visitor Intake', lines: ['Hello.'] }))
    act(() => vi.advanceTimersByTime(300))
    expect(useUIStore.getState().controlsHintVisible).toBe(false)
  })

  it('pauses its clock while a panel is open', () => {
    vi.useFakeTimers()
    renderGame()
    act(() => useUIStore.getState().openPanel('help'))
    act(() => vi.advanceTimersByTime((HINT_SECONDS + 2) * 1000))
    expect(useUIStore.getState().controlsHintVisible).toBe(true)
  })

  it('respects controlsHintVisible set by other modules', () => {
    act(() => useUIStore.getState().setControlsHintVisible(false))
    renderGame()
    expect(screen.queryByTestId('controls-hint')).toBeNull()
  })

  it('sits top-left for mouse/keyboard, and in the bottom stack above the stick on touch', () => {
    const { unmount } = renderGame()
    expect(screen.getByTestId('controls-hint').parentElement).toHaveClass('miw-hud__tl')
    unmount()
    useModality.setState({ forced: true })
    renderGame()
    const hint = screen.getByTestId('controls-hint')
    // clear of the top of the view (spawn wayfinding sign) on phones
    expect(hint.parentElement).toHaveClass('miw-hud__bc')
    for (const line of SPAWN_HINT.touch) expect(hint).toHaveTextContent(line)
  })
})

describe('slow-device lite offer', () => {
  beforeEach(() => {
    resetLiteOffer()
    runtime.frame.fps = 60
  })
  afterEach(() => {
    resetLiteOffer()
    runtime.frame.fps = 60
    useGameStore.setState({ quality: 'medium' })
  })

  it('offers the lite portfolio once per session after ~8 s under 18 fps at the low tier', () => {
    vi.useFakeTimers()
    useGameStore.setState({ quality: 'low' })
    runtime.frame.fps = 9
    const { unmount } = renderGame()
    act(() => vi.advanceTimersByTime((SLOW_SECONDS - 1) * 1000))
    expect(screen.queryByText(LITE_OFFER_TEXT)).toBeNull()
    act(() => vi.advanceTimersByTime(1500))
    const toast = screen.getByText(LITE_OFFER_TEXT).closest('.miw-toast') as HTMLElement
    expect(within(toast).getByRole('link', { name: 'Switch to lite' })).toHaveAttribute('href', '/?lite=1')
    expect(within(toast).getByRole('link', { name: 'Portfolio page' })).toHaveAttribute('href', '/portfolio/')
    // non-blocking but sticky: still offered long after an ordinary toast would have expired
    act(() => vi.advanceTimersByTime(60_000))
    expect(screen.getByText(LITE_OFFER_TEXT)).toBeInTheDocument()
    fireEvent.click(within(toast).getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByText(LITE_OFFER_TEXT)).toBeNull()
    // once per session
    unmount()
    renderGame()
    act(() => vi.advanceTimersByTime(30_000))
    expect(screen.queryByText(LITE_OFFER_TEXT)).toBeNull()
  })

  it('stays quiet above the low tier, at playable frame rates and while a panel is open', () => {
    vi.useFakeTimers()
    runtime.frame.fps = 9
    useGameStore.setState({ quality: 'medium' })
    renderGame()
    act(() => vi.advanceTimersByTime(30_000)) // medium: the perf monitor can still step down
    act(() => useGameStore.setState({ quality: 'low' }))
    runtime.frame.fps = 24
    act(() => vi.advanceTimersByTime(30_000))
    runtime.frame.fps = 9
    act(() => useUIStore.getState().openPanel('help'))
    act(() => vi.advanceTimersByTime(30_000)) // reading a panel: the frame rate does not matter
    expect(screen.queryByText(LITE_OFFER_TEXT)).toBeNull()
    act(() => useUIStore.getState().closePanel())
    act(() => vi.advanceTimersByTime((SLOW_SECONDS + 1) * 1000))
    expect(screen.getByText(LITE_OFFER_TEXT)).toBeInTheDocument()
  })
})

describe('recovery hint, fade, launch strip, fps', () => {
  it('shows the recovery hint with a working Recover button', () => {
    renderGame()
    act(() => useUIStore.getState().setRecoveryHint('Stuck? Press R to recover'))
    const fired = vi.fn()
    const off = actions.on('recover', fired)
    const hint = screen.getByTestId('recovery-hint')
    expect(hint).toHaveTextContent('Stuck? Press R to recover')
    fireEvent.click(within(hint).getByRole('button', { name: /recover/i }))
    off()
    expect(fired).toHaveBeenCalledTimes(1)
  })

  it('fade overlay blocks input only when mostly opaque', () => {
    renderGame()
    expect(screen.queryByTestId('fade-overlay')).toBeNull()
    act(() => useUIStore.getState().setFade({ opacity: 0.3 }))
    expect(screen.getByTestId('fade-overlay')).toHaveStyle({ pointerEvents: 'none' })
    act(() => useUIStore.getState().setFade({ opacity: 1, label: 'Travelling to the Personnel Office' }))
    const fade = screen.getByTestId('fade-overlay')
    expect(fade).toHaveStyle({ pointerEvents: 'auto' })
    expect(fade).toHaveTextContent('Travelling to the Personnel Office')
  })

  it('launch strip reads the factory sim and is marked as simulated', () => {
    renderGame()
    const strip = screen.getByTestId('launch-strip')
    expect(strip).toHaveTextContent(/ROCKET #\d+/)
    expect(strip.getAttribute('title')).toMatch(/simulated/i)
  })

  it('FPS readout follows the setting', () => {
    renderGame()
    expect(screen.queryByTestId('fps')).toBeNull()
    act(() => useSettings.getState().set({ showFps: true }))
    expect(screen.getByTestId('fps')).toHaveTextContent(/\d+ FPS/)
  })
})

describe('dialogue bubble', () => {
  it('shows speaker, role and line; E advances, the last line closes', async () => {
    renderGame()
    act(() => useUIStore.getState().openDialogue({ npcId: 'greeter', name: 'Dot', role: 'Visitor Intake', lines: ['First line.', 'Second line.'] }))
    const host = screen.getByTestId('dialogue')
    expect(host).toHaveAttribute('aria-live', 'polite')
    expect(host).toHaveTextContent('Dot')
    expect(host).toHaveTextContent('Visitor Intake')
    expect(host).toHaveTextContent('First line.')
    // the key press that opened the dialogue is ignored for a moment
    fireEvent.keyDown(window, { key: 'e' })
    expect(host).toHaveTextContent('First line.')
    await act(() => new Promise((r) => setTimeout(r, 180)))
    fireEvent.keyDown(window, { key: 'e' })
    expect(host).toHaveTextContent('Second line.')
    fireEvent.keyDown(window, { key: ' ' })
    expect(useUIStore.getState().dialogue).toBeNull()
  })

  it('consumes the E that closes the last line, so the game cannot re-interact with the same press', async () => {
    renderGame()
    // Stands in for the player module's window keydown listener (bubble phase).
    const gameKeys = vi.fn()
    window.addEventListener('keydown', gameKeys)
    try {
      act(() => useUIStore.getState().openDialogue({ npcId: 'greeter', name: 'Dot', role: 'Visitor Intake', lines: ['Only line.'] }))
      await act(() => new Promise((r) => setTimeout(r, 180)))
      fireEvent.keyDown(document.body, { key: 'e' })
      expect(useUIStore.getState().dialogue).toBeNull()
      expect(gameKeys).not.toHaveBeenCalled()
      // With the bubble gone, E belongs to the game again.
      fireEvent.keyDown(document.body, { key: 'e' })
      expect(gameKeys).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('keydown', gameKeys)
    }
  })

  it('clicking the card advances and ✕ closes', async () => {
    renderGame()
    act(() => useUIStore.getState().openDialogue({ npcId: 'n', name: 'Gus', role: 'Welder', lines: ['One.', 'Two.', 'Three.'] }))
    fireEvent.click(screen.getByText('One.'))
    expect(screen.getByTestId('dialogue')).toHaveTextContent('Two.')
    fireEvent.click(screen.getByRole('button', { name: 'Close dialogue' }))
    expect(useUIStore.getState().dialogue).toBeNull()
  })
})

describe('touch controls', () => {
  it('render only for touch input, and hide (resetting movement) while a panel is open', () => {
    renderGame()
    expect(screen.queryByTestId('touch-controls')).toBeNull()
    act(() => useModality.getState().force(true))
    expect(screen.getByTestId('touch-controls')).toBeInTheDocument()
    runtime.input.touchMove.x = 0.7
    act(() => useUIStore.getState().openPanel('help'))
    expect(screen.queryByTestId('touch-controls')).toBeNull()
    expect(runtime.input.touchMove.x).toBe(0)
  })

  it('buttons trigger actions and toggle run', () => {
    useModality.setState({ forced: true })
    renderGame()
    const seen: string[] = []
    const offs = (['recover', 'recenter'] as const).map((n) => actions.on(n, () => seen.push(n)))
    fireEvent.click(screen.getByRole('button', { name: 'Recover (unstick)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Recenter camera' }))
    offs.forEach((o) => o())
    expect(seen).toEqual(['recover', 'recenter'])
    const run = screen.getByRole('button', { name: 'Run' })
    fireEvent.click(run)
    expect(runtime.input.touchRun).toBe(true)
    expect(run).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Map and directory' }))
    expect(useUIStore.getState().panel?.id).toBe('directory')
  })

  it('the joystick writes touchMove and resets on release; drags elsewhere accumulate look', () => {
    useModality.setState({ forced: true })
    const { container } = renderGame()
    const zone = container.querySelector<HTMLElement>('.miw-touch__stick-zone')!
    zone.getBoundingClientRect = () => ({ left: 0, top: 400, right: 300, bottom: 800, width: 300, height: 400, x: 0, y: 400, toJSON: () => ({}) })
    fireEvent.pointerDown(zone, { pointerId: 1, clientX: 150, clientY: 600 })
    fireEvent.pointerMove(zone, { pointerId: 1, clientX: 150, clientY: 540 })
    expect(runtime.input.touchMove.y).toBeGreaterThan(0.9)
    expect(Math.abs(runtime.input.touchMove.x)).toBeLessThan(1e-6)
    fireEvent.pointerUp(zone, { pointerId: 1, clientX: 150, clientY: 540 })
    expect(runtime.input.touchMove.y).toBe(0)

    const look = container.querySelector<HTMLElement>('.miw-touch__look')!
    runtime.input.touchLook.dx = 0
    runtime.input.touchLook.dy = 0
    fireEvent.pointerDown(look, { pointerId: 2, clientX: 600, clientY: 300 })
    fireEvent.pointerMove(look, { pointerId: 2, clientX: 640, clientY: 290 })
    expect(runtime.input.touchLook.dx).toBe(40)
    expect(runtime.input.touchLook.dy).toBe(-10)
    // second finger → pinch (fingers closing = zoom out = positive)
    runtime.input.touchZoom = 0
    fireEvent.pointerDown(look, { pointerId: 3, clientX: 740, clientY: 290 })
    fireEvent.pointerMove(look, { pointerId: 3, clientX: 700, clientY: 290 })
    expect(runtime.input.touchZoom).toBeCloseTo(40)
    expect(runtime.input.touchLook.dx).toBe(40)
    fireEvent.pointerUp(look, { pointerId: 2 })
    fireEvent.pointerUp(look, { pointerId: 3 })
  })
})
