import type { Counters, RocketState, RocketStage } from '@/systems/factory/types'
import { ROCKET_STAGES } from '@/systems/factory/types'

/**
 * HUD launch-strip text for the (fictional, simulated) rocket factory.
 * Pure function of the sim state so it can be unit-tested.
 */
export type LaunchTone = 'normal' | 'alert' | 'good' | 'bad'

export interface LaunchStatus {
  /** Main line, e.g. "ROCKET #4 · ASSEMBLY 62%" or "LAUNCH IN 7". */
  label: string
  /** Secondary detail, e.g. current stage. */
  detail: string | null
  tone: LaunchTone
  /** Whole seconds left while counting down, else null. */
  countdown: number | null
  /** 0..1 for assembly / rollout progress bars, else null. */
  progress: number | null
}

const STAGE_LABEL: Record<RocketStage, string> = {
  chassis: 'Chassis',
  tanks: 'Fuel tanks',
  fins: 'Fins',
  guidance: 'Guidance',
  nose: 'Nose cone',
  attachments: 'Questionable attachments',
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)

export function describeLaunch(r: RocketState): LaunchStatus {
  const id = Number.isFinite(r.id) ? r.id : 0
  const tag = `ROCKET #${id}`
  const mk = (label: string, detail: string | null, tone: LaunchTone = 'normal', countdown: number | null = null, progress: number | null = null): LaunchStatus => ({
    label,
    detail,
    tone,
    countdown,
    progress,
  })
  switch (r.phase) {
    case 'assembling': {
      const n = ROCKET_STAGES.length
      const done = Math.min(n, Math.max(0, Math.floor(Number.isFinite(r.stagesComplete) ? r.stagesComplete : 0)))
      const p = clamp01((done + clamp01(r.stageProgress)) / n)
      const stage = ROCKET_STAGES[Math.min(done, n - 1)]
      return mk(`${tag} · ASSEMBLY ${Math.floor(p * 100)}%`, done >= n ? 'Final checks' : STAGE_LABEL[stage], 'normal', null, p)
    }
    case 'rollout': {
      const p = clamp01(r.transport)
      return mk(`${tag} · ROLLOUT ${Math.floor(p * 100)}%`, 'Heading to the pad', 'normal', null, p)
    }
    case 'pad':
      return mk(`${tag} · ON THE PAD`, 'Awaiting countdown')
    case 'countdown': {
      const s = Math.max(0, Math.ceil(Number.isFinite(r.countdown ?? NaN) ? (r.countdown as number) : 0))
      return mk(`LAUNCH IN ${s}`, `Rocket #${id} · stand clear of the pad`, 'alert', s)
    }
    case 'ignition':
      return mk(`${tag} · IGNITION`, 'Stand clear', 'alert')
    case 'flight':
      return mk(`${tag} · LIFTOFF`, 'Watch the sky', 'alert')
    case 'aftermath':
      switch (r.outcome) {
        case 'success':
          return mk(`${tag} · NOMINAL ASCENT`, 'Orbit-ish achieved', 'good')
        case 'wobble':
          return mk(`${tag} · WOBBLY ASCENT`, 'Counts as a success', 'good')
        case 'breakup':
        case 'explosion':
          return mk(`${tag} · UNSCHEDULED DISASSEMBLY`, 'Counter reset', 'bad')
        default:
          return mk(`${tag} · LAUNCH COMPLETE`, null)
      }
    case 'reset':
      return mk(`${tag} · CLEARING THE PAD`, 'Next rocket queued')
    default:
      return mk(tag, null)
  }
}

/** Compact launch tally, e.g. "3 launched · 41 disassembled". */
export function describeCounters(c: Counters): string {
  const ok = Number.isFinite(c.successes) ? c.successes : 0
  const bad = Number.isFinite(c.disassemblies) ? c.disassemblies : 0
  return `${ok} launched · ${bad} disassembled`
}

/** Stable identity for change detection when polling. */
export function launchKey(s: LaunchStatus): string {
  return `${s.label}|${s.detail ?? ''}|${s.tone}|${s.progress === null ? '' : Math.floor(s.progress * 100)}`
}
