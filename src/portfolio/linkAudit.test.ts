import { describe, expect, it } from 'vitest'
import { collectExternalLinks } from '@/content/links'
import { classifyStatus, collectAllLinks, failsStrict, uniqueUrls, validateUrl } from './linkAudit'
import { DEFAULT_SITE_URL } from './site'

describe('validateUrl', () => {
  it.each(['https://github.com/BrianM53', 'https://www.tryharmony.ai/', 'https://podcasts.apple.com/podcast/id1466861744', 'mailto:brian@example.org'])(
    'accepts %s',
    (url) => expect(validateUrl(url)).toEqual({ ok: true, problems: [] }),
  )

  it.each([
    ['http://github.com/BrianM53', /must be https/],
    ['github.com/BrianM53', /parseable/],
    ['https://github.com/Brian M53', /whitespace/],
    [' https://github.com/BrianM53', /leading or trailing whitespace/],
    ['javascript:alert(1)', /unsupported scheme/],
    ['https://localhost:5173/', /public domain|placeholder/],
    ['https://192.168.1.10/', /public domain/],
    ['https://example.com/profile', /placeholder/],
    ['https://user:secret@github.com/', /credentials/],
    ['https://github.com/<x>', /percent-encoded/],
    ['mailto:not-an-email', /valid email/],
    ['', /empty/],
  ])('rejects %j', (url, problem) => {
    const r = validateUrl(url)
    expect(r.ok).toBe(false)
    expect(r.problems.join('; ')).toMatch(problem)
  })
})

describe('classifyStatus / failsStrict', () => {
  it('treats 2xx and 3xx as ok, LinkedIn 999 as blocked, 429 as rate-limited, the rest as broken', () => {
    expect(classifyStatus(200).verdict).toBe('ok')
    expect(classifyStatus(301).verdict).toBe('ok')
    expect(classifyStatus(999)).toEqual({ verdict: 'blocked', label: 'blocked-by-site (manual check)' })
    expect(classifyStatus(429).verdict).toBe('rate-limited')
    expect(classifyStatus(404)).toEqual({ verdict: 'broken', label: 'HTTP 404' })
    expect(classifyStatus(500).verdict).toBe('broken')
  })

  it('only verified links that are broken or unreachable fail a strict run', () => {
    expect(failsStrict(true, 'broken')).toBe(true)
    expect(failsStrict(true, 'unreachable')).toBe(true)
    expect(failsStrict(true, 'blocked')).toBe(false)
    expect(failsStrict(true, 'rate-limited')).toBe(false)
    expect(failsStrict(false, 'broken')).toBe(false)
  })
})

describe('collectAllLinks', () => {
  const links = collectAllLinks(DEFAULT_SITE_URL)

  it('covers every content link plus credits and the deployment URLs', () => {
    const urls = new Set(links.map((l) => l.url))
    for (const l of collectExternalLinks()) expect(urls.has(l.url), l.where).toBe(true)
    expect(links.some((l) => l.where.startsWith('credits.'))).toBe(true)
    expect(links.find((l) => l.where === 'site.portfolio')?.url).toBe(`${DEFAULT_SITE_URL}portfolio/`)
    expect(uniqueUrls(links).length).toBeLessThan(links.length) // GitHub profile appears twice
  })

  it('every configured URL is syntactically valid (acceptance test 4)', () => {
    const bad = links.map((l) => ({ where: l.where, url: l.url, ...validateUrl(l.url) })).filter((r) => !r.ok)
    expect(bad).toEqual([])
  })

  it('deployment URLs are flagged as unverified with an explanation for the owner', () => {
    for (const l of links.filter((x) => x.where.startsWith('site.'))) {
      expect(l.verified).toBe(false)
      expect(l.note).toBeTruthy()
    }
  })
})
