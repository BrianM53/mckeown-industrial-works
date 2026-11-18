/**
 * Goalkeeper brain (pure, unit-tested). Produces a pose (offset / lift / roll +
 * WorkerModel anim) per frame. Reactions are chosen when the visitor kicks:
 *
 *   wrong — dives spectacularly the wrong way (goal)
 *   late  — flails, then dives the right way far too late (goal)
 *   own   — dives the right way, palms it UP and back into his own net, and
 *           celebrates anyway (goal; the "celebrates an own goal" gag)
 *   save  — a genuine save, deflected wide (never on the visitor's first goal)
 *
 * Coordinates: `dx` is a world-x offset from the keeper's home spot; `roll` is
 * the body roll about his facing axis (positive tips the head toward +x).
 */
import type { Rng } from '@/core/rng'
import type { WorkerAnim } from '@/world/WorkerModel'

export type KeeperReaction = 'wrong' | 'late' | 'own' | 'save'
export type KeeperState = 'ready' | 'windup' | 'dive' | 'down' | 'getup' | 'celebrate' | 'sulk' | 'return'

export interface KeeperPose {
  anim: WorkerAnim
  dx: number
  lift: number
  roll: number
  /** Walking speed for the gait (m/s). */
  speed: number
  /** Look at the ball (true) or straight ahead. */
  lookAtBall: boolean
}

export const KEEPER_TIMING = {
  windupLate: 0.32,
  dive: 0.46,
  down: 0.85,
  downSpectacular: 1.35,
  getup: 0.55,
  celebrate: 1.7,
  sulk: 1.5,
  returnSpeed: 1.6,
}

/** Weighted reaction pick. The very first goal attempt can never be saved. */
export function pickKeeperReaction(rng: Rng, goalsSoFar: number): KeeperReaction {
  const r = rng()
  if (goalsSoFar === 0) return r < 0.6 ? 'wrong' : r < 0.85 ? 'late' : 'own'
  if (r < 0.42) return 'wrong'
  if (r < 0.62) return 'late'
  if (r < 0.8) return 'own'
  return 'save'
}

const easeOut = (p: number) => 1 - (1 - p) * (1 - p)
const clamp01 = (p: number) => (p < 0 ? 0 : p > 1 ? 1 : p)

export class KeeperBrain {
  state: KeeperState = 'ready'
  t = 0
  reaction: KeeperReaction | null = null
  /** World-x direction of the dive. */
  dir: -1 | 1 = 1
  spectacular = false
  /** Post-flight outcome known? (goal / saved) */
  private outcome: 'goal' | 'saved' | null = null
  private landDx = 0
  private landRoll = 0
  dx = 0
  private time = 0

  /** Visitor kicked toward world side `shotSide`. */
  onKick(shotSide: -1 | 1, reaction: KeeperReaction, spectacular: boolean): void {
    this.reaction = reaction
    this.spectacular = spectacular
    this.dir = reaction === 'wrong' ? ((-shotSide) as -1 | 1) : shotSide
    this.outcome = null
    this.enter(reaction === 'late' ? 'windup' : 'dive')
  }

  onGoal(): void {
    this.outcome = 'goal'
  }

  onSaved(): void {
    this.outcome = 'saved'
  }

  /** Is he currently mid-dive with hands where the ball is crossing? */
  get reaching(): boolean {
    return this.state === 'dive' && this.t > KEEPER_TIMING.dive * 0.35
  }

  /** Reset to the ready stance (debug / ball reset). */
  reset(): void {
    this.enter('ready')
    this.reaction = null
    this.outcome = null
    this.dx = 0
  }

  private enter(s: KeeperState): void {
    this.state = s
    this.t = 0
  }

  update(dt: number, ballDx: number): KeeperPose {
    const T = KEEPER_TIMING
    const step = Math.min(Math.max(dt, 0), 0.1)
    this.t += step
    this.time += step
    switch (this.state) {
      case 'ready': {
        // shuffle side to side, shading toward the ball
        const want = Math.max(-0.6, Math.min(0.6, ballDx * 0.18)) + Math.sin(this.time * 1.3) * 0.22
        const prev = this.dx
        this.dx += (want - this.dx) * Math.min(1, step * 3)
        const v = Math.abs(this.dx - prev) / Math.max(step, 1e-3)
        return { anim: v > 0.25 ? 'walk' : 'idle', dx: this.dx, lift: 0, roll: 0, speed: v, lookAtBall: true }
      }
      case 'windup': {
        if (this.t >= T.windupLate) this.enter('dive')
        return { anim: 'panic', dx: this.dx, lift: 0, roll: 0, speed: 0, lookAtBall: true }
      }
      case 'dive': {
        const reach = this.spectacular ? 1.95 : 1.45
        const p = clamp01(this.t / T.dive)
        const e = easeOut(p)
        const dx = this.dx + this.dir * reach * e
        const lift = (this.spectacular ? 0.75 : 0.5) * Math.sin(Math.PI * p) + 0.08 * p
        const roll = this.dir * 1.35 * easeOut(clamp01(p * 1.25))
        if (p >= 1) {
          this.landDx = dx
          this.landRoll = roll
          this.enter('down')
        }
        return { anim: 'cheer', dx, lift, roll, speed: 0, lookAtBall: true }
      }
      case 'down': {
        const dur = this.spectacular ? T.downSpectacular : T.down
        let roll = this.landRoll
        let dx = this.landDx
        if (this.spectacular) {
          // barrel-roll along the turf after landing
          const p = clamp01(this.t / (dur * 0.7))
          roll = this.landRoll + this.dir * Math.PI * 2 * easeOut(p)
          dx = this.landDx + this.dir * 0.85 * easeOut(p)
        }
        if (this.t >= dur) {
          this.landDx = dx
          this.landRoll = this.dir * 1.35
          this.enter('getup')
        }
        return { anim: this.spectacular && this.t < dur * 0.7 ? 'tumble' : 'idle', dx, lift: 0.04, roll, speed: 0, lookAtBall: false }
      }
      case 'getup': {
        const p = easeOut(clamp01(this.t / T.getup))
        if (this.t >= T.getup) {
          this.dx = this.landDx
          if (this.outcome === 'saved' || (this.reaction === 'own' && this.outcome === 'goal')) this.enter('celebrate')
          else this.enter('sulk')
        }
        return { anim: 'idle', dx: this.landDx, lift: 0, roll: this.landRoll * (1 - p), speed: 0, lookAtBall: false }
      }
      case 'celebrate': {
        if (this.t >= T.celebrate) this.enter(this.outcome === 'goal' ? 'sulk' : 'return')
        return { anim: 'cheer', dx: this.dx, lift: 0, roll: 0, speed: 0, lookAtBall: false }
      }
      case 'sulk': {
        if (this.t >= T.sulk) this.enter('return')
        return { anim: this.reaction === 'own' ? 'idle' : 'point', dx: this.dx, lift: 0, roll: 0, speed: 0, lookAtBall: this.reaction !== 'own' }
      }
      case 'return': {
        const sgn = Math.sign(-this.dx)
        const move = Math.min(Math.abs(this.dx), T.returnSpeed * step)
        this.dx += sgn * move
        if (Math.abs(this.dx) < 0.02) {
          this.dx = 0
          this.reaction = null
          this.enter('ready')
        }
        return { anim: 'walk', dx: this.dx, lift: 0, roll: 0, speed: T.returnSpeed, lookAtBall: true }
      }
    }
  }
}
