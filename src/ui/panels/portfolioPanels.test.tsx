import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { contactOptions } from '@/content/links'
import { FICTION_DISCLAIMER, PROFILE } from '@/content/profile'
import { GITHUB_PROFILE_URL, PROJECTS } from '@/content/projects'
import { RESUME } from '@/content/resume'
import { HARMONY, PODCAST, REC_YARD, RND_ANNEX } from '@/content/stations'
import { useUIStore } from '@/state/ui'
import { expectSafeExternalLinks, hrefs, renderInMode, resetUIState } from '../testing/helpers'
import AboutPanel from './AboutPanel'
import CodeStoryPanel from './CodeStoryPanel'
import ContactPanel from './ContactPanel'
import GithubPanel from './GithubPanel'
import HarmonyPanel from './HarmonyPanel'
import ProjectPanel from './ProjectPanel'
import RecPanel from './RecPanel'
import ResumePanel from './ResumePanel'
import RndPanel from './RndPanel'

const noop = () => {}

beforeEach(() => resetUIState())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Résumé panel', () => {
  it('renders experience, education, skills, projects and contact from content', () => {
    const { container } = renderInMode(<ResumePanel onClose={noop} />)
    const dialog = screen.getByRole('dialog', { name: PROFILE.name })
    for (const sec of RESUME.sections) {
      expect(within(dialog).getByRole('heading', { name: sec.heading })).toBeInTheDocument()
      for (const en of sec.entries) {
        expect(dialog).toHaveTextContent(en.title)
        if (en.org) expect(dialog).toHaveTextContent(en.org)
        if (en.dates) expect(dialog).toHaveTextContent(en.dates)
        for (const b of en.bullets ?? []) expect(dialog).toHaveTextContent(b)
        if (en.source) expect(dialog).toHaveTextContent(`Source: ${en.source}`)
      }
    }
    expect(within(dialog).getByRole('heading', { name: 'Skills' })).toBeInTheDocument()
    for (const s of RESUME.skills) expect(within(dialog).getByText(s)).toBeInTheDocument()
    for (const p of PROJECTS) expect(within(dialog).getByRole('link', { name: new RegExp(escape(p.name)) })).toHaveAttribute('href', p.url)
    const links = expectSafeExternalLinks(container)
    for (const o of contactOptions()) expect(hrefs(links).concat(o.href.startsWith('mailto:') ? [o.href] : [])).toContain(o.href)
  })

  it('shows the pending-review note and no download link while pdfUrl is null', () => {
    expect(RESUME.pdfUrl).toBeNull()
    const { container } = renderInMode(<ResumePanel onClose={noop} />)
    if (RESUME.status === 'pending') expect(screen.getByTestId('resume-pending')).toHaveTextContent(RESUME.pendingMessage)
    expect(screen.queryByText(/download pdf/i)).toBeNull()
    expect(container.querySelector('a[download]')).toBeNull()
    expect(container.querySelector('a[href$=".pdf"]')).toBeNull()
  })

  it('offers a Download PDF link only once a PDF is configured', () => {
    const original = RESUME.pdfUrl
    RESUME.pdfUrl = 'resume/Brian-McKeown-Resume.pdf'
    try {
      renderInMode(<ResumePanel onClose={noop} />)
      const dl = screen.getByTestId('resume-download')
      expect(dl).toHaveAttribute('href', '/resume/Brian-McKeown-Resume.pdf')
      expect(dl).toHaveAttribute('download')
    } finally {
      RESUME.pdfUrl = original
    }
  })

  it('prints via window.print()', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    renderInMode(<ResumePanel onClose={noop} />)
    fireEvent.click(screen.getByRole('button', { name: /print \/ save as pdf/i }))
    expect(print).toHaveBeenCalledTimes(1)
  })
})

describe('Harmony panel', () => {
  it('states the role factually and links to Harmony AI', () => {
    const { container } = renderInMode(<HarmonyPanel onClose={noop} />)
    const dialog = screen.getByRole('dialog', { name: HARMONY.company })
    expect(dialog).toHaveTextContent(HARMONY.role)
    for (const p of HARMONY.paragraphs) expect(dialog).toHaveTextContent(p)
    expect(dialog).toHaveTextContent(HARMONY.simulatedDataNote)
    expect(hrefs(expectSafeExternalLinks(container))).toContain(HARMONY.link.url)
  })
})

describe('Code Story panel', () => {
  it('shows the exact episode title, date, summary and an Open episode link (no audio)', () => {
    const { container } = renderInMode(<CodeStoryPanel onClose={noop} />)
    const dialog = screen.getByRole('dialog', { name: PODCAST.show })
    expect(within(dialog).getByRole('heading', { name: PODCAST.episodeTitle })).toBeInTheDocument()
    if (PODCAST.date) expect(dialog).toHaveTextContent(PODCAST.date)
    expect(dialog).toHaveTextContent(PODCAST.summary)
    expect(screen.getByRole('link', { name: /open episode/i })).toHaveAttribute('href', PODCAST.link.url)
    const links = hrefs(expectSafeExternalLinks(container))
    for (const l of PODCAST.platformLinks) expect(links).toContain(l.url)
    expect(container.querySelector('audio, video, iframe')).toBeNull()
  })

  it('labels platform links as show pages', () => {
    renderInMode(<CodeStoryPanel onClose={noop} />)
    const showPages = PODCAST.platformLinks.filter((l) => /show page/i.test(`${l.label} ${l.note ?? ''}`))
    expect(screen.queryAllByText('Show page')).toHaveLength(showPages.length)
  })
})

