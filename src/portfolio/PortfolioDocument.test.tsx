import { cleanup, render, screen, within } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectExternalLinks, contactOptions } from '@/content/links'
import { FICTION_DISCLAIMER, PROFILE } from '@/content/profile'
import { PROJECTS } from '@/content/projects'
import { RESUME } from '@/content/resume'
import { HARMONY, PODCAST } from '@/content/stations'
import { ZONES } from '@/world/layout'
import PortfolioDocument, { isoDate } from './PortfolioDocument'
import { SECTIONS } from './site'

// Each test renders the whole document; leave headroom for slow CI runners and parallel suites.
vi.setConfig({ testTimeout: 15_000 })
afterEach(cleanup)

const isAbsoluteHttp = (href: string | null) => /^https?:\/\//i.test(href ?? '')

/**
 * Links whose text matches `re`. Whole-document `getByRole('link', { name })` queries compute an
 * accessible name for every element and take seconds in jsdom under a parallel full-suite run,
 * so tests use this (or role queries scoped with `within`) instead.
 */
const linksNamed = (root: ParentNode, re: RegExp) => [...root.querySelectorAll<HTMLAnchorElement>('a[href]')].filter((a) => re.test(a.textContent ?? ''))

describe('PortfolioDocument structure', () => {
  it('renders exactly one h1: the owner’s name', () => {
    const { container } = render(<PortfolioDocument />)
    const h1s = container.querySelectorAll('h1')
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toHaveTextContent(PROFILE.name)
  })

  it('renders every section (with an h2 label) and links each one from the section nav', () => {
    const { container } = render(<PortfolioDocument />)
    const nav = container.querySelector<HTMLElement>('nav[aria-label="Portfolio sections"]')!
    expect(nav).not.toBeNull()
    expect(SECTIONS.map((s) => s.id)).toEqual(['about', 'harmony-ai', 'code-story', 'projects', 'resume', 'contact', 'about-this-site'])
    for (const s of SECTIONS) {
      const section = document.getElementById(s.id)
      expect(section, s.id).not.toBeNull()
      expect(section!.tagName).toBe('SECTION')
      const h2 = section!.querySelector('h2')!
      expect(h2).toHaveTextContent(s.title)
      expect(section).toHaveAttribute('aria-labelledby', h2.id)
      expect(nav.querySelector(`a[href="#${s.id}"]`), s.id).toHaveTextContent(s.nav)
    }
  })

  it('never skips a heading level', () => {
    const { container } = render(<PortfolioDocument />)
    const levels = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => Number(h.tagName[1]))
    expect(levels[0]).toBe(1)
    for (let i = 1; i < levels.length; i++) expect(levels[i] - levels[i - 1], `heading #${i}`).toBeLessThanOrEqual(1)
  })

  it('page variant owns the banner, main and contentinfo landmarks; skip link targets main', () => {
    const { container } = render(<PortfolioDocument variant="page" />)
    expect(screen.getByRole('banner')).toContainElement(container.querySelector('h1'))
    expect(screen.getByRole('main')).toHaveAttribute('id', 'content')
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    const [skip] = linksNamed(container, /^skip to content$/i)
    expect(skip).toHaveAttribute('href', '#content')
    expect(container.querySelector('a')).toBe(skip) // first focusable element
  })

  it('embedded variant never nests a <main> (the app provides it)', () => {
    const { container } = render(<PortfolioDocument variant="embedded" notice={<p>notice</p>} />)
    expect(container.querySelectorAll('main')).toHaveLength(0)
    // #content is the target of the app top bar's skip link (its first tab stop), so the
    // embedded document has no skip link of its own (it would be the ~9th tab stop)
    expect(container.querySelector('#content')).toHaveAttribute('tabindex', '-1')
    expect(container.querySelector('.pf-skip')).toBeNull()
    // the notice comes first, before the masthead
    const root = container.querySelector('.pf')!
    expect(root.children[0]).toHaveTextContent('notice')
  })

  it('hides decorative graphics from assistive technology', () => {
    const { container } = render(<PortfolioDocument />)
    const svgs = [...container.querySelectorAll('svg')]
    expect(svgs.length).toBeGreaterThan(5)
    for (const svg of svgs) expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelectorAll('img:not([alt])')).toHaveLength(0)
  })

  it('renders on the server without a DOM (the prerender path)', () => {
    const html = renderToStaticMarkup(<PortfolioDocument variant="page" basePath="/x/" />)
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1)
    expect(html).toContain('href="/x/"')
  })
})

