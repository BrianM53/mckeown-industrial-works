/**
 * §12.9 Rocket production cycle, §12.10 optimization minigame (Line Supervisor Console).
 * Sim time is fast-forwarded through __MIW__.factory.advance / __MIW__.clock.advance.
 */
import { expect, test, type Page } from '@playwright/test'
import { teleport, uiState, useGamePage } from './helpers'

const g = useGamePage({ needs: ['factory.getState', 'factory.advance', 'factory.forceNextOutcome', 'factory.setParams'] })

interface Rocket {
  id: number
  phase: string
  stagesComplete: number
  countdown: number | null
  outcome: string | null
}
interface Model {
  throughputPerHour: number
  defectRate: number
  successChance: number
  bottleneck: string
  meetsTarget: boolean
}
interface FactorySnap {
  rocket: Rocket
  params: { conveyorSpeed: number; inspection: number; pressesToTanks: number }
  model: Model
  counters: { successes: number; disassemblies: number }
  history: { rocketId: number; outcome: string; stowaway: boolean }[]
  lines: Record<string, { rate: number; status: string }>
}
const snap = (p: Page): Promise<FactorySnap> => p.evaluate(() => window.__MIW__.factory.getState())

/**
 * Step the sim in small increments inside the page until `stop` matches (or `maxSeconds`), and
 * return the ordered list of rocket phases seen plus the final rocket.
 */
async function runUntil(p: Page, stop: { phase?: string; id?: number }, maxSeconds: number, step = 0.25): Promise<{ phases: string[]; stages: number[]; rocket: Rocket; t: number }> {
  return p.evaluate(
    ({ stop: st, maxSeconds: max, step: dt }) => {
      const f = window.__MIW__.factory
      const phases: string[] = []
      const stages: number[] = []
      let r = f.getState().rocket as { id: number; phase: string; stagesComplete: number; countdown: number | null; outcome: string | null }
      let t = 0
      const done = () => (st.phase === undefined || r.phase === st.phase) && (st.id === undefined || r.id === st.id)
      phases.push(r.phase)
      stages.push(r.stagesComplete)
      while (!done() && t < max) {
        r = f.advance(dt)
        t += dt
        if (phases[phases.length - 1] !== r.phase) phases.push(r.phase)
        if (stages[stages.length - 1] !== r.stagesComplete) stages.push(r.stagesComplete)
      }
      return { phases, stages, rocket: r, t }
    },
    { stop, maxSeconds, step },
  )
}

test.describe('§12.9 rocket production cycle', () => {
  test('§12.9 rocket assembles, wheels out, counts down, launches, records the outcome and the next rocket starts', async () => {
    const p = g.page
    const s0 = await snap(p)
    const id0 = s0.rocket.id
    const hist0 = s0.history.length
    expect(s0.rocket.phase).toBe('assembling')
    await p.evaluate(() => window.__MIW__.factory.forceNextOutcome('wobble'))

    // 1. assembly completes on its own (stages 0..6), then rollout starts
    const build = await runUntil(p, { phase: 'rollout' }, 900, 1)
    expect(build.rocket.phase, `phases ${build.phases.join('→')}`).toBe('rollout')
    expect(build.rocket.stagesComplete).toBe(6)
    for (let i = 1; i < build.stages.length; i++) expect(build.stages[i]).toBeGreaterThan(build.stages[i - 1]) // monotonic build-up

    // 2. wheel-out → pad → countdown: the HUD shows the countdown strip
    const toCountdown = await runUntil(p, { phase: 'countdown' }, 300)
    expect(toCountdown.rocket.phase, `phases ${toCountdown.phases.join('→')}`).toBe('countdown')
    expect(toCountdown.rocket.countdown).not.toBeNull()
    await expect(p.getByTestId('launch-strip')).toBeVisible({ timeout: 60_000 })

    // 3. ignition → flight → aftermath → reset → next rocket assembling
    const rest = await runUntil(p, { phase: 'assembling', id: id0 + 1 }, 600)
    const all = ['assembling', ...build.phases.slice(1), ...toCountdown.phases.slice(1), ...rest.phases.slice(1)]
    const order = ['assembling', 'rollout', 'pad', 'countdown', 'ignition', 'flight', 'aftermath', 'reset', 'assembling']
    expect(all, `observed ${all.join('→')}`).toEqual(order)
    expect(rest.rocket.id).toBe(id0 + 1)
    expect(rest.rocket.stagesComplete).toBe(0)

    // 4. outcome recorded
    const s1 = await snap(p)
    expect(s1.history.length).toBe(hist0 + 1)
    expect(s1.history[s1.history.length - 1]).toMatchObject({ rocketId: id0, outcome: 'wobble' })
    expect(s1.counters.successes).toBe(s0.counters.successes + 1)
  })

  test('§12.9 a failed launch is recorded too and production keeps going (shortcut via skipToLaunch)', async () => {
    const p = g.page
    const s0 = await snap(p)
    if (s0.rocket.phase !== 'assembling') await runUntil(p, { phase: 'assembling', id: s0.rocket.id + 1 }, 600)
    const s1 = await snap(p)
    await p.evaluate(() => window.__MIW__.factory.forceNextOutcome('explosion'))
    expect(await p.evaluate(() => window.__MIW__.factory.skipToLaunch())).not.toBe('assembling')
    const r = await runUntil(p, { phase: 'assembling', id: s1.rocket.id + 1 }, 900)
    expect(r.phases).toContain('ignition')
    const s2 = await snap(p)
    expect(s2.history[s2.history.length - 1]).toMatchObject({ rocketId: s1.rocket.id, outcome: 'explosion' })
    expect(s2.counters.disassemblies).toBe(s1.counters.disassemblies + 1)
    expect(s2.rocket.phase).toBe('assembling')
  })
})

