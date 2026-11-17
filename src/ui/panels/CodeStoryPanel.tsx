import { PODCAST } from '@/content/stations'
import { ExternalLink, Panel } from '../kit/Panel'
import { hostLabel } from '../lib/links'
import { Section } from './common'
import type { PanelComponentProps } from './registry'

/**
 * Broadcast Booth: the Code Story interview. Links out to the episode page; no
 * audio is streamed or embedded here.
 */
export default function CodeStoryPanel({ onClose }: PanelComponentProps) {
  const host = hostLabel(PODCAST.link.url)
  return (
    <Panel title={PODCAST.show} kicker="Broadcast Booth · Podcast" size="md" tone="paper" onClose={onClose} testId="panel-codestory">
      <div className="miw-onair" aria-hidden="true">
        <span className="miw-onair__lamp" /> On air
      </div>
      <h3 className="miw-episode__title">{PODCAST.episodeTitle}</h3>
      <p className="miw-episode__meta">
        {PODCAST.show}
        {PODCAST.date && (
          <>
            {' · '}
            <time>{PODCAST.date}</time>
          </>
        )}
      </p>
      <p>{PODCAST.summary}</p>
      {PODCAST.attributionNote && <p className="miw-meta">{PODCAST.attributionNote}</p>}
      <p className="miw-cta">
        <ExternalLink href={PODCAST.link.url} className="miw-btn miw-btn--primary miw-btn--lg">
          Open episode
        </ExternalLink>
      </p>
      <p className="miw-meta">Opens the episode on {host} in a new tab. No audio plays on this site.</p>
      {PODCAST.platformLinks.length > 0 && (
        <Section title="Also on">
          <ul className="miw-platforms">
            {PODCAST.platformLinks.map((l) => (
              <li key={l.url}>
                <ExternalLink href={l.url}>{l.label}</ExternalLink>
                {/show page/i.test(`${l.label} ${l.note ?? ''}`) && <span className="miw-tag">Show page</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </Panel>
  )
}
