import { contactOptions } from '@/content/links'
import { PROFILE } from '@/content/profile'
import { PROJECTS } from '@/content/projects'
import { RESUME } from '@/content/resume'
import { Icon } from '../kit/Icon'
import { ExternalLink, Panel } from '../kit/Panel'
import { assetHref } from '../lib/links'
import { CONTACT_KIND_LABEL, Chips, ContactLink, PanelLink, Section } from './common'
import type { PanelComponentProps } from './registry'

/**
 * Personnel Office: accessible HTML résumé built from content/resume.ts,
 * projects.ts and profile.ts. While RESUME.status is 'pending' a clearly
 * labelled note is shown; a Download PDF link appears only when RESUME.pdfUrl
 * is set. "Print / save as PDF" prints just this document (print styles in
 * panels.css).
 */
export default function ResumePanel({ onClose }: PanelComponentProps) {
  const contacts = contactOptions()
  const pdf = RESUME.pdfUrl ? assetHref(RESUME.pdfUrl) : null

  return (
    <Panel
      title={PROFILE.name}
      kicker="Personnel Office · Résumé"
      size="lg"
      tone="paper"
      onClose={onClose}
      testId="panel-resume"
      footer={
        <>
          <button type="button" className="miw-btn miw-btn--primary" onClick={() => window.print()}>
            <Icon name="print" size={18} /> Print / save as PDF
          </button>
          {pdf && (
            <a className="miw-btn" href={pdf} download data-testid="resume-download">
              <Icon name="download" size={18} /> Download PDF
            </a>
          )}
          <PanelLink to="contact" icon="mail">
            Contact Brian
          </PanelLink>
        </>
      }
    >
      <article className="miw-resume miw-print-scope" aria-label={`Résumé of ${PROFILE.name}`}>
        <header className="miw-resume__head">
          <p className="miw-print-only miw-resume__print-name">{PROFILE.name}</p>
          <p className="miw-resume__headline">{PROFILE.headline}</p>
          {PROFILE.location && (
            <p className="miw-resume__location">
              <span className="sr-only">Location: </span>
              {PROFILE.location}
            </p>
          )}
          <ul className="miw-resume__contact" aria-label="Contact">
            {contacts.map((o) => (
              <li key={o.kind}>
                <span className="miw-resume__contact-kind">{CONTACT_KIND_LABEL[o.kind]}</span>
                <ContactLink option={o} />
              </li>
            ))}
          </ul>
          {!PROFILE.email && PROFILE.linkedin?.verified && <p className="miw-resume__reach">No public email address yet. Brian is reachable via LinkedIn.</p>}
        </header>

        {RESUME.status === 'pending' && (
          <aside className="miw-callout miw-callout--pending miw-resume__pending" role="note" data-testid="resume-pending">
            <p className="miw-stamp">Pending owner review</p>
            <p>{RESUME.pendingMessage}</p>
          </aside>
        )}

        {RESUME.sections.map((sec) => (
          <Section key={sec.heading} title={sec.heading}>
            <ol className="miw-entries">
              {sec.entries.map((en, i) => (
                <li key={`${en.title}-${en.org ?? ''}-${i}`} className="miw-entry">
                  <div className="miw-entry__head">
                    <h4 className="miw-entry__title">
                      {en.title}
                      {en.org && <span className="miw-entry__org">{en.org}</span>}
                    </h4>
                    {en.dates && <p className="miw-entry__dates">{en.dates}</p>}
                  </div>
                  {en.bullets && en.bullets.length > 0 && (
                    <ul className="miw-entry__bullets">
                      {en.bullets.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  )}
                  {en.source && <p className="miw-source">Source: {en.source}</p>}
                </li>
              ))}
            </ol>
          </Section>
        ))}

        <Section title="Skills">
          <Chips items={RESUME.skills} label="Skills" />
        </Section>

        <Section title="Projects">
          <ul className="miw-resume__projects">
            {PROJECTS.map((p) => (
              <li key={p.id} className="miw-resume__project">
                <h4 className="miw-resume__project-name">
                  <ExternalLink href={p.url}>{p.name}</ExternalLink>
                </h4>
                <p className="miw-resume__project-text">{p.oneLiner}</p>
                {p.tech.length > 0 && <p className="miw-resume__project-meta">{p.tech.join(' · ')}</p>}
                {p.caveat && <p className="miw-resume__project-caveat">{p.caveat}</p>}
              </li>
            ))}
          </ul>
        </Section>
      </article>
    </Panel>
  )
}
