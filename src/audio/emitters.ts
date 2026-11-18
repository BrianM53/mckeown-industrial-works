import { createRng, hashString, type Rng } from '@/core/rng'
import type { LineId, LoopName, Vec3 } from '@/core/types'
import { ANCHORS, COLLECTOR, LINES, PAD, QC_ARCH, RESTRICTED_ZONES, ZONES, zoneAt, type LineDef } from '@/world/layout'

/**
 * WORLD SOUND MAP — every positional machinery emitter, derived from
 * world/layout.ts (no invented coordinates beyond "which spot along a line").
 */

/** Building zone id containing (x, z), or null when outdoors (used for occlusion). */
export function spaceAt(x: number, z: number): string | null {
  const id = zoneAt(x, z)
  return id && ZONES[id].building ? id : null
}

const line = (id: LineId): LineDef => {
  const l = LINES.find((d) => d.id === id)
  if (!l) throw new Error(`audio: unknown line ${id}`)
  return l
}
const along = (l: LineDef, f: number) => l.zStart + (l.zEnd - l.zStart) * f
const mid = (l: LineDef) => along(l, 0.5)

const SMELT = line('smelt')
const PIPE = line('pipe')
const TANK = line('tank')

function rectCenter(id: string): [number, number] {
  const z = RESTRICTED_ZONES.find((r) => r.id === id)
  if (z && z.shape.kind === 'rect') {
    const r = z.shape.rect
    return [(r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2]
  }
  return [17.5, -4.5]
}

export interface WorldEmitterDef {
  id: string
  loop: LoopName
  position: Vec3
  volume: number
  refDistance?: number
  maxDistance?: number
  /** Production line driving this emitter: status → on/off, conveyorSpeed → rate. */
  line?: LineId
}

const transformer = rectCenter('transformer-yard')

export const WORLD_EMITTERS: WorldEmitterDef[] = [
  // furnace roar at the smelting line input
  { id: 'furnace', loop: 'furnace-roar', position: [SMELT.x, 1.6, SMELT.zStart - 0.5], volume: 1, maxDistance: 42 },
  // one conveyor clatter per ground line, at its middle
  ...LINES.filter((l) => !l.overhead).map(
    (l): WorldEmitterDef => ({ id: `belt-${l.id}`, loop: 'belt-clatter', position: [l.x, 0.9, mid(l)], volume: 1, line: l.id, maxDistance: 32 }),
  ),
  // the elevated collector belt feeding the tower
  { id: 'belt-collector', loop: 'belt-clatter', position: [0, COLLECTOR.height, COLLECTOR.z], volume: 0.55, maxDistance: 30 },
  // transformer yard (restricted zone centre)
  { id: 'transformer', loop: 'transformer-hum', position: [transformer[0], 1.5, transformer[1]], volume: 1, maxDistance: 28 },
  // the server hall's giant fan and racks
  { id: 'server-fan', loop: 'fan-hum', position: [ANCHORS.serverFan.position[0], 3.2, ANCHORS.serverFan.position[1]], volume: 1, maxDistance: 30 },
  { id: 'server-racks', loop: 'server-hum', position: [ZONES.server.center[0], 1.4, ZONES.server.center[1]], volume: 1, maxDistance: 32 },
  // radio booth
  { id: 'radio', loop: 'radio-music', position: [ANCHORS.radioDesk.position[0], 1.3, ANCHORS.radioDesk.position[1]], volume: 1, maxDistance: 24 },
]

/** Where the smelt-line stamping press slams (phase crossing 0.5). */
export const PRESS_POSITION: Vec3 = [SMELT.x, 1.5, mid(SMELT)]
/** Pipe-line machining station (quiet clank on its cycle). */
export const PIPE_MACHINE_POSITION: Vec3 = [PIPE.x, 1.4, along(PIPE, 0.45)]
/** Welding stations on the fuel-tank line. */
export const WELD_SPOTS: Vec3[] = [
  [TANK.x - 0.6, 1.6, along(TANK, 0.38)],
  [TANK.x + 0.6, 1.6, along(TANK, 0.68)],
]
/**
 * Machinery that periodically vents a louder steam hiss (seeded bursts): the
 * furnace's quench station and the fuel-tank pressure test. Continuous vent
 * hiss at the visible floor grates is placed by the environment module.
 */
export const STEAM_SPOTS: Vec3[] = [
  [SMELT.x - 2.6, 2.2, SMELT.zStart - 1.5],
  [TANK.x + 2.4, 2, along(TANK, 0.75)],
]
/** Launch pad (rocket sounds). */
export const PAD_POSITION: Vec3 = [PAD.center[0], 2, PAD.center[1]]

const PAYLOAD = line('payload')
/** Normalized payload-belt position (0 = zStart … 1 = zEnd) where items pass through the QC scanner arch. */
export const QC_MARK = (PAYLOAD.zStart - QC_ARCH.position[1]) / (PAYLOAD.zStart - PAYLOAD.zEnd)
/** The arch's scanner head (beeps when a payload item passes). */
export const QC_SCANNER_POSITION: Vec3 = [QC_ARCH.position[0], QC_ARCH.height - 0.4, QC_ARCH.position[1]]

/**
 * Machine-cycle id of the newest belt item at or past normalized position
 * `mark`, or −1 when none (items sorted DESCENDING; item i was made by cycle
 * `cycles - (items.length - 1 - i)`, see systems/factory). It only grows as
 * items pass the mark, so an increase means "an item just went through".
 */
export function newestItemPast(items: readonly number[], cycles: number, mark: number): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i] >= mark) return cycles - (items.length - 1 - i)
  }
  return -1
}

/** Detects items passing a mark on a belt: tick() is true once per newly passed item (never for the initial state or after a reset). */
export class MarkWatcher {
  private last: number | null = null

  constructor(private readonly mark: number) {}

  tick(items: readonly number[] | undefined, cycles: number | undefined): boolean {
    if (!items || !Number.isFinite(cycles)) return false
    const c = newestItemPast(items, cycles as number, this.mark)
    if (this.last === null || c < this.last) {
      // first look, the belt emptied past the mark, or the sim was reset: no event
      this.last = c
      return false
    }
    if (c === this.last) return false
    this.last = c
    return true
  }
}

/**
 * Seeded "random but reproducible" event timer. tick(dt) returns true when
 * the event fires; the next interval is drawn from [min, max], or from the
 * short burst range with probability `burstChance` (bursty welding).
 */
export class SeededTimer {
  private left: number
  private readonly rng: Rng

  constructor(
    seedKey: string,
    private readonly min: number,
    private readonly max: number,
    private readonly burst: { chance: number; min: number; max: number } | null = null,
  ) {
    this.rng = createRng(hashString(seedKey))
    this.left = this.min + (this.max - this.min) * this.rng()
  }

  /** Advance by dt seconds; true when the event fires this tick. */
  tick(dt: number): boolean {
    if (!(dt > 0)) return false
    this.left -= Math.min(dt, 1)
    if (this.left > 0) return false
    const b = this.burst
    if (b && this.rng() < b.chance) this.left = b.min + (b.max - b.min) * this.rng()
    else this.left = this.min + (this.max - this.min) * this.rng()
    return true
  }

  /** Seeded random in [0, 1) for choosing spots / variations. */
  next(): number {
    return this.rng()
  }
}

/** Approximate rocket altitude during the flight phase, for positioning launch sounds (m). */
export function estimateRocketAltitude(flightSeconds: number): number {
  const t = Math.max(0, flightSeconds)
  return Math.min(70, 2 + 2.2 * t * t)
}
