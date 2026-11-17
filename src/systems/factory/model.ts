/**
 * Line Supervisor Console optimization model — small, transparent and pure.
 *
 * In plain words (the console shows the same thing):
 *  1. Six presses are shared. `pressesToTanks` of them stamp tank shells, the
 *     rest stamp fins and panels. Each line can supply some number of
 *     "rockets per hour" worth of parts; everything scales with conveyor speed.
 *  2. A rocket needs parts from every line, so throughput is set by the slowest
 *     line (the bottleneck) — and inspection holds every part for a check:
 *        throughput = min(line capacities) × (1 − 0.35 × inspection)
 *  3. Up to 1.2× belt speed, 5% of parts come out defective. Faster than that,
 *     defects climb with the square of the overspeed:
 *        defects = 5% + 40% × max(0, speed − 1.2)²
 *  4. Inspection catches up to 90% of them:
 *        escaped = defects × (1 − 0.9 × inspection)
 *  5. Escaped defects cost launch success, which is capped below 100%:
 *        success = clamp(85% − 10 × escaped, 20%, 75%)
 */
import { clamp } from '@/core/math'
import type { LineId } from '@/core/types'
import { DEFAULT_PARAMS, LINE_IDS, MODEL, PARAM_SPECS, TARGET, TOTAL_PRESSES } from './config'
import type { OptimizationParams, OptimizationResult } from './types'

/** Snap a value to its slider grid and clamp it into range (NaN → fallback). */
function snap(value: unknown, key: keyof OptimizationParams, fallback: number): number {
  const spec = PARAM_SPECS[key]
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  const steps = Math.round((clamp(n, spec.min, spec.max) - spec.min) / spec.step)
  // toFixed avoids 1.2000000000000002-style drift so params compare exactly.
  return Number((spec.min + steps * spec.step).toFixed(4))
}

/**
 * Clamp and snap (possibly partial / untrusted) params onto the slider grid.
 * Missing or invalid fields fall back to `base` (defaults if omitted).
 */
export function normalizeParams(p: Partial<OptimizationParams> | null | undefined, base: OptimizationParams = DEFAULT_PARAMS): OptimizationParams {
  const src = p ?? {}
  return {
    conveyorSpeed: snap(src.conveyorSpeed ?? base.conveyorSpeed, 'conveyorSpeed', base.conveyorSpeed),
    inspection: snap(src.inspection ?? base.inspection, 'inspection', base.inspection),
    pressesToTanks: snap(src.pressesToTanks ?? base.pressesToTanks, 'pressesToTanks', base.pressesToTanks),
  }
}

export function paramsEqual(a: OptimizationParams, b: OptimizationParams): boolean {
  return a.conveyorSpeed === b.conveyorSpeed && a.inspection === b.inspection && a.pressesToTanks === b.pressesToTanks
}

/**
 * Rockets/hour worth of parts each line can supply at these settings, BEFORE
 * the inspection slowdown (which applies to all lines equally).
 */
export function lineCapacities(p: OptimizationParams): Record<LineId, number> {
  const s = p.conveyorSpeed
  return {
    smelt: (TOTAL_PRESSES - p.pressesToTanks) * MODEL.panelPerPress * s,
    pipe: MODEL.pipe * s,
    circuit: MODEL.circuit * s,
    tank: p.pressesToTanks * MODEL.tankPerPress * s,
    payload: MODEL.payload * s,
  }
}

/** Throughput multiplier caused by inspection (1 = no slowdown). */
export function inspectionFactor(inspection: number): number {
  return 1 - MODEL.inspectionSlowdown * inspection
}

/** Raw defect rate before inspection. */
export function rawDefectRate(conveyorSpeed: number): number {
  const over = Math.max(0, conveyorSpeed - MODEL.overspeedKnee)
  return MODEL.baseDefectRate + MODEL.overspeedFactor * over * over
}

/** Probability that QC catches a defective part. */
export function catchRate(inspection: number): number {
  return MODEL.inspectionCatch * inspection
}

export function successChanceFor(escapedDefectRate: number): number {
  const s = MODEL.success
  return clamp(s.base - s.perDefect * escapedDefectRate, s.min, s.max)
}