test.describe('§12.10 optimization minigame', () => {
  test('§12.10 console parameters change throughput/defects per the model, and reset restores the baseline', async () => {
    const p = g.page
    await p.evaluate(() => {
      window.__MIW__.ui.closePanel()
      window.__MIW__.factory.resetParams()
    })
    const base = await snap(p)

    // the tested model's directions (pure function used by the sim)
    const dir = (await p.evaluate(() => {
      const ev = window.__MIW__.factory.evaluate
      return {
        insp0: ev({ inspection: 0 }).defectRate as number,
        insp1: ev({ inspection: 1 }).defectRate as number,
        tanks1: ev({ pressesToTanks: 1 }).throughputPerHour as number,
        tanks3: ev({ pressesToTanks: 3 }).throughputPerHour as number,
      }
    })) as { insp0: number; insp1: number; tanks1: number; tanks3: number }
    expect(dir.insp1, 'more inspection → fewer escaped defects').toBeLessThan(dir.insp0)
    expect(dir.tanks3, 'starved tank line: more tank presses → more rockets/hour').toBeGreaterThan(dir.tanks1)

    // open the console in-world: walk up and press E
    await teleport(p, 3.3, 19, -Math.PI / 2)
    await expect.poll(async () => (await uiState(p)).prompt?.id ?? null, { timeout: 60_000 }).toBe('station:console')
    await p.keyboard.press('KeyE')
    // ConsolePanel does not pass testId="panel-console" (falls back to "panel"): locate it by its dialog name
    const panel = p.getByRole('dialog', { name: 'Line Supervisor Console' })
    await expect(panel).toBeVisible({ timeout: 60_000 })
    const read = async () => ({
      throughput: (await p.getByTestId('console-throughput-value').textContent())?.trim() ?? '',
      defects: (await p.getByTestId('console-defects-value').textContent())?.trim() ?? '',
      odds: (await p.getByTestId('console-odds-value').textContent())?.trim() ?? '',
    })
    const baseUi = await read()
    const expectModelMatchesParams = async () => {
      const s = await snap(p)
      const want = (await p.evaluate((params) => window.__MIW__.factory.evaluate(params), s.params)) as Model
      expect(s.model.throughputPerHour).toBeCloseTo(want.throughputPerHour, 6)
      expect(s.model.defectRate).toBeCloseTo(want.defectRate, 6)
      expect(s.model.successChance).toBeCloseTo(want.successChance, 6)
      return s
    }

    // conveyor speed slider (keyboard): End → max
    await p.getByTestId('console-speed').focus()
    await p.keyboard.press('End')
    await expect.poll(async () => (await snap(p)).params.conveyorSpeed).toBe(2)
    const sSpeed = await expectModelMatchesParams()
    expect(sSpeed.model.throughputPerHour !== base.model.throughputPerHour || sSpeed.model.defectRate !== base.model.defectRate).toBe(true)

    // inspection slider: End → 100 %: fewer defects than at the default inspection level
    await p.getByTestId('console-inspection').focus()
    await p.keyboard.press('End')
    await expect.poll(async () => (await snap(p)).params.inspection).toBe(1)
    const sInsp = await expectModelMatchesParams()
    expect(sInsp.model.defectRate).toBeLessThan(sSpeed.model.defectRate)

    // presses: 3 of 6 on tank shells
    await panel.getByRole('radio', { name: /^3 of 6 presses/ }).check({ force: true })
    await expect.poll(async () => (await snap(p)).params.pressesToTanks).toBe(3)
    const sPress = await expectModelMatchesParams()
    expect(sPress.model.throughputPerHour).toBeGreaterThan(sInsp.model.throughputPerHour)

    // the readouts follow the model
    await expect.poll(read).not.toEqual(baseUi)

    // the running sim adopts the new targets (line rates change)
    await p.evaluate(() => window.__MIW__.clock.advance(6))
    const live = await snap(p)
    const changed = Object.keys(base.lines).filter((k) => Math.abs(live.lines[k].rate - base.lines[k].rate) > 1e-6)
    expect(changed.length, 'line rates follow the parameters').toBeGreaterThan(0)

    // reset restores the baseline
    await p.getByTestId('console-reset').click()
    await expect.poll(async () => (await snap(p)).params).toEqual(base.params)
    const after = await snap(p)
    expect(after.model.throughputPerHour).toBe(base.model.throughputPerHour)
    expect(after.model.defectRate).toBe(base.model.defectRate)
    expect(after.model.successChance).toBe(base.model.successChance)
    await expect.poll(read).toEqual(baseUi)
    await p.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
  })
})
