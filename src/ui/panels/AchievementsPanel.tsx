import { ACHIEVEMENTS } from '@/content/achievements'
import { useGameStore } from '@/state/game'
import { Icon } from '../kit/Icon'
import { Panel } from '../kit/Panel'
import type { PanelComponentProps } from './registry'

/** Visitor achievements for this visit (game trophies, explicitly not career achievements). */
export default function AchievementsPanel({ onClose }: PanelComponentProps) {
  const unlocked = useGameStore((s) => s.achievements)
  const count = ACHIEVEMENTS.filter((a) => unlocked[a.id] !== undefined).length
  return (
    <Panel title="Achievements" kicker="Visitor record · this visit" size="md" tone="hmi" fiction onClose={onClose} testId="panel-achievements">
      <div className="miw-ach-summary">
        <p className="miw-ach-summary__count">
          <span className="miw-ach-summary__num">{count}</span> / {ACHIEVEMENTS.length} unlocked
        </p>
        <span className="miw-ach-summary__bar" aria-hidden="true">
          <span style={{ transform: `scaleX(${ACHIEVEMENTS.length ? count / ACHIEVEMENTS.length : 0})` }} />
        </span>
        <p className="miw-meta">Game trophies for exploring the factory, kept for this visit only. Not career achievements.</p>
      </div>
      <ul className="miw-ach-list">
        {ACHIEVEMENTS.map((a) => {
          const got = unlocked[a.id] !== undefined
          const secret = a.hidden && !got
          return (
            <li key={a.id} className={`miw-ach${got ? ' is-unlocked' : ''}${secret ? ' is-secret' : ''}`} data-testid={`ach-${a.id}`}>
              <span className="miw-ach__icon" aria-hidden="true">
                <Icon name={got ? 'trophy' : 'lock'} size={20} />
              </span>
              <div className="miw-ach__text">
                <p className="miw-ach__title">{secret ? '???' : a.title}</p>
                <p className="miw-ach__desc">{secret ? 'Hidden achievement. Keep exploring.' : a.description}</p>
              </div>
              <span className="miw-ach__state">{got ? 'Unlocked' : 'Locked'}</span>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}