// ---------------------------------------------------------------------------
// Display rounding. Conservative on purpose: throughput rounds DOWN and defects
// round UP, so a readout can never look like it meets the target while the
// target check fails (the check below uses these same rounded values).
// ---------------------------------------------------------------------------

/** Throughput shown with one decimal, rounded down. */
export function displayThroughput(perHour: number): number {
  return Math.floor(perHour * 10 + 1e-9) / 10
}

/** Escaped defects in percent with one decimal, rounded up. */
export function displayDefectPercent(rate: number): number {
  return Math.ceil(rate * 1000 - 1e-9) / 10
}

/** Launch success chance in whole percent. */
export function displaySuccessPercent(chance: number): number {
  return Math.round(chance * 100)
}

export const TARGET_DEFECT_PERCENT = Math.round(TARGET.defectRate * 1000) / 10

function fmt1(n: number): string {
  return n.toFixed(1)
}

/** A rate 0..1 as a percentage with one decimal ("8.6%"). */
function pct1(rate: number): string {
  return `${fmt1(Math.round(rate * 1000) / 10)}%`
}

/** Can full inspection bring escaped defects on target at this belt speed? */
function inspectionCanFix(conveyorSpeed: number): boolean {
  const best = rawDefectRate(conveyorSpeed) * (1 - catchRate(PARAM_SPECS.inspection.max))
  return displayDefectPercent(best) <= TARGET_DEFECT_PERCENT
}

/** Best raw (pre-inspection) throughput reachable by re-allocating presses at this speed. */
function bestAllocationThroughput(p: OptimizationParams): number {
  let best = 0
  for (let k = PARAM_SPECS.pressesToTanks.min; k <= PARAM_SPECS.pressesToTanks.max; k++) {
    const caps = lineCapacities({ ...p, pressesToTanks: k })
    best = Math.max(best, Math.min(...LINE_IDS.map((id) => caps[id])))
  }
  return best
}

/**
 * Evaluate the console settings. Pure and deterministic: same params, same result.
 * Inputs are normalized first, so out-of-range values are clamped.
 */
export function evaluate(input: Partial<OptimizationParams>): OptimizationResult {
  const p = normalizeParams(input)
  const caps = lineCapacities(p)
  let minLine: LineId = LINE_IDS[0]
  for (const id of LINE_IDS) if (caps[id] < caps[minLine]) minLine = id
  const raw = caps[minLine]
  const factor = inspectionFactor(p.inspection)
  const throughputPerHour = raw * factor
  const defectRate = rawDefectRate(p.conveyorSpeed) * (1 - catchRate(p.inspection))
  const successChance = successChanceFor(defectRate)

  const best = bestAllocationThroughput(p)
  const allocationOptimal = raw >= best - 1e-9
  const slowdown = 1 - factor
  let bottleneck: OptimizationResult['bottleneck']
  if (!allocationOptimal) bottleneck = caps.tank <= caps.smelt ? 'tank' : 'smelt'
  else if (slowdown >= MODEL.inspectionBottleneckSlowdown - 1e-9) bottleneck = 'inspection'
  else bottleneck = 'balanced'

  const shownT = displayThroughput(throughputPerHour)
  const shownD = displayDefectPercent(defectRate)
  const meetsT = shownT >= TARGET.throughputPerHour
  const meetsD = shownD <= TARGET_DEFECT_PERCENT
  const meetsTarget = meetsT && meetsD

  const explanation = explain(p, { bottleneck, meetsT, meetsD, meetsTarget, slowdown, successChance, allocationOptimal })
  return { throughputPerHour, defectRate, successChance, bottleneck, meetsTarget, explanation }
}

interface ExplainInput {
  bottleneck: OptimizationResult['bottleneck']
  meetsT: boolean
  meetsD: boolean
  meetsTarget: boolean
  slowdown: number
  successChance: number
  allocationOptimal: boolean
}

