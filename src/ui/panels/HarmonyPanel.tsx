import { HARMONY } from '@/content/stations'
import { Icon } from '../kit/Icon'
import { ExternalLink, Panel } from '../kit/Panel'
import { hostLabel } from '../lib/links'
import { PanelLink } from './common'
import type { PanelComponentProps } from './registry'

/** Manufacturing Control Room: Brian's real role at Harmony AI (content/stations.ts HARMONY). */
export default function HarmonyPanel({ onClose }: PanelComponentProps) {
  return (
    <Panel
      title={HARMONY.company}
      kicker="Manufacturing Control Room"
      size="md"
      tone="paper"
      onClose={onClose}
      testId="panel-harmony"
      footer={
        <>
          <PanelLink to="codestory" icon="mic">
            Hear the Code Story interview
          </PanelLink>
          <PanelLink to="resume" icon="person" variant="ghost">
            Résumé
          </PanelLink>
        </>
      }
    >
      <div className="miw-role-plate">
        <span className="miw-role-plate__label">Brian’s role</span>
        <span className="miw-role-plate__value">{HARMONY.role}</span>
      </div>
      {HARMONY.paragraphs.map((p) => (
        <p key={p}>{p}</p>
      ))}
      <p className="miw-cta">
        <ExternalLink href={HARMONY.link.url} className="miw-btn miw-btn--primary miw-btn--lg">
          Visit {HARMONY.link.label || hostLabel(HARMONY.link.url)}
        </ExternalLink>
      </p>
      <aside className="miw-callout miw-callout--sim" role="note">
        <p className="miw-callout__title">
          <Icon name="gauge" size={18} /> About the control-room screens
        </p>
        <p>{HARMONY.simulatedDataNote}</p>
      </aside>
    </Panel>
  )
}
