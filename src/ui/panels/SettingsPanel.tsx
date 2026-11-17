import { useId, type ReactNode } from 'react'
import { events } from '@/core/events'
import { useGameStore } from '@/state/game'
import { useSettings, type QualitySetting, type SettingsState } from '@/state/settings'
import { Icon } from '../kit/Icon'
import { Panel } from '../kit/Panel'
import { useUIMode } from '../lib/mode'
import type { PanelComponentProps } from './registry'

type Patch = Partial<Omit<SettingsState, 'set' | 'reset'>>

function systemPrefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * Settings cabinet: every visitor preference in state/settings.ts. Native,
 * labelled inputs (switches, sliders, radio group) so everything is keyboard and
 * screen-reader operable. Changes apply instantly and persist in this browser.
 */
export default function SettingsPanel({ onClose }: PanelComponentProps) {
  const s = useSettings()
  const tier = useGameStore((g) => g.quality)
  const mode = useUIMode()
  const set = (patch: Patch) => useSettings.getState().set(patch)

  const enableSound = () => {
    set({ audioConsent: true, muted: false })
    events.emit('sfx', { name: 'ui-click' })
  }
  const resetDefaults = () => {
    const consent = useSettings.getState().audioConsent
    useSettings.getState().reset()
    // Consent is an explicit choice for this visit, not a "preference": keep it.
    if (consent) set({ audioConsent: true })
  }

  return (
    <Panel
      title="Settings"
      kicker="Control cabinet"
      size="md"
      tone="hmi"
      onClose={onClose}
      testId="panel-settings"
      footer={
        <>
          <button type="button" className="miw-btn" onClick={resetDefaults} data-testid="settings-reset">
            <Icon name="recover" size={18} /> Reset to defaults
          </button>
          <span className="miw-meta">Saved in this browser only.</span>
        </>
      }
    >
      <div className="miw-settings">
        <fieldset className="miw-set">
          <legend className="miw-set__legend">
            <Icon name="sound-on" size={18} /> Sound
          </legend>
          <div className="miw-set__row miw-set__row--consent">
            <div className="miw-set__text">
              <p className="miw-set__label">Sound for this visit</p>
              <p className="miw-set__desc">{s.audioConsent ? (s.muted ? 'Enabled, currently muted.' : 'Enabled.') : 'Off until you turn it on. Nothing plays automatically.'}</p>
            </div>
            {s.audioConsent ? (
              <span className={`miw-set__status${s.muted ? '' : ' is-on'}`}>
                <span className="miw-led" aria-hidden="true" /> {s.muted ? 'Muted' : 'On'}
              </span>
            ) : (
              <button type="button" className="miw-btn miw-btn--primary miw-btn--sm" onClick={enableSound}>
                <Icon name="sound-on" size={16} /> Enable sound
              </button>
            )}
          </div>
          <Switch label="Mute all sound" checked={s.muted} onChange={(v) => set({ muted: v })} />
          <Slider label="Master volume" value={s.masterVolume} onChange={(v) => set({ masterVolume: v })} />
          <Slider label="Music volume" value={s.musicVolume} onChange={(v) => set({ musicVolume: v })} />
          <Slider label="Effects volume" value={s.sfxVolume} onChange={(v) => set({ sfxVolume: v })} />
          <Switch label="Captions for sound cues" description="Whistles, alarms, countdowns and PA announcements as text." checked={s.captions} onChange={(v) => set({ captions: v })} />
        </fieldset>

        <fieldset className="miw-set">
          <legend className="miw-set__legend">
            <Icon name="info" size={18} /> Comfort
          </legend>
          <Switch
            label="Reduce motion"
            description={
              s.reducedMotionSource === 'system' ? 'Following your system setting. No camera shake, gentler transitions, fewer flashes.' : 'Your choice for this site. No camera shake, gentler transitions, fewer flashes.'
            }
            checked={s.reducedMotion}
            onChange={(v) => set({ reducedMotion: v, reducedMotionSource: 'user' })}
          >
            {s.reducedMotionSource === 'user' && (
              <button type="button" className="miw-linkbtn" onClick={() => set({ reducedMotion: systemPrefersReducedMotion(), reducedMotionSource: 'system' })}>
                Use system setting
              </button>
            )}
          </Switch>
          <Switch
            label="Ambient gags & announcements"
            description="Involuntary jokes and PA announcements. Things you trigger yourself always work."
            checked={s.ambientEvents}
            onChange={(v) => set({ ambientEvents: v })}
          />
        </fieldset>

        <fieldset className="miw-set">
          <legend className="miw-set__legend">
            <Icon name="recenter" size={18} /> Camera &amp; controls
          </legend>
          <Slider
            label="Camera sensitivity"
            min={0.25}
            max={3}
            step={0.05}
            value={s.cameraSensitivity}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(v) => set({ cameraSensitivity: v })}
          />
          <Switch label="Invert vertical look" checked={s.invertY} onChange={(v) => set({ invertY: v })} />
          <Switch
            label="Mouse-look (pointer lock)"
            description="Click the factory to capture the mouse for free look. Esc releases it."
            checked={s.pointerLock}
            onChange={(v) => set({ pointerLock: v })}
          />
        </fieldset>

        <fieldset className="miw-set">
          <legend className="miw-set__legend">
            <Icon name="gauge" size={18} /> Graphics
          </legend>
          <QualityPicker value={s.quality} onChange={(q) => set({ quality: q })} current={mode === 'game' ? tier : null} />
          <Switch label="Show FPS counter" checked={s.showFps} onChange={(v) => set({ showFps: v })} />
        </fieldset>
      </div>
    </Panel>
  )
}

