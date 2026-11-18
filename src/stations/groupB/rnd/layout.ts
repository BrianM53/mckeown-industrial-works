/**
 * R&D ANNEX layout (pure data, unit-tested). ZONES.rnd.building: interior
 * x -45.5..-30.5, z -39.5..-26.5, door on the east wall z -35..-31. The
 * environment furnishes the east half (lab benches along the north/south walls,
 * fume hood + gas cylinders in the NE corner); stations use the west half.
 *
 *   north wall z -39.5   [gauge]──rower──[lamps]   lab bench   hood
 *        (bench slot 1)   ROW-PERGFECT RIG (-40,-36.5)           |
 *   W   [DO NOT PRESS] (-44.5,-33)          info board ↘        DOOR
 *        (bench slot 0)   SLAM SCANNER (-40,-30) + hologram       |
 *   south wall z -26.5                      lab bench (env)
 */
import { PROJECTS } from '@/content/projects'
import type { ProjectContent } from '@/content/types'
import type { Rect, Vec2 } from '@/core/types'
import { ANCHORS, EAST, NORTH, ZONES } from '@/world/layout'

export const ANNEX = ZONES.rnd.building!
export const INTERIOR: Rect = ANNEX.interior
export const DOOR = { x: ANNEX.footprint.maxX, z0: ANNEX.doorSpan[0], z1: ANNEX.doorSpan[1] }

/** Projects with a bespoke machine (everything else featured gets a generic bench). */
export const CUSTOM_STATIONS = ['gaussian-slam', 'row-pergfect'] as const

export const SCANNER = {
  x: ANCHORS.slamScanner.position[0],
  z: ANCHORS.slamScanner.position[1],
  yaw: ANCHORS.slamScanner.yaw,
  baseR: 0.85,
  baseH: 0.85,
  trackR: 1.12,
  /** Interaction point (in front of the scanner, toward the visitor). */
  interact: { x: ANCHORS.slamScanner.position[0] + 2.45, z: ANCHORS.slamScanner.position[1] },
  monitor: { x: ANCHORS.slamScanner.position[0] + 1.55, z: ANCHORS.slamScanner.position[1] - 1.55 },
  /** Hologram (reconstruction) floats above the turntable. */
  holoY: 2.05,
  holoScale: 0.62,
  /** Seconds for one reconstruction (spec: ~20 s). */
  cycle: 20,
  hold: 2.5,
  dissolve: 2.5,
}

export const ROW_RIG = {
  x: ANCHORS.rowRig.position[0],
  z: ANCHORS.rowRig.position[1],
  yaw: ANCHORS.rowRig.yaw,
  interact: { x: ANCHORS.rowRig.position[0] + 2.2, z: ANCHORS.rowRig.position[1] },
  /** Local footprint (rig frame, before yaw): x along the rower, z across. */
  half: { x: 2.15, z: 0.85 },
}

export const DNP = {
  x: ANCHORS.doNotPress.position[0],
  z: ANCHORS.doNotPress.position[1],
  yaw: ANCHORS.doNotPress.yaw,
  interact: { x: ANCHORS.doNotPress.interact[0], z: ANCHORS.doNotPress.interact[1] },
  /** First (small) button pedestal and the hatch the second one rises from. */
  b1: { x: ANCHORS.doNotPress.position[0] - 0.05, z: ANCHORS.doNotPress.position[1] - 0.8, r: 0.22, h: 1.0 },
  b2: { x: ANCHORS.doNotPress.position[0] + 0.15, z: ANCHORS.doNotPress.position[1] + 0.85, r: 0.34, h: 1.22 },
  /** Thank-you sign on the west wall. */
  sign: { x: INTERIOR.minX + 0.06, y: 3.05, z: ANCHORS.doNotPress.position[1] },
  resetAfter: 60,
}

/** Hatch / keep-clear geometry around the second button (local half sizes, m). */
export const DNP_GEOM = { half: 0.42, frame: 0.07, bollardHalf: 0.66 }

/** Where the visitor stands to press button 1 or 2 (just east of each pedestal / bollard square). */
export function dnpInteractPoint(which: 1 | 2): { x: number; z: number } {
  return which === 1 ? { x: DNP.b1.x + 0.78, z: DNP.b1.z } : { x: DNP.b2.x + DNP_GEOM.bollardHalf + 0.42, z: DNP.b2.z }
}

/** Annex directory board just inside the door, angled toward the entrance. */
export const INFO_BOARD = { x: -32.4, z: -36.85, yaw: -2.45, w: 1.5, h: 1.0, y0: 0.9 }
export const INFO_INTERACT: Vec2 = [-32.0, -35.6]

export interface BenchSlot {
  x: number
  z: number
  yaw: number
}

/** Generic project benches (data-driven; empty today — every featured project has a bespoke rig). */
export const BENCH_SLOTS: BenchSlot[] = [
  { x: -43.3, z: -27.35, yaw: NORTH },
  { x: -44.75, z: -38.2, yaw: EAST },
]

export const BENCH = { w: 1.5, d: 0.75 }

/** Featured R&D projects that need a generic bench (no bespoke machine yet). */
export function genericStationProjects(projects: ProjectContent[] = PROJECTS): ProjectContent[] {
  return projects.filter((p) => p.featured && p.station === 'rnd' && !(CUSTOM_STATIONS as readonly string[]).includes(p.id))
}

/** Assign projects to bench slots (extra projects beyond the slots are listed on the info board only). */
export function assignBenches(projects: ProjectContent[]): { project: ProjectContent; slot: BenchSlot }[] {
  return projects.slice(0, BENCH_SLOTS.length).map((project, i) => ({ project, slot: BENCH_SLOTS[i] }))
}
