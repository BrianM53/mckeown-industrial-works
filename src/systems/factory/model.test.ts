// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, MODEL, PARAM_SPECS, TARGET, TOTAL_PRESSES } from './config'
import {
  displayDefectPercent,
  displayThroughput,
  evaluate,
  lineCapacities,
  MODEL_EXPLAINER,
  normalizeParams,
  paramsEqual,
  TARGET_DEFECT_PERCENT,
} from './model'
import type { OptimizationParams, OptimizationResult } from './types'

/** Every combination reachable with the console's sliders (16 × 21 × 5 = 1680). */
function grid(): OptimizationParams[] {
  const out: OptimizationParams[] = []
  const s = PARAM_SPECS
  for (let a = 0; a <= Math.round((s.conveyorSpeed.max - s.conveyorSpeed.min) / s.conveyorSpeed.step); a++)
    for (let b = 0; b <= Math.round((s.inspection.max - s.inspection.min) / s.inspection.step); b++)
      for (let p = s.pressesToTanks.min; p <= s.pressesToTanks.max; p++)
        out.push(
          normalizeParams({
            conveyorSpeed: s.conveyorSpeed.min + a * s.conveyorSpeed.step,
            inspection: s.inspection.min + b * s.inspection.step,
            pressesToTanks: p,
          }),
        )
  return out
}

const GRID = grid()
const RESULTS = GRID.map((p) => ({ p, r: evaluate(p) }))
const at = (p: Partial<OptimizationParams>): OptimizationResult => evaluate({ ...DEFAULT_PARAMS, ...p })
const meetsThroughput = (r: OptimizationResult) => displayThroughput(r.throughputPerHour) >= TARGET.throughputPerHour
const meetsDefects = (r: OptimizationResult) => displayDefectPercent(r.defectRate) <= TARGET_DEFECT_PERCENT

describe('parameter grid', () => {
  it('covers every slider combination exactly once', () => {
    expect(GRID).toHaveLength(16 * 21 * 5)
    expect(new Set(GRID.map((p) => `${p.conveyorSpeed}/${p.inspection}/${p.pressesToTanks}`)).size).toBe(GRID.length)
  })

  it('normalizes params onto the grid (clamp, snap, NaN-safe)', () => {
    expect(normalizeParams({ conveyorSpeed: 9, inspection: -1, pressesToTanks: 0 })).toEqual({ conveyorSpeed: 2, inspection: 0, pressesToTanks: 1 })
    expect(normalizeParams({ conveyorSpeed: 1.23, inspection: 0.33, pressesToTanks: 2.6 })).toEqual({ conveyorSpeed: 1.2, inspection: 0.35, pressesToTanks: 3 })
    expect(normalizeParams({ conveyorSpeed: Number.NaN, inspection: Infinity })).toEqual(DEFAULT_PARAMS)
    expect(normalizeParams({ conveyorSpeed: Number.NaN })).toEqual(DEFAULT_PARAMS)
    expect(normalizeParams(undefined)).toEqual(DEFAULT_PARAMS)
    // 0.5 + 7 × 0.1 must compare equal to 1.2 (no float drift).
    expect(normalizeParams({ conveyorSpeed: 0.5 + 7 * 0.1 }).conveyorSpeed).toBe(1.2)
    expect(paramsEqual(normalizeParams({ conveyorSpeed: 1.2000000001 }), { ...DEFAULT_PARAMS, conveyorSpeed: 1.2 })).toBe(true)
  })

  it('evaluate is pure and deterministic', () => {
    const input = { conveyorSpeed: 1.4, inspection: 0.75, pressesToTanks: 3 }
    const copy = { ...input }
    expect(evaluate(input)).toEqual(evaluate(copy))
    expect(input).toEqual(copy)
  })
})

