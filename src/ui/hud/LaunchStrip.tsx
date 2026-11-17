import { factory, useFactory } from '@/systems/factory'
import { Icon } from '../kit/Icon'
import { describeCounters, describeLaunch, launchKey } from '../lib/launchStatus'
import { usePoll } from '../lib/usePoll'

const SIM_NOTE = 'Simulated factory data. In-world fiction, not real metrics.'

/**
 * Compact launch status (top-left), e.g. "ROCKET #4 · ASSEMBLY 62%". During the
 * countdown it becomes a prominent "⚠ LAUNCH IN 7" status. Re-renders on sim
 * notifications plus a 4 Hz poll for smooth progress between them.
 */
export function LaunchStrip() {
  useFactory((s) => s.rocket.phase)
  usePoll(() => launchKey(describeLaunch(factory.state.rocket)), 4)
  const status = describeLaunch(factory.state.rocket)
  const counters = describeCounters(factory.state.counters)

  if (status.countdown !== null) {
    return (
      <div className="miw-launch miw-launch--countdown" title={SIM_NOTE} data-testid="launch-strip">
        <div role="status" aria-live="polite" className="miw-launch__count">
          <Icon name="warning" size={22} />
          <span>
            LAUNCH IN <span className="miw-launch__secs">{status.countdown}</span>
          </span>
        </div>
        {status.detail && <p className="miw-launch__detail">{status.detail}</p>}
        <span className="sr-only">{SIM_NOTE}</span>
      </div>
    )
  }

  return (
    <div className={`miw-launch miw-launch--${status.tone}`} title={SIM_NOTE} data-testid="launch-strip">
      <p className="miw-launch__row">
        <span className="miw-launch__sim" aria-hidden="true">
          SIM
        </span>
        <span className="miw-launch__label">{status.label}</span>
      </p>
      {status.progress !== null && (
        <span className="miw-launch__bar" aria-hidden="true">
          <span style={{ transform: `scaleX(${status.progress})` }} />
        </span>
      )}
      <p className="miw-launch__detail">
        {status.detail}
        <span className="miw-launch__counters">
          {status.detail ? ' · ' : ''}
          {counters}
        </span>
      </p>
      <span className="sr-only">{SIM_NOTE}</span>
    </div>
  )
}
