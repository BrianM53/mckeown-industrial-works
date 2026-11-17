import { act, cleanup, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { SimClock } from '@/core/clock'
import { PHASE_ORDER } from './config'
import { factory, useFactory } from './index'
import { shallowEqual, useFactoryStore } from './react'
import { FactorySimulation } from './sim'
import type { FactoryState } from './types'

const sims: FactorySimulation[] = []
afterEach(() => {
  cleanup()
  for (const s of sims.splice(0)) s.stop()
  factory.resetParams()
})

function make() {
  const clock = new SimClock()
  const sim = new FactorySimulation({ clock, emit: () => {}, debugNamespace: null })
  sims.push(sim)
  sim.start()
  return { clock, sim }
}

/** Advance in small acts so each low-frequency change gets its own render opportunity. */
function play(clock: SimClock, seconds: number, slice = 0.25) {
  for (let t = 0; t < seconds - 1e-9; t += slice) act(() => clock.advance(slice))
}

describe('useFactory', () => {
  it('re-renders on phase change only — not per tick, not per countdown second', () => {
    const { clock, sim } = make()
    let notifications = 0
    sim.subscribe(() => notifications++)
    const renders: string[] = []
    function Probe() {
      const phase = useFactoryStore(sim, (s) => s.rocket.phase)
      renders.push(phase)
      return <span data-testid="phase">{phase}</span>
    }
    render(<Probe />)
    expect(renders).toEqual(['assembling'])
    act(() => sim.skipToLaunch())
    play(clock, 20 + 6 + 10 + 2 + 12 + 8 + 5 + 1)
    expect(screen.getByTestId('phase').textContent).toBe('assembling')
    expect(sim.state.rocket.id).toBe(2)
    expect(renders).toEqual([...PHASE_ORDER, 'assembling'])
    // The sim notified far more often (countdown seconds, stages, outcome, line status).
    expect(notifications).toBeGreaterThan(renders.length + 8)
  })

  it('selectors returning objects re-render only when the content changes (shallowEqual)', () => {
    const { clock, sim } = make()
    const renders: Array<{ successes: number; disassemblies: number }> = []
    const select = (s: FactoryState) => ({ successes: s.counters.successes, disassemblies: s.counters.disassemblies })
    function Probe() {
      const c = useFactoryStore(sim, select, shallowEqual)
      renders.push(c)
      return null
    }
    render(<Probe />)
    sim.forceNextOutcome('explosion')
    act(() => sim.skipToLaunch())
    play(clock, 20 + 6 + 10 + 2 + 12)
    expect(renders.map((r) => r.disassemblies)).toEqual([41, 42])
  })

  it('is StrictMode-safe and the app-wide hook reads the live params', () => {
    function Params() {
      const speed = useFactory((s) => s.params.conveyorSpeed)
      const certified = useFactory((s) => s.model.meetsTarget)
      return (
        <p data-testid="p">
          {speed.toFixed(1)}|{String(certified)}
        </p>
      )
    }
    render(
      <StrictMode>
        <Params />
      </StrictMode>,
    )
    expect(screen.getByTestId('p').textContent).toBe('1.0|false')
    act(() => factory.setParams({ conveyorSpeed: 1.3, inspection: 0.6, pressesToTanks: 3 }))
    expect(screen.getByTestId('p').textContent).toBe('1.3|true')
  })
})
