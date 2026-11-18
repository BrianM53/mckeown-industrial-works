import type { LaunchOutcome, LineId } from '@/core/types'
import { ROCKET_STAGES, type FactoryState, type RocketPhase } from '@/systems/factory/types'

/**
 * Control-room telemetry model (pure; unit-tested). Everything shown on the
 * Harmony control-room screens is derived from the live factory SIMULATION
 * (factory.state) and its rocket:* events — fictional data about a pretend
 * factory, labelled as such on every screen.
 */
export const LINE_ORDER: LineId[] = ['smelt', 'pipe', 'circuit', 'tank', 'payload']
export const LINE_SHORT: Record<LineId, string> = { smelt: 'STAMP', pipe: 'PIPE', circuit: 'ELEC', tank: 'TANK', payload: 'QC/PAY' }

export const PHASE_LABEL: Record<RocketPhase, string> = {
  assembling: 'ASSEMBLING',
  rollout: 'ROLLOUT TO PAD',
  pad: 'ON PAD',
  countdown: 'COUNTDOWN',
  ignition: 'IGNITION',
  flight: 'IN FLIGHT',
  aftermath: 'AFTERMATH',
  reset: 'PAD RESET',
}

export const OUTCOME_LABEL: Record<LaunchOutcome, string> = {
  success: 'NOMINAL',
  wobble: 'NOMINAL-ISH (WOBBLE)',
  breakup: 'UNSCHEDULED DISASSEMBLY',
  explosion: 'VERY UNSCHEDULED DISASSEMBLY',
}

