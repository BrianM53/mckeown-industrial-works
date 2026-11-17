import { useEffect, useId, type CSSProperties, type ReactNode } from 'react'
import { events } from '@/core/events'
import type { LaunchOutcome } from '@/core/types'
import {
  displayDefectPercent,
  displaySuccessPercent,
  displayThroughput,
  factory,
  LINE_IDS,
  LINE_LABELS,
  MODEL,
  MODEL_EXPLAINER,
  PARAM_SPECS,
  ROCKET_STAGES,
  TARGET,
  TARGET_DEFECT_PERCENT,
  TOTAL_PRESSES,
  useFactory,
  type OptimizationResult,
  type RocketPhase,
  type RocketStage,
} from '@/systems/factory'
import { useSettings } from '@/state/settings'
import { Panel } from '@/ui/kit/Panel'
import type { PanelComponentProps } from '@/ui/panels/registry'
import { markCertified } from './certification'
import './console.css'

/**
 * Line Supervisor Console — the optimization minigame (spec §6). Three knobs
 * drive a small transparent model (systems/factory/model.ts); changes apply
 * live to the production lines and to the odds of every future launch.
 */
export default function ConsolePanel({ onClose }: PanelComponentProps) {
  const model = useFactory((s) => s.model)
  const reducedMotion = useSettings((s) => s.reducedMotion)

  useEffect(() => {
    if (!model.meetsTarget || !markCertified()) return
    events.emit('achievement', { id: 'line-certified' })
    events.emit('toast', {
      text: `Line certified! Launch success odds now ${displaySuccessPercent(model.successChance)}%.`,
      kind: 'success',
      duration: 5,
    })
  }, [model.meetsTarget, model.successChance])

  return (
    <Panel
      title="Line Supervisor Console"
      kicker="PRODUCTION SPINE · LINE SUPERVISOR CONSOLE"
      onClose={onClose}
      tone="hmi"
      size="lg"
      footer={
        <div className="lsc-footer">
          <button type="button" className="miw-btn lsc-btn" onClick={() => factory.resetParams()} data-testid="console-reset">
            <span aria-hidden="true">↺</span> Reset to defaults
          </button>
          <p className="lsc-footer__note">Simulated data — this factory is fictional.</p>
        </div>
      }
    >
      <div className="lsc" data-reduced-motion={reducedMotion || undefined}>
        <p className="lsc-intro">
          Rebalance the presses, tune the belts and set inspection to certify the line. Every change goes live on the factory floor.
        </p>
        <TargetBox model={model} />
        <Telemetry model={model} />
        <div className="lsc-grid">
          <Controls />
          <div className="lsc-col">
            <Readouts model={model} />
            <FloorStatus />
          </div>
        </div>
        <ModelExplainer />
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Target / certification
// ---------------------------------------------------------------------------

const BOTTLENECK_LABEL: Record<OptimizationResult['bottleneck'], string> = {
  smelt: 'Sheet stamping',
  pipe: 'Pipe machining',
  circuit: 'Electronics',
  tank: 'Tank line',
  payload: 'Payload QC',
  inspection: 'Inspection',
  balanced: 'None: lines balanced',
}

function TargetBox({ model }: { model: OptimizationResult }) {
  const tOk = displayThroughput(model.throughputPerHour) >= TARGET.throughputPerHour
  const dOk = displayDefectPercent(model.defectRate) <= TARGET_DEFECT_PERCENT
  const misses = Number(!tOk) + Number(!dOk)
  return (
    <section className="lsc-target" data-certified={model.meetsTarget} aria-labelledby="lsc-target-title">
      <div className="lsc-target__top">
        <div className="lsc-target__spec">
          <h3 id="lsc-target-title" className="lsc-eyebrow">
            Shift target
          </h3>
          <p className="lsc-target__goals">
            <span className="lsc-goal" data-ok={tOk}>
              <Lamp ok={tOk} /> ≥ {TARGET.throughputPerHour} rockets/hr
            </span>
            <span className="lsc-target__and" aria-hidden="true">
              +
            </span>
            <span className="lsc-goal" data-ok={dOk}>
              <Lamp ok={dOk} /> ≤ {TARGET_DEFECT_PERCENT.toFixed(1)}% escaped defects
            </span>
          </p>
        </div>
        <div className="lsc-target__status" role="status" aria-live="polite" data-testid="console-status">
          {model.meetsTarget ? (
            <p className="lsc-stamp">
              Line certified <span aria-hidden="true">✓</span>
            </p>
          ) : (
            <p className="lsc-pending">
              Not certified
              <span className="lsc-pending__sub">{misses === 2 ? 'Both goals off target' : '1 goal off target'}</span>
            </p>
          )}
        </div>
      </div>
      <div className="lsc-notes">
        <p className="lsc-bottleneck" data-kind={model.bottleneck} data-testid="console-bottleneck">
          <span className="lsc-bottleneck__label">Bottleneck</span>
          <span className="lsc-bottleneck__value">{BOTTLENECK_LABEL[model.bottleneck]}</span>
        </p>
        <ul className="lsc-hints" aria-label="Supervisor notes" data-testid="console-hints">
          {model.explanation.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function Lamp({ ok }: { ok: boolean }) {
  return <span className="lsc-lamp" data-state={ok ? 'ok' : 'bad'} aria-hidden="true" />
}

/**
 * Compact copy of the live readouts that sticks to the top of the panel while
 * the controls scroll. CSS shows it only in the single-column layout (phones,
 * 200% zoom), where the full readouts sit far below the sliders and players
 * would otherwise tune blind. Visual only: the Live readouts card is the
 * accessible version, so screen readers skip this duplicate.
 */
function Telemetry({ model }: { model: OptimizationResult }) {
  const t = displayThroughput(model.throughputPerHour)
  const d = displayDefectPercent(model.defectRate)
  const tOk = t >= TARGET.throughputPerHour
  const dOk = d <= TARGET_DEFECT_PERCENT
  return (
    <div className="lsc-telemetry" data-certified={model.meetsTarget} aria-hidden="true" data-testid="console-telemetry">
      <span className="lsc-tele">
        <span className="lsc-tele__k">Rockets/hr ≥ {TARGET.throughputPerHour}</span>
        <span className="lsc-tele__v" data-ok={tOk}>
          <Lamp ok={tOk} />
          {t.toFixed(1)}
        </span>
      </span>
      <span className="lsc-tele">
        <span className="lsc-tele__k">Defects ≤ {TARGET_DEFECT_PERCENT.toFixed(1)}%</span>
        <span className="lsc-tele__v" data-ok={dOk}>
          <Lamp ok={dOk} />
          {d.toFixed(1)}%
        </span>
      </span>
      <span className="lsc-tele">
        <span className="lsc-tele__k">Launch odds</span>
        <span className="lsc-tele__v">{displaySuccessPercent(model.successChance)}%</span>
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function Controls() {
  const params = useFactory((s) => s.params)
  const speed = PARAM_SPECS.conveyorSpeed
  const insp = PARAM_SPECS.inspection
  const knee = ((MODEL.overspeedKnee - speed.min) / (speed.max - speed.min)) * 100
  return (
    <section className="lsc-card lsc-controls" aria-labelledby="lsc-controls-title">
      <h3 id="lsc-controls-title" className="lsc-card__title">
        Controls
      </h3>
      <PressSelector value={params.pressesToTanks} />
      <Slider
        label="Conveyor speed"
        value={params.conveyorSpeed}
        min={speed.min}
        max={speed.max}
        step={speed.step}
        display={`${params.conveyorSpeed.toFixed(1)}×`}
        valueText={`${params.conveyorSpeed.toFixed(1)} times normal speed`}
        hint={`Every line runs faster. Past ${MODEL.overspeedKnee.toFixed(1)}× (striped zone) defects climb fast.`}
        scale={[`${speed.min.toFixed(1)}×`, `${MODEL.overspeedKnee.toFixed(1)}×`, `${speed.max.toFixed(1)}×`]}
        zoneStart={knee}
        testId="console-speed"
        onChange={(v) => factory.setParams({ conveyorSpeed: v })}
      />
      <Slider
        label="Inspection thoroughness"
        value={params.inspection}
        min={insp.min}
        max={insp.max}
        step={insp.step}
        display={`${Math.round(params.inspection * 100)}%`}
        valueText={`${Math.round(params.inspection * 100)} percent`}
        hint={`Catches up to ${Math.round(MODEL.inspectionCatch * 100)}% of bad parts, but holds every part for a check.`}
        scale={['Spot checks', 'Every bolt']}
        testId="console-inspection"
        onChange={(v) => factory.setParams({ inspection: v })}
      />
    </section>
  )
}

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  valueText: string
  hint: string
  scale: string[]
  /** Percent of the track where a striped caution zone starts. */
  zoneStart?: number
  testId: string
  onChange: (value: number) => void
}

function Slider({ label, value, min, max, step, display, valueText, hint, scale, zoneStart, testId, onChange }: SliderProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const fill = ((value - min) / (max - min)) * 100
  const style = { '--fill': `${fill}%`, '--zone': `${zoneStart ?? 101}%` } as CSSProperties
  return (
    <div className="lsc-control">
      <div className="lsc-control__head">
        <label htmlFor={id} className="lsc-control__label">
          {label}
        </label>
        <output htmlFor={id} className="lsc-control__value" data-testid={`${testId}-value`}>
          {display}
        </output>
      </div>
      <input
        id={id}
        className="lsc-range"
        data-zone={zoneStart !== undefined}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={style}
        aria-describedby={hintId}
        aria-valuetext={valueText}
        data-testid={testId}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
      <div className="lsc-scale" aria-hidden="true" data-count={scale.length}>
        {scale.map((s, i) => (
          <span key={s} style={scale.length === 3 && i === 1 && zoneStart !== undefined ? { left: `${zoneStart}%` } : undefined}>
            {s}
          </span>
        ))}
      </div>
      <p id={hintId} className="lsc-control__hint">
        {hint}
      </p>
    </div>
  )
}

function PressSelector({ value }: { value: number }) {
  const name = useId()
  const hintId = `${name}-hint`
  const spec = PARAM_SPECS.pressesToTanks
  const options: number[] = []
  for (let n = spec.min; n <= spec.max; n += spec.step) options.push(n)
  return (
    <fieldset className="lsc-control lsc-presses" aria-describedby={hintId}>
      <legend className="lsc-control__label">Presses stamping tank shells</legend>
      <div className="lsc-press-row" aria-hidden="true">
        {Array.from({ length: TOTAL_PRESSES }, (_, i) => (
          <span key={i} className="lsc-press" data-kind={i < value ? 'tank' : 'panel'}>
            <span className="lsc-press__ram" />
          </span>
        ))}
      </div>
      <div className="lsc-seg" data-testid="console-presses">
        {options.map((n) => (
          <label key={n} className="lsc-seg__opt">
            <input
              type="radio"
              name={name}
              value={n}
              checked={value === n}
              onChange={() => factory.setParams({ pressesToTanks: n })}
              aria-label={`${n} of ${TOTAL_PRESSES} presses on tank shells`}
            />
            <span aria-hidden="true">{n}</span>
          </label>
        ))}
      </div>
      <p id={hintId} className="lsc-control__hint">
        <span className="lsc-key lsc-key--tank" aria-hidden="true" /> {value} on tank shells
        <span className="lsc-key lsc-key--panel" aria-hidden="true" /> {TOTAL_PRESSES - value} on fins &amp; panels. The six presses are
        shared.
      </p>
    </fieldset>
  )
}

// ---------------------------------------------------------------------------
// Readouts
// ---------------------------------------------------------------------------

const THROUGHPUT_SCALE = 30
const DEFECT_SCALE = 10

function Readouts({ model }: { model: OptimizationResult }) {
  const t = displayThroughput(model.throughputPerHour)
  const d = displayDefectPercent(model.defectRate)
  const odds = displaySuccessPercent(model.successChance)
  const tOk = t >= TARGET.throughputPerHour
  const dOk = d <= TARGET_DEFECT_PERCENT
  return (
    <section className="lsc-card lsc-readouts" aria-labelledby="lsc-readouts-title">
      <h3 id="lsc-readouts-title" className="lsc-card__title">
        Live readouts
      </h3>
      <Readout
        label="Throughput"
        value={t.toFixed(1)}
        unit="rockets/hr"
        ok={tOk}
        target={`target ≥ ${TARGET.throughputPerHour}`}
        testId="console-throughput"
        bar={<Bar value={t / THROUGHPUT_SCALE} target={TARGET.throughputPerHour / THROUGHPUT_SCALE} ok={tOk} />}
      />
      <Readout
        label="Escaped defects"
        value={`${d.toFixed(1)}%`}
        ok={dOk}
        target={`target ≤ ${TARGET_DEFECT_PERCENT.toFixed(1)}%`}
        testId="console-defects"
        bar={<Bar value={d / DEFECT_SCALE} target={TARGET_DEFECT_PERCENT / DEFECT_SCALE} ok={dOk} overflow={d > DEFECT_SCALE} />}
      />
      <Readout
        label="Launch success odds"
        value={`${odds}%`}
        ok={null}
        target={`cap ${Math.round(MODEL.success.max * 100)}%`}
        testId="console-odds"
        bar={<Bar value={model.successChance} target={MODEL.success.max} ok={null} />}
      />
    </section>
  )
}

interface ReadoutProps {
  label: string
  value: string
  unit?: string
  /** null = informational (no pass/fail). */
  ok: boolean | null
  target: string
  bar: ReactNode
  testId: string
}

function Readout({ label, value, unit, ok, target, bar, testId }: ReadoutProps) {
  return (
    <div className="lsc-readout" data-ok={ok === null ? 'info' : ok} data-testid={testId}>
      <div className="lsc-readout__row">
        <span className="lsc-readout__label">{label}</span>
        <span className="lsc-readout__value">
          <span className="lsc-num" data-testid={`${testId}-value`}>
            {value}
          </span>
          {unit && <span className="lsc-unit"> {unit}</span>}
        </span>
      </div>
      {bar}
      <div className="lsc-readout__meta">
        <span>{target}</span>
        {ok !== null && (
          <span className="lsc-verdict" data-ok={ok}>
            {ok ? '✓ On target' : '✗ Off target'}
          </span>
        )}
      </div>
    </div>
  )
}

function Bar({ value, target, ok, overflow }: { value: number; target: number; ok: boolean | null; overflow?: boolean }) {
  const style = {
    '--v': `${Math.min(1, Math.max(0, value)) * 100}%`,
    '--t': `${Math.min(1, Math.max(0, target)) * 100}%`,
  } as CSSProperties
  return (
    <div className="lsc-bar" style={style} data-ok={ok === null ? 'info' : ok} data-overflow={overflow || undefined} aria-hidden="true">
      <span className="lsc-bar__fill" />
      <span className="lsc-bar__target" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Floor status (live link to the 3D factory)
// ---------------------------------------------------------------------------

const STAGE_LABEL: Record<RocketStage, string> = {
  chassis: 'chassis',
  tanks: 'fuel tanks',
  fins: 'fins',
  guidance: 'guidance',
  nose: 'nose cone',
  attachments: 'questionable attachments',
}

const OUTCOME_LABEL: Record<LaunchOutcome, string> = {
  success: 'Clean ascent',
  wobble: 'Wobbly, but up',
  breakup: 'Unscheduled disassembly',
  explosion: 'Unscheduled disassembly (loud)',
}

function phaseText(phase: RocketPhase, stages: number, countdown: number | null): string {
  switch (phase) {
    case 'assembling':
      return stages < ROCKET_STAGES.length ? `Assembling ${STAGE_LABEL[ROCKET_STAGES[stages]]} (stage ${stages + 1} of ${ROCKET_STAGES.length})` : 'Assembly complete'
    case 'rollout':
      return 'Rolling out to the pad'
    case 'pad':
      return 'On the pad'
    case 'countdown':
      return `Countdown: T−${countdown ?? 0}`
    case 'ignition':
      return 'Ignition'
    case 'flight':
      return 'In flight'
    case 'aftermath':
      return 'Reviewing the footage'
    case 'reset':
      return 'Resetting the tower'
  }
}

function FloorStatus() {
  const id = useFactory((s) => s.rocket.id)
  const phase = useFactory((s) => s.rocket.phase)
  const stages = useFactory((s) => s.rocket.stagesComplete)
  const countdown = useFactory((s) => (s.rocket.countdown === null ? null : Math.ceil(s.rocket.countdown - 1e-6)))
  const statuses = useFactory((s) => LINE_IDS.map((l) => s.lines[l].status).join('|'))
  const last = useFactory((s) => s.history[s.history.length - 1] ?? null)
  const list = statuses.split('|')
  return (
    <section className="lsc-card lsc-floor" aria-labelledby="lsc-floor-title">
      <h3 id="lsc-floor-title" className="lsc-card__title">
        Factory floor
      </h3>
      <div className="lsc-floor__rocket">
        <p className="lsc-floor__now" data-testid="console-floor">
          <span className="lsc-floor__id">Rocket #{id}</span> {phaseText(phase, stages, countdown)}
        </p>
        <p className="lsc-floor__last">
          Last launch:{' '}
          {last ? (
            <span data-good={last.outcome === 'success' || last.outcome === 'wobble'}>
              #{last.rocketId} {OUTCOME_LABEL[last.outcome]}
              {last.stowaway ? ' (with a passenger)' : ''}
            </span>
          ) : (
            <span>before your shift</span>
          )}
        </p>
      </div>
      <ul className="lsc-lines">
        {LINE_IDS.map((l, i) => {
          const blocked = list[i] === 'blocked'
          return (
            <li key={l} className="lsc-line" data-status={list[i]}>
              <span className="lsc-lamp" data-state={blocked ? 'warn' : 'ok'} aria-hidden="true" />
              <span className="lsc-line__name">{LINE_LABELS[l]}</span>
              <span className="lsc-line__state">{blocked ? 'Backed up' : 'Running'}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------------------
// How the model works
// ---------------------------------------------------------------------------

function ModelExplainer() {
  return (
    <details className="lsc-model">
      <summary>How the model works</summary>
      <ol className="lsc-model__list">
        {MODEL_EXPLAINER.map((e) => (
          <li key={e.title}>
            <h4>{e.title}</h4>
            <code>{e.formula}</code>
            <p>{e.text}</p>
          </li>
        ))}
      </ol>
      <p className="lsc-model__note">
        Out in the yard the tower crew and the single launch pad keep their own pace, so launches speed up more gently than the throughput
        number. Your settings change every future launch’s odds, and the lines respond as soon as you move a control.
      </p>
    </details>
  )
}