describe('the challenge', () => {
  it('baseline (default settings) fails the target on both throughput and defects', () => {
    const r = evaluate(DEFAULT_PARAMS)
    expect(r.meetsTarget).toBe(false)
    expect(meetsThroughput(r)).toBe(false)
    expect(meetsDefects(r)).toBe(false)
    expect(r.throughputPerHour).toBeCloseTo(7.44, 2)
    expect(r.defectRate).toBeCloseTo(0.041, 4)
    expect(r.bottleneck).toBe('tank')
  })

  it('at least three distinct grid combos pass, but it is a real puzzle (few pass)', () => {
    const passing = RESULTS.filter((x) => x.r.meetsTarget)
    expect(passing.length).toBeGreaterThanOrEqual(3)
    expect(passing.length).toBeLessThan(GRID.length * 0.05)
    // Solutions span several speeds and inspection levels (not one magic point).
    expect(new Set(passing.map((x) => x.p.conveyorSpeed)).size).toBeGreaterThanOrEqual(3)
    expect(new Set(passing.map((x) => x.p.inspection)).size).toBeGreaterThanOrEqual(3)
    // A known, explainable solution: balance presses, nudge speed, inspect more.
    expect(at({ conveyorSpeed: 1.3, inspection: 0.6, pressesToTanks: 3 }).meetsTarget).toBe(true)
    expect(at({ conveyorSpeed: 1.4, inspection: 0.75, pressesToTanks: 3 }).meetsTarget).toBe(true)
    expect(at({ conveyorSpeed: 1.5, inspection: 0.9, pressesToTanks: 3 }).meetsTarget).toBe(true)
  })

  it('every passing combo needs all three knobs moved from baseline', () => {
    for (const { p } of RESULTS.filter((x) => x.r.meetsTarget)) {
      expect(p.conveyorSpeed).toBeGreaterThan(DEFAULT_PARAMS.conveyorSpeed)
      expect(p.inspection).toBeGreaterThan(DEFAULT_PARAMS.inspection)
      expect(p.pressesToTanks).not.toBe(DEFAULT_PARAMS.pressesToTanks)
    }
  })

  it('has real trade-offs: max speed alone fails on defects, max inspection alone fails on throughput', () => {
    const fast = at({ conveyorSpeed: 2 })
    expect(meetsDefects(fast)).toBe(false)
    expect(fast.meetsTarget).toBe(false)
    const careful = at({ inspection: 1 })
    expect(meetsThroughput(careful)).toBe(false)
    expect(meetsDefects(careful)).toBe(true)
    expect(careful.meetsTarget).toBe(false)
    // Even with balanced presses, each extreme fails for its own reason.
    const fastBalanced = at({ conveyorSpeed: 2, pressesToTanks: 3 })
    expect(meetsThroughput(fastBalanced)).toBe(true)
    expect(meetsDefects(fastBalanced)).toBe(false)
    const carefulBalanced = at({ inspection: 1, pressesToTanks: 3 })
    expect(meetsDefects(carefulBalanced)).toBe(true)
    expect(meetsThroughput(carefulBalanced)).toBe(false)
    // Everything maxed is not a cheat code either.
    expect(at({ conveyorSpeed: 2, inspection: 1, pressesToTanks: 3 }).meetsTarget).toBe(false)
  })

  it('the readouts never contradict the certification (conservative rounding)', () => {
    const bad = RESULTS.filter(({ r }) => {
      const shownOk = displayThroughput(r.throughputPerHour) >= TARGET.throughputPerHour && displayDefectPercent(r.defectRate) <= TARGET_DEFECT_PERCENT
      // Displayed values never flatter the line.
      const flatters = displayThroughput(r.throughputPerHour) > r.throughputPerHour + 1e-9 || displayDefectPercent(r.defectRate) < r.defectRate * 100 - 1e-9
      return shownOk !== r.meetsTarget || flatters
    })
    expect(bad.map((b) => b.p)).toEqual([])
  })
})

