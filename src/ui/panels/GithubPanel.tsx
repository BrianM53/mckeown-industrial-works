import { PROFILE } from '@/content/profile'
import { GITHUB_PROFILE_URL, PROJECTS } from '@/content/projects'
import { ExternalLink, Panel } from '../kit/Panel'
import { repoPath } from '../lib/links'
import { PanelLink } from './common'
import type { PanelComponentProps } from './registry'

/**
 * Server Hall: terminal-styled cards for every curated repository in
 * content/projects.ts. Rendered from local config only (no GitHub API, no stats).
 */
export default function GithubPanel({ onClose }: PanelComponentProps) {
  return (
    <Panel
      title="Code on GitHub"
      kicker="Server Hall · Repositories"
      size="lg"
      tone="hmi"
      onClose={onClose}
      testId="panel-github"
      footer={
        <>
          <ExternalLink href={GITHUB_PROFILE_URL} className="miw-btn miw-btn--primary">
            {PROFILE.github.label}
          </ExternalLink>
          <PanelLink to="rnd" icon="flask">
            R&amp;D Annex
          </PanelLink>
        </>
      }
    >
      <p className="miw-term-line" aria-hidden="true">
        <span className="miw-term-line__prompt">$</span> ls ~/{repoPath(GITHUB_PROFILE_URL)} --curated
      </p>
      <ul className="miw-repos">
        {PROJECTS.map((p) => (
          <li key={p.id} className="miw-repo">
            <div className="miw-repo__bar" aria-hidden="true">
              <span className="miw-repo__dots">
                <i />
                <i />
                <i />
              </span>
              <span className="miw-repo__path">{repoPath(p.url)}</span>
            </div>
            <div className="miw-repo__body">
              <h3 className="miw-repo__name">
                {p.name}
                {p.featured && <span className="miw-tag miw-repo__tag">Featured</span>}
                {p.isFork && <span className="miw-tag miw-repo__tag">Fork</span>}
              </h3>
              <p className="miw-repo__text">{p.oneLiner}</p>
              {p.tech.length > 0 && (
                <ul className="miw-chips" aria-label={`${p.name} technologies`}>
                  {p.tech.map((t) => (
                    <li key={t} className="miw-chip">
                      {t}
                    </li>
                  ))}
                </ul>
              )}
              {p.caveat && <p className="miw-repo__caveat">{p.caveat}</p>}
            </div>
            <div className="miw-repo__actions">
              <ExternalLink href={p.url} className="miw-btn miw-btn--sm" label={`View repo: ${p.name}`}>
                View repo
              </ExternalLink>
              <PanelLink to="project" params={{ projectId: p.id }} variant="ghost" className="miw-btn--sm" ariaLabel={`Details: ${p.name}`}>
                Details
              </PanelLink>
            </div>
          </li>
        ))}
      </ul>
      <p className="miw-meta miw-repos__note">Curated from local configuration. No live GitHub data, contribution counts or activity stats.</p>
    </Panel>
  )
}