describe('PortfolioDocument links', () => {
  it('opens every external link in a new tab with rel="noopener noreferrer" and says so', () => {
    const { container } = render(<PortfolioDocument />)
    const links = [...container.querySelectorAll('a[href]')]
    const external = links.filter((a) => isAbsoluteHttp(a.getAttribute('href')))
    expect(external.length).toBeGreaterThan(10)
    for (const a of external) {
      expect(a, a.getAttribute('href')!).toHaveAttribute('target', '_blank')
      const rel = (a.getAttribute('rel') ?? '').split(/\s+/)
      expect(rel).toContain('noopener')
      expect(rel).toContain('noreferrer')
      expect(a.textContent).toContain('(opens in a new tab)')
    }
    for (const a of links.filter((l) => !isAbsoluteHttp(l.getAttribute('href')))) expect(a).not.toHaveAttribute('target')
  })

  it('links every configured content URL and contact option', () => {
    const { container } = render(<PortfolioDocument />)
    const hrefs = new Set([...container.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')))
    for (const l of collectExternalLinks()) {
      if (l.where === 'profile.linkedin' && !PROFILE.linkedin?.verified) continue
      if (l.where === 'profile.website' && !PROFILE.website?.verified) continue
      expect(hrefs.has(l.url), `${l.where}: ${l.url}`).toBe(true)
    }
    for (const c of contactOptions()) expect(hrefs.has(c.href), c.href).toBe(true)
  })

  it('shows no email while PROFILE.email is null, and a mailto link once one is configured', () => {
    const original = PROFILE.email
    try {
      PROFILE.email = null
      const a = render(<PortfolioDocument />)
      expect(a.container.querySelector('a[href^="mailto:"]')).toBeNull()
      expect(within(document.getElementById('contact')!).queryByText('Email')).toBeNull()
      cleanup()

      PROFILE.email = 'owner@example.org'
      const b = render(<PortfolioDocument />)
      const mail = b.container.querySelector('a[href="mailto:owner@example.org"]')
      expect(mail).not.toBeNull()
      expect(mail).not.toHaveAttribute('target')
      expect(mail).toHaveTextContent('owner@example.org')
    } finally {
      PROFILE.email = original
    }
  })

  it('links to the 3D factory by default and hides those links when factoryHref is null', () => {
    const a = render(<PortfolioDocument basePath="/mckeown-industrial-works/" />)
    const enter = linksNamed(a.container, /enter the 3d factory/i)
    expect(enter.length).toBeGreaterThan(0)
    for (const link of enter) expect(link).toHaveAttribute('href', '/mckeown-industrial-works/')
    cleanup()
    const b = render(<PortfolioDocument factoryHref={null} />)
    expect(linksNamed(b.container, /3d factory/i)).toEqual([])
  })
})

describe('PortfolioDocument content', () => {
  it('omits the PDF link while pdfUrl is null, and resolves a configured PDF against the base path', () => {
    const original = RESUME.pdfUrl
    try {
      RESUME.pdfUrl = null
      const a = render(<PortfolioDocument basePath="/sub/" />)
      expect(linksNamed(a.container, /download|pdf/i)).toEqual([])
      expect(a.container.querySelector('a[href$=".pdf"]')).toBeNull()
      cleanup()

      RESUME.pdfUrl = 'resume/Brian-McKeown-Resume.pdf'
      const b = render(<PortfolioDocument basePath="/sub/" />)
      const pdf = within(b.container.querySelector<HTMLElement>('#resume')!).getByRole('link', { name: /download résumé \(pdf\)/i })
      expect(pdf).toHaveAttribute('href', '/sub/resume/Brian-McKeown-Resume.pdf')
      expect(pdf).not.toHaveAttribute('target')
    } finally {
      RESUME.pdfUrl = original
    }
  })

  it('labels a pending résumé honestly and lists experience, education and skills', () => {
    render(<PortfolioDocument />)
    const resume = document.getElementById('resume')!
    if (RESUME.status === 'pending') {
      expect(within(resume).getByRole('note', { name: /résumé status/i })).toHaveTextContent(RESUME.pendingMessage)
    }
    for (const sec of RESUME.sections) {
      expect(within(resume).getByRole('heading', { level: 3, name: sec.heading })).toBeInTheDocument()
      for (const e of sec.entries) expect(resume).toHaveTextContent(e.title)
    }
    for (const s of RESUME.skills) expect(within(resume).getByText(s)).toBeInTheDocument()
  })

  it('lists featured projects first, each with its caveat, technologies and repository link', () => {
    const { container } = render(<PortfolioDocument />)
    const names = [...container.querySelectorAll('.pf-project__name')].map((h) => h.textContent)
    expect(names).toEqual([...PROJECTS.filter((p) => p.featured), ...PROJECTS.filter((p) => !p.featured)].map((p) => p.name))
    for (const p of PROJECTS) {
      const card = container.querySelector(`#project-${p.id}`)!.closest('article')!
      if (p.caveat) expect(card).toHaveTextContent(p.caveat)
      for (const t of p.tech) expect(within(card).getByText(t)).toBeInTheDocument()
      expect(within(card).getByRole('link', { name: new RegExp(`View ${escapeRe(p.name)} on GitHub`) })).toHaveAttribute('href', p.url)
    }
  })

  it('presents Harmony AI, the Code Story episode and the fiction disclaimer from content', () => {
    render(<PortfolioDocument />)
    const harmony = document.getElementById('harmony-ai')!
    for (const p of HARMONY.paragraphs) expect(harmony).toHaveTextContent(p)
    expect(within(harmony).getAllByRole('link').every((a) => a.getAttribute('href') === HARMONY.link.url)).toBe(true)

    const podcast = document.getElementById('code-story')!
    expect(within(podcast).getByRole('heading', { level: 3 })).toHaveTextContent(PODCAST.episodeTitle)
    expect(within(podcast).getByRole('link', { name: new RegExp(escapeRe(PODCAST.link.label)) })).toHaveAttribute('href', PODCAST.link.url)
    for (const l of PODCAST.platformLinks) expect(within(podcast).getByRole('link', { name: new RegExp(escapeRe(l.label)) })).toHaveAttribute('href', l.url)
    if (PODCAST.date) expect(podcast).toHaveTextContent(PODCAST.date)

    expect(document.getElementById('about-this-site')).toHaveTextContent(FICTION_DISCLAIMER)
  })

  it('names each portfolio station by its zone name in the 3D world', () => {
    render(<PortfolioDocument />)
    const tour = [...document.querySelectorAll('#about-this-site .pf-tour strong')].map((s) => s.textContent)
    expect(tour).toEqual([ZONES.personnel, ZONES.control, ZONES.radio, ZONES.server, ZONES.rnd, ZONES.rec].map((z) => z.name))
  })
})

describe('isoDate', () => {
  it('converts "Month D, YYYY" and rejects anything else', () => {
    expect(isoDate('October 15, 2026')).toBe('2026-10-15')
    expect(isoDate('march 3, 2024')).toBe('2024-03-03')
    expect(isoDate('Smarch 3, 2024')).toBeNull()
    expect(isoDate('2026-10-15')).toBeNull()
  })
})

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
