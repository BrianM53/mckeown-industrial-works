import type { HarmonyContent, LinkRef, PodcastContent } from './types'

/** Harmony AI (Control Room). Sources: https://www.tryharmony.ai/ and the Code Story episode page. */
export const HARMONY: HarmonyContent = {
  company: 'Harmony AI',
  link: { label: 'tryharmony.ai', url: 'https://www.tryharmony.ai/', verified: true, note: 'tryharmony.ai redirects to the canonical www.tryharmony.ai.' },
  role: 'Founding Engineer',
  paragraphs: [
    'Brian is a founding engineer at Harmony AI and was one of its first hires. Harmony calls itself “the AI operating system for American manufacturing.” Its product is an AI layer on top of a plant’s existing machines, ERP and quality software, and paperwork. It connects them into one real-time system and automates scheduling, reporting and data entry, with no rip-and-replace.',
    'Brian’s focus is production scheduling with machine learning and AI. Harmony sends forward-deployed engineers into plants, so much of the work happens on real factory floors.',
    'Founded in 2025 and based in Chattanooga, Tennessee.',
  ],
  simulatedDataNote:
    'Everything on these screens is a fictional simulation of this pretend factory. It is not Harmony customer data.',
}

/** Code Story interview (Broadcast Booth). Verified 2026-11-17: HTTP 200, title and role as below. */
export const PODCAST: PodcastContent = {
  show: 'Code Story',
  episodeTitle: 'S13 Bonus: Eliminating Paperwork & Manual Data Entry in Manufacturing with Brian McKeown, Founding Engineer at Harmony AI',
  link: {
    label: 'Open episode on codestory.co',
    url: 'https://www.codestory.co/episodes/s13-bonus-eliminating-paperwork-manual-data-entry-in-manufacturing-with-brian-mckeown-ceo-of-harmony-ai/',
    verified: true,
    note: 'Episode text lists Brian as “Founding Engineer at Harmony AI”. Only the URL slug says “ceo”.',
  },
  date: 'October 15, 2026',
  summary:
    'Host Noah Labhart talks with Brian about how Harmony AI digitizes paperwork on the plant floor and connects machine data and ERP/MES systems into one data layer that AI agents use to automate scheduling, quality and back-office work. They also cover forward-deployed engineering, the 4–6 week pilot model, speed versus technical debt, and reshoring US manufacturing. About 29 minutes.',
  attributionNote: null,
  platformLinks: [
    { label: 'Code Story on Apple Podcasts', url: 'https://podcasts.apple.com/podcast/id1466861744', verified: true, note: 'Show page, not the specific episode.' },
    { label: 'Code Story on Spotify', url: 'https://open.spotify.com/show/0f5HGQ2EPd63H83gqAifXp', verified: true, note: 'Show page, not the specific episode.' },
  ],
}

/** Recreation Yard copy. Source for the rec-athletics fact: Code Story episode page. */
export const REC_YARD = {
  title: 'Recreation Yard',
  paragraphs: [
    'Brian was heavily involved in rec athletics at Texas A&M (per his Code Story interview), so the factory got a Recreation Yard.',
    'Kick the soccer ball at the goal, or bump the volleyball over the net. The staff league has strong opinions about the rules.',
  ],
}

/** R&D Annex copy (featured projects come from projects.ts where featured === true). */
export const RND_ANNEX = {
  title: 'R&D Annex',
  intro: 'Featured builds from Brian’s GitHub, each on a suitably over-engineered test rig.',
}

/** Collected external links for link checking / quick links. */
export function allExternalLinks(extra: LinkRef[] = []): LinkRef[] {
  return [HARMONY.link, PODCAST.link, ...PODCAST.platformLinks, ...extra]
}
