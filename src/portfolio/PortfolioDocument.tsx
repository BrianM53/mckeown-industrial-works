import type { ReactNode } from 'react'
import { contactOptions } from '../content/links'
import { FICTION_DISCLAIMER, PROFILE } from '../content/profile'
import { GITHUB_PROFILE_URL, PROJECTS } from '../content/projects'
import { RESUME } from '../content/resume'
import { HARMONY, PODCAST } from '../content/stations'
import { ZONES } from '../world/layout'
import { FactoryArt, FactoryMark } from './FactoryArt'
import { Icon, type IconName } from './Icons'
import { CREDIT_LINKS, SECTIONS, SITE_NAME, isExternalHref, normalizeBasePath, resolveSiteHref, sectionById, type SectionId } from './site'

/**
 * The complete portfolio as plain, semantic HTML. Rendered:
 *  - at build time by scripts/prerender.tsx into <out>/portfolio/index.html (variant "page", no JS), and
 *  - in the app by FallbackPortfolio when 3D is unavailable / declined / crashed (variant "embedded").
 *
 * Pure: reads only src/content/* and ./site; no CSS imports, no browser APIs, no hooks with effects.
 * Styles live in portfolio.css (scoped under .pf).
 */
export type PortfolioVariant = 'page' | 'embedded'

export interface PortfolioDocumentProps {
  /**
   * "page": standalone document; owns the banner / main / contentinfo landmarks.
   * "embedded": rendered inside the app's own <main>; no nested <main>.
   */
  variant?: PortfolioVariant
  /** Public base path of the site ("/" or "/mckeown-industrial-works/"). */
  basePath?: string
  /** Link to the 3D factory. Defaults to the base path; null hides it (e.g. no WebGL). */
  factoryHref?: string | null
  /** Optional status notice rendered before the masthead (used by the in-app fallback). */
  notice?: ReactNode
}

export default function PortfolioDocument({ variant = 'page', basePath = '/', factoryHref, notice }: PortfolioDocumentProps) {
  const base = normalizeBasePath(basePath)
  const factory = factoryHref === undefined ? base : factoryHref
  const Content = variant === 'page' ? 'main' : 'div'
  return (
    <div className="pf" id="top" data-variant={variant} data-testid="portfolio-document">
      {/* Embedded in the app, the top bar's skip link (first tab stop, before the bar) targets #content. */}
      {variant === 'page' && (
        <a className="pf-skip" href="#content">
          Skip to content
        </a>
      )}
      {notice}
      <Masthead factoryHref={factory} />
      <SectionNav />
      <Content id="content" className="pf-main" tabIndex={-1}>
        <AboutSection />
        <HarmonySection />
        <PodcastSection />
        <ProjectsSection />
        <ResumeSection basePath={base} />
        <ContactSection />
        <SiteSection variant={variant} factoryHref={factory} />
      </Content>
      <Footer />
    </div>
  )
}

/* ------------------------------------------------------------------ links */

/** External link: new tab, no opener/referrer, announced to screen readers. */
function Ext({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <a href={href} className={className} target="_blank" rel="noopener noreferrer">
      {children}
      {/* NBSP: a plain leading space would collapse inside the absolutely positioned span. */}
      <span className="pf-sr-only">{'\u00a0'}(opens in a new tab)</span>
      <Icon name="external" className="pf-icon--ext" />
    </a>
  )
}

function SmartLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  if (isExternalHref(href))
    return (
      <Ext href={href} className={className}>
        {children}
      </Ext>
    )
  return (
    <a href={href} className={className}>
      {children}
    </a>
  )
}

function profileLinks(): { href: string; label: string; icon: IconName }[] {
  const out: { href: string; label: string; icon: IconName }[] = [{ href: PROFILE.github.url, label: 'GitHub', icon: 'github' }]
  if (PROFILE.linkedin?.verified) out.push({ href: PROFILE.linkedin.url, label: 'LinkedIn', icon: 'linkedin' })
  if (PROFILE.website?.verified) out.push({ href: PROFILE.website.url, label: PROFILE.website.label, icon: 'website' })
  return out
}

/* --------------------------------------------------------------- layout */

