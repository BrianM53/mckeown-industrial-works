/**
 * NPC roster: who works where. Positions are hand-placed against world/layout.ts
 * and validated by src/npc/npc.routes.test.ts (lanes, doors, restricted zones,
 * building walls, machinery, station anchors, environment colliders).
 *
 * Quality tiers: low spawns 6 workers, medium 10, high 14.
 */
import { yawToward } from '@/core/math'
import type { QualityTier, Vec2 } from '@/core/types'
import { EAST, NORTH, SOUTH, WEST } from '@/world/layout'
import {
  LOOK_CHIEF,
  LOOK_DJ,
  LOOK_DRIVER,
  LOOK_GREETER,
  LOOK_LINE_A,
  LOOK_LINE_B,
  LOOK_LOUNGER_A,
  LOOK_LOUNGER_B,
  LOOK_OPERATOR,
  LOOK_QC,
  LOOK_SCIENTIST,
  LOOK_SYSADMIN,
} from './looks'
import { NAP_CONVEYOR } from './propsData'
import type { NpcDef } from './types'

const face = (from: Vec2, to: Vec2) => yawToward({ x: from[0], z: from[1] }, { x: to[0], z: to[1] })

// ---------------------------------------------------------------------------
// Production-line worker spots. The production module publishes standing spots
// (clear of its machines, facing them) in src/factory/lines/spots.ts. Imported
// defensively: a missing file / renamed export / large move falls back to the
// copies below (the routes here were validated around these positions).
// ---------------------------------------------------------------------------

interface SpotLike {
  id?: unknown
  position?: unknown
  yaw?: unknown
}
const spotModules = import.meta.glob<{ LINE_WORKER_SPOTS?: Record<string, SpotLike[]> }>('../factory/lines/spots.ts', { eager: true })
const PRODUCTION_SPOTS: SpotLike[] = (() => {
  try {
    const mod = Object.values(spotModules)[0]
    const rec = mod?.LINE_WORKER_SPOTS
    return rec && typeof rec === 'object' ? Object.values(rec).flatMap((v) => (Array.isArray(v) ? v : [])) : []
  } catch {
    return []
  }
})()

/** A production spot by id if it exists and stays within 1 m of our validated fallback. */
export function lineSpot(id: string, fallback: { pos: Vec2; yaw: number }): { pos: Vec2; yaw: number; source: 'production' | 'fallback' } {
  const s = PRODUCTION_SPOTS.find((x) => x && x.id === id)
  const p = s?.position
  if (s && Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(s.yaw as number)) {
    if (Math.hypot((p[0] as number) - fallback.pos[0], (p[1] as number) - fallback.pos[1]) < 1.0)
      return { pos: [p[0] as number, p[1] as number], yaw: s.yaw as number, source: 'production' }
  }
  return { ...fallback, source: 'fallback' }
}

const SMELT_FURNACE = lineSpot('smelt:furnace', { pos: [-6.55, 15.25], yaw: WEST })
const SMELT_PRESS = lineSpot('smelt:press', { pos: [-6.68, 10.05], yaw: WEST })
const PIPE_LATHE = lineSpot('pipe:lathe', { pos: [-14.62, 16.15], yaw: NORTH })
const PIPE_ROBOT = lineSpot('pipe:robot', { pos: [-14.55, 9.75], yaw: face([-14.55, 9.75], [-14.7, 8.4]) })
const CIRCUIT_BOOTH = lineSpot('circuit:booth', { pos: [6.45, 13.8], yaw: EAST })
const CIRCUIT_TEST = lineSpot('circuit:test', { pos: [6.4, 5.7], yaw: EAST })
const TANK_GAUGE = lineSpot('tank:gauge', { pos: [17.42, 7.25], yaw: face([17.42, 7.25], [17.55, 6.0]) })
const QC_SPOT = lineSpot('payload:qc', { pos: [-5.2, 10.0], yaw: EAST })
/** Spots taken from the production module (debug / report). */
export const SPOT_SOURCES = { SMELT_FURNACE, SMELT_PRESS, PIPE_LATHE, PIPE_ROBOT, CIRCUIT_BOOTH, CIRCUIT_TEST, TANK_GAUGE, QC_SPOT }

