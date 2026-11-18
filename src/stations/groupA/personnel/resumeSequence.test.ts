import { describe, expect, it } from 'vitest'
import { SHRED_DELAY, WINDUP_ARM, cues, cuesBetween, isShredPrint, poseAt, timeline, type Cue } from './resumeSequence'

describe('résumé print sequence', () => {
  it('shreds every third print only', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 9].map(isShredPrint)).toEqual([false, false, true, false, false, true, false, true])
    expect(isShredPrint(0)).toBe(false)
    expect(isShredPrint(-3)).toBe(false)
    expect(isShredPrint(NaN)).toBe(false)
    expect(isShredPrint(3.5)).toBe(false)
  })

  it('normal print: feeds, winds up, slams, stamps, lifts and finishes', () => {
    const tl = timeline('normal')
    expect(poseAt('normal', 0).keeperFeed).toBe(0)
    expect(poseAt('normal', 0).stamped).toBe(false)
    expect(poseAt('normal', 1.0).motor).toBeGreaterThan(0.9)
    expect(poseAt('normal', tl.keeperFeed.b).keeperFeed).toBeCloseTo(1)
    // wind-up raises the arm past rest (negative), then the slam reaches 1
    const mid = (tl.windup.a + tl.windup.b) / 2
    expect(poseAt('normal', mid).arm).toBeLessThan(0)
    expect(poseAt('normal', tl.windup.b - 1e-3).arm).toBeCloseTo(WINDUP_ARM, 2)
    expect(poseAt('normal', tl.impact + 0.01).arm).toBe(1)
    expect(poseAt('normal', tl.impact - 0.001).stamped).toBe(false)
    expect(poseAt('normal', tl.impact).stamped).toBe(true)
    // the stamped copy stays on the tray after the sequence
    const end = poseAt('normal', tl.duration + 5)
    expect(end.done).toBe(true)
    expect(end.stamped).toBe(true)
    expect(end.keeperFeed).toBeCloseTo(1)
    expect(end.arm).toBe(0)
    expect(end.motor).toBe(0)
    expect(end.beacons).toBe(false)
    expect(tl.duration).toBeLessThan(5)
  })

  it('slam accelerates (ease-in) and arm values stay bounded', () => {
    const tl = timeline('normal')
    const a0 = poseAt('normal', tl.slam.a + 0.02).arm
    const a1 = poseAt('normal', tl.slam.a + 0.09).arm
    const a2 = poseAt('normal', tl.slam.a + 0.16).arm
    expect(a1 - a0).toBeLessThan(a2 - a1)
    for (let t = -1; t < tl.duration + 1; t += 0.01) {
      const p = poseAt('normal', t)
      expect(p.arm).toBeGreaterThanOrEqual(WINDUP_ARM - 1e-9)
      expect(p.arm).toBeLessThanOrEqual(1)
      expect(p.motor).toBeGreaterThanOrEqual(0)
      expect(p.motor).toBeLessThanOrEqual(1)
      expect(Number.isFinite(p.squash)).toBe(true)
    }
  })

  it('shred variant sends the decoy up the tube before the real copy is stamped', () => {
    const tl = timeline('shred')
    expect(tl.impact).toBeCloseTo(timeline('normal').impact + SHRED_DELAY)
    // decoy feeds first, keeper still inside
    const p1 = poseAt('shred', tl.decoyFeed!.b)
    expect(p1.decoyFeed).toBeCloseTo(1)
    expect(p1.keeperFeed).toBe(0)
    // ball travels the tube, then the shredder runs
    expect(poseAt('shred', tl.tube!.a - 0.01).tube).toBe(-1)
    const pt = poseAt('shred', (tl.tube!.a + tl.tube!.b) / 2).tube
    expect(pt).toBeGreaterThan(0.2)
    expect(pt).toBeLessThan(0.8)
    expect(poseAt('shred', (tl.shred!.a + tl.shred!.b) / 2).shred).toBe(1)
    // the shredder is done before the real copy finishes feeding, and well before the stamp
    expect(tl.shred!.b).toBeLessThanOrEqual(tl.keeperFeed.b)
    expect(tl.keeperFeed.b).toBeLessThan(tl.impact)
    // stamping only marks the keeper
    expect(poseAt('shred', tl.impact).stamped).toBe(true)
    expect(poseAt('shred', tl.duration + 0.1).done).toBe(true)
    expect(tl.duration).toBeLessThan(9)
  })

  it('cues fire exactly once across arbitrary frame splits', () => {
    for (const variant of ['normal', 'shred'] as const) {
      const all = cues(variant)
      const tl = timeline(variant)
      const seen: Cue[] = []
      const out: Cue[] = []
      let t = 0
      // irregular frame times, including tiny and big steps
      const steps = [0.001, 0.016, 0.033, 0.1, 0.07, 0.002, 0.25]
      let i = 0
      while (t < tl.duration + 0.5) {
        const next = t + steps[i++ % steps.length]
        seen.push(...cuesBetween(variant, t, next, out))
        t = next
      }
      expect(seen.map((c) => c.kind)).toEqual(all.map((c) => c.kind))
      expect(seen.filter((c) => c.kind === 'stamp')).toHaveLength(1)
      expect(seen.filter((c) => c.kind === 'done')).toHaveLength(1)
      expect(seen.filter((c) => c.kind === 'whoosh')).toHaveLength(variant === 'shred' ? 1 : 0)
      expect(seen.filter((c) => c.kind === 'shred')).toHaveLength(variant === 'shred' ? 1 : 0)
      // stamp cue coincides with the impact
      expect(all.find((c) => c.kind === 'stamp')!.t).toBeCloseTo(tl.impact)
    }
  })

  it('cuesBetween ignores empty / reversed intervals', () => {
    expect(cuesBetween('normal', 1, 1)).toEqual([])
    expect(cuesBetween('normal', 2, 1)).toEqual([])
    expect(cuesBetween('normal', NaN, 1)).toEqual([])
  })
})
