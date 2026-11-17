import type { LinkRef } from './types'
import { PROFILE } from './profile'
import { PROJECTS, GITHUB_PROFILE_URL } from './projects'
import { HARMONY, PODCAST } from './stations'

/** Every external URL configured in content (for the link checker and owner review). */
export function collectExternalLinks(): (LinkRef & { where: string })[] {
  const out: (LinkRef & { where: string })[] = []
  out.push({ ...PROFILE.github, where: 'profile.github' })
  if (PROFILE.linkedin) out.push({ ...PROFILE.linkedin, where: 'profile.linkedin' })
  if (PROFILE.website) out.push({ ...PROFILE.website, where: 'profile.website' })
  out.push({ label: 'GitHub profile', url: GITHUB_PROFILE_URL, verified: true, where: 'projects.githubProfile' })
  for (const p of PROJECTS) out.push({ label: p.name, url: p.url, verified: p.verified, where: `projects.${p.id}` })
  out.push({ ...HARMONY.link, where: 'harmony.link' })
  out.push({ ...PODCAST.link, where: 'podcast.link' })
  PODCAST.platformLinks.forEach((l, i) => out.push({ ...l, where: `podcast.platformLinks[${i}]` }))
  return out
}

/** Primary contact options derived from verified content only (never invented). */
export function contactOptions(): { kind: 'email' | 'linkedin' | 'github' | 'website'; label: string; href: string }[] {
  const opts: { kind: 'email' | 'linkedin' | 'github' | 'website'; label: string; href: string }[] = []
  if (PROFILE.email) opts.push({ kind: 'email', label: PROFILE.email, href: `mailto:${PROFILE.email}` })
  if (PROFILE.linkedin?.verified) opts.push({ kind: 'linkedin', label: 'Message on LinkedIn', href: PROFILE.linkedin.url })
  opts.push({ kind: 'github', label: 'GitHub — BrianM53', href: PROFILE.github.url })
  if (PROFILE.website?.verified) opts.push({ kind: 'website', label: PROFILE.website.label, href: PROFILE.website.url })
  return opts
}
