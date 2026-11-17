import type { ResumeContent } from './types'

/**
 * Résumé data. Compiled from Brian's own published site (https://brianm53.github.io/,
 * app/page.tsx) and GitHub profile. It is NOT an owner-approved résumé yet:
 * `status: 'pending'` shows a "pending owner review" note, and no PDF link appears
 * until `pdfUrl` is set (put the approved PDF in /public and set e.g. 'resume/Brian-McKeown-Resume.pdf').
 */
export const RESUME: ResumeContent = {
  status: 'pending',
  pdfUrl: null,
  pendingMessage:
    'Compiled from Brian’s current public site and GitHub profile. A downloadable PDF will appear here once Brian supplies an approved copy.',
  sections: [
    {
      heading: 'Experience',
      entries: [
        {
          title: 'Founding Engineer',
          org: 'Harmony AI',
          dates: '2026 – present · Chattanooga, TN',
          bullets: ['Building a production scheduling system using machine learning and AI (React, Hono, Supabase).'],
          source: 'brianm53.github.io',
        },
        {
          title: 'Full-Stack Engineer',
          org: 'Antera Software',
          dates: '2025 – 2026 · Plano, TX',
          bullets: [
            'Built a SaaS webstore platform with React, NestJS and MongoDB.',
            'Led a legacy refactor that improved Apdex by 50%.',
            'Optimized schemas, cutting checkout times by 80%.',
          ],
          source: 'brianm53.github.io',
        },
        {
          title: 'Data Center Engineer',
          org: 'Tetra Pak',
          dates: '2024 · Denton, TX',
          bullets: ['Ansible automation across hundreds of servers.', 'A ServiceNow API integration cut manual ticket volume by 50%+.'],
          source: 'brianm53.github.io',
        },
        {
          title: 'Software Engineer',
          org: 'IDLife Corporate',
          dates: '2023 · Frisco, TX',
          bullets: ['Wrote internal Python and JavaScript tools to automate data entry and reporting for lot control and inventory management.'],
          source: 'brianm53.github.io',
        },
      ],
    },
    {
      heading: 'Education',
      entries: [
        {
          title: 'Computer Science, Statistics minor',
          org: 'Texas A&M University',
          dates: 'Class of 2025 · GPA 3.8',
          source: 'brianm53.github.io',
        },
      ],
    },
  ],
  skills: ['TypeScript', 'Node.js', 'Python', 'React', 'Supabase', 'PostgreSQL', 'MongoDB', 'Ansible', 'C++', 'Java'],
}
