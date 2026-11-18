/**
 * Volleyball opponent brain (pure, unit-tested). Reacts to the visitor's bump:
 *
 *   return — runs under the ball and bumps it back over the net (rally!)
 *   miss   — chases the wrong way / too slowly, then disputes the point
 *   argue  — does not move at all; argues about the rules while the ball lands
 *
 * After a point he fetches the ball and lobs it back to the visitor's spot.
 * `update` returns a pose plus at most one action for the component to perform.
 */
import type { Rng } from '@/core/rng'
import type { Vec2 } from '@/core/types'
import { yawToward } from '@/core/math'
import type { WorkerAnim } from '@/world/WorkerModel'

export type OpponentReaction = 'return' | 'miss' | 'argue'
export type OpponentState = 'ready' | 'chase' | 'bump' | 'argue' | 'dispute' | 'fetch' | 'toss' | 'home'
export type OpponentAction = { kind: 'bumpBack' } | { kind: 'tossBack' } | { kind: 'say'; phrase: string } | null

export interface OpponentPose {
  anim: WorkerAnim
  x: number
  z: number
  /** Body facing (yaw). */
  yaw: number
  speed: number
  action: OpponentAction
}

export const ARGUE_PHRASES = ['ROTATION VIOLATION!', 'FOOT FAULT!', 'THAT WAS A CARRY.', 'NET TOUCH!']
export const DISPUTE_PHRASES = ['OUT!', 'THAT WAS OUT.', 'I WASN’T READY.', 'SUN IN MY EYES.']
export const RETURN_PHRASES = ['MINE!', 'GOT IT!']

const RUN = 3.4
const SLOW = 1.4

export function pickOpponentReaction(rng: Rng, rallyHits: number): OpponentReaction {
  const r = rng()
  // long rallies end eventually: he gets tired
  const ret = rallyHits >= 3 ? 0.12 : 0.42
  if (r < ret) return 'return'
  if (r < ret + (1 - ret) * 0.55) return 'miss'
  return 'argue'
}

export class OpponentBrain {
  state: OpponentState = 'ready'
  t = 0
  x: number
  z: number
  yaw = 0
  private home: Vec2
  private target: Vec2 = [0, 0]
  private speed = 0
  private pending: OpponentAction = null
  private phraseIdx = 0
  private time = 0
  reaction: OpponentReaction | null = null
  /** Where the ball came to rest (fetch target). */
  private ball: Vec2 = [0, 0]

  constructor(home: Vec2, private rng: Rng) {
    this.home = home
    this.x = home[0]
    this.z = home[1]
  }

  private enter(s: OpponentState): void {
    this.state = s
    this.t = 0
  }

  private nextPhrase(list: string[]): string {
    const p = list[(this.phraseIdx + Math.floor(this.rng() * list.length)) % list.length]
    this.phraseIdx++
    return p
  }

  /** The visitor bumped the ball; it will land at `landing` after `flight` seconds. */
  onVisitorBump(landing: Vec2, flight: number, reaction: OpponentReaction): void {
    this.reaction = reaction
    if (reaction === 'return') {
      // stand just behind the landing point, under the descending ball
      this.target = [landing[0], landing[1] + 0.2]
      const d = Math.hypot(this.target[0] - this.x, this.target[1] - this.z)
      this.speed = Math.max(RUN, d / Math.max(0.35, flight - 0.35))
      this.pending = { kind: 'say', phrase: this.nextPhrase(RETURN_PHRASES) }
      this.enter('chase')
    } else if (reaction === 'miss') {
      // commits hard to the wrong side
      const wrong = landing[0] > this.x ? -1 : 1
      this.target = [Math.max(37.4, Math.min(44.6, this.x + wrong * 1.6)), this.z + 0.3]
      this.speed = SLOW
      this.enter('chase')
    } else {
      this.pending = { kind: 'say', phrase: this.nextPhrase(ARGUE_PHRASES) }
      this.enter('argue')
    }
  }

  /** The ball is low and close: perform the return bump now. */
  bumpNow(): void {
    this.pending = { kind: 'bumpBack' }
    this.enter('bump')
  }

  /** The visitor scored: dispute it, then fetch the ball from `ballAt`. */
  onPointLost(ballAt: Vec2): void {
    this.ball = ballAt
    this.pending = { kind: 'say', phrase: this.nextPhrase(DISPUTE_PHRASES) }
    this.enter('dispute')
  }

  /** Ball landed on the visitor's side (after a return) or went elsewhere. */
  onRallyOver(): void {
    if (this.state !== 'dispute' && this.state !== 'fetch' && this.state !== 'toss') this.enter('home')
  }

  reset(): void {
    this.x = this.home[0]
    this.z = this.home[1]
    this.reaction = null
    this.pending = null
    this.enter('ready')
  }

  private moveToward(tx: number, tz: number, speed: number, dt: number): boolean {
    const dx = tx - this.x
    const dz = tz - this.z
    const d = Math.hypot(dx, dz)
    if (d < 0.05) return true
    const step = Math.min(d, speed * dt)
    this.x += (dx / d) * step
    this.z += (dz / d) * step
    this.yaw = yawToward({ x: 0, z: 0 }, { x: dx, z: dz })
    return d - step < 0.05
  }

  update(dt: number, visitor: Vec2): OpponentPose {
    const step = Math.min(Math.max(dt, 0), 0.1)
    this.t += step
    this.time += step
    let anim: WorkerAnim = 'idle'
    let speed = 0
    const faceVisitor = () => {
      this.yaw = yawToward({ x: this.x, z: this.z }, { x: visitor[0], z: visitor[1] })
    }
    switch (this.state) {
      case 'ready': {
        // bouncy ready stance, small side steps
        const tx = this.home[0] + Math.sin(this.time * 0.8) * 0.5
        this.moveToward(tx, this.home[1], 0.6, step)
        faceVisitor()
        anim = Math.abs(Math.cos(this.time * 0.8)) > 0.4 ? 'walk' : 'idle'
        speed = 0.5
        break
      }
      case 'chase': {
        const done = this.moveToward(this.target[0], this.target[1], this.speed, step)
        anim = this.speed > 2.5 ? 'run' : 'walk'
        speed = this.speed
        if (done) {
          faceVisitor()
          anim = 'idle'
          speed = 0
        }
        break
      }
      case 'bump': {
        faceVisitor()
        anim = 'carry'
        if (this.t > 0.5) this.enter('home')
        break
      }
      case 'argue': {
        faceVisitor()
        anim = 'point'
        if (this.t > 2.4) this.enter('home')
        break
      }
      case 'dispute': {
        faceVisitor()
        anim = this.t < 1.2 ? 'point' : 'idle'
        if (this.t > 1.7) this.enter('fetch')
        break
      }
      case 'fetch': {
        const done = this.moveToward(this.ball[0], this.ball[1] + 0.45, 2.2, step)
        anim = 'walk'
        speed = 2.2
        if (done || this.t > 3) {
          this.pending = { kind: 'tossBack' }
          this.enter('toss')
        }
        break
      }
      case 'toss': {
        faceVisitor()
        anim = 'kick'
        if (this.t > 0.6) this.enter('home')
        break
      }
      case 'home': {
        const done = this.moveToward(this.home[0], this.home[1], 1.8, step)
        anim = 'walk'
        speed = 1.8
        if (done) {
          this.reaction = null
          this.enter('ready')
        }
        break
      }
    }
    const action = this.pending
    this.pending = null
    return { anim, x: this.x, z: this.z, yaw: this.yaw, speed, action }
  }
}
