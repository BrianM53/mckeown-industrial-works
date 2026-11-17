/**
 * Factory simulation entry point (factory-sim module).
 *
 *   factory            — the app-wide FactorySim, ticked by core/clock simClock.
 *                        world/Scene.tsx SimDriver calls setSeed(?seed) and start().
 *   useFactory(sel)    — React hook; re-renders only when the selected value changes.
 *
 * For 3D modules: read `factory.state` inside useFrame (it is mutated in place
 * every tick). Useful facts (see config.ts for the numbers):
 *  - lines[id].items: positions 0..1 from LineDef.zStart (0) to zEnd (1), sorted
 *    DESCENDING (index 0 is nearest the tower). The item at index i was made by
 *    machine cycle `cycles - (items.length - 1 - i)` (stable per-item variety).
 *  - lines[id].phase: machine cycle 0..1; a part is ejected onto the belt at the
 *    wrap (1 → 0). Phase holds at 0 while the line waits for belt room.
 *  - lines[id].status 'blocked': the tower's hopper for this line is full; parts
 *    queue at the belt end and the belt stops once packed. `rate` is 0 while the
 *    machine waits. Extra runtime field `beltSpeed` (see LineStateWithBelt).
 *  - rocket.transport: eased 0→1 during 'rollout'; 1 on the pad; eases back
 *    1→0 across 'aftermath' + 'reset' (the empty transporter returns).
 *  - rocket.outcome is decided at 'ignition'; the outcome becomes visible
 *    OUTCOME_REVEAL_AT[outcome] seconds into 'flight', when 'rocket:outcome'
 *    fires and the counters update.
 *  - 'rocket:stage' payload: `stage` = 0-based index of the stage just
 *    completed, `stageName` = ROCKET_STAGES[stage].
 *  - 'rocket:countdown' fires with secondsLeft 10, 9, … 1; 'rocket:ignition' is zero.
 *  - 'factory:part' is throttled (≤ 2.5/s); `total` = parts that line has
 *    delivered this session.
 *  - The sim emits captions for the countdown and the PA announcer but no
 *    'sfx' or 'shake' — audio/rocket modules map rocket:* events to those.
 */
import type { FactorySim, FactoryState } from './types'
import { useFactoryStore } from './react'
import { FactorySimulation } from './sim'

export * from './types'
export { FactorySimulation, type FactorySimOptions, type FactoryEmit } from './sim'
export { useFactoryStore, shallowEqual } from './react'
export {
  evaluate,
  normalizeParams,
  paramsEqual,
  lineCapacities,
  rawDefectRate,
  inspectionFactor,
  catchRate,
  successChanceFor,
  displayThroughput,
  displayDefectPercent,
  displaySuccessPercent,
  TARGET_DEFECT_PERCENT,
  MODEL_EXPLAINER,
} from './model'
export { worldCycleSeconds, lineTargets, type LineStateWithBelt } from './production'
export {
  DEFAULT_PARAMS,
  PARAM_SPECS,
  TOTAL_PRESSES,
  TARGET,
  MODEL,
  LINE_IDS,
  LINE_LABELS,
  PHASE_ORDER,
  PHASE_SECONDS,
  LAUNCH_SEQUENCE_SECONDS,
  OUTCOME_REVEAL_AT,
  STAGE_RECIPES,
  INITIAL_COUNTERS,
  DEFAULT_SEED,
  WORLD,
} from './config'
export { isSuccessfulOutcome } from './outcomes'

/** The app-wide factory simulation. */
export const factory: FactorySim = new FactorySimulation()

// Dev HMR: never leave a replaced instance ticking alongside the new one.
if (import.meta.hot) import.meta.hot.dispose(() => factory.stop())

/** React hook: re-renders when the selected slice of the live sim state changes. */
export function useFactory<T>(selector: (s: FactoryState) => T, isEqual?: (a: T, b: T) => boolean): T {
  return useFactoryStore(factory, selector, isEqual)
}
