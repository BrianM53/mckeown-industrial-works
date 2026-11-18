import { FICTION_DISCLAIMER, PROFILE } from '@/content/profile'
import { Icon } from '../kit/Icon'
import { Panel } from '../kit/Panel'
import { portfolioHref } from '../lib/links'
import { Chips, PanelLink, Section } from './common'
import type { PanelComponentProps } from './registry'

/** How this site is built (facts about the codebase itself, not about Brian). */
const STACK = ['TypeScript', 'React', 'Vite', 'Three.js', 'React Three Fiber', 'drei', 'Rapier physics', 'zustand', 'Web Audio API']

/** About: who Brian is, fact vs fiction, how the site was built, credits & licenses. */
export default function AboutPanel({ onClose }: PanelComponentProps) {
  return (
    <Panel
      title="About this site"
      kicker="McKeown Industrial Works"
      size="md"
      tone="paper"
      onClose={onClose}
      testId="panel-about"
      footer={
        <>
          <a className="miw-btn miw-btn--primary" href={portfolioHref()}>
            View the plain HTML portfolio
          </a>
          <PanelLink to="contact" icon="mail">
            Contact
          </PanelLink>
        </>
      }
    >
      <aside className="miw-callout miw-callout--fiction" role="note" data-testid="fiction-disclaimer">
        <p className="miw-callout__title">
          <Icon name="warning" size={18} /> Fact vs. fiction
        </p>
        <p>{FICTION_DISCLAIMER}</p>
      </aside>

      <Section title={`Who is ${PROFILE.name}?`}>
        {PROFILE.summary.map((p) => (
          <p key={p}>{p}</p>
        ))}
        {PROFILE.facts.length > 0 && (
          <ul className="miw-facts">
            {PROFILE.facts.map((f) => (
              <li key={f.text}>
                {f.text}
                <span className="miw-source"> Source: {f.source}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="How this site was built">
        <p>
          A browser-based, explorable third-person factory. Everything is rendered live in your browser: the world is
          built from code with Three.js through React Three Fiber, with Rapier physics, and sound is synthesized with the
          Web Audio API. The portfolio content lives in small typed data files, so every panel (and the plain HTML
          version) reads from the same facts.
        </p>
        <Chips items={STACK} label="Technology" />
      </Section>

      <Section title="Credits & licenses">
        <ul className="miw-credits">
          <li>
            Fonts: Barlow, Barlow Condensed and IBM Plex Mono, under the SIL Open Font License 1.1, self-hosted (no
            remote font requests).
          </li>
          <li>All 3D models, textures, sound effects and music are original and generated procedurally in code. No third-party models, images or recordings.</li>
          <li>Open-source libraries: React, three.js, React Three Fiber, drei and zustand (MIT), and Rapier physics (Apache-2.0).</li>
          <li>Harmony AI and Code Story are named factually; no logos are reproduced.</li>
          <li>The safety inspector is a generic parody character with no government affiliation.</li>
        </ul>
      </Section>
    </Panel>
  )
}
