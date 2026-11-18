/**
 * §12.12 NPC event scheduling: one gag at a time (no impossible overlapping states), cooldowns
 * respected by the natural scheduler, workers return to valid waypoints afterwards.
 * Loaded WITHOUT noevents so the ambient scheduler can run (ambient events are toggled per test).
 */
import { expect, test, type Page } from '@playwright/test'
import { teleport, setCamera, useGamePage } from './helpers'

const g = useGamePage({ query: 'quality=low&seed=7', needs: ['npc.list', 'npc.triggerGag', 'npc.gags', 'npc.snap', 'director.active'] })

interface Npc {
  id: string
  name: string
  position: [number, number, number]
  state: string
}
const npcs = (p: Page): Promise<Npc[]> => p.evaluate(() => window.__MIW__.npc.list())
const gags = (p: Page): Promise<{ ids: string[]; running: string | null; history: { id: string; at: number }[] }> => p.evaluate(() => window.__MIW__.npc.gags())
const byId = (list: Npc[], id: string) => {
  const n = list.find((x) => x.id === id)
  if (!n) throw new Error(`npc ${id} missing from ${list.map((x) => x.id).join(',')}`)
  return n
}
const finiteInWorld = (n: Npc) =>
  n.position.every(Number.isFinite) && n.position[0] >= -50 && n.position[0] <= 50 && n.position[2] >= -48 && n.position[2] <= 40 && n.position[1] > -1 && n.position[1] < 6

/**
 * Advance sim time in `step` increments inside the page until the given NPC is settled at
 * `stay:<station>` (or `max` seconds pass). Also records every sample's running gag and the
 * number of NPCs in a 'gag' state, to catch impossible overlaps.
 */
async function advanceUntilSettled(p: Page, npcId: string, station: string, max: number, step = 0.5) {
  return p.evaluate(
    ({ npcId: id, station: st, max: m, step: dt }) => {
      const api = window.__MIW__
      const samples: { t: number; running: string | null; inGag: string[]; states: Record<string, string> }[] = []
      let t = 0
      const read = () => {
        const list = api.npc.list() as { id: string; state: string }[]
        const running = api.npc.gags().running as string | null
        samples.push({ t, running, inGag: list.filter((n) => n.state === 'gag').map((n) => n.id), states: Object.fromEntries(list.map((n) => [n.id, n.state])) })
        return list.find((n) => n.id === id)?.state ?? ''
      }
      let state = read()
      while (t < m && !(state === `stay:${st}` && api.npc.gags().running === null)) {
        api.clock.advance(dt)
        t += dt
        state = read()
      }
      return { t, state, samples }
    },
    { npcId, station, max, step },
  )
}

test.describe('§12.12 NPC gag scheduling', () => {
  test('§12.12 only one gag runs at a time, aborted actors are restored, and actors return to their waypoint', async () => {
    const p = g.page
    await p.evaluate(() => {
      window.__MIW__.ui.closePanel()
      window.__MIW__.settings.set({ ambientEvents: false })
    })
    // put the nap actor (driver) on its return waypoint ('lean') and remember where that is
    await p.evaluate(() => window.__MIW__.npc.snap('driver', 'lean'))
    await expect.poll(async () => byId(await npcs(p), 'driver').state, { timeout: 30_000 }).toBe('stay:lean')
    const lean = byId(await npcs(p), 'driver').position

    // start one gag, then another: the first is aborted (never two at once)
    expect(await p.evaluate(() => window.__MIW__.npc.triggerGag('kick'))).toBe(true)
    expect((await gags(p)).running).toBe('gag:kick')
    expect(await p.evaluate(() => window.__MIW__.npc.triggerGag('nap'))).toBe(true)
    const gs = await gags(p)
    expect(gs.running).toBe('gag:nap')
    const active = (await p.evaluate(() => window.__MIW__.director.active())) as string[]
    expect(active).toContain('gag:nap')
    expect(active).not.toContain('gag:kick')
    const list = await npcs(p)
    expect(byId(list, 'circuit').state, 'aborted kick actor is released').not.toBe('gag')
    expect(list.filter((n) => n.state === 'gag').map((n) => n.id)).toEqual(['driver'])

    // run the nap to completion; the driver walks back to 'lean'
    const r = await advanceUntilSettled(p, 'driver', 'lean', 120)
    expect(r.state, `driver ended in ${r.state} after ${r.t}s`).toBe('stay:lean')
    for (const s of r.samples) {
      if (s.running === null) expect(s.inGag, `t=${s.t}: NPCs in 'gag' with no gag running`).toEqual([])
      else expect(s.inGag.length, `t=${s.t}: ${s.inGag.join(',')} in ${s.running}`).toBeLessThanOrEqual(2)
    }
    expect(r.samples.some((s) => s.running === 'gag:nap')).toBe(true)
    expect(r.samples[r.samples.length - 1].running).toBeNull()
    const end = byId(await npcs(p), 'driver')
    expect(Math.hypot(end.position[0] - lean[0], end.position[2] - lean[2]), 'driver back on its waypoint').toBeLessThan(1)
    // everyone else is somewhere valid
    for (const n of await npcs(p)) expect(finiteInWorld(n), `${n.id} at ${n.position.join(',')}`).toBe(true)
    const v = (await p.evaluate(() => window.__MIW__.npc.validation())) as { hidden: string[] }
    expect(v.hidden).not.toContain('driver')
  })

  test('§12.12 the natural scheduler respects per-gag cooldowns and never overlaps gags', async () => {
    const p = g.page
    await p.evaluate(() => {
      window.__MIW__.ui.closePanel()
      window.__MIW__.director.reset()
      window.__MIW__.settings.set({ ambientEvents: true })
    })
    // stand where several gags are in view (production spine, looking north)
    await teleport(p, 0, 21, 0)
    await setCamera(p, { yaw: 0, pitch: 0.17 })
    const result = await p.evaluate(() => {
      const api = window.__MIW__
      const starts: { id: string; t: number }[] = []
      let prev: string | null = api.npc.gags().running
      let overlaps = 0
      let t = 0
      for (; t < 600; t += 1) {
        api.clock.advance(1)
        const run = api.npc.gags().running as string | null
        if (run && run !== prev) starts.push({ id: run, t })
        const inGag = (api.npc.list() as { state: string }[]).filter((n) => n.state === 'gag').length
        if (!run && inGag > 0) overlaps++
        prev = run
      }
      const all = (api.npc.list() as { position: number[]; state: string }[]).map((n) => ({ p: n.position, s: n.state }))
      return { starts, overlaps, t, all }
    })
    test.info().annotations.push({ type: 'natural-gags', description: JSON.stringify(result.starts) })
    expect(result.starts.length, 'the scheduler starts ambient gags on its own').toBeGreaterThan(0)
    expect(result.overlaps, "NPCs stuck in a 'gag' state with no gag running").toBe(0)
    // the shortest per-gag cooldown is 80 s (src/npc/gagDefs.ts): the same gag never restarts sooner
    const last = new Map<string, number>()
    for (const s of result.starts) {
      const prev = last.get(s.id)
      if (prev !== undefined) expect(s.t - prev, `${s.id} restarted after ${s.t - prev}s`).toBeGreaterThanOrEqual(80)
      last.set(s.id, s.t)
    }
    for (const n of result.all) expect(n.p.every(Number.isFinite), JSON.stringify(n)).toBe(true)
    await p.evaluate(() => window.__MIW__.settings.set({ ambientEvents: false }))
  })
})
