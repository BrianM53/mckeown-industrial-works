import { contactOptions } from '@/content/links'
import { yawToward } from '@/core/math'
import type { PanelId } from '@/state/ui'
import { ANCHORS, PRINCIPAL_ZONES, WAYPOINTS, ZONES, type ZoneId } from '@/world/layout'

/**
 * Factory directory entries, derived from world/layout.ts (single source of
 * truth for names, colours, blurbs, entrances). Order: the five principal
 * portfolio destinations (PRINCIPAL_ZONES), then Contact, R&D Annex, the Line
 * Supervisor Console, Launch Yard and Maintenance Bay.
 */
export interface Destination {
  /** Stable key (zone id, or 'contact'). */
  key: string
  /** Zone used for the assisted route / beacon (ui store routeTarget). */
  zoneId: ZoneId
  name: string
  shortName: string
  color: string
  blurb: string
  /** Panel opened by "Open now" (null = world-only destination). */
  panel: PanelId | null
  principal: boolean
  /** Fast-travel drop point (player service teleport). */
  travel: { x: number; z: number; yaw: number }
  icon: 'person' | 'gauge' | 'mic' | 'code' | 'ball' | 'mail' | 'flask' | 'console' | 'rocket' | 'forklift' | 'map'
}

const ICONS: Partial<Record<ZoneId, Destination['icon']>> = {
  personnel: 'person',
  control: 'gauge',
  radio: 'mic',
  server: 'code',
  rec: 'ball',
  rnd: 'flask',
  production: 'console',
  launch: 'rocket',
  maintenance: 'forklift',
}

function fromZone(id: ZoneId, overrides: Partial<Destination> = {}): Destination {
  const z = ZONES[id]
  return {
    key: id,
    zoneId: id,
    name: z.name,
    shortName: z.shortName,
    color: z.color,
    blurb: z.blurb,
    panel: z.panel ?? null,
    principal: z.principal,
    travel: { x: z.entrance[0], z: z.entrance[1], yaw: z.entranceYaw },
    icon: ICONS[id] ?? 'map',
    ...overrides,
  }
}

const CONTACT_KIND_NAME = { email: 'Email', linkedin: 'LinkedIn', github: 'GitHub', website: 'website' } as const

/** "LinkedIn, GitHub and website" from the verified contact options (never a hard-coded claim). */
export function contactChannels(): string {
  const names = contactOptions().map((o) => CONTACT_KIND_NAME[o.kind])
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? 'GitHub')
}

/** Contact: opens the contact panel; in the world it is the pneumatic-tube mailbox at Visitor Intake. */
function contactDestination(): Destination {
  const stand = WAYPOINTS.mailbox?.position ?? ANCHORS.contactMailbox.interact
  const box = ANCHORS.contactMailbox.position
  return {
    key: 'contact',
    zoneId: 'intake',
    name: 'Contact',
    shortName: 'Hire · Say hello',
    color: ZONES.intake.color,
    blurb: `${contactChannels()} links. In the factory: the pneumatic-tube mailbox at Visitor Intake.`,
    panel: 'contact',
    principal: false,
    travel: { x: stand[0], z: stand[1], yaw: yawToward({ x: stand[0], z: stand[1] }, { x: box[0], z: box[1] }) },
    icon: 'mail',
  }
}

export function buildDestinations(): Destination[] {
  return [
    ...PRINCIPAL_ZONES.map((id) => fromZone(id, { principal: true })),
    contactDestination(),
    fromZone('rnd'),
    fromZone('production', { name: 'Line Supervisor Console', shortName: ZONES.production.name, panel: 'console' }),
    fromZone('launch', { panel: null }),
    fromZone('maintenance', { panel: null }),
  ]
}

export const DESTINATIONS: Destination[] = buildDestinations()
