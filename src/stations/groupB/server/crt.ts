/**
 * CRT screen content for the Server Hall (pure layout, unit-tested). Every word
 * comes from src/content/projects.ts; nothing here invents stats or activity.
 * The painter (screens.ts) renders these lines green-on-black in IBM Plex Mono.
 */
import { GITHUB_PROFILE_URL, PROJECTS } from '@/content/projects'
import type { ProjectContent } from '@/content/types'
import { clampLines, wrapMono } from '../shared/canvas'

export type CrtStyle = 'dim' | 'rule' | 'title' | 'body' | 'tech' | 'prompt' | 'big'

export interface CrtLine {
  text: string
  style: CrtStyle
}

export interface CrtScreen {
  id: string
  lines: CrtLine[]
  /** Bottom prompt (drawn inside the blinking band). */
  prompt: string
}

/** Characters per line for each style at the cell size used by the painter (512 px wide). */
export const CRT_COLS: Record<CrtStyle, number> = { dim: 40, rule: 40, title: 24, body: 40, tech: 40, prompt: 32, big: 12 }
export const MAX_BODY_LINES = 7
export const MAX_TITLE_LINES = 2

export function githubHandle(url: string = GITHUB_PROFILE_URL): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

export function projectScreen(p: ProjectContent, index: number, total: number): CrtScreen {
  const title = clampLines(wrapMono(p.name.toUpperCase(), CRT_COLS.title), MAX_TITLE_LINES, CRT_COLS.title)
  const body = clampLines(wrapMono(p.oneLiner, CRT_COLS.body), MAX_BODY_LINES - (title.length - 1), CRT_COLS.body)
  const tech = p.tech.length ? clampLines(wrapMono(`TECH: ${p.tech.join(' · ')}`, CRT_COLS.tech), 2, CRT_COLS.tech) : []
  const lines: CrtLine[] = [
    { text: `MIW://SERVER-HALL  REPO ${String(index + 1).padStart(2, '0')}/${String(total).padStart(2, '0')}`, style: 'dim' },
    { text: '', style: 'rule' },
    ...title.map((t) => ({ text: t, style: 'title' as const })),
    ...body.map((t) => ({ text: t, style: 'body' as const })),
    ...tech.map((t) => ({ text: t, style: 'tech' as const })),
  ]
  return { id: p.id, lines, prompt: '> PRESS E TO READ_' }
}

export function indexScreen(projects: ProjectContent[] = PROJECTS): CrtScreen {
  const names = projects.slice(0, 7).map((p, i) => ({ text: clampLines([`${String(i + 1).padStart(2, '0')} ${p.name}`], 1, CRT_COLS.body)[0], style: 'body' as const }))
  return {
    id: 'index',
    lines: [
      { text: 'MIW://SERVER-HALL  INDEX', style: 'dim' },
      { text: '', style: 'rule' },
      { text: 'REPOSITORY INDEX', style: 'title' },
      ...names,
      { text: githubHandle(), style: 'tech' },
    ],
    prompt: '> PRESS E TO BROWSE_',
  }
}

/** The three monitors of the main terminal (left, center, right). */
export function terminalScreens(projects: ProjectContent[] = PROJECTS): CrtScreen[] {
  const techs = [...new Set(projects.flatMap((p) => p.tech))]
  const techLines = clampLines(wrapMono(techs.join(' · '), CRT_COLS.body), 8, CRT_COLS.body)
  return [
    {
      id: 'term-left',
      lines: [
        { text: 'MIW://MAINFRAME', style: 'dim' },
        { text: '', style: 'rule' },
        { text: 'MIW', style: 'big' },
        { text: 'McKEOWN INDUSTRIAL WORKS', style: 'title' },
        { text: 'SERVER HALL TERMINAL 00', style: 'body' },
        { text: 'COOLING: ONE (1) LARGE FAN', style: 'body' },
        { text: 'DO NOT FEED THE FAN', style: 'tech' },
      ],
      prompt: '',
    },
    {
      id: 'term-center',
      lines: [
        { text: 'MIW://SERVER-HALL', style: 'dim' },
        { text: '', style: 'rule' },
        { text: 'CODE ON GITHUB', style: 'title' },
        { text: githubHandle(), style: 'tech' },
        { text: '', style: 'body' },
        ...projects.slice(0, 5).map((p) => ({ text: clampLines([`· ${p.name}`], 1, CRT_COLS.body)[0], style: 'body' as const })),
      ],
      prompt: '> PRESS E TO BROWSE ALL_',
    },
    {
      id: 'term-right',
      lines: [
        { text: 'MIW://STACK', style: 'dim' },
        { text: '', style: 'rule' },
        { text: 'TECHNOLOGIES', style: 'title' },
        ...techLines.map((t) => ({ text: t, style: 'body' as const })),
      ],
      prompt: '',
    },
  ]
}