function Masthead({ factoryHref }: { factoryHref: string | null }) {
  return (
    <header className="pf-masthead">
      <div className="pf-wrap pf-masthead__grid">
        <div className="pf-masthead__text">
          <p className="pf-brand">
            <FactoryMark className="pf-brand__mark" />
            <span>{SITE_NAME}</span>
            <span className="pf-brand__edition">Portfolio</span>
          </p>
          <h1 className="pf-name">{PROFILE.name}</h1>
          <p className="pf-headline">{PROFILE.headline}</p>
          {PROFILE.location && (
            <p className="pf-location">
              <Icon name="pin" />
              {PROFILE.location}
            </p>
          )}
          <ul className="pf-actions pf-actions--masthead">
            {factoryHref && (
              <li className="pf-actions__primary">
                <a className="pf-btn pf-btn--primary" href={factoryHref}>
                  Enter the 3D factory
                  <Icon name="arrow" />
                </a>
              </li>
            )}
            {profileLinks().map((l) => (
              <li key={l.href} className="pf-actions__profile">
                <Ext className="pf-btn pf-btn--ondark" href={l.href}>
                  <Icon name={l.icon} />
                  {l.label}
                </Ext>
              </li>
            ))}
          </ul>
        </div>
        <FactoryArt className="pf-masthead__art" ground={false} />
      </div>
      <div className="pf-masthead__ground" aria-hidden="true" />
      <div className="pf-hazard" aria-hidden="true" />
    </header>
  )
}