describe('launch odds', () => {
  it('successChance always stays within [0.2, 0.75] and is never 1', () => {
    const chances = RESULTS.map((x) => x.r.successChance)
    expect(chances.every((c) => Number.isFinite(c) && c >= 0.2 && c <= 0.75)).toBe(true)
    expect(Math.max(...chances)).toBe(MODEL.success.max)
    expect(Math.min(...chances)).toBe(MODEL.success.min)
  })

  it('better settings measurably improve the odds', () => {
    const base = evaluate(DEFAULT_PARAMS).successChance
    expect(base).toBeCloseTo(0.44, 2)
    for (const { r } of RESULTS.filter((x) => x.r.meetsTarget)) expect(r.successChance).toBeGreaterThan(base + 0.15)
  })
})

describe('monotonic sanity', () => {
  it('more presses to tanks raises throughput while tanks are the bottleneck', () => {
    for (const s of [0.5, 1, 1.5, 2]) {
      for (const i of [0, 0.5, 1]) {
        for (let p = 1; p < 5; p++) {
          const r = evaluate({ conveyorSpeed: s, inspection: i, pressesToTanks: p })
          if (r.bottleneck !== 'tank') continue
          expect(evaluate({ conveyorSpeed: s, inspection: i, pressesToTanks: p + 1 }).throughputPerHour).toBeGreaterThan(r.throughputPerHour)
        }
      }
    }
  })

  it('more presses to tanks starves sheet stamping eventually', () => {
    expect(at({ pressesToTanks: 4 }).bottleneck).toBe('smelt')
    expect(at({ pressesToTanks: 5 }).throughputPerHour).toBeLessThan(at({ pressesToTanks: 3 }).throughputPerHour)
  })

  it('more inspection lowers escaped defects and lowers throughput (strictly)', () => {
    const bad = RESULTS.filter(({ p, r }) => {
      if (p.inspection >= 1) return false
      const more = evaluate({ ...p, inspection: p.inspection + 0.05 })
      return !(more.defectRate < r.defectRate && more.throughputPerHour < r.throughputPerHour)
    })
    expect(bad.map((b) => b.p)).toEqual([])
  })

  it('faster belts raise throughput and never lower defects', () => {
    const bad = RESULTS.filter(({ p, r }) => {
      if (p.conveyorSpeed >= 2) return false
      const faster = evaluate({ ...p, conveyorSpeed: p.conveyorSpeed + 0.1 })
      return !(faster.throughputPerHour > r.throughputPerHour && faster.defectRate >= r.defectRate)
    })
    expect(bad.map((b) => b.p)).toEqual([])
    // Defects climb superlinearly above 1.2×.
    const d = (s: number) => at({ conveyorSpeed: s, inspection: 0 }).defectRate
    expect(d(1.2)).toBeCloseTo(d(0.5), 10)
    expect(d(2.0) - d(1.6)).toBeGreaterThan(d(1.6) - d(1.2))
  })

  it('press split stays within the six shared presses', () => {
    for (let p = 1; p <= 5; p++) {
      const caps = lineCapacities({ ...DEFAULT_PARAMS, pressesToTanks: p })
      expect(caps.tank / MODEL.tankPerPress + caps.smelt / MODEL.panelPerPress).toBeCloseTo(TOTAL_PRESSES, 10)
    }
  })
})

