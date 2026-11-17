import type { ProjectContent } from './types'

/**
 * Curated GitHub projects (Server Hall cards; `featured` ones also get R&D Annex machines).
 * Facts were verified via the GitHub API, READMEs and project reports on 2026-11-17.
 * Honest caveats (team/course/fork status) are deliberate. Do not remove them.
 * To add a project: append an entry. The Server Hall and the static portfolio pick it up automatically.
 */
export const PROJECTS: ProjectContent[] = [
  {
    id: 'gaussian-slam',
    name: 'Gaussian-SLAM (live streaming)',
    url: 'https://github.com/BrianM53/Gaussian-SLAM',
    oneLiner:
      'Senior capstone team project that extended open-source Gaussian-SLAM research code to build a 3D reconstruction live from streamed video frames, viewable in the browser as it grows.',
    details: [
      'Five-person Texas A&M senior capstone (Spring 2025) for industry sponsor SpatialGen. The team added frame-by-frame streaming input, depth estimation from video, and a live browser viewer on top of Gaussian-SLAM by Yugay et al.',
      'Brian oversaw scope and deliverables, managed the product backlog, and coordinated with the sponsor.',
    ],
    tech: ['Python', 'Shell'],
    featured: true,
    station: 'rnd',
    verified: true,
    isFork: false,
    caveat: 'Team project built on open-source research code (VladimirYugay/Gaussian-SLAM).',
  },
  {
    id: 'row-pergfect',
    name: 'Row-Pergfect 1.0',
    url: 'https://github.com/BrianM53/Row-Pergfect-1.0',
    oneLiner:
      'A smart rowing-machine handle: two motion sensors on a Raspberry Pi watch each stroke and light up LEDs when the rower’s form goes wrong.',
    details: [
      'Solo course project (Texas A&M, 2024) built for a Concept2 RowErg. It flags pulling left or right, rushing the arms back, and pausing mid-stroke, in real time.',
      'The project report is candid about limits: left/right detection was sometimes confused.',
    ],
    tech: ['Python', 'Raspberry Pi', 'MPU6050 IMU sensors'],
    featured: true,
    station: 'rnd',
    verified: true,
    isFork: false,
    caveat: 'Solo course project.',
  },
  {
    id: 'react-pos',
    name: 'React POS System',
    url: 'https://github.com/BrianM53/React-POS-System',
    oneLiner:
      'A web point-of-sale system for a crêpe restaurant, with a React frontend, an Express backend and a PostgreSQL database.',
    details: ['Five-person team course project (Texas A&M, Fall 2023). Brian was the project manager and built cashier and ordering features.'],
    tech: ['React', 'JavaScript', 'Express', 'PostgreSQL'],
    featured: false,
    station: 'server',
    verified: true,
    isFork: false,
    caveat: 'Team course project. Brian was project manager.',
  },
  {
    id: 'os-projects',
    name: 'OS Projects',
    url: 'https://github.com/BrianM53/OS-Projects',
    oneLiner:
      'Five C++ operating-systems assignments: inter-process communication over named pipes, a Linux shell with pipes and redirection, a multithreaded producer–consumer, a TCP/IP version, and a packet sniffing lab.',
    details: [],
    tech: ['C++', 'C', 'Shell', 'Docker'],
    featured: false,
    station: 'server',
    verified: true,
    isFork: false,
    caveat: 'Coursework (Texas A&M, Fall 2023) built on instructor starter code.',
  },
  {
    id: 'y86-cpu',
    name: 'Y86-64 CPU',
    url: 'https://github.com/BrianM53/Y86-64-CPU',
    oneLiner: 'A Y86-64 processor designed in Logisim, with fetch, decode, execute, memory and PC-update stages, plus small test programs.',
    details: ['Team project. Brian built the memory stage and shared the PC-update logic.'],
    tech: ['Logisim', 'Y86-64 assembly'],
    featured: false,
    station: 'server',
    verified: true,
    isFork: false,
    caveat: 'Team project.',
  },
]

export const GITHUB_PROFILE_URL = 'https://github.com/BrianM53'

export function getProject(id: string): ProjectContent | undefined {
  return PROJECTS.find((p) => p.id === id)
}
