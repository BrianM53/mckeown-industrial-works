import { PROJECTS } from '@/content/projects'
import { RND_ANNEX } from '@/content/stations'
import { ExternalLink, Panel } from '../kit/Panel'
import { Chips, PanelLink } from './common'
import type { PanelComponentProps } from './registry'

/** R&D Annex: featured projects (projects.ts featured === true). */
export default function RndPanel({ onClose }: PanelComponentProps) {
  const featured = PROJECTS.filter((p) => p.featured)
  return (
    <Panel
      title={RND_ANNEX.title}
      kicker="R&D Annex · Featured builds"
      size="md"
      tone="paper"
      onClose={onClose}
      testId="panel-rnd"
      footer={
        <PanelLink to="github" icon="code">
          All repositories
        </PanelLink>
      }
    >
      <p className="miw-lede">{RND_ANNEX.intro}</p>
      <ul className="miw-features">
        {featured.map((p, i) => (
          <li key={p.id} className="miw-feature">
            <p className="miw-feature__rig" aria-hidden="true">
              Test rig {String(i + 1).padStart(2, '0')}
            </p>
            <h3 className="miw-feature__name">{p.name}</h3>
            <p>{p.oneLiner}</p>
            <Chips items={p.tech} label={`${p.name} technologies`} />
            {p.caveat && <p className="miw-caveat">{p.caveat}</p>}
            <div className="miw-feature__actions">
              <PanelLink to="project" params={{ projectId: p.id }} variant="primary" className="miw-btn--sm" ariaLabel={`Read more: ${p.name}`}>
                Read more
              </PanelLink>
              <ExternalLink href={p.url} className="miw-btn miw-btn--sm" label={`Repository: ${p.name}`}>
                Repository
              </ExternalLink>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
