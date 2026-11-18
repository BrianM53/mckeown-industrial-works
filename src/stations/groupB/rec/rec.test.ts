import { describe, expect, it } from 'vitest'
import { createRng } from '@/core/rng'
import { WAYPOINTS, ZONES } from '@/world/layout'
import { pointInCollider } from '../shared/colliders'
import { G, heightAt, planKick, solveLob, type V3 } from './ballMath'
import { recColliders } from './colliders'
import { KeeperBrain, pickKeeperReaction } from './keeper'
import { BALL_SPOT, FENCE, GATE, GOAL, INSIDE, KEEPER_HOME, NET, OPPONENT_HOME, RULES_INTERACT, VOLLEY_SPOT } from './layout'
import { OpponentBrain, pickOpponentReaction } from './opponent'
import { digits, recScore, scoreLine } from './score'

const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z })

describe('Rec Yard layout', () => {
  const colliders = recColliders()

  it('fences the yard but leaves the west gate open', () => {
    const gateMid = (GATE.z0 + GATE.z1) / 2
    for (let z = GATE.z0 + 0.5; z <= GATE.z1 - 0.5; z += 0.2)
      for (const c of colliders) expect(pointInCollider(c, GATE.x, z, 0.36), `${c.id} blocks the gate at z=${z}`).toBe(false)
    expect(gateMid).toBeCloseTo(ZONES.rec.entrance[1], 0)
    expect(GATE.z1 - GATE.z0).toBeGreaterThanOrEqual(4)
    expect(FENCE.length).toBeGreaterThanOrEqual(5)
  })

  it('keeps the gate waypoint segment and every interaction spot clear', () => {
    const a = WAYPOINTS.recGate.position
    const b = WAYPOINTS.recInside.position
    for (let k = 0; k <= 30; k++) {
      const x = a[0] + ((b[0] - a[0]) * k) / 30
      const z = a[1] + ((b[1] - a[1]) * k) / 30
      for (const c of colliders) expect(pointInCollider(c, x, z, 0.4), `${c.id} blocks the rec waypoint segment`).toBe(false)
    }
    for (const [x, z] of [BALL_SPOT, VOLLEY_SPOT, RULES_INTERACT, KEEPER_HOME, OPPONENT_HOME])
      for (const c of colliders) expect(pointInCollider(c, x, z, 0.3), `${c.id} covers ${x},${z}`).toBe(false)
  })
})

describe('Rec Yard ball physics helpers', () => {
  it('aim-assisted kicks from the spot always fly between the posts and under the bar', () => {
    const rng = createRng(3)
    const inner = GOAL.width / 2 - GOAL.post
    for (let i = 0; i < 200; i++) {
      const ball = v3(BALL_SPOT[0] + (rng() - 0.5) * 6, 0.11, BALL_SPOT[1] + (rng() - 0.5) * 4)
      const plan = planKick(ball, rng)
      expect(plan.kind).toBe('shot')
      const t = (GOAL.mouthZ - ball.z) / plan.v.z
      expect(t).toBeGreaterThan(0)
      const x = ball.x + plan.v.x * t
      const y = heightAt(ball, plan.v, t)
      expect(Math.abs(x - GOAL.x)).toBeLessThan(inner)
      expect(y).toBeGreaterThan(0)
      expect(y).toBeLessThan(GOAL.height)
    }
  })

  it('clears the ball back toward the spot when kicked from behind the goal', () => {
    const plan = planKick(v3(GOAL.x, 0.11, GOAL.backZ - 0.5), createRng(1))
    expect(plan.kind).toBe('clear')
    expect(Math.hypot(plan.target.x - BALL_SPOT[0], plan.target.z - BALL_SPOT[1])).toBeLessThan(1.5)
  })

  it('lobs land on target (volleyball arcs over the net)', () => {
    const from = v3(NET.x, 1.0, -10.6)
    const to = v3(NET.x + 1, 0.1, -6.2)
    const f = solveLob(from, to, NET.top + 1.4)
    expect(from.x + f.v.x * f.t).toBeCloseTo(to.x, 5)
    expect(from.z + f.v.z * f.t).toBeCloseTo(to.z, 5)
    expect(heightAt(from, f.v, f.t)).toBeCloseTo(to.y, 5)
    const tNet = (NET.z - from.z) / f.v.z
    expect(heightAt(from, f.v, tNet)).toBeGreaterThan(NET.top)
    expect(G).toBe(18)
  })

  it('keeps the play area inside the fence', () => {
    for (const [x, z] of [BALL_SPOT, VOLLEY_SPOT, KEEPER_HOME, OPPONENT_HOME]) {
      expect(x).toBeGreaterThan(INSIDE.minX)
      expect(x).toBeLessThan(INSIDE.maxX)
      expect(z).toBeGreaterThan(INSIDE.minZ)
      expect(z).toBeLessThan(INSIDE.maxZ)
    }
  })
})

describe('Rec Yard NPC brains & score', () => {
  it('never saves the first goal attempt', () => {
    const rng = createRng(11)
    for (let i = 0; i < 300; i++) expect(pickKeeperReaction(rng, 0)).not.toBe('save')
    const seen = new Set<string>()
    for (let i = 0; i < 300; i++) seen.add(pickKeeperReaction(rng, 2))
    expect(seen).toEqual(new Set(['wrong', 'late', 'own', 'save']))
  })

  it('keeper dives, gets up and returns home without NaNs', () => {
    const k = new KeeperBrain()
    k.onKick(1, 'wrong', true)
    for (let i = 0; i < 60 * 8; i++) {
      const p = k.update(1 / 60, 0.5)
      expect(Number.isFinite(p.dx + p.lift + p.roll + p.speed)).toBe(true)
      if (i === 60) k.onGoal()
    }
    expect(k.state).toBe('ready')
  })

  it('opponent returns rallies sometimes and tires in long rallies', () => {
    const rng = createRng(5)
    let early = 0
    let late = 0
    for (let i = 0; i < 1000; i++) {
      if (pickOpponentReaction(rng, 0) === 'return') early++
      if (pickOpponentReaction(rng, 5) === 'return') late++
    }
    expect(early).toBeGreaterThan(late)
    expect(late).toBeGreaterThan(0)
    const o = new OpponentBrain(OPPONENT_HOME, createRng(2))
    o.onVisitorBump([NET.x, -6.2], 1.2, 'argue')
    for (let i = 0; i < 60 * 10; i++) {
      const p = o.update(1 / 60, [NET.x, -10.6])
      expect(Number.isFinite(p.x + p.z + p.yaw)).toBe(true)
    }
  })

  it('formats the scoreboard and notifies listeners', () => {
    expect(scoreLine(3, 12)).toBe('GOALS 3 · POINTS 12')
    expect(scoreLine(-1, 0.6)).toBe('GOALS 0 · POINTS 0')
    expect(digits(7)).toBe(' 7')
    expect(digits(150)).toBe('99')
    let n = 0
    const off = recScore.subscribe(() => n++)
    recScore.reset()
    recScore.addGoal()
    recScore.addPoint()
    off()
    recScore.addGoal()
    expect(n).toBe(3)
    expect(recScore.goals).toBe(2)
    recScore.reset()
  })
})
