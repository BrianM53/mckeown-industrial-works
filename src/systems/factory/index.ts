/**
 * Factory simulation entry point. TEMPORARY STUB — the factory-sim module
 * replaces this with the real implementation (sim.ts) keeping the exports:
 *   export const factory: FactorySim
 *   export function useFactory<T>(selector: (s: FactoryState) => T): T
 *   export * from './types'
 */
import { useSyncExternalStore } from 'react'
import type { LineId } from '@/core/types'
import type { FactorySim, FactoryState, LineState, OptimizationParams } from './types'

export * from './types'

const DEFAULT_PARAMS: OptimizationParams = { conveyorSpeed: 1, inspection: 0.2, pressesToTanks: 1 }

function line(id: LineId): LineState {
  return { id, rate: 6, phase: 0, cycles: 0, items: [], delivered: 0, required: 4, status: 'running', defectFlash: 0 }
}

const state: FactoryState = {
  t: 0,
  lines: { smelt: line('smelt'), pipe: line('pipe'), circuit: line('circuit'), tank: line('tank'), payload: line('payload') },
  rocket: {
    id: 1,
    seed: 1,
    phase: 'assembling',
    phaseTime: 0,
    phaseDuration: Infinity,
    stagesComplete: 0,
    stageProgress: 0,
    countdown: null,
    transport: 0,
    outcome: null,
    stowaway: false,
  },
  counters: { successes: 3, disassemblies: 41, lastDisassemblyT: -600 },
  params: { ...DEFAULT_PARAMS },
  model: { throughputPerHour: 10, defectRate: 0.2, successChance: 0.35, bottleneck: 'tank', meetsTarget: false, explanation: [] },
  history: [],
}

const subs = new Set<() => void>()
let version = 0

export const factory: FactorySim = {
  start() {},
  stop() {},
  state,
  subscribe(fn) {
    subs.add(fn)
    return () => subs.delete(fn)
  },
  get version() {
    return version
  },
  setParams(p) {
    Object.assign(state.params, p)
    version++
    subs.forEach((f) => f())
  },
  resetParams() {
    Object.assign(state.params, DEFAULT_PARAMS)
    version++
    subs.forEach((f) => f())
  },
  setSeed() {},
  forceNextOutcome() {},
  skipToLaunch() {},
  reset() {},
}

/** React hook: re-renders when the sim notifies; selector runs on the live state. */
export function useFactory<T>(selector: (s: FactoryState) => T): T {
  useSyncExternalStore(factory.subscribe, () => factory.version)
  return selector(factory.state)
}
