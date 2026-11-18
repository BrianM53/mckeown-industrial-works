/**
 * Dialogue integrity (spec §8 "Dialogue", §12 manual feel "jokes vary, don't
 * constantly name Brian"): every worker has 3–5 short conversations, the CEO
 * mythology stays occasional, and no line restates a real biographical fact
 * (those live in src/content/{profile,resume,projects,stations}.ts).
 */
import { describe, expect, it } from 'vitest'
import { AMBIENT_CHATTER, BUMP_LINES, DIALOGUE, GAG_QUIPS, LAUNCH_REACTIONS, PANIC_LINES, SLEEP_TALK } from '@/content/dialogue'
import { PROFILE } from '@/content/profile'
import { PROJECTS } from '@/content/projects'
import { RESUME } from '@/content/resume'
import { HARMONY, PODCAST } from '@/content/stations'
import { ROSTER } from './roster'

/** "McKeown Industrial Works" is the company's name, not a mention of the person. */
const mentionsBrian = (s: string) => /\bBrian\b/i.test(s) || /\bMcKeown\b(?! Industrial)/.test(s)
const CEO = { test: (s: string) => /\bCEO\b/.test(s) || mentionsBrian(s) }

const allConversations = DIALOGUE.flatMap((d) => d.conversations)
const everyLine: string[] = [
  ...allConversations.flat(),
  ...SLEEP_TALK.flat(),
  ...Object.values(AMBIENT_CHATTER).flat(),
  ...Object.values(GAG_QUIPS),
  ...BUMP_LINES,
  ...Object.values(LAUNCH_REACTIONS).flat(),
  ...PANIC_LINES,
]

describe('NPC dialogue', () => {
  it('has an entry for every roster worker, with matching name and role', () => {
    for (const n of ROSTER) {
      const entry = DIALOGUE.find((d) => d.npcId === n.id)
      expect(entry, n.id).toBeDefined()
      expect(entry!.name).toBe(n.name)
      expect(entry!.role).toBe(n.role)
    }
    expect(new Set(DIALOGUE.map((d) => d.npcId)).size).toBe(DIALOGUE.length)
  })

  it('gives every worker 3–5 conversations of 1–3 lines, each ≤ 140 characters', () => {
    for (const d of DIALOGUE) {
      expect(d.conversations.length, d.npcId).toBeGreaterThanOrEqual(3)
      expect(d.conversations.length, d.npcId).toBeLessThanOrEqual(5)
      for (const c of d.conversations) {
        expect(c.length, `${d.npcId}: ${c[0]}`).toBeGreaterThanOrEqual(1)
        expect(c.length, `${d.npcId}: ${c[0]}`).toBeLessThanOrEqual(3)
        for (const line of c) {
          expect(line.trim().length, line).toBeGreaterThan(0)
          expect(line.length, line).toBeLessThanOrEqual(140)
        }
      }
      // no worker repeats themselves
      const keys = d.conversations.map((c) => c.join('|'))
      expect(new Set(keys).size, d.npcId).toBe(keys.length)
    }
  })

  it('keeps the CEO mythology occasional and rarely names Brian', () => {
    const ceo = allConversations.filter((c) => c.some((l) => CEO.test(l)))
    // brief: at most ~1 in 4 conversations, test gate 30 %
    expect(ceo.length / allConversations.length).toBeLessThanOrEqual(0.25)
    // never more than one CEO conversation per worker
    for (const d of DIALOGUE) expect(d.conversations.filter((c) => c.some((l) => CEO.test(l))).length, d.npcId).toBeLessThanOrEqual(1)
    // the person is (almost) never named
    expect(everyLine.filter(mentionsBrian).length).toBeLessThanOrEqual(1)
  })

  it('mixes in useful hints (directory, console, forklift recovery, stations)', () => {
    const text = allConversations.flat().join('\n')
    expect(text).toMatch(/Press M/i)
    expect(text).toMatch(/Line Supervisor Console/)
    expect(text).toMatch(/R puts it back|R flips it/i)
    expect(text).toMatch(/press E/i)
  })

  it('never restates real biographical facts (those belong to the portfolio panels)', () => {
    const banned = new Set<string>([
      HARMONY.company,
      PODCAST.show,
      ...(PROFILE.location ? [PROFILE.location.split(',')[0]] : []),
      'Dallas',
      'Texas',
      'A&M',
      'Aggie',
      'github',
      'linkedin',
      'http',
      'www.',
      '@',
    ])
    for (const section of RESUME.sections) for (const e of section.entries) if (e.org) banned.add(e.org)
    for (const p of PROJECTS) if (p.name.length > 6) banned.add(p.name)
    const hits: string[] = []
    for (const line of everyLine) for (const b of banned) if (line.toLowerCase().includes(b.toLowerCase())) hits.push(`${b}: ${line}`)
    expect(hits).toEqual([])
  })

  it('keeps floating chatter bubbles short', () => {
    for (const [id, lines] of Object.entries(AMBIENT_CHATTER)) {
      expect(ROSTER.some((n) => n.id === id), id).toBe(true)
      expect(lines.length, id).toBeGreaterThanOrEqual(2)
      for (const l of lines) expect(l.length, l).toBeLessThanOrEqual(40)
    }
    for (const l of [...Object.values(GAG_QUIPS), ...BUMP_LINES, ...Object.values(LAUNCH_REACTIONS).flat(), ...PANIC_LINES]) expect(l.length, l).toBeLessThanOrEqual(40)
  })
})
