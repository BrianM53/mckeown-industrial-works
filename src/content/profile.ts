import type { ProfileContent } from './types'

/**
 * REAL facts about Brian. Every statement here has an owner-controlled source:
 *  - GitHub profile (https://github.com/BrianM53): bio, LinkedIn social link
 *  - Brian's current site (https://brianm53.github.io/): role, location, stack, education
 *  - Code Story episode page (2026-10-15): background, rec athletics, Chattanooga move
 *  - Harmony AI site (https://www.tryharmony.ai/): company description
 * Owner: please review (docs/OWNER_REVIEW.md). Edit freely — the site renders from this file.
 */
export const PROFILE: ProfileContent = {
  name: 'Brian McKeown',
  headline: 'Founding Engineer at Harmony AI',
  summary: [
    'Brian McKeown is a founding engineer at Harmony AI, which builds an AI operating system for manufacturing plants. He was one of its first hires.',
    'He is a Computer Science graduate of Texas A&M University and calls himself a full-stack engineer moving into ML engineering. At Harmony he builds production scheduling systems with machine learning and AI.',
    'He grew up in Dallas and now works in Chattanooga, Tennessee, where Harmony is based. Much of the job happens on real factory floors.',
  ],
  location: 'Chattanooga, TN',
  github: { label: 'GitHub — BrianM53', url: 'https://github.com/BrianM53', verified: true },
  linkedin: {
    label: 'LinkedIn',
    url: 'https://www.linkedin.com/in/brian-mckeown-49b225229/',
    verified: true,
    note: 'Published by Brian on his GitHub profile and brianm53.github.io. LinkedIn blocks automated checks (HTTP 999), so confirm it manually.',
  },
  // No public email has been provided by the owner. Add one here to enable the email button.
  email: null,
  website: { label: 'brianm53.github.io', url: 'https://brianm53.github.io/', verified: true, note: "Brian's current personal site." },
  facts: [
    { text: 'Computer Science graduate, Texas A&M University (Class of 2025, Statistics minor)', source: 'https://brianm53.github.io/ and https://github.com/BrianM53' },
    { text: 'Born and raised in Dallas, Texas', source: 'Code Story episode page (2026-10-15)' },
    { text: 'Heavily involved in rec athletics at Texas A&M', source: 'Code Story episode page (2026-10-15)' },
    { text: 'One of the first hires at Harmony AI; relocated to Chattanooga, TN', source: 'Code Story episode page (2026-10-15)' },
  ],
}

/** Clearly-labeled in-world fiction (the joke CEO mythology). Never presented as fact. */
export const FICTION_DISCLAIMER =
  'McKeown Industrial Works is a fictional factory. The workers, the “CEO” mythology, production numbers, launch results and safety incidents are all jokes. The portfolio facts (résumé, Harmony AI, Code Story, GitHub projects, contact links) are real.'