/** Sim seconds → "HH:MM:SS" on a fictional plant clock that starts at 06:00:00. */
export function plantClock(t: number, startHour = 6): string {
  const s = Math.max(0, Math.floor(Number.isFinite(t) ? t : 0)) + startHour * 3600
  const hh = Math.floor(s / 3600) % 24
  const mm = Math.floor(s / 60) % 60
  const ss = s % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

/** Elapsed seconds → "MM:SS" (or "H:MM:SS" past an hour). */
export function elapsed(sec: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor(s / 60) % 60
  const ss = s % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

export type LogLevel = 'info' | 'good' | 'warn' | 'bad'

export interface LogEntry {
  t: number
  text: string
  level: LogLevel
}

/** Bounded event log (newest last). */
export class EventLog {
  readonly entries: LogEntry[] = []
  /** Bumps on every push (cheap change detection for redraws). */
  version = 0
  constructor(readonly cap = 14) {}

  push(t: number, text: string, level: LogLevel = 'info'): void {
    const last = this.entries[this.entries.length - 1]
    if (last && last.text === text && Math.abs(last.t - t) < 0.5) return
    this.entries.push({ t, text, level })
    if (this.entries.length > this.cap) this.entries.splice(0, this.entries.length - this.cap)
    this.version++
  }

  clear(): void {
    this.entries.length = 0
    this.version++
  }
}

/** Log lines for factory events (null = not logged). */
export function describeEvent(
  name: string,
  p: { rocketId?: number; stage?: number; stageName?: string; secondsLeft?: number; outcome?: LaunchOutcome; stowaway?: boolean },
): { text: string; level: LogLevel } | null {
  const id = p.rocketId ?? 0
  switch (name) {
    case 'rocket:stage': {
      const idx = (p.stage ?? 0) + 1
      const nm = (p.stageName ?? ROCKET_STAGES[p.stage ?? 0] ?? '').toUpperCase()
      return { text: `R-${id} STAGE ${idx}/${ROCKET_STAGES.length} ${nm} OK`, level: 'good' }
    }
    case 'rocket:complete':
      return { text: `R-${id} ASSEMBLY COMPLETE`, level: 'good' }
    case 'rocket:rollout':
      return { text: `R-${id} ROLLOUT TO PAD`, level: 'info' }
    case 'rocket:countdown':
      return p.secondsLeft === 10 ? { text: `R-${id} COUNTDOWN T-10`, level: 'warn' } : null
    case 'rocket:ignition':
      return { text: `R-${id} IGNITION`, level: 'warn' }
    case 'rocket:liftoff':
      return { text: `R-${id} LIFTOFF`, level: 'warn' }
    case 'rocket:outcome': {
      const o = p.outcome ?? 'success'
      const bad = o === 'breakup' || o === 'explosion'
      return { text: `R-${id} OUTCOME: ${OUTCOME_LABEL[o]}`, level: bad ? 'bad' : 'good' }
    }
    case 'rocket:reset':
      return { text: `PAD RESET · NEXT ROCKET R-${id + 1}`, level: 'info' }
    case 'factory:params':
      return { text: 'LINE SETTINGS CHANGED AT CONSOLE', level: 'info' }
    case 'nightshift:start':
      return { text: 'GRID FAULT · RUNNING ON VIBES', level: 'bad' }
    case 'nightshift:end':
      return { text: 'POWER RESTORED', level: 'good' }
    case 'osha:tackle':
      return { text: 'SAFETY: VISITOR RE-BRIEFED', level: 'warn' }
    default:
      return null
  }
}

/** Fixed-length ring buffer of samples (for sparklines). */
export class Series {
  readonly data: Float32Array
  private head = 0
  count = 0
  constructor(readonly size: number) {
    this.data = new Float32Array(size)
  }
  push(v: number): void {
    this.data[this.head] = Number.isFinite(v) ? v : 0
    this.head = (this.head + 1) % this.size
    this.count = Math.min(this.size, this.count + 1)
  }
  /** i = 0 is the oldest retained sample. */
  at(i: number): number {
    const start = (this.head - this.count + this.size) % this.size
    return this.data[(start + i) % this.size]
  }
  max(): number {
    let m = 0
    for (let i = 0; i < this.count; i++) m = Math.max(m, this.at(i))
    return m
  }
}

/**
 * Low-frequency telemetry sampled from the live sim (call `sample` every
 * SAMPLE_EVERY seconds). Also counts QC catches (rising edges of defectFlash).
 */
export class Telemetry {
  static readonly SAMPLE_EVERY = 1
  readonly rates: Record<LineId, Series>
  readonly throughput = new Series(60)
  readonly odds = new Series(60)
  qcCaught = 0
  private prevFlash: Record<LineId, number> = { smelt: 0, pipe: 0, circuit: 0, tank: 0, payload: 0 }
  private acc = 0

  constructor() {
    this.rates = { smelt: new Series(48), pipe: new Series(48), circuit: new Series(48), tank: new Series(48), payload: new Series(48) }
  }

  /** Advance by dt; samples when due. Returns true if a sample was taken. */
  tick(dt: number, s: FactoryState): boolean {
    // QC catches are edge-detected every tick so short flashes are not missed
    for (const id of LINE_ORDER) {
      const f = s.lines[id]?.defectFlash ?? 0
      if (f > 0 && this.prevFlash[id] <= 0) this.qcCaught++
      this.prevFlash[id] = f
    }
    this.acc += Math.max(0, Math.min(dt, 1))
    if (this.acc < Telemetry.SAMPLE_EVERY && this.throughput.count > 0) return false
    this.acc = 0
    for (const id of LINE_ORDER) this.rates[id].push(s.lines[id]?.rate ?? 0)
    this.throughput.push(s.model?.throughputPerHour ?? 0)
    this.odds.push(s.model?.successChance ?? 0)
    return true
  }
}

/** Overall assembly progress 0..1 of the current rocket. */
export function assemblyProgress(s: FactoryState): number {
  const n = ROCKET_STAGES.length
  const done = Math.min(n, Math.max(0, s.rocket.stagesComplete))
  const p = done >= n ? 0 : Math.min(1, Math.max(0, s.rocket.stageProgress))
  return Math.min(1, (done + p) / n)
}

/** Seconds since the last unscheduled disassembly (the counter sign's timer). */
export function sinceDisassembly(s: FactoryState): number {
  return Math.max(0, s.t - s.counters.lastDisassemblyT)
}
