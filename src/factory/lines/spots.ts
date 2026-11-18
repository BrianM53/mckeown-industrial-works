/**
 * Worker standing spots along the production lines, for the npc module.
 *
 *   import { LINE_WORKER_SPOTS } from '@/factory/lines/spots'
 *   for (const s of LINE_WORKER_SPOTS.smelt) <WorkerModel position={[s.position[0], 0, s.position[1]]} rotation-y={s.yaw} anim={s.anim} />
 *
 * Every spot is clear of this module's colliders (≥ 0.45 m), outside the main
 * aisle, the walkways and the cross aisle, and faces the machine it tends
 * (yaw: forward = (-sin, 0, -cos)). Pure data — safe to import anywhere.
 */
import type { LineId, Vec2 } from '@/core/types'
import { yawToward } from '@/core/math'
import { ARCH, PIPE, TANK } from './config'

export interface LineWorkerSpot {
  /** Stable id, e.g. 'smelt:furnace'. */
  id: string
  /** Feet position [x, z]. */
  position: Vec2
  /** Facing yaw (radians). */
  yaw: number
  /** Suggested WorkerModel animation. */
  anim: 'work' | 'point' | 'idle'
  /** What the worker is doing there (for dialogue flavor / debugging). */
  task: string
}

const WEST = Math.PI / 2
const EAST = -Math.PI / 2
const NORTH = 0
const SOUTH = Math.PI

const face = (from: Vec2, to: Vec2) => yawToward({ x: from[0], z: from[1] }, { x: to[0], z: to[1] })

export const LINE_WORKER_SPOTS: Record<LineId, LineWorkerSpot[]> = {
  smelt: [
    { id: 'smelt:furnace', position: [-6.55, 15.25], yaw: WEST, anim: 'work', task: 'Stoking the furnace mouth' },
    { id: 'smelt:press', position: [-6.68, 10.05], yaw: WEST, anim: 'work', task: 'Running the stamping press' },
    { id: 'smelt:qc', position: [-10.42, 6.6], yaw: EAST, anim: 'work', task: 'Inspecting stamped panels' },
  ],
  pipe: [
    { id: 'pipe:lathe', position: [-14.62, 16.15], yaw: NORTH, anim: 'work', task: 'Minding the lathe' },
    { id: 'pipe:bender', position: [-17.3, 9.2], yaw: NORTH, anim: 'work', task: 'Feeding the pipe bender' },
    { id: 'pipe:robot', position: [-14.55, 9.75], yaw: face([-14.55, 9.75], [PIPE.robot.x, PIPE.robot.z]), anim: 'point', task: 'Supervising the valve robot' },
  ],
  circuit: [
    { id: 'circuit:booth', position: [6.45, 13.8], yaw: EAST, anim: 'work', task: 'Watching the pick-and-place through the glass' },
    { id: 'circuit:test', position: [6.4, 5.7], yaw: EAST, anim: 'work', task: 'Reading the test rack' },
    { id: 'circuit:output', position: [10.42, 4.25], yaw: WEST, anim: 'work', task: 'Checking finished boards' },
  ],
  tank: [
    { id: 'tank:roller', position: [14.62, 15.85], yaw: SOUTH, anim: 'work', task: 'Operating the plate roller' },
    { id: 'tank:welder', position: [14.6, 10.4], yaw: face([14.6, 10.4], [TANK.welder.x, TANK.welder.z]), anim: 'work', task: 'Babysitting the welding robot' },
    { id: 'tank:gauge', position: [17.42, 7.25], yaw: face([17.42, 7.25], [TANK.gauge.x, TANK.gauge.z]), anim: 'point', task: 'Pointing at the pressure gauge' },
  ],
  payload: [
    { id: 'payload:qc', position: [5.2, ARCH.z - 1.0], yaw: WEST, anim: 'work', task: 'Scanning anyone who walks through the QC arch' },
    { id: 'payload:packing', position: [-5.0, 16.95], yaw: NORTH, anim: 'idle', task: 'Counting payload pods' },
  ],
}

/** Flat list (handy for spawning). */
export const ALL_LINE_WORKER_SPOTS: LineWorkerSpot[] = Object.values(LINE_WORKER_SPOTS).flat()
