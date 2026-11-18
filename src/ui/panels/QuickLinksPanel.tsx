import type { MouseEvent } from 'react'
import { contactOptions } from '@/content/links'
import { PROJECTS } from '@/content/projects'
import { HARMONY, PODCAST } from '@/content/stations'
import type { PanelId } from '@/state/ui'
import { ZONES } from '@/world/layout'
import { Icon, type IconName } from '../kit/Icon'
import { Keycap } from '../kit/Keycap'
import { Panel } from '../kit/Panel'
import { portfolioHref } from '../lib/links'
import { useUIMode } from '../lib/mode'
import { openPanelFromControl } from '../lib/nav'
import { CONTACT_KIND_LABEL } from './common'
import type { PanelComponentProps } from './registry'

interface Tile {
  id: PanelId
  title: string
  sub: string
  icon: IconName
  color?: string
}

/** The pause / portfolio menu: every real destination one click away (works without WebGL). */
export default function QuickLinksPanel({ onClose }: PanelComponentProps) {
  const mode = useUIMode()
  const game = mode === 'game'

  const portfolio: Tile[] = [
    { id: 'resume', title: 'Résumé', sub: 'Experience, education, skills', icon: 'person', color: ZONES.personnel.color },
    { id: 'harmony', title: HARMONY.company, sub: `Brian’s role: ${HARMONY.role}`, icon: 'gauge', color: ZONES.control.color },
    { id: 'codestory', title: PODCAST.show, sub: PODCAST.date ? `Podcast interview · ${PODCAST.date}` : 'Podcast interview', icon: 'mic', color: ZONES.radio.color },
    { id: 'github', title: 'GitHub', sub: `${PROJECTS.length} selected repositories`, icon: 'code', color: ZONES.server.color },
    { id: 'contact', title: 'Contact', sub: contactOptions().map((o) => CONTACT_KIND_LABEL[o.kind]).join(', '), icon: 'mail', color: ZONES.intake.color },
    { id: 'about', title: 'About', sub: 'Who Brian is · how this site works', icon: 'info' },
  ]
  // Without the 3D world there are no routes, camera or trophies to offer: say only what works.
  const factory: Tile[] = game
    ? [
        { id: 'directory', title: 'Directory', sub: 'Map, routes & fast travel', icon: 'map' },
        { id: 'settings', title: 'Settings', sub: 'Sound, motion, camera', icon: 'sliders' },
        { id: 'help', title: 'Help', sub: 'Controls & wayfinding', icon: 'help' },
        { id: 'achievements', title: 'Achievements', sub: 'Visitor trophies', icon: 'trophy' },
      ]
    : [
        { id: 'directory', title: 'Directory', sub: 'Site map & every destination', icon: 'map' },
        { id: 'settings', title: 'Settings', sub: 'Motion & display', icon: 'sliders' },
        { id: 'help', title: 'Help', sub: 'Finding your way around', icon: 'help' },
      ]

  const go = (id: PanelId) => (e: MouseEvent<HTMLButtonElement>) => openPanelFromControl(id, e)

  return (
    <Panel
      title="Portfolio quick links"
      kicker={game ? 'Paused · Shift break' : 'Menu'}
      size="md"
      tone="hmi"
      onClose={onClose}
      testId="panel-quicklinks"
      footer={
        <>
          <button type="button" className="miw-btn miw-btn--primary" onClick={onClose} data-testid="resume-play">
            <Icon name={game ? 'travel' : 'close'} size={18} /> {game ? 'Resume play' : 'Close menu'}
          </button>
          <a className="miw-btn" href={portfolioHref()}>
            {game ? 'Skip game → View portfolio' : 'View portfolio page'}
          </a>
        </>
      }
    >
      <h3 className="miw-ql__group">Portfolio</h3>
      <ul className="miw-ql miw-ql--main">
        {portfolio.map((t) => (
          <li key={t.id}>
            <button type="button" className="miw-ql__tile" style={t.color ? { ['--zone' as string]: t.color } : undefined} onClick={go(t.id)} data-testid={`ql-${t.id}`}>
              <span className="miw-ql__icon" aria-hidden="true">
                <Icon name={t.icon} size={22} />
              </span>
              <span className="miw-ql__text">
                <span className="miw-ql__title">{t.title}</span>
                <span className="miw-ql__sub">{t.sub}</span>
              </span>
              <Icon name="chevron" size={18} className="miw-ql__chev" />
            </button>
          </li>
        ))}
      </ul>
      <h3 className="miw-ql__group">{game ? 'Factory' : 'Site'}</h3>
      <ul className={`miw-ql miw-ql--small${factory.length === 3 ? ' miw-ql--three' : ''}`}>
        {factory.map((t) => (
          <li key={t.id}>
            <button type="button" className="miw-ql__tile miw-ql__tile--small" onClick={go(t.id)} data-testid={`ql-${t.id}`}>
              <span className="miw-ql__icon" aria-hidden="true">
                <Icon name={t.icon} size={20} />
              </span>
              <span className="miw-ql__text">
                <span className="miw-ql__title">{t.title}</span>
                <span className="miw-ql__sub">{t.sub}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {game && (
        <p className="miw-meta miw-ql__keys" aria-hidden="true">
          <Keycap size="sm">P</Keycap> or <Keycap size="sm">Esc</Keycap> opens this menu · <Keycap size="sm">M</Keycap> directory · <Keycap size="sm">?</Keycap> help
        </p>
      )}
    </Panel>
  )
}
