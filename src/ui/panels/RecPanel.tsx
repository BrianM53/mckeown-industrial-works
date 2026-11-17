import { ACHIEVEMENTS } from '@/content/achievements'
import { REC_YARD } from '@/content/stations'
import { useGameStore } from '@/state/game'
import { Icon } from '../kit/Icon'
import { Keycap } from '../kit/Keycap'
import { Panel } from '../kit/Panel'
import { useUIMode } from '../lib/mode'
import { Section } from './common'
import type { PanelComponentProps } from './registry'

const YARD_TROPHIES = ['goal', 'volley']

/** Recreation Yard: personal-interest copy (REC_YARD) and how to play the two micro-games. */
export default function RecPanel({ onClose }: PanelComponentProps) {
  const mode = useUIMode()
  const unlocked = useGameStore((s) => s.achievements)
  const trophies = ACHIEVEMENTS.filter((a) => YARD_TROPHIES.includes(a.id))
  return (
    <Panel title={REC_YARD.title} kicker="Recreation Yard · Staff league" size="md" tone="paper" onClose={onClose} testId="panel-rec">
      {REC_YARD.paragraphs.map((p) => (
        <p key={p}>{p}</p>
      ))}
      <Section title="How to play">
        <dl className="miw-howto">
          <div className="miw-howto__row">
            <dt>
              <Icon name="ball" size={20} /> Soccer
            </dt>
            <dd>
              Walk up to the ball and press <Keycap size="sm">E</Keycap> (or tap <strong>Interact</strong>) to kick it at the goal.
            </dd>
          </div>
          <div className="miw-howto__row">
            <dt>
              <Icon name="ball" size={20} /> Volleyball
            </dt>
            <dd>
              Walk up to the volleyball and press <Keycap size="sm">E</Keycap> to bump it over the net.
            </dd>
          </div>
        </dl>
        {mode === 'fallback' && <p className="miw-meta">Both games live in the 3D factory, which isn’t running on this device.</p>}
      </Section>
      {trophies.length > 0 && (
        <Section title="Yard trophies">
          <ul className="miw-trophies">
            {trophies.map((a) => {
              const got = unlocked[a.id] !== undefined
              return (
                <li key={a.id} className={got ? 'is-unlocked' : undefined}>
                  <Icon name={got ? 'trophy' : 'lock'} size={18} />
                  <span>
                    <strong>{a.title}</strong> — {a.description}
                  </span>
                  <span className="miw-tag">{got ? 'Unlocked' : 'Locked'}</span>
                </li>
              )
            })}
          </ul>
          <p className="miw-meta">Game trophies for this visit (in-world fun, not career achievements).</p>
        </Section>
      )}
    </Panel>
  )
}
