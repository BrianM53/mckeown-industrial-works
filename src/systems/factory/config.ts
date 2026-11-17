/**
 * Factory simulation tunables (factory-sim module). Everything that shapes the
 * minigame numbers, the production lines or the launch cadence lives here so it
 * can be tuned in one place. Pure data: no React, no three.
 */
import type { LaunchOutcome, LineId } from '@/core/types'
import type { OptimizationParams, RocketPhase, RocketStage } from './types'

/** The five process lines in their canonical order (west → east on the map, payload overhead). */
export const LINE_IDS: readonly LineId[] = ['smelt', 'pipe', 'circuit', 'tank', 'payload']

/** Human labels used by the console and the explanation hints. */
export const LINE_LABELS: Record<LineId, string> = {
  smelt: 'Sheet stamping',
  pipe: 'Pipe machining',
  circuit: 'Electronics',
  tank: 'Tank line',
  payload: 'Payload QC',
}

// ---------------------------------------------------------------------------
// Minigame knobs
// ---------------------------------------------------------------------------

export interface ParamSpec {
  min: number
  max: number
  step: number
  default: number
}

export const PARAM_SPECS: Record<keyof OptimizationParams, ParamSpec> = {
  conveyorSpeed: { min: 0.5, max: 2, step: 0.1, default: 1 },
  inspection: { min: 0, max: 1, step: 0.05, default: 0.2 },
  pressesToTanks: { min: 1, max: 5, step: 1, default: 1 },
}

export const DEFAULT_PARAMS: Readonly<OptimizationParams> = Object.freeze({
  conveyorSpeed: PARAM_SPECS.conveyorSpeed.default,
  inspection: PARAM_SPECS.inspection.default,
  pressesToTanks: PARAM_SPECS.pressesToTanks.default,
})

/** Shared stamping presses split between tank shells and fins/panels. */
export const TOTAL_PRESSES = 6

// ---------------------------------------------------------------------------
// Optimization model (see model.ts — every number below appears in the
// console's "How the model works" section, so keep them round and explainable)
// ---------------------------------------------------------------------------

export const MODEL = {
  /** Rockets/hour worth of tank shells that ONE press supplies at 1.0× belts. */
  tankPerPress: 8,
  /** Rockets/hour worth of fins & panels that ONE press supplies at 1.0× belts. */
  panelPerPress: 7.5,
  /** Fixed lines (no presses), rockets/hour worth of parts at 1.0× belts. */
  pipe: 21,
  circuit: 22.5,
  payload: 22,
  /** Throughput multiplier is (1 − inspectionSlowdown × inspection). */
  inspectionSlowdown: 0.35,
  /** Raw defect rate up to the overspeed knee. */
  baseDefectRate: 0.05,
  /** Belt speed above which defects climb with the square of the overspeed. */
  overspeedKnee: 1.2,
  overspeedFactor: 0.4,
  /** Share of defects that full (1.0) inspection catches. */
  inspectionCatch: 0.9,
  /** successChance = clamp(base − perDefect × escapedRate, min, max). Max < 1: failures stay possible. */
  success: { base: 0.85, perDefect: 10, min: 0.2, max: 0.75 },
  /** With presses balanced, inspection is reported as the bottleneck once it slows the line this much. */
  inspectionBottleneckSlowdown: 0.15,
} as const

/** The console's certification target (shown in the panel). */
export const TARGET = {
  /** Rockets per hour, at least. */
  throughputPerHour: 20,
  /** Escaped defect rate, at most. */
  defectRate: 0.025,
} as const

// ---------------------------------------------------------------------------
// Rocket assembly
// ---------------------------------------------------------------------------

/** Parts each stage consumes, by line. Stages are built in ROCKET_STAGES order. */
export const STAGE_RECIPES: Record<RocketStage, Partial<Record<LineId, number>>> = {
  chassis: { smelt: 22 },
  tanks: { tank: 30 },
  fins: { smelt: 15, pipe: 20 },
  guidance: { circuit: 44 },
  nose: { smelt: 19 },
  attachments: { pipe: 20, payload: 26 },
}

/** Minimum tower-crew seconds per stage (the crew can't bolt faster than this even with every part on hand). */
export const STAGE_CREW_SECONDS: Record<RocketStage, number> = {
  chassis: 14,
  tanks: 12,
  fins: 12,
  guidance: 10,
  nose: 10,
  attachments: 14,
}

// ---------------------------------------------------------------------------
// Launch sequence
// ---------------------------------------------------------------------------

export const PHASE_ORDER: readonly RocketPhase[] = ['assembling', 'rollout', 'pad', 'countdown', 'ignition', 'flight', 'aftermath', 'reset']