function Switch({
  label,
  description,
  checked,
  onChange,
  children,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
  children?: ReactNode
}) {
  const id = useId()
  return (
    <div className="miw-set__row">
      <div className="miw-set__text">
        <label className="miw-set__label" htmlFor={id}>
          {label}
        </label>
        {description && (
          <p className="miw-set__desc" id={`${id}-d`}>
            {description}
          </p>
        )}
        {children}
      </div>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="miw-switch"
        checked={checked}
        aria-describedby={description ? `${id}-d` : undefined}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
    </div>
  )
}

function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.05,
  format = (v: number) => `${Math.round(v * 100)}%`,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  format?: (v: number) => string
}) {
  const id = useId()
  const safe = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min
  const pct = ((safe - min) / (max - min)) * 100
  return (
    <div className="miw-set__row miw-set__row--slider">
      <label className="miw-set__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="range"
        className="miw-slider"
        min={min}
        max={max}
        step={step}
        value={safe}
        aria-valuetext={format(safe)}
        style={{ ['--fill' as string]: `${pct}%` }}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
      <output className="miw-set__value" htmlFor={id}>
        {format(safe)}
      </output>
    </div>
  )
}

const QUALITY: { value: QualitySetting; label: string; desc: string }[] = [
  { value: 'auto', label: 'Auto', desc: 'Adapts to your device' },
  { value: 'low', label: 'Low', desc: 'No shadows, fewer details' },
  { value: 'medium', label: 'Medium', desc: 'Balanced' },
  { value: 'high', label: 'High', desc: 'Sharper, more effects' },
]

function QualityPicker({ value, onChange, current }: { value: QualitySetting; onChange: (q: QualitySetting) => void; current: string | null }) {
  const name = useId()
  return (
    <div className="miw-set__row miw-set__row--quality" role="radiogroup" aria-labelledby={`${name}-l`}>
      <div className="miw-set__text">
        <p className="miw-set__label" id={`${name}-l`}>
          Render quality
        </p>
        {current && <p className="miw-set__desc">Currently rendering at {current}.</p>}
      </div>
      <div className="miw-segmented">
        {QUALITY.map((q) => (
          <label key={q.value} className={`miw-segmented__opt${value === q.value ? ' is-checked' : ''}`} title={q.desc}>
            <input type="radio" name={name} value={q.value} checked={value === q.value} onChange={() => onChange(q.value)} />
            <span>{q.label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
