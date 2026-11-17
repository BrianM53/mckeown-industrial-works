/**
 * Owner-editable content schema. All REAL facts about Brian live in src/content/*.ts
 * and must be verifiable; every external link carries a `verified` flag. In-world
 * jokes/lore live in fiction.ts / dialogue.ts and are always presented as fiction.
 */
export interface LinkRef {
  label: string
  url: string
  /** True only when the URL was checked against an owner source and resolves. */
  verified: boolean
  /** Shown to the owner in the review checklist. */
  note?: string
}

export interface ProfileContent {
  name: string
  /** Short factual headline, e.g. "Founding Engineer at Harmony AI". */
  headline: string
  /** Factual summary paragraphs (no invented achievements). */
  summary: string[]
  location: string | null
  github: LinkRef
  linkedin: LinkRef | null
  /** Only an owner-provided public address. null until supplied. */
  email: string | null
  website: LinkRef | null
  /** Facts with an owner-controlled source (education, interests...). */
  facts: { text: string; source: string }[]
}

export interface ProjectContent {
  id: string
  name: string
  url: string
  /** One plain-language sentence. */
  oneLiner: string
  /** Optional extra factual detail paragraphs. */
  details: string[]
  /** Technologies (only verified ones). */
  tech: string[]
  /** Shown as a featured R&D Annex machine. */
  featured: boolean
  /** Where it appears in the world. */
  station: 'rnd' | 'server'
  verified: boolean
  isFork: boolean
  /** Honest caveat shown in small print (e.g. "Fork of …", "Course project"). */
  caveat?: string
}

export interface ResumeEntry {
  title: string
  org?: string
  dates?: string
  bullets?: string[]
  /** Where this fact came from (owner review). */
  source?: string
}

export interface ResumeSection {
  heading: string
  entries: ResumeEntry[]
}

export interface ResumeContent {
  /** 'pending' until the owner supplies an approved résumé. */
  status: 'pending' | 'approved'
  /** Path/URL of the approved PDF, or null (no download link is shown when null). */
  pdfUrl: string | null
  pendingMessage: string
  sections: ResumeSection[]
  skills: string[]
}

export interface HarmonyContent {
  company: string
  link: LinkRef
  role: string
  paragraphs: string[]
  /** Disclaimer shown next to the in-world telemetry. */
  simulatedDataNote: string
}

export interface PodcastContent {
  show: string
  episodeTitle: string
  link: LinkRef
  date: string | null
  summary: string
  /** Explains any difference between the episode's wording and the owner's current title. */
  attributionNote: string | null
  platformLinks: LinkRef[]
}

export interface Achievement {
  id: string
  title: string
  description: string
  /** Hidden achievements show as "???" until unlocked. */
  hidden: boolean
}