describe('GitHub panel', () => {
  it('renders a card for every project with tech, caveat and link, plus the profile link', () => {
    const { container } = renderInMode(<GithubPanel onClose={noop} />)
    const dialog = screen.getByRole('dialog', { name: /code on github/i })
    for (const p of PROJECTS) {
      expect(within(dialog).getByRole('heading', { name: new RegExp(escape(p.name)) })).toBeInTheDocument()
      expect(dialog).toHaveTextContent(p.oneLiner)
      for (const t of p.tech) expect(within(dialog).getAllByText(t).length).toBeGreaterThan(0)
      if (p.caveat) expect(dialog).toHaveTextContent(p.caveat)
    }
    const links = hrefs(expectSafeExternalLinks(container))
    for (const p of PROJECTS) expect(links).toContain(p.url)
    expect(links).toContain(GITHUB_PROFILE_URL)
    expect(dialog.textContent).not.toMatch(/★|\bstars\b|\bforks\b/i)
  })

  it('opens the project detail panel', () => {
    renderInMode(<GithubPanel onClose={noop} />)
    const first = PROJECTS[0]
    fireEvent.click(screen.getByRole('button', { name: `Details: ${first.name}` }))
    expect(useUIStore.getState().panel).toEqual({ id: 'project', params: { projectId: first.id } })
  })
})

describe('Project panel', () => {
  it('renders one project in detail', () => {
    const p = PROJECTS.find((x) => x.details.length > 0) ?? PROJECTS[0]
    const { container } = renderInMode(<ProjectPanel params={{ projectId: p.id }} onClose={noop} />)
    const dialog = screen.getByRole('dialog', { name: p.name })
    expect(dialog).toHaveTextContent(p.oneLiner)
    for (const d of p.details) expect(dialog).toHaveTextContent(d)
    if (p.caveat) expect(dialog).toHaveTextContent(p.caveat)
    for (const t of p.tech) expect(within(dialog).getByText(t)).toBeInTheDocument()
    expect(hrefs(expectSafeExternalLinks(container))).toContain(p.url)
  })

  it('handles an unknown project id gracefully', () => {
    renderInMode(<ProjectPanel params={{ projectId: 'nope' }} onClose={noop} />)
    expect(screen.getByRole('dialog', { name: /project not found/i })).toBeInTheDocument()
  })
})

describe('R&D Annex panel', () => {
  it('lists only featured projects with links to their detail panels', () => {
    const { container } = renderInMode(<RndPanel onClose={noop} />)
    const dialog = screen.getByRole('dialog', { name: RND_ANNEX.title })
    expect(dialog).toHaveTextContent(RND_ANNEX.intro)
    for (const p of PROJECTS) {
      if (p.featured) expect(within(dialog).getByRole('heading', { name: p.name })).toBeInTheDocument()
      else expect(within(dialog).queryByRole('heading', { name: p.name })).toBeNull()
    }
    const featured = PROJECTS.filter((p) => p.featured)
    expect(hrefs(expectSafeExternalLinks(container)).sort()).toEqual(featured.map((p) => p.url).sort())
    fireEvent.click(screen.getByRole('button', { name: `Read more: ${featured[0].name}` }))
    expect(useUIStore.getState().panel?.params).toEqual({ projectId: featured[0].id })
  })
})

describe('Rec Yard panel', () => {
  it('shows the yard copy and how to play', () => {
    renderInMode(<RecPanel onClose={noop} />)
    const dialog = screen.getByRole('dialog', { name: REC_YARD.title })
    for (const p of REC_YARD.paragraphs) expect(dialog).toHaveTextContent(p)
    expect(within(dialog).getByRole('heading', { name: /how to play/i })).toBeInTheDocument()
    expect(dialog).toHaveTextContent(/walk up to the ball and press E/i)
    expect(dialog).toHaveTextContent(/bump it over the net/i)
  })
})

describe('Contact panel', () => {
  it('shows exactly the configured contact options and never invents an email', () => {
    const { container } = renderInMode(<ContactPanel onClose={noop} />)
    const opts = contactOptions()
    const all = [...container.querySelectorAll<HTMLAnchorElement>('.miw-contact-list a[href]')].map((a) => a.getAttribute('href'))
    expect(all).toEqual(opts.map((o) => o.href))
    expectSafeExternalLinks(container)
    if (!PROFILE.email) {
      expect(container.querySelector('a[href^="mailto:"]')).toBeNull()
      if (PROFILE.linkedin?.verified) expect(screen.getByText(/reachable via LinkedIn/i)).toBeInTheDocument()
    }
  })
})

describe('About panel', () => {
  it('shows who Brian is, the fiction disclaimer, the stack and credits', () => {
    const { container } = renderInMode(<AboutPanel onClose={noop} />)
    const dialog = screen.getByRole('dialog', { name: /about this site/i })
    expect(screen.getByTestId('fiction-disclaimer')).toHaveTextContent(FICTION_DISCLAIMER)
    for (const p of PROFILE.summary) expect(dialog).toHaveTextContent(p)
    expect(dialog).toHaveTextContent(/React Three Fiber/)
    expect(dialog).toHaveTextContent(/Open Font License/)
    expect(dialog).toHaveTextContent(/procedurally/)
    expect(screen.getByRole('link', { name: /plain html portfolio/i })).toHaveAttribute('href', '/portfolio/')
    expectSafeExternalLinks(container)
  })
})

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
