/**
 * Where does the worker step out of the forklift? Pure candidate generation +
 * selection (unit-tested); the physics overlap test is injected.
 *
 * Order: driver side (left) at the seat, right side, behind the counterweight,
 * in front of the forks, then the four diagonals, then two rings further out.
 */
import { FORKLIFT } from '../constants'
import { localToWorld, type Pose2 } from './geometry2d'

export type ExitSide = 'left' | 'right' | 'back' | 'front' | 'left-front' | 'left-back' | 'right-front' | 'right-back' | 'ring'

export interface ExitSpot {
  x: number
  z: number
  side: ExitSide
}

export interface ExitDims {
  /** Lateral distance from the centerline to the worker's center. */
  side: number
  /** Distance behind the origin (past the counterweight). */
  back: number
  /** Distance ahead of the origin (past the fork tips). */
  front: number
  /** Forward offset of the seat (negative = behind the origin). */
  seatForward: number
  rings: number[]
  ringSteps: number
}

const PLAYER_RADIUS = 0.35
const CLEARANCE = 0.32

export const EXIT_DIMS: ExitDims = {
  side: FORKLIFT.halfWidth + PLAYER_RADIUS + CLEARANCE,
  back: FORKLIFT.rearZ + PLAYER_RADIUS + CLEARANCE,
  front: -FORKLIFT.frontZ + PLAYER_RADIUS + CLEARANCE,
  seatForward: -FORKLIFT.seatZ,
  rings: [3.0, 3.9],
  ringSteps: 12,
}

export function exitCandidates(pose: Pose2, d: ExitDims = EXIT_DIMS): ExitSpot[] {
  const out: ExitSpot[] = []
  const at = (side: ExitSide, right: number, forward: number) => {
    const [x, z] = localToWorld(pose, right, forward)
    out.push({ x, z, side })
  }
  at('left', -d.side, d.seatForward)
  at('right', d.side, d.seatForward)
  at('back', 0, -d.back)
  at('front', 0, d.front)
  at('left-back', -d.side, -d.back * 0.85)
  at('right-back', d.side, -d.back * 0.85)
  at('left-front', -d.side, d.front * 0.75)
  at('right-front', d.side, d.front * 0.75)
  for (const r of d.rings) {
    for (let i = 0; i < d.ringSteps; i++) {
      // start on the driver's (left) side and sweep around (right = cos a, forward = sin a)
      const a = Math.PI + (i * Math.PI * 2) / d.ringSteps
      at('ring', Math.cos(a) * r, Math.sin(a) * r)
    }
  }
  return out
}

/**
 * First candidate accepted by `accept` (bounds / restricted zones) that is
 * physically free. Returns null when nothing works (caller falls back to the
 * nearest checkpoint).
 */
export function chooseExitSpot(
  candidates: ExitSpot[],
  isFree: (x: number, z: number) => boolean,
  accept: (x: number, z: number) => boolean = () => true,
): ExitSpot | null {
  for (const c of candidates) {
    if (!Number.isFinite(c.x) || !Number.isFinite(c.z)) continue
    if (!accept(c.x, c.z)) continue
    if (isFree(c.x, c.z)) return c
  }
  return null
}