function SectionNav() {
  return (
    <nav className="pf-nav" aria-label="Portfolio sections">
      <div className="pf-wrap">
        <ul className="pf-nav__list">
          {SECTIONS.map((s, i) => (
            <li key={s.id}>
              <a href={`#${s.id}`}>
                <span className="pf-nav__num" aria-hidden="true">
                  {pad(i + 1)}
                </span>
                {s.nav}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  )
}

function Section({ id, lede, children }: { id: SectionId; lede?: ReactNode; children: ReactNode }) {
  const s = sectionById(id)
  const n = SECTIONS.findIndex((x) => x.id === id) + 1
  return (
    <section id={id} className={`pf-section pf-section--${id}`} aria-labelledby={`${id}-title`}>
      <div className="pf-wrap">
        <div className="pf-section__head">
          <p className="pf-kicker">
            <span className="pf-kicker__num">{pad(n)}</span>
            {s.kicker}
          </p>
          <h2 id={`${id}-title`} className="pf-h2">
            {s.title}
          </h2>
          {lede && <p className="pf-lede">{lede}</p>}
        </div>
        {children}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------- sections */

function AboutSection() {
  return (
    <Section id="about">
      <div className="pf-split">
        <div className="pf-prose">
          {PROFILE.summary.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
        {PROFILE.facts.length > 0 && (
          <div className="pf-card pf-facts">
            <h3 className="pf-h3" id="about-facts-title">
              Quick facts
            </h3>
            <ul className="pf-facts__list" aria-labelledby="about-facts-title">
              {PROFILE.facts.map((f) => (
                <li key={f.text}>{f.text}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Section>
  )
}

function HarmonySection() {
  return (
    <Section id="harmony-ai">
      <div className="pf-split">
        <div className="pf-prose">
          {HARMONY.paragraphs.map((p) => (
            <p key={p}>{p}</p>
          ))}
          <p className="pf-actions-line">
            <Ext className="pf-btn pf-btn--ink" href={HARMONY.link.url}>
              Visit {HARMONY.link.label}
            </Ext>
          </p>
        </div>
        <div className="pf-plate">
          <dl className="pf-plate__list">
            <div>
              <dt>Company</dt>
              <dd>{HARMONY.company}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{HARMONY.role}</dd>
            </div>
            <div>
              <dt>Web</dt>
              <dd>
                <Ext href={HARMONY.link.url}>{HARMONY.link.label}</Ext>
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </Section>
  )
}

function PodcastSection() {
  const iso = PODCAST.date ? isoDate(PODCAST.date) : null
  return (
    <Section id="code-story">
      <article className="pf-card pf-episode" aria-labelledby="episode-title">
        <p className="pf-meta">
          <Icon name="play" />
          <span>{PODCAST.show}</span>
          {PODCAST.date && (
            <>
              <span aria-hidden="true">·</span>
              {iso ? <time dateTime={iso}>{PODCAST.date}</time> : <span>{PODCAST.date}</span>}
            </>
          )}
        </p>
        <h3 className="pf-h3 pf-episode__title" id="episode-title">
          {PODCAST.episodeTitle}
        </h3>
        <p className="pf-episode__summary">{PODCAST.summary}</p>
        {PODCAST.attributionNote && <p className="pf-note">{PODCAST.attributionNote}</p>}
        <ul className="pf-actions">
          <li>
            <Ext className="pf-btn pf-btn--primary" href={PODCAST.link.url}>
              {PODCAST.link.label}
            </Ext>
          </li>
          {PODCAST.platformLinks.map((l) => (
            <li key={l.url}>
              <Ext className="pf-btn pf-btn--ink" href={l.url}>
                {l.label}
              </Ext>
            </li>
          ))}
        </ul>
      </article>
    </Section>
  )
}

function ProjectsSection() {
  // Featured first; otherwise keep the owner's order (sort is stable).
  const projects = [...PROJECTS].sort((a, b) => Number(b.featured) - Number(a.featured))
  return (
    <Section id="projects" lede="Repositories from Brian’s GitHub. Team, course and fork status is noted on each one.">
      <ul className="pf-projects">
        {projects.map((p) => (
          <li key={p.id} className={p.featured ? 'pf-project pf-project--featured' : 'pf-project'}>
            <article className="pf-project__card" aria-labelledby={`project-${p.id}`}>
              {(p.featured || p.isFork) && (
                <p className="pf-project__tags">
                  {p.featured && <span className="pf-tag pf-tag--featured">Featured</span>}
                  {p.isFork && <span className="pf-tag">Fork</span>}
                </p>
              )}
              <h3 className="pf-h3 pf-project__name" id={`project-${p.id}`}>
                {p.name}
              </h3>
              <p className="pf-project__summary">{p.oneLiner}</p>
              {p.details.map((d) => (
                <p key={d} className="pf-project__detail">
                  {d}
                </p>
              ))}
              {p.caveat && (
                <p className="pf-caveat">
                  <span className="pf-caveat__label">Note</span> {p.caveat}
                </p>
              )}
              {p.tech.length > 0 && (
                <ul className="pf-chips" aria-label={`Technologies used in ${p.name}`}>
                  {p.tech.map((t) => (
                    <li key={t} className="pf-chip">
                      {t}
                    </li>
                  ))}
                </ul>
              )}
              <p className="pf-project__link">
                <Ext href={p.url}>
                  View <span className="pf-sr-only">{p.name}</span> on GitHub
                </Ext>
              </p>
            </article>
          </li>
        ))}
      </ul>
      <p className="pf-actions-line">
        <Ext className="pf-btn pf-btn--ink" href={GITHUB_PROFILE_URL}>
          <Icon name="github" />
          All repositories on GitHub
        </Ext>
      </p>
    </Section>
  )
}

function ResumeSection({ basePath }: { basePath: string }) {
  const pdfHref = RESUME.pdfUrl ? resolveSiteHref(basePath, RESUME.pdfUrl) : null
  return (
    <Section id="resume">
      <div className="pf-sheet">
        {RESUME.status === 'pending' && (
          <div className="pf-pending" role="note" aria-label="Résumé status">
            <p className="pf-stamp">Pending approval</p>
            <p className="pf-pending__text">{RESUME.pendingMessage}</p>
          </div>
        )}
        {RESUME.sections.map((sec) => (
          <div key={sec.heading} className="pf-resume-block">
            <h3 className="pf-h3 pf-resume-block__title">{sec.heading}</h3>
            <ul className="pf-entries">
              {sec.entries.map((e) => (
                <li key={`${e.title}|${e.org ?? ''}|${e.dates ?? ''}`} className="pf-entry">
                  <p className="pf-entry__when">{e.dates}</p>
                  <div className="pf-entry__body">
                    <h4 className="pf-h4">
                      {e.title}
                      {e.org && (
                        <span className="pf-entry__org">
                          <span className="pf-sr-only">,</span> {e.org}
                        </span>
                      )}
                    </h4>
                    {e.bullets && e.bullets.length > 0 && (
                      <ul className="pf-entry__bullets">
                        {e.bullets.map((b) => (
                          <li key={b}>{b}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {RESUME.skills.length > 0 && (
          <div className="pf-resume-block">
            <h3 className="pf-h3 pf-resume-block__title" id="resume-skills-title">
              Skills
            </h3>
            <ul className="pf-chips pf-chips--lg" aria-labelledby="resume-skills-title">
              {RESUME.skills.map((s) => (
                <li key={s} className="pf-chip">
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}
        {pdfHref && (
          <p className="pf-actions-line pf-resume__pdf">
            <SmartLink className="pf-btn pf-btn--primary" href={pdfHref}>
              <Icon name="download" />
              Download résumé (PDF)
            </SmartLink>
          </p>
        )}
      </div>
    </Section>
  )
}

const CONTACT_KIND: Record<ReturnType<typeof contactOptions>[number]['kind'], { label: string; icon: IconName }> = {
  email: { label: 'Email', icon: 'email' },
  linkedin: { label: 'LinkedIn', icon: 'linkedin' },
  github: { label: 'GitHub', icon: 'github' },
  website: { label: 'Website', icon: 'website' },
}

function ContactSection() {
  const options = contactOptions()
  return (
    <Section id="contact" lede="Hiring, collaborating or just saying hello: reach Brian here.">
      <ul className="pf-contact">
        {options.map((o) => (
          <li key={`${o.kind}:${o.href}`}>
            <SmartLink className={`pf-contact__item pf-contact__item--${o.kind}`} href={o.href}>
              <Icon name={CONTACT_KIND[o.kind].icon} className="pf-contact__icon" />
              <span className="pf-contact__text">
                <span className="pf-contact__kind">{CONTACT_KIND[o.kind].label}</span>
                <span className="pf-contact__label">{o.label}</span>
              </span>
            </SmartLink>
          </li>
        ))}
      </ul>
    </Section>
  )
}

/** Where each part of the portfolio lives in the 3D world (names from the world layout, so they never drift). */
const FACTORY_TOUR: { place: string; what: string }[] = [
  { place: ZONES.personnel.name, what: 'the résumé.' },
  { place: ZONES.control.name, what: `${HARMONY.company}, next to a wall of simulated factory telemetry.` },
  { place: ZONES.radio.name, what: `the ${PODCAST.show} interview.` },
  { place: ZONES.server.name, what: 'GitHub projects.' },
  { place: ZONES.rnd.name, what: 'featured projects, each on its own test rig.' },
  { place: ZONES.rec.name, what: 'soccer and volleyball mini-games.' },
]

function SiteSection({ variant, factoryHref }: { variant: PortfolioVariant; factoryHref: string | null }) {
  return (
    <Section id="about-this-site">
      <div className="pf-split pf-split--site">
        <div className="pf-prose">
          <p>
            {SITE_NAME} is Brian’s portfolio built as a small, explorable 3D factory. You steer an anonymous worker around a busy
            campus where five production lines feed a rocket assembly tower, and the stations around it hold the real portfolio:
          </p>
          <ul className="pf-tour">
            {FACTORY_TOUR.map((t) => (
              <li key={t.place}>
                <strong>{t.place}</strong>: {t.what}
              </li>
            ))}
          </ul>
          <p>
            {variant === 'page'
              ? 'This page is the plain-HTML edition: the same facts with no 3D, and it works without JavaScript.'
              : 'This lite view carries the same facts without the 3D scene.'}
          </p>
          {factoryHref && (
            <p className="pf-actions-line pf-factory-cta">
              <a className="pf-btn pf-btn--primary" href={factoryHref}>
                Enter the 3D factory
                <Icon name="arrow" />
              </a>
              <span className="pf-small">Needs a browser with WebGL.</span>
            </p>
          )}
          <p className="pf-small">Built with TypeScript, React, Three.js (via React Three Fiber) and Rapier physics.</p>
        </div>
        <div className="pf-fiction" role="note" aria-label="In-world fiction">
          <p className="pf-fiction__label">
            <span>In-world fiction</span>
          </p>
          <p className="pf-fiction__text">{FICTION_DISCLAIMER}</p>
        </div>
      </div>
    </Section>
  )
}

function Footer() {
  return (
    <footer className="pf-footer">
      <div className="pf-wrap pf-footer__grid">
        <p className="pf-footer__brand">
          <FactoryMark className="pf-brand__mark" />
          <span>{SITE_NAME}</span>
        </p>
        <div className="pf-footer__credits">
          <p>
            Type: <Ext href={CREDIT_LINKS.barlow.url}>Barlow</Ext>, Barlow Condensed and <Ext href={CREDIT_LINKS.plex.url}>IBM Plex Mono</Ext>,
            used under the <Ext href={CREDIT_LINKS.ofl.url}>SIL Open Font License 1.1</Ext>.
          </p>
          <p>The factory’s 3D models, textures and sounds are original and generated in code.</p>
          <p>
            © {PROFILE.name}. The portfolio facts are real; the factory is fiction.
          </p>
        </div>
        <p className="pf-footer__top">
          <a href="#top">Back to top</a>
        </p>
      </div>
    </footer>
  )
}

/* -------------------------------------------------------------- helpers */

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/** "October 15, 2026" → "2026-10-15" (null when the text is not in that form). */
export function isoDate(text: string): string | null {
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(text.trim())
  if (!m) return null
  const month = MONTHS.indexOf(m[1].toLowerCase()) + 1
  const day = Number(m[2])
  if (month < 1 || day < 1 || day > 31) return null
  return `${m[3]}-${pad(month)}-${pad(day)}`
}