/** 2–4 short live hints, most useful first. */
function explain(p: OptimizationParams, r: ExplainInput): string[] {
  const lines: string[] = []
  const tanks = p.pressesToTanks
  const panels = TOTAL_PRESSES - tanks
  const odds = `${displaySuccessPercent(r.successChance)}%`

  if (r.meetsTarget) {
    lines.push(`Line certified. Launch success odds are now ${odds}.`)
  }

  // 1. Press allocation (the biggest lever, so it always comes first).
  if (r.bottleneck === 'tank') {
    lines.push(`Tank line starved: only ${tanks} of ${TOTAL_PRESSES} presses ${tanks === 1 ? 'stamps' : 'stamp'} tank shells.`)
  } else if (r.bottleneck === 'smelt') {
    lines.push(`Sheet stamping starved: only ${panels} of ${TOTAL_PRESSES} presses left for fins and panels.`)
  } else {
    lines.push(`Presses balanced: ${tanks} on tank shells, ${panels} on fins and panels.`)
  }

  // 2. Defects. Point at the lever that can actually fix them: inspection,
  //    unless the belts run so fast that even full inspection can't keep up.
  if (!r.meetsD) {
    const speed = p.conveyorSpeed
    if (!inspectionCanFix(speed)) {
      lines.push(`Belts at ${fmt1(speed)}× make ${pct1(rawDefectRate(speed))} bad parts: too many for inspection. Slow them down.`)
    } else if (speed > MODEL.overspeedKnee + 1e-9) {
      lines.push(`Belts at ${fmt1(speed)}× make ${pct1(rawDefectRate(speed))} bad parts. Raise inspection to catch more.`)
    } else {
      lines.push(`Too many defects reach the rockets. Raise inspection: it catches up to ${Math.round(MODEL.inspectionCatch * 100)}%.`)
    }
  }

  // 3. Throughput (a starved line is already explained by hint 1).
  if (!r.meetsT && r.allocationOptimal) {
    if (r.slowdown >= 0.1 - 1e-9) {
      lines.push(`Inspection slows the line ${Math.round(r.slowdown * 100)}%. Faster belts can make up for it.`)
    } else {
      lines.push('Lines are balanced but slow: raise conveyor speed.')
    }
  }

  // 4. Launch odds (only when there is room left on the list).
  if (!r.meetsTarget && lines.length < 4) {
    lines.push(`Escaped defects set launch success odds at ${odds} (75% at best).`)
  }
  return lines.slice(0, 4)
}

/** Plain-language model description for the console's "How the model works" section. */
export const MODEL_EXPLAINER: ReadonlyArray<{ title: string; formula: string; text: string }> = [
  {
    title: 'Press split',
    formula: `tanks = presses × ${MODEL.tankPerPress} · fins & panels = (${TOTAL_PRESSES} − presses) × ${MODEL.panelPerPress}`,
    text: `Six presses are shared. Each press on tank shells keeps up with ${MODEL.tankPerPress} rockets an hour; each press on fins and panels, ${MODEL.panelPerPress}. Pipe, electronics and payload lines manage ${MODEL.pipe}–${MODEL.circuit} on their own. Every line scales with conveyor speed.`,
  },
  {
    title: 'Throughput',
    formula: `throughput = slowest line × (1 − ${MODEL.inspectionSlowdown} × inspection)`,
    text: 'A rocket needs parts from every line, so the slowest line sets the pace. Inspection holds each part for a check: at 100% thoroughness the whole line runs 35% slower.',
  },
  {
    title: 'Defects',
    formula: `defects = ${MODEL.baseDefectRate * 100}% + ${MODEL.overspeedFactor * 100}% × (speed − ${fmt1(MODEL.overspeedKnee)})²`,
    text: `Up to ${fmt1(MODEL.overspeedKnee)}× belt speed, ${MODEL.baseDefectRate * 100}% of parts come out bad. Push the belts harder and defects climb with the square of the overspeed.`,
  },
  {
    title: 'Inspection',
    formula: `escaped = defects × (1 − ${MODEL.inspectionCatch} × inspection)`,
    text: `Inspection catches up to ${Math.round(MODEL.inspectionCatch * 100)}% of bad parts. The rest ride along into the rocket.`,
  },
  {
    title: 'Launch odds',
    formula: `success = ${MODEL.success.base * 100}% − ${MODEL.success.perDefect} × escaped (kept within ${MODEL.success.min * 100}–${MODEL.success.max * 100}%)`,
    text: 'These are the odds of a clean launch. Every escaped-defect point costs ten of them, and even a perfect line tops out at 75%: the rockets are still ugly. Failed launches sometimes wobble their way up anyway.',
  },
]
