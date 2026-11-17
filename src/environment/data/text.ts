/**
 * Environment signage copy. Everything here is in-world fiction / wayfinding;
 * no personal facts (those live in src/content/*).
 */
import { ZONES, type ZoneId } from '@/world/layout'

/** Building sign: big title + zone-colored tab (omitted when redundant). */
export function buildingSignText(id: ZoneId): { title: string; tab: string | null } {
  const z = ZONES[id]
  const title = z.name.toUpperCase()
  const tab = z.shortName.toUpperCase()
  const redundant = title.includes(tab) || tab.length === 0
  return { title, tab: redundant ? null : tab }
}

/** Short labels for signpost blades (fit ~16 characters). */
export const BLADE_LABELS: Record<ZoneId, string> = {
  intake: 'VISITOR INTAKE',
  personnel: 'RÉSUMÉ · PERSONNEL',
  maintenance: 'MAINTENANCE BAY',
  production: 'PRODUCTION',
  tower: 'ROCKET TOWER',
  launch: 'LAUNCH YARD',
  control: 'HARMONY AI · CONTROL',
  server: 'GITHUB · SERVER HALL',
  rnd: 'R&D ANNEX',
  radio: 'CODE STORY · RADIO',
  rec: 'REC YARD',
  breakroom: 'BREAK ROOM',
  warehouse: 'WAREHOUSE',
}

export interface PosterDef {
  id: string
  headline: string
  body: string
  /** Accent / background color. */
  color: string
  icon: PosterIcon
}

export type PosterIcon = 'hardhat' | 'warning' | 'rocket' | 'forklift' | 'bolt' | 'eye' | 'cup' | 'clipboard' | 'star' | 'chart' | 'ear' | 'hand'

/** Joke safety / motivational posters (pure fiction). */
export const POSTERS: PosterDef[] = [
  { id: 'priority', headline: 'SAFETY IS OUR #2 PRIORITY', body: '#1 is under review.', color: '#E9B63F', icon: 'hardhat' },
  { id: 'eyes', headline: 'EYE PROTECTION REQUIRED', body: 'Also strongly recommended: eyes.', color: '#4F86A8', icon: 'eye' },
  { id: 'forklift', headline: 'PLEASE DO NOT FEED THE FORKLIFT', body: 'It is on a strict diet of pallets.', color: '#E57D35', icon: 'forklift' },
  { id: 'rockets', headline: 'REPORT ROCKETS FOUND IN UNUSUAL PLACES', body: 'Unusual places include: the roof.', color: '#D9483B', icon: 'rocket' },
  { id: 'lift', headline: 'LIFT WITH YOUR LEGS', body: 'Launch with your heart.', color: '#638C88', icon: 'hand' },
  { id: 'running', headline: 'NO RUNNING', body: 'Brisk walking pending legal review.', color: '#E9B63F', icon: 'warning' },
  { id: 'floor', headline: 'CAUTION: FLOOR MAY BE FLOOR', body: 'Please treat accordingly.', color: '#E9B63F', icon: 'warning' },
  { id: 'voltage', headline: 'HIGH VOLTAGE', body: 'Low patience. Do not touch.', color: '#E9B63F', icon: 'bolt' },
  { id: 'ppe', headline: 'WEAR YOUR PPE', body: 'Pizza is not Personal Protective Equipment.', color: '#5DBB63', icon: 'clipboard' },
  { id: 'signin', headline: 'ALL VISITORS MUST SIGN IN', body: 'All rockets must sign out.', color: '#EAE3D2', icon: 'clipboard' },
  { id: 'qc', headline: 'QUALITY IS JOB ONE', body: 'Job two is finding job one.', color: '#4FC3A1', icon: 'star' },
  { id: 'ears', headline: 'HEARING PROTECTION ZONE', body: 'WHAT?', color: '#4F86A8', icon: 'ear' },
  { id: 'synergy', headline: 'SYNERGY', body: 'It is like energy, but in a meeting.', color: '#8C6BB1', icon: 'chart' },
  { id: 'coffee', headline: 'COFFEE IS A SAFETY DEVICE', body: 'Refill responsibly. Then refill again.', color: '#A95E39', icon: 'cup' },
  { id: 'teamwork', headline: 'TEAMWORK', body: 'Together, nobody has to take the blame.', color: '#638C88', icon: 'star' },
  { id: 'attitude', headline: 'ATTITUDE', body: 'Like altitude, but on purpose.', color: '#E57D35', icon: 'rocket' },
  { id: 'microwave', headline: 'NO FISH IN THE MICROWAVE', body: 'This is a launch facility, not a fish facility.', color: '#D9483B', icon: 'warning' },
  { id: 'hang', headline: 'HANG IN THERE', body: 'The torque wrench believes in you.', color: '#E9B63F', icon: 'hand' },
  { id: 'doors', headline: 'THIS DOOR IS ALARMED', body: 'It is also deeply concerned.', color: '#D9483B', icon: 'warning' },
  { id: 'inspector', headline: 'THIS AREA IS PATROLLED', body: 'By a very fast safety inspector.', color: '#E57D35', icon: 'eye' },
]

export function poster(id: string): PosterDef {
  return POSTERS.find((p) => p.id === id) ?? POSTERS[0]
}

/** Floor stencils (painted text). */
export const STENCILS = {
  intake: 'VISITOR INTAKE',
  youAreHere: 'YOU ARE HERE',
  probably: '(PROBABLY)',
  mainAisle: 'MAIN AISLE',
  production: 'PRODUCTION SPINE',
  lookUp: 'LOOK UP',
  stop: 'STOP',
  slow: 'SLOW',
  walkway: 'WALKWAY',
  forklifts: 'FORKLIFTS',
  keepClear: 'KEEP CLEAR',
  blast: 'BLAST ZONE',
  launchView: 'LAUNCH VIEWING',
  towerPlaza: 'TOWER PLAZA',
  noParking: 'NO PARKING',
  ceo: 'RESERVED · CEO',
  practice: 'FORKLIFT PRACTICE AREA',
  loading: 'LOADING ZONE',
}

/** Lines shown when peeking into the locked executive office. */
export const EXEC_PEEK_LINES = [
  'Through the glass: one enormous pie chart. Every slice says SYNERGY.',
  'The pie chart has been reorganized. It is still entirely SYNERGY.',
  'A sticky note on the glass: "Back in Q5."',
  'You cannot tell if the pie chart is a strategy or a lunch order.',
  'The keypad accepts only buzzwords. You do not have enough.',
]

export const MOTTO = 'THE FACTORY CAN BE DYSFUNCTIONAL. THE WEBSITE CANNOT.'
export const WELCOME_TITLE = 'McKEOWN INDUSTRIAL WORKS'
export const WELCOME_SUB = 'VISITOR INTAKE'
