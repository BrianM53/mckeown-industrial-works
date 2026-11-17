import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { events } from '@/core/events'
import { DEFAULT_PARAMS, evaluate, factory } from '@/systems/factory'
import ConsolePanel from './ConsolePanel'
import { resetCertification } from './certification'

function setup() {
  const onClose = vi.fn()
  const achievements: string[] = []
  const toasts: string[] = []
  const offA = events.on('achievement', (p) => achievements.push(p.id))
  const offT = events.on('toast', (p) => toasts.push(p.text))
  const utils = render(<ConsolePanel onClose={onClose} />)
  return { ...utils, onClose, achievements, toasts, off: () => (offA(), offT()) }
}

const speed = () => screen.getByLabelText('Conveyor speed') as HTMLInputElement
const inspection = () => screen.getByLabelText('Inspection thoroughness') as HTMLInputElement
const presses = (n: number) => screen.getByRole('radio', { name: `${n} of 6 presses on tank shells` }) as HTMLInputElement
const value = (testId: string) => screen.getByTestId(`${testId}-value`).textContent

beforeEach(() => {
  act(() => factory.resetParams())
  resetCertification()
})
afterEach(() => {
  cleanup()
  act(() => factory.resetParams())
})

describe('Line Supervisor Console', () => {
  it('renders the HMI panel with three labelled controls, readouts, target and the fiction note', () => {
    const { off } = setup()
    const dialog = screen.getByRole('dialog', { name: 'Line Supervisor Console' })
    expect(within(dialog).getByText('PRODUCTION SPINE · LINE SUPERVISOR CONSOLE')).toBeInTheDocument()
    expect(dialog.className).toContain('miw-panel--hmi')
    expect(speed().type).toBe('range')
    expect(speed().min).toBe('0.5')
    expect(speed().max).toBe('2')
    expect(speed().step).toBe('0.1')
    expect(inspection().step).toBe('0.05')
    expect(screen.getAllByRole('radio')).toHaveLength(5)
    expect(presses(1).checked).toBe(true)
    // Baseline readouts straight from the model.
    const base = evaluate(DEFAULT_PARAMS)
    expect(value('console-throughput')).toBe('7.4')
    expect(value('console-defects')).toBe('4.1%')
    expect(value('console-odds')).toBe(`${Math.round(base.successChance * 100)}%`)
    expect(value('console-speed')).toBe('1.0×')
    expect(value('console-inspection')).toBe('20%')
    expect(screen.getByTestId('console-bottleneck')).toHaveTextContent(/Tank line/i)
    expect(within(screen.getByTestId('console-hints')).getAllByRole('listitem').length).toBe(base.explanation.length)
    expect(screen.getByText(/≥ 20 rockets\/hr/)).toBeInTheDocument()
    expect(screen.getByText(/≤ 2.5% escaped defects/)).toBeInTheDocument()
    expect(screen.getByTestId('console-status')).toHaveTextContent(/Not certified/i)
    expect(screen.getByText('Simulated data — this factory is fictional.')).toBeInTheDocument()
    expect(screen.getByTestId('console-floor')).toHaveTextContent(/Rocket #\d+/)
    off()
  })

  it('sliders and the press selector change the live factory params', async () => {
    const user = userEvent.setup()
    const { off } = setup()
    fireEvent.change(speed(), { target: { value: '1.5' } })
    expect(factory.state.params.conveyorSpeed).toBe(1.5)
    expect(value('console-speed')).toBe('1.5×')
    fireEvent.change(inspection(), { target: { value: '0.45' } })
    expect(factory.state.params.inspection).toBe(0.45)
    expect(value('console-inspection')).toBe('45%')
    await user.click(presses(3))
    expect(factory.state.params.pressesToTanks).toBe(3)
    expect(presses(3).checked).toBe(true)
    expect(screen.getByTestId('console-bottleneck')).toHaveTextContent(/Inspection|balanced/i)
    const r = evaluate(factory.state.params)
    expect(value('console-throughput')).toBe((Math.floor(r.throughputPerHour * 10 + 1e-9) / 10).toFixed(1))
    // Keyboard: arrows move within the radio group.
    presses(3).focus()
    await user.keyboard('{ArrowRight}')
    expect(factory.state.params.pressesToTanks).toBe(4)
    expect(screen.getByTestId('console-bottleneck')).toHaveTextContent(/Sheet stamping/i)
    off()
  })

  it('reset restores the defaults', async () => {
    const user = userEvent.setup()
    const { off } = setup()
    fireEvent.change(speed(), { target: { value: '1.8' } })
    fireEvent.change(inspection(), { target: { value: '0.9' } })
    await user.click(presses(5))
    expect(factory.state.params).not.toEqual(DEFAULT_PARAMS)
    await user.click(screen.getByRole('button', { name: /Reset to defaults/i }))
    expect(factory.state.params).toEqual(DEFAULT_PARAMS)
    expect(speed().value).toBe('1')
    expect(inspection().value).toBe('0.2')
    expect(presses(1).checked).toBe(true)
    expect(value('console-throughput')).toBe('7.4')
    off()
  })

  it('shows LINE CERTIFIED when the target is met, and celebrates only the first time', async () => {
    const user = userEvent.setup()
    const { off, achievements, toasts } = setup()
    expect(screen.queryByText(/Line certified/i, { selector: '.lsc-stamp' })).toBeNull()
    await user.click(presses(3))
    fireEvent.change(speed(), { target: { value: '1.3' } })
    expect(screen.getByTestId('console-status')).toHaveTextContent(/Not certified/i)
    fireEvent.change(inspection(), { target: { value: '0.6' } })
    expect(factory.state.model.meetsTarget).toBe(true)
    const status = screen.getByTestId('console-status')
    expect(status).toHaveTextContent(/Line certified/i)
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(screen.getAllByText(/On target/i)).toHaveLength(2)
    expect(achievements).toEqual(['line-certified'])
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatch(/Line certified/)
    // Drop out of spec and back in: no second celebration.
    fireEvent.change(inspection(), { target: { value: '0.2' } })
    expect(status).toHaveTextContent(/Not certified/i)
    fireEvent.change(inspection(), { target: { value: '0.6' } })
    expect(status).toHaveTextContent(/Line certified/i)
    expect(achievements).toEqual(['line-certified'])
    expect(toasts).toHaveLength(1)
    off()
  })

  it('explains the model in plain language on demand', async () => {
    const user = userEvent.setup()
    const { off } = setup()
    const summary = screen.getByText('How the model works')
    const details = summary.closest('details')!
    expect(details.open).toBe(false)
    await user.click(summary)
    expect(details.open).toBe(true)
    expect(within(details).getByText(/throughput = slowest line × \(1 − 0.35 × inspection\)/)).toBeInTheDocument()
    expect(within(details).getAllByRole('listitem')).toHaveLength(5)
    off()
  })

  it('is keyboard operable and closes with Esc or the ✕ button', async () => {
    const user = userEvent.setup()
    const { off, onClose } = setup()
    // Walk one full cycle of the focus trap.
    const stops: HTMLElement[] = []
    for (let i = 0; i < 20; i++) {
      await user.tab()
      const el = document.activeElement as HTMLElement
      if (stops.includes(el)) break
      stops.push(el)
    }
    const mine = stops.filter((el) => el.closest('.lsc, .lsc-footer') && el.matches('input, button, summary'))
    expect(mine).toEqual([presses(1), speed(), inspection(), screen.getByText('How the model works'), screen.getByRole('button', { name: /Reset to defaults/i })])
    expect(stops).toContain(screen.getByRole('button', { name: 'Close panel' }))
    speed().focus()
    expect(document.activeElement).toBe(speed())
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Close panel' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    off()
  })

  it('follows the live factory floor (rocket phase and line status)', () => {
    const { off } = setup()
    const sim = factory as unknown as { skipToPhase?: (p: string) => void }
    expect(screen.getByTestId('console-floor')).toHaveTextContent(/Assembling/)
    act(() => factory.skipToLaunch())
    expect(screen.getByTestId('console-floor')).toHaveTextContent(/Rolling out to the pad/)
    act(() => sim.skipToPhase?.('countdown'))
    expect(screen.getByTestId('console-floor')).toHaveTextContent(/Countdown: T−10/)
    act(() => factory.reset(true))
    expect(screen.getByTestId('console-floor')).toHaveTextContent(/Rocket #1 Assembling/)
    expect(screen.getAllByRole('listitem').some((li) => /Sheet stamping/.test(li.textContent ?? ''))).toBe(true)
    off()
  })
})