/** Nap position on the conveyor: hips over the downstream half, feet toward the south. */
export const NAP_SPOT: Vec2 = [NAP_CONVEYOR.pos[0], NAP_CONVEYOR.pos[1] - 0.5]
const NAP_APPROACH: Vec2 = [NAP_CONVEYOR.pos[0] - 0.95, NAP_SPOT[1]]

export const ROSTER: NpcDef[] = [
  // ------------------------------------------------------------------ low tier (6)
  {
    id: 'greeter',
    name: 'Dot',
    role: 'Visitor Intake',
    tier: 'low',
    look: LOOK_GREETER,
    seed: 11,
    zone: 'intake',
    greeter: true,
    speed: 1.05,
    stations: [
      { id: 'desk', pos: [2.95, 28.4], yaw: face([2.95, 28.4], [0, 32.4]), activity: 'idle', dur: [12, 20], laneOk: true },
      { id: 'arch', pos: [2.95, 33.7], yaw: face([2.95, 33.7], [-0.5, 30]), activity: 'idle', dur: [7, 11], laneOk: true },
    ],
    routine: ['desk', 'arch'],
    legs: [{ from: 'desk', to: 'arch' }],
  },
  {
    id: 'smelter',
    name: 'Rocco',
    role: 'Smelter Operator',
    tier: 'low',
    look: LOOK_LINE_A,
    seed: 23,
    zone: 'production',
    carries: true,
    speed: 1.1,
    stations: [
      { id: 'furnace', pos: SMELT_FURNACE.pos, yaw: SMELT_FURNACE.yaw, activity: 'work', dur: [9, 16] },
      { id: 'press', pos: SMELT_PRESS.pos, yaw: SMELT_PRESS.yaw, activity: 'work', dur: [7, 12] },
    ],
    routine: ['furnace', 'press'],
    legs: [{ from: 'furnace', to: 'press', carry: true }],
  },
  {
    id: 'circuit',
    name: 'Priya',
    role: 'Guidance Electronics',
    tier: 'low',
    look: LOOK_LINE_B,
    seed: 37,
    zone: 'production',
    carries: true,
    speed: 1.1,
    stations: [
      { id: 'booth', pos: CIRCUIT_BOOTH.pos, yaw: CIRCUIT_BOOTH.yaw, activity: 'work', dur: [9, 15] },
      { id: 'test', pos: CIRCUIT_TEST.pos, yaw: CIRCUIT_TEST.yaw, activity: 'work', dur: [8, 13] },
    ],
    routine: ['booth', 'test'],
    legs: [{ from: 'booth', to: 'test', carry: true }],
  },
  {
    id: 'qc',
    name: 'Vera',
    role: 'Quality Control',
    tier: 'low',
    look: LOOK_QC,
    seed: 41,
    zone: 'production',
    speed: 1.0,
    stations: [
      { id: 'arch', pos: QC_SPOT.pos, yaw: QC_SPOT.yaw, activity: 'idle', dur: [9, 15], lookAt: [0, 11] },
      { id: 'scan', pos: [2.75, 9.55], yaw: face([2.75, 9.55], [0.4, 11]), activity: 'point', dur: [3, 5], laneOk: true },
    ],
    routine: ['arch', 'scan'],
    legs: [{ from: 'arch', to: 'scan' }],
  },
  {
    id: 'chief',
    name: 'Bev',
    role: 'Tower Crew Chief',
    tier: 'low',
    look: LOOK_CHIEF,
    seed: 53,
    zone: 'tower',
    speed: 1.1,
    stations: [
      { id: 'tower', pos: [-7.8, -6.8], yaw: EAST, activity: 'idle', dur: [7, 11], lookAt: [0, -10] },
      { id: 'board', pos: [-7.8, -13.6], yaw: EAST, activity: 'idle', dur: [6, 10], lookAt: [0, -12] },
      { id: 'arm', pos: [-10.9, -9.2], yaw: face([-10.9, -9.2], [-12.4, -9.8]), activity: 'idle', dur: [5, 8] },
    ],
    routine: ['tower', 'board', 'arm'],
    legs: [
      { from: 'tower', to: 'board' },
      { from: 'board', to: 'arm' },
      { from: 'arm', to: 'tower' },
    ],
  },
  {
    id: 'driver',
    name: 'Dale',
    role: 'Employee of the Month',
    tier: 'low',
    look: LOOK_DRIVER,
    seed: 67,
    zone: 'maintenance',
    speed: 0.85,
    stations: [
      { id: 'lean', pos: [-17.05, 29.0], yaw: EAST, activity: 'lean', lean: 0.13, dur: [22, 36] },
      { id: 'nap', pos: NAP_SPOT, yaw: SOUTH, activity: 'nap', y: NAP_CONVEYOR.height, onProp: true, dur: [26, 42] },
    ],
    routine: ['lean', 'nap'],
    legs: [{ from: 'lean', to: 'nap', via: [NAP_APPROACH] }],
  },

  // ------------------------------------------------------------------ medium tier (+4)
  {
    id: 'pipe',
    name: 'Marisol',
    role: 'Pipe & Valve Machinist',
    tier: 'medium',
    look: LOOK_LINE_B,
    seed: 71,
    zone: 'production',
    carries: true,
    speed: 1.1,
    stations: [
      { id: 'lathe', pos: PIPE_LATHE.pos, yaw: PIPE_LATHE.yaw, activity: 'work', dur: [9, 15] },
      { id: 'robot', pos: PIPE_ROBOT.pos, yaw: PIPE_ROBOT.yaw, activity: 'point', dur: [5, 8] },
    ],
    routine: ['lathe', 'robot'],
    // along the edge of the walkway, around the lathe
    legs: [{ from: 'lathe', to: 'robot', via: [[-13.62, 15.75], [-13.62, 10.15]], carry: true }],
  },
  {
    id: 'tank',
    name: 'Gus',
    role: 'Tank Fabricator',
    tier: 'medium',
    look: LOOK_LINE_A,
    seed: 83,
    zone: 'production',
    carries: true,
    speed: 1.05,
    stations: [
      { id: 'outer', pos: [18.45, 12.9], yaw: WEST, activity: 'work', dur: [9, 15], lookAt: [16, 12.9] },
      { id: 'gauge', pos: TANK_GAUGE.pos, yaw: TANK_GAUGE.yaw, activity: 'point', dur: [5, 8] },
    ],
    routine: ['outer', 'gauge'],
    // the gauge niche is only reachable from the hall's east strip
    legs: [{ from: 'gauge', to: 'outer', via: [[18.45, TANK_GAUGE.pos[1]]], carry: true }],
  },
  {
    id: 'operator',
    name: 'Nadia',
    role: 'Control Room Operator',
    tier: 'medium',
    look: LOOK_OPERATOR,
    seed: 97,
    zone: 'control',
    speed: 1.0,
    stations: [
      // operator desk #2 (the Control Room's first desk has its own seated operator)
      { id: 'desk', pos: [-40.35, 16.1], yaw: WEST, activity: 'sit', y: 0.02, onProp: true, dur: [16, 26], lookAt: [-41.95, 15.6] },
      { id: 'screens', pos: [-36.6, 18.3], yaw: face([-36.6, 18.3], [-45.3, 13]), activity: 'idle', dur: [7, 11], lookAt: [-45.3, 13] },
    ],
    routine: ['desk', 'screens'],
    legs: [{ from: 'screens', to: 'desk', via: [[-39.45, 16.1]] }],
  },
  {
    id: 'dj',
    name: 'DJ Torque',
    role: 'Radio Booth',
    tier: 'medium',
    look: LOOK_DJ,
    seed: 101,
    zone: 'radio',
    speed: 1.0,
    stations: [
      { id: 'records', pos: [38.75, 7.75], yaw: NORTH, activity: 'work', dur: [8, 13] },
      { id: 'groove', pos: [40.4, 12.4], yaw: WEST, activity: 'idle', dur: [8, 12], lookAt: [33, 11] },
    ],
    routine: ['records', 'groove'],
    legs: [{ from: 'records', to: 'groove' }],
  },

  // ------------------------------------------------------------------ high tier (+4)
  {
    id: 'sysadmin',
    name: 'Glenn',
    role: 'Sysadmin',
    tier: 'high',
    look: LOOK_SYSADMIN,
    seed: 113,
    zone: 'server',
    speed: 1.0,
    // the hot aisle between rack rows B and C (north and south blocks), patching cables on
    // row C's backs. Crossing the central aisle here keeps him ≥ 1.2 m from the terminal
    // spot and clear of the door zone (the cold aisle crossing passed right by the terminal).
    stations: [
      { id: 'rack-n', pos: [-33.35, -13.3], yaw: EAST, activity: 'work', dur: [9, 14] },
      { id: 'rack-s', pos: [-33.35, -4.75], yaw: EAST, activity: 'work', dur: [7, 11] },
    ],
    routine: ['rack-n', 'rack-s'],
    legs: [{ from: 'rack-n', to: 'rack-s' }],
  },
  {
    id: 'scientist',
    name: 'Dr. Fenwick',
    role: 'R&D Scientist',
    tier: 'high',
    look: LOOK_SCIENTIST,
    seed: 127,
    zone: 'rnd',
    speed: 0.95,
    stations: [
      { id: 'bench-n', pos: [-35.2, -38.1], yaw: NORTH, activity: 'work', dur: [9, 15] },
      { id: 'bench-s', pos: [-35.0, -27.9], yaw: SOUTH, activity: 'work', dur: [7, 12] },
    ],
    routine: ['bench-n', 'bench-s'],
    legs: [{ from: 'bench-n', to: 'bench-s' }],
  },
  {
    id: 'lounger-a',
    name: 'Moe',
    role: 'On Break',
    tier: 'high',
    look: LOOK_LOUNGER_A,
    seed: 131,
    zone: 'breakroom',
    speed: 0.9,
    stations: [
      { id: 'sofa', pos: [32.6, 35.0], yaw: NORTH, activity: 'sit', onProp: true, dur: [25, 45] },
      { id: 'vending', pos: [32.45, 26.25], yaw: NORTH, activity: 'idle', dur: [6, 10] },
    ],
    routine: ['sofa', 'vending'],
    legs: [{ from: 'vending', to: 'sofa', via: [[32.3, 30.0], [32.6, 33.9]] }],
  },
  {
    id: 'lounger-b',
    name: 'Lou',
    role: 'On Break',
    tier: 'high',
    look: LOOK_LOUNGER_B,
    seed: 149,
    zone: 'breakroom',
    speed: 0.95,
    stations: [
      { id: 'counter', pos: [39.1, 25.9], yaw: NORTH, activity: 'work', dur: [8, 13] },
      { id: 'window', pos: [41.4, 29.6], yaw: SOUTH, activity: 'idle', dur: [6, 10] },
    ],
    routine: ['counter', 'window'],
    legs: [{ from: 'counter', to: 'window' }],
  },
]

const TIER_RANK: Record<QualityTier, number> = { low: 0, medium: 1, high: 2 }

/** NPCs that spawn at a quality tier. */
export function rosterFor(quality: QualityTier): NpcDef[] {
  return ROSTER.filter((n) => TIER_RANK[n.tier] <= TIER_RANK[quality])
}

export function npcDef(id: string): NpcDef | undefined {
  return ROSTER.find((n) => n.id === id)
}

/** Position of a roster station (throws on typos — used to anchor gag choreography). */
export function stationPos(npcId: string, stationId: string): Vec2 {
  const st = npcDef(npcId)?.stations.find((s) => s.id === stationId)
  if (!st) throw new Error(`[npc] unknown station ${npcId}:${stationId}`)
  return [st.pos[0], st.pos[1]]
}
