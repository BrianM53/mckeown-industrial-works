import type { LaunchOutcome, LineId } from '@/core/types'

/**
 * FACTORY SIMULATION CONTRACT (integrator-owned). Implemented by
 * src/systems/factory/sim.ts (factory-sim module); rendered by
 * src/factory/lines (5 process lines) and src/factory/rocket (tower/launch);
 * tuned by the Line Supervisor Console minigame (src/factory/ui/ConsolePanel).
 *
 * Pure TypeScript, deterministic given (seed, params, elapsed sim time), ticked
 * by core/clock simClock. No three.js / React in the sim itself.
 */

/** Minigame knobs. */
export interface OptimizationParams {
  /** Conveyor speed multiplier, 0.5..2.0 (step 0.1). */
  conveyorSpeed: number
  /** Inspection thoroughness 0..1 (step 0.05). */
  inspection: number
  /** How many of the 6 shared presses stamp tank shells (the rest stamp fins/panels), 1..5. */
  pressesToTanks: number
}

export interface OptimizationResult {
  /** Simulated rockets per hour. */
  throughputPerHour: number
  /** Escaped defect rate 0..1 (defects that pass inspection). */
  defectRate: number
  /** Probability 0..1 that a launch is a clean success. Always < 1 (failures stay possible). */
  successChance: number
  /** What currently limits throughput. */
  bottleneck: LineId | 'inspection' | 'balanced'
  /** Meets the challenge target (shown as LINE CERTIFIED). */
  meetsTarget: boolean
  /** Short human-readable explanation lines for the console panel. */
  explanation: string[]
}

export interface LineState {
  id: LineId
  /** Items per minute this line currently produces. */
  rate: number
  /** Continuous machine-cycle phase 0..1 (animation sync, e.g. the press slams at ~0.5). */
  phase: number
  /** Completed machine cycles (monotonic). */
  cycles: number
  /** Visible belt items as normalized positions 0..1 from zStart (0) to zEnd (1). Deterministic. */
  items: number[]
  /** Parts delivered to the tower for the current rocket. */
  delivered: number
  /** Parts required from this line for the current rocket. */
  required: number
  status: 'running' | 'blocked' | 'idle'
  /** Seconds remaining of a QC "defect caught" flash (0 when none). */
  defectFlash: number
}

export type RocketPhase = 'assembling' | 'rollout' | 'pad' | 'countdown' | 'ignition' | 'flight' | 'aftermath' | 'reset'

export const ROCKET_STAGES = ['chassis', 'tanks', 'fins', 'guidance', 'nose', 'attachments'] as const
export type RocketStage = (typeof ROCKET_STAGES)[number]

export interface RocketState {
  /** Increments for every new rocket (first rocket = 1). */
  id: number
  /** Per-rocket seed for visual variety (asymmetry, attachments). */
  seed: number
  phase: RocketPhase
  /** Seconds since the current phase started. */
  phaseTime: number
  /** Planned duration of the current phase in seconds (Infinity while assembling). */
  phaseDuration: number
  /** Completed stages 0..6 (index into ROCKET_STAGES); the silhouette grows with it. */
  stagesComplete: number
  /** 0..1 progress of the stage currently being built. */
  stageProgress: number
  /** Seconds remaining while phase === 'countdown', else null. */
  countdown: number | null
  /** 0..1 progress along TRACK from tower (0) to pad (1). */
  transport: number
  /** Decided at ignition; null before. */
  outcome: LaunchOutcome | null
  /** An NPC forgot to disembark (decided when rollout completes). */
  stowaway: boolean
}

export interface LaunchRecord {
  rocketId: number
  outcome: LaunchOutcome
  stowaway: boolean
  /** Sim time of the launch. */
  t: number
}

export interface Counters {
  /** Launches that reached orbit-ish: outcomes 'success' and 'wobble' (wobble = success with drama). */
  successes: number
  /** Unscheduled disassemblies: outcomes 'breakup' and 'explosion'. Each one resets the sign's timer. */
  disassemblies: number
  /** Sim time of the last unscheduled disassembly (negative = before the session started). */
  lastDisassemblyT: number
}

export interface FactoryState {
  /** Sim time (s). */
  t: number
  lines: Record<LineId, LineState>
  rocket: RocketState
  counters: Counters
  params: OptimizationParams
  model: OptimizationResult
  /** Most recent launches, newest last (bounded). */
  history: LaunchRecord[]
}

export interface FactorySim {
  /** Idempotent: subscribes to simClock. */
  start(): void
  stop(): void
  /** Live state (mutated in place every tick). Read only — never write. */
  readonly state: FactoryState
  /** Notified on low-frequency changes: phase/stage changes, counters, params, countdown seconds. */
  subscribe(fn: () => void): () => void
  /** Monotonic version number bumped on every notify (for useSyncExternalStore). */
  readonly version: number
  setParams(p: Partial<OptimizationParams>): void
  resetParams(): void
  setSeed(seed: number): void
  /** Debug/test: force the next launch outcome (null clears). */
  forceNextOutcome(o: LaunchOutcome | null, stowaway?: boolean): void
  /** Debug/test: finish assembly now and begin rollout. */
  skipToLaunch(): void
  /** Debug/test: reset to a fresh rocket (keeps counters unless hard). */
  reset(hard?: boolean): void
}
