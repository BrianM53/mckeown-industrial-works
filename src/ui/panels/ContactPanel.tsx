import { contactOptions } from '@/content/links'
import { PROFILE } from '@/content/profile'
import { Icon } from '../kit/Icon'
import { Panel } from '../kit/Panel'
import { displayUrl } from '../lib/links'
import { CONTACT_ICON, CONTACT_KIND_LABEL, ContactLink, PanelLink } from './common'
import type { PanelComponentProps } from './registry'

/**
 * Contact / Hire / Say hello. Shows only contactOptions() (verified, owner
 * provided). Never invents an address: email appears only if PROFILE.email is set.
 */
export default function ContactPanel({ onClose }: PanelComponentProps) {
  const options = contactOptions()
  return (
    <Panel
      title="Contact"
      kicker="Hire · Say hello"
      size="sm"
      tone="paper"
      onClose={onClose}
      testId="panel-contact"
      footer={
        <PanelLink to="resume" icon="person" variant="ghost">
          View résumé
        </PanelLink>
      }
    >
      <p className="miw-lede">The best ways to reach {PROFILE.name}:</p>
      <ul className="miw-contact-list">
        {options.map((o) => {
          const where = o.kind === 'email' ? null : displayUrl(o.href)
          return (
            <li key={o.kind}>
              <ContactLink option={o} className="miw-contact-card">
                <span className="miw-contact-card__icon" aria-hidden="true">
                  <Icon name={CONTACT_ICON[o.kind]} size={22} />
                </span>
                <span className="miw-contact-card__text">
                  <span className="miw-contact-card__kind">{CONTACT_KIND_LABEL[o.kind]}</span>
                  <span className="miw-contact-card__label">{o.label}</span>
                  {where && where !== o.label && <span className="miw-contact-card__host">{where}</span>}
                </span>
              </ContactLink>
            </li>
          )
        })}
      </ul>
      {!PROFILE.email && PROFILE.linkedin?.verified && (
        <p className="miw-contact-note">
          <Icon name="info" size={16} /> No public email address is listed yet. Brian is reachable via LinkedIn.
        </p>
      )}
      {PROFILE.location && <p className="miw-meta">Based in {PROFILE.location}.</p>}
    </Panel>
  )
}