describe('bottleneck & explanation', () => {
  it('reports the limiting factor', () => {
    expect(at({ pressesToTanks: 1 }).bottleneck).toBe('tank')
    expect(at({ pressesToTanks: 2 }).bottleneck).toBe('tank')
    expect(at({ pressesToTanks: 3 }).bottleneck).toBe('balanced')
    expect(at({ pressesToTanks: 3, inspection: 0.6 }).bottleneck).toBe('inspection')
    expect(at({ pressesToTanks: 4 }).bottleneck).toBe('smelt')
    expect(at({ pressesToTanks: 5, inspection: 1 }).bottleneck).toBe('smelt')
  })

  it('gives 2–4 short, live hints that point at the fix', () => {
    const bad = RESULTS.filter(({ r }) => r.explanation.length < 2 || r.explanation.length > 4 || r.explanation.some((l) => l.length <= 10 || l.length > 90))
    expect(bad.map((b) => b.r.explanation)).toEqual([])
    const base = evaluate(DEFAULT_PARAMS).explanation
    expect(base[0]).toBe('Tank line starved: only 1 of 6 presses stamps tank shells.')
    expect(base.join(' ')).toMatch(/inspection/i)
    expect(at({ pressesToTanks: 4 }).explanation[0]).toMatch(/Sheet stamping starved: only 2 of 6/)
    expect(at({ pressesToTanks: 3, inspection: 0.6 }).explanation.join(' ')).toMatch(/Inspection slows the line 21%/)
    const won = at({ conveyorSpeed: 1.3, inspection: 0.6, pressesToTanks: 3 })
    expect(won.explanation[0]).toMatch(/^Line certified/)
  })

  it('the defect hint names the lever that can fix it', () => {
    // Fast belts that inspection can still keep up with: inspect more (do not just slow down).
    const fast = at({ pressesToTanks: 3, conveyorSpeed: 1.7 }).explanation.join(' ')
    expect(fast).toContain('Belts at 1.7× make 15.0% bad parts. Raise inspection to catch more.')
    expect(fast).not.toMatch(/Slow them down/)
    // Belts so fast that even full inspection lets too much through: slow down.
    for (const inspection of [0, 0.5, 1]) {
      expect(at({ pressesToTanks: 3, conveyorSpeed: 2, inspection }).explanation.join(' ')).toMatch(/at 2\.0× make 30\.6% bad parts: too many for inspection\. Slow them down\./)
    }
    // Normal speed: inspection is the only lever.
    expect(at({ pressesToTanks: 3 }).explanation.join(' ')).toMatch(/Raise inspection: it catches up to 90%/)
  })

  it('a player who simply follows the hints certifies the line from any starting point', () => {
    /** The change the first actionable hint asks for (what a player reading the panel would do). */
    const follow = (p: OptimizationParams, hints: string[]): OptimizationParams | null => {
      for (const h of hints) {
        if (/^Tank line starved/.test(h)) return normalizeParams({ ...p, pressesToTanks: p.pressesToTanks + 1 })
        if (/^Sheet stamping starved/.test(h)) return normalizeParams({ ...p, pressesToTanks: p.pressesToTanks - 1 })
        if (/Slow them down/.test(h)) return normalizeParams({ ...p, conveyorSpeed: p.conveyorSpeed - 0.1 })
        if (/Raise inspection/.test(h)) return normalizeParams({ ...p, inspection: p.inspection + 0.05 })
        if (/raise conveyor speed|Faster belts/.test(h)) return normalizeParams({ ...p, conveyorSpeed: p.conveyorSpeed + 0.1 })
      }
      return null
    }
    const clicksFrom = (start: OptimizationParams): number => {
      let p = start
      for (let clicks = 0; clicks <= 60; clicks++) {
        const r = evaluate(p)
        if (r.meetsTarget) return clicks
        const next = follow(p, r.explanation)
        if (!next || paramsEqual(next, p)) return Infinity // no actionable hint, or a hint that cannot be followed
        p = next
      }
      return Infinity
    }
    const stuck = RESULTS.filter(({ p }) => !Number.isFinite(clicksFrom(p))).map(({ p }) => p)
    expect(stuck).toEqual([])
    // From the baseline it is a short walk (2 press clicks, inspection to 60%, belts to 1.3×).
    expect(clicksFrom(DEFAULT_PARAMS)).toBe(13)
  })

  it('the plain-language explainer quotes the live constants', () => {
    const text = MODEL_EXPLAINER.map((e) => `${e.formula} ${e.text}`).join(' ')
    expect(text).toContain(String(MODEL.tankPerPress))
    expect(text).toContain(String(MODEL.inspectionSlowdown))
    expect(text).toContain('75%')
  })
})
