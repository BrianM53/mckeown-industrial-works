import { collectExternalLinks, contactOptions } from '../content/links'
import { RESUME } from '../content/resume'
import type { LinkRef } from '../content/types'
import { CREDIT_LINKS, OG_IMAGE, PORTFOLIO_PATH, isExternalHref, normalizeSiteUrl, DEFAULT_SITE_URL } from './site'

/**
 * Pure helpers for scripts/check-links.ts: gather every external URL the site can show,
 * validate syntax, and classify HTTP results. No I/O here.
 */

export interface AuditLink extends LinkRef {
  /** Where the link is configured (content path or "site.*" / "credits.*"). */
  where: string
}

/** Every URL the site renders or advertises: content links, contact, credits, deployment URLs. */
export function collectAllLinks(siteUrl: string): AuditLink[] {
  const site = normalizeSiteUrl(siteUrl)
  const out: AuditLink[] = collectExternalLinks().map((l) => ({ ...l }))
  for (const c of contactOptions()) {
    // Web contact options duplicate profile links already collected; mailto needs its own syntax check.
    if (c.kind === 'email') out.push({ label: 'Contact email', url: c.href, verified: true, where: 'profile.email' })
  }
  if (RESUME.pdfUrl && isExternalHref(RESUME.pdfUrl)) out.push({ label: 'Résumé PDF', url: RESUME.pdfUrl, verified: RESUME.status === 'approved', where: 'resume.pdfUrl' })
  for (const [key, l] of Object.entries(CREDIT_LINKS)) out.push({ ...l, where: `credits.${key}` })
  // The default GitHub Pages deployment was verified live (smoke + browser boot) on 2026-11-18.
  // Any other SITE_URL (custom domain, fork) stays flagged until it is deployed and checked.
  const isLiveDefault = site === normalizeSiteUrl(DEFAULT_SITE_URL)
  const deployNote = isLiveDefault
    ? 'This site’s own GitHub Pages deployment (verified live 2026-11-18).'
    : 'This site’s own deployment URL; it resolves once the site is deployed there.'
  out.push({ label: 'Site root (canonical)', url: site, verified: isLiveDefault, note: deployNote, where: 'site.root' })
  out.push({ label: 'Static portfolio (canonical)', url: site + PORTFOLIO_PATH, verified: isLiveDefault, note: deployNote, where: 'site.portfolio' })
  out.push({ label: 'Social card image', url: site + OG_IMAGE.path, verified: isLiveDefault, note: deployNote, where: 'site.ogImage' })
  return out
}

export interface UrlCheck {
  ok: boolean
  problems: string[]
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i
const PLACEHOLDER_HOSTS = /(^|\.)(example\.(com|org|net)|localhost|test|invalid)$/i

/** Syntax rules: absolute https URL (or a well-formed mailto:), no whitespace/credentials/placeholders. */
export function validateUrl(url: string): UrlCheck {
  const problems: string[] = []
  if (url !== url.trim()) problems.push('has leading or trailing whitespace')
  const u0 = url.trim()
  if (!u0) return { ok: false, problems: ['is empty'] }
  if (/\s/.test(u0)) problems.push('contains whitespace')
  if (/[<>"{}|\\^`]/.test(u0)) problems.push('contains characters that must be percent-encoded')

  if (/^mailto:/i.test(u0)) {
    const addr = u0.slice(7).split('?')[0]
    let decoded = addr
    try {
      decoded = decodeURIComponent(addr)
    } catch {
      problems.push('has invalid percent-encoding')
    }
    if (!EMAIL_RE.test(decoded)) problems.push('is not a valid email address')
    return { ok: problems.length === 0, problems }
  }

  let u: URL
  try {
    u = new URL(u0)
  } catch {
    problems.push('is not a parseable absolute URL')
    return { ok: false, problems }
  }
  if (u.protocol === 'http:') problems.push('uses http: (must be https:)')
  else if (u.protocol !== 'https:') problems.push(`uses unsupported scheme ${u.protocol}`)
  if (u.username || u.password) problems.push('contains credentials')
  if (!u.hostname.includes('.') || /^\d+(\.\d+){3}$/.test(u.hostname) || u.hostname.startsWith('[')) problems.push('does not use a public domain name')
  if (PLACEHOLDER_HOSTS.test(u.hostname)) problems.push('points at a placeholder or local domain')
  return { ok: problems.length === 0, problems }
}

export type NetVerdict = 'ok' | 'blocked' | 'rate-limited' | 'broken' | 'unreachable'

/** Classifies a final HTTP status (after redirects). LinkedIn answers bots with 999. */
export function classifyStatus(status: number): { verdict: NetVerdict; label: string } {
  if (status === 999) return { verdict: 'blocked', label: 'blocked-by-site (manual check)' }
  if (status >= 200 && status < 400) return { verdict: 'ok', label: 'ok' }
  if (status === 429) return { verdict: 'rate-limited', label: 'rate-limited (retry later)' }
  return { verdict: 'broken', label: `HTTP ${status}` }
}

/** Whether a network result fails the run in --strict mode (only verified links can fail). */
export function failsStrict(verified: boolean, verdict: NetVerdict): boolean {
  return verified && (verdict === 'broken' || verdict === 'unreachable')
}

/** Groups links by URL so each address is fetched once. */
export function uniqueUrls(links: AuditLink[]): string[] {
  return [...new Set(links.map((l) => l.url.trim()))]
}