/** Seconds per timed phase ('assembling' lasts until every stage is built). */
export const PHASE_SECONDS: Record<Exclude<RocketPhase, 'assembling'>, number> = {
  rollout: 20,
  pad: 6,
  countdown: 10,
  ignition: 2,
  flight: 12,
  aftermath: 8,
  reset: 5,
}

/** Total seconds of the launch sequence after assembly (rollout → reset). */
export const LAUNCH_SEQUENCE_SECONDS = Object.values(PHASE_SECONDS).reduce((a, b) => a + b, 0)

/**
 * Seconds into 'flight' at which each outcome becomes visible (choreography
 * contract with the rocket module). 'rocket:outcome' fires and the counters
 * update at exactly this moment.
 */
export const OUTCOME_REVEAL_AT: Record<LaunchOutcome, number> = {
  success: 6,
  wobble: 4,
  breakup: 3.5,
  explosion: 2.8,
}

/** If the launch is not a clean success, which kind of mess it is. */
export const FAILURE_WEIGHTS: Record<Exclude<LaunchOutcome, 'success'>, number> = {
  wobble: 45,
  breakup: 35,
  explosion: 20,
}

/** Chance that a worker forgets to disembark (decided when rollout completes). */
export const STOWAWAY_CHANCE = 0.12

/** Launch history length kept in state. */
export const HISTORY_LIMIT = 20

/** Believable starting history for the counter sign ("fourteen minutes" joke). Local fiction, not real data. */
export const INITIAL_COUNTERS = {
  successes: 3,
  disassemblies: 41,
  minutesSinceDisassembly: 14,
} as const

/**
 * Default base seed when the URL has no ?seed. Curated by search: at default
 * console settings a visit's first launches go breakup → wobble with a
 * stowaway → clean success → explosion, then pure chance. Rocket 1 breaks up
 * at any settings (every visitor's first launch is memorable), rocket 3 always
 * succeeds, and rocket 4 survives only if the line has been well optimized
 * (success odds above 65%). Asserted in sim.test.ts.
 */
export const DEFAULT_SEED = 109473

// ---------------------------------------------------------------------------
// World mapping (how the model drives the visible lines and the cadence)
// ---------------------------------------------------------------------------

export const WORLD = {
  /**
   * Steady-state seconds per rocket at default params: ≈150 s of assembly plus
   * the 63 s launch sequence. The cadence follows the model's throughput but
   * compressed — cycle = base × (baselineThroughput / throughput)^cycleExponent —
   * because the tower crew and the single pad set their own pace. That keeps a
   * launch every ~3–4.5 minutes for any console settings.
   */
  baseCycleSeconds: 213,
  cycleExponent: 0.17,
  /** Non-bottleneck lines run (capacity / bottleneck capacity)^surplusExponent faster than the tower needs, then back up. */
  surplusExponent: 0.25,
  /** Smoothing (1/s) when console changes alter line rates and belt speeds, so belts never jump. */
  rateSmoothing: 1.6,
  /** Parts per rocket from each line (sum of STAGE_RECIPES). */
  requiredParts: { smelt: 56, pipe: 40, circuit: 44, tank: 30, payload: 26 } as Record<LineId, number>,
  /**
   * Seconds for an item to ride the whole belt (position 0 → 1) at 1.0× conveyor
   * speed. Tuned with requiredParts so ~6–10 items ride each belt in normal play.
   */
  beltTransitSeconds: { smelt: 30, pipe: 40, circuit: 36, tank: 48, payload: 64 } as Record<LineId, number>,
  /** Minimum normalized spacing of items (the machine waits for this much room; backed-up items pack to it). */
  itemGap: { smelt: 0.055, pipe: 0.06, circuit: 0.05, tank: 0.085, payload: 0.06 } as Record<LineId, number>,
  /** Safety cap on visible items per line. */
  maxItems: 20,
  /** Tower hopper per line for the NEXT rocket (parts). */
  hopperParts: { smelt: 56, pipe: 40, circuit: 44, tank: 30, payload: 26 } as Record<LineId, number>,
  /** Seconds of line production simulated before the visit starts (fills belts and hoppers). */
  preloadSeconds: 170,
  /** Seconds of assembly already done on rocket #1 when the visit starts (a half-built rocket greets the visitor). */
  headStartSeconds: 76,
  /** Global throttle for 'factory:part' notifications (seconds between two). */
  partEventInterval: 0.4,
  /** Seconds a QC "defect caught" flash lasts. */
  defectFlashSeconds: 0.9,
} as const
