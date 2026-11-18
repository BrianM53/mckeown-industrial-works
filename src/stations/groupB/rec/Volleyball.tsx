import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BallCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import * as THREE from 'three'
import { GROUPS } from '@/core/collision'
import { registerDebug } from '@/core/debug'
import { events } from '@/core/events'
import { useInteractable } from '@/core/interaction'
import { createRng } from '@/core/rng'
import { runtime } from '@/core/runtime'
import type { Vec2 } from '@/core/types'
import { useUIStore } from '@/state/ui'
import { director } from '@/systems/director'
import { WorkerModel, type WorkerAnim, type WorkerLook } from '@/world/WorkerModel'
import { Bubble, useBubbleController, type BubbleAtlas } from '../shared/Bubble'
import { ballMaterial, volleyBallGeometry } from './balls'
import { G, randomIn, solveLob, type V3 } from './ballMath'
import { COURT, FAR_TARGET, INSIDE, NEAR_TARGET, NET, OPPONENT_HOME, VOLLEY_BALL_R, VOLLEY_SPOT } from './layout'
import { NpcCapsule } from './npcBody'
import { OpponentBrain, pickOpponentReaction, type OpponentReaction } from './opponent'
import { recScore } from './score'
import { dribble, makeBallTracker, trackBall } from './tracker'

/**
 * VOLLEYBALL (spec §5.5): bump the ball over the net with forgiving, scripted
 * lobs. A landing on the far side scores a "Point!" (achievement 'volley').
 * The opponent (WorkerModel) sometimes returns it (rally), sometimes chases the
 * wrong way, sometimes just argues about the rules (speech bubble; talk to him
 * for the full lecture). Nothing can get stuck: out-of-yard or forgotten balls
 * return to their spot.
 */
const LIN_DAMP = 0.08
const ANG_DAMP = 1.1
const IDLE_RESET = 20
const BUMP_HEIGHT = 1.15

export const OPPONENT_LOOK: Partial<WorkerLook> = {
  helmet: '#D9483B',
  helmetStripe: '#f4efe2',
  vest: '#4F86A8',
  stripe: '#e8edf0',
  shirt: '#e3dccb',
  pants: '#3a3f47',
  face: 'glasses',
}

export const OPPONENT_LINES: string[][] = [
  ['Staff league rules: the ball is IN if I touched it.', 'It is OUT if you touched it.', 'Glad we cleared that up.'],
  ['That last point is under review.', 'The review board is me. The review is pending. Indefinitely.'],
  ['I was all-conference in the Thursday lunch league.', 'There is one team in the Thursday lunch league.'],
  ['Bump it over the net and I will demonstrate my patented “wasn’t ready” defense.'],
]

interface VFlight {
  by: 'visitor' | 'opponent' | 'toss'
  fromSide: 'near' | 'far'
  t: number
  T: number
  returned: boolean
}

function lobTo(from: V3, to: Vec2, apex: number): ReturnType<typeof solveLob> {
  return solveLob(from, { x: to[0], y: VOLLEY_BALL_R, z: to[1] }, apex, LIN_DAMP)
}

/** Where a lob is at bump height on the way down (opponent's intercept point). */
function interceptPoint(from: V3, v: V3, h: number): Vec2 {
  const disc = v.y * v.y - 2 * G * (h - from.y)
  const t = disc > 0 ? (v.y + Math.sqrt(disc)) / G : v.y / G
  return [from.x + v.x * t, from.z + v.z * t]
}

export function Volleyball({ atlas, reduced }: { atlas: BubbleAtlas; reduced: boolean }) {
  const rb = useRef<RapierRigidBody>(null)
  const ballMesh = useRef<THREE.Mesh>(null)
  const oppRoot = useRef<THREE.Group>(null)
  const bubble = useBubbleController()
  const rng = useMemo(() => createRng(7041), [])
  const brain = useMemo(() => new OpponentBrain(OPPONENT_HOME, createRng(99)), [])
  const tracker = useMemo(() => makeBallTracker(VOLLEY_SPOT[0], VOLLEY_BALL_R, VOLLEY_SPOT[1]), [])
  const game = useRef({ flight: null as VFlight | null, rally: 0, forced: null as OpponentReaction | null, pop: 1, lastBounce: 0, lastPointAt: -10 })
  const pose = useRef({ anim: 'idle' as WorkerAnim, speed: 0 })
  const talkIdx = useRef(0)

  const resetBall = (x = VOLLEY_SPOT[0], z = VOLLEY_SPOT[1]) => {
    const body = rb.current
    if (!body) return
    try {
      body.setTranslation({ x, y: VOLLEY_BALL_R + 0.03, z }, true)
      body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    } catch {
      return
    }
    tracker.pos.set(x, VOLLEY_BALL_R, z)
    tracker.idle = 0
    tracker.skip = 3
    game.current.flight = null
    game.current.rally = 0
    game.current.pop = 0
    brain.onRallyOver()
  }

  const launch = (to: Vec2, apex: number, by: VFlight['by']): number => {
    const body = rb.current
    if (!body) return 0
    const b = tracker.pos
    const from = { x: b.x, y: Math.max(b.y, VOLLEY_BALL_R), z: b.z }
    const f = lobTo(from, to, apex)
    try {
      body.setLinvel(f.v, true)
      body.setAngvel({ x: (rng() - 0.5) * 8, y: (rng() - 0.5) * 8, z: (rng() - 0.5) * 8 }, true)
    } catch {
      return 0
    }
    game.current.flight = { by, fromSide: b.z < NET.z ? 'near' : 'far', t: 0, T: f.t, returned: false }
    tracker.idle = 0
    return f.t
  }

  const bump = (): boolean => {
    if (!rb.current || tracker.speed > 7) return false
    const b = tracker.pos
    const near = b.z < NET.z
    const target = randomIn(near ? FAR_TARGET : NEAR_TARGET, rng)
    const apex = NET.top + 1.35 + rng() * 0.5
    const from = { x: b.x, y: Math.max(b.y, VOLLEY_BALL_R), z: b.z }
    const f = lobTo(from, target, apex)
    const T = launch(target, apex, 'visitor')
    if (T <= 0) return false
    events.emit('sfx', { name: 'ball-kick', position: [b.x, 0.6, b.z], volume: 0.7, rate: 1.35 })
    game.current.rally++
    if (near) {
      let reaction = game.current.forced ?? pickOpponentReaction(rng, game.current.rally)
      game.current.forced = null
      if (reaction === 'argue' && !director.request({ id: 'gag:rec-rules-argument', kind: 'ambient', cooldown: 12, duration: 3 })) reaction = 'miss'
      const spot = reaction === 'return' ? interceptPoint(from, f.v, BUMP_HEIGHT) : target
      brain.onVisitorBump(spot, f.t, reaction)
    }
    return true
  }

  useInteractable({
    id: 'rec:volleyball',
    verb: 'Bump',
    label: 'Volleyball',
    radius: 2.2,
    priority: 1,
    getPosition: () => ({ x: tracker.pos.x, y: tracker.pos.y, z: tracker.pos.z }),
    enabled: () => tracker.pos.y < 1.6 && (game.current.flight === null || game.current.flight.by === 'opponent' || game.current.flight.by === 'toss'),
    onInteract: () => {
      bump()
    },
  })
  useInteractable({
    id: 'rec:opponent',
    verb: 'Talk',
    label: 'Rhonda (Volleyball Captain)',
    radius: 1.9,
    priority: -0.3,
    getPosition: () => ({ x: brain.x, y: 0, z: brain.z }),
    enabled: () => brain.state === 'ready',
    onInteract: () => {
      const lines = OPPONENT_LINES[talkIdx.current % OPPONENT_LINES.length]
      talkIdx.current++
      useUIStore.getState().openDialogue({ npcId: 'rec:opponent', name: 'Rhonda', role: 'Volleyball Captain · Rules Committee', lines })
    },
  })

  useEffect(
    () =>
      registerDebug('rec', {
        bump: () => bump(),
        setOpponent: (r: OpponentReaction | null) => {
          game.current.forced = r
        },
        resetVolleyball: () => resetBall(),
        placeVolleyball: (x: number, z: number) => resetBall(x, z),
        volley: () => ({
          ball: [+tracker.pos.x.toFixed(2), +tracker.pos.y.toFixed(2), +tracker.pos.z.toFixed(2)],
          flight: game.current.flight?.by ?? null,
          opponent: brain.state,
          reaction: brain.reaction,
          points: recScore.points,
          rally: game.current.rally,
        }),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  useFrame((_, rawDt) => {
    const dt = Math.min(Math.max(rawDt, 0), 0.1)
    const body = rb.current
    const mesh = ballMesh.current
    const g = game.current
    if (!body || !mesh) return
    if (mesh.parent) trackBall(tracker, mesh.parent.position, dt)
    const b = tracker.pos

    if (g.pop < 1) {
      g.pop = Math.min(1, g.pop + dt / (reduced ? 0.05 : 0.28))
      mesh.scale.setScalar(g.pop < 1 ? 0.2 + 0.8 * g.pop + Math.sin(g.pop * Math.PI) * 0.25 : 1)
    }

    // opponent return bump: ball descending near his hands
    const f = g.flight
    if (f) {
      f.t += dt
      if (f.by === 'visitor' && brain.reaction === 'return' && !f.returned && tracker.vel.y < 0 && b.y < 1.75 && b.y > 0.45 && b.z > NET.z) {
        if (Math.hypot(b.x - brain.x, b.z - brain.z) < 1.15) {
          f.returned = true
          brain.bumpNow()
          launch(randomIn(NEAR_TARGET, rng), NET.top + 1.2 + rng() * 0.4, 'opponent')
          events.emit('sfx', { name: 'ball-kick', position: [b.x, b.y, b.z], volume: 0.6, rate: 1.4 })
        }
      }
    }

    // landing
    const flight = g.flight
    if (flight && flight.t > 0.3 && b.y < VOLLEY_BALL_R + 0.09 && (tracker.bounced || tracker.vel.y > -0.5)) {
      const side = b.z > NET.z ? 'far' : 'near'
      const inCourt = b.x > COURT.minX - 0.5 && b.x < COURT.maxX + 0.5 && b.z > COURT.minZ - 0.5 && b.z < COURT.maxZ + 0.5
      if (flight.by === 'visitor' && side !== flight.fromSide) {
        if (inCourt) {
          const n = recScore.addPoint()
          g.lastPointAt = performance.now()
          events.emit('toast', { text: n === 1 ? 'Point! Over the net.' : `Point! That’s ${n}.`, kind: 'success', duration: 2.6 })
          events.emit('achievement', { id: 'volley' })
          events.emit('sfx', { name: 'cheer', position: [b.x, 1, b.z], volume: 0.45 })
        }
        if (side === 'far') brain.onPointLost([b.x, b.z])
        else brain.onRallyOver()
        g.rally = 0
      } else if (flight.by === 'opponent') {
        brain.onRallyOver()
      }
      g.flight = null
    }
    if (g.flight && g.flight.t > g.flight.T + 4) g.flight = null

    // brain
    const op = brain.update(dt, [runtime.player.position.x, runtime.player.position.z])
    if (op.action) {
      if (op.action.kind === 'say') bubble.say(op.action.phrase, 2.1)
      else if (op.action.kind === 'tossBack') {
        // only if the ball is still on his side and within reach
        if (b.z > NET.z && Math.hypot(b.x - brain.x, b.z - brain.z) < 2.2) {
          launch(VOLLEY_SPOT, NET.top + 0.9, 'toss')
          events.emit('sfx', { name: 'ball-kick', position: [b.x, 0.4, b.z], volume: 0.5 })
        }
      }
    }
    const root = oppRoot.current
    if (root) {
      root.position.set(op.x, 0, op.z)
      root.rotation.y = op.yaw
      pose.current.anim = op.anim
      pose.current.speed = op.speed
    }

    // resets
    const out = !Number.isFinite(b.x) || !Number.isFinite(b.z) || b.y < -1 || b.x < INSIDE.minX - 0.8 || b.x > INSIDE.maxX + 0.8 || b.z < INSIDE.minZ - 0.8 || b.z > INSIDE.maxZ + 0.8
    if (out || tracker.idle > IDLE_RESET) resetBall()

    dribble(tracker, body, 0.64, 1.2)

    if (tracker.bounced && tracker.impact > 1.4) {
      const now = performance.now()
      if (now - g.lastBounce > 140) {
        g.lastBounce = now
        events.emit('sfx', { name: 'ball-bounce', position: [b.x, b.y, b.z], volume: Math.min(0.9, tracker.impact / 8), rate: 1.15 })
      }
    }
  })

  return (
    <group name="rec-volleyball">
      <RigidBody
        ref={rb}
        type="dynamic"
        colliders={false}
        ccd
        canSleep
        linearDamping={LIN_DAMP}
        angularDamping={ANG_DAMP}
        position={[VOLLEY_SPOT[0], VOLLEY_BALL_R + 0.03, VOLLEY_SPOT[1]]}
        name="rec-volleyball"
      >
        <BallCollider args={[VOLLEY_BALL_R]} mass={0.27} restitution={0.62} friction={0.6} collisionGroups={GROUPS.ball} />
        <mesh ref={ballMesh} geometry={volleyBallGeometry(VOLLEY_BALL_R)} material={ballMaterial()} castShadow />
      </RigidBody>
      <group ref={oppRoot} position={[OPPONENT_HOME[0], 0, OPPONENT_HOME[1]]}>
        <WorkerModel look={OPPONENT_LOOK} anim={() => pose.current.anim} speed={() => pose.current.speed} seed={23} />
        <Bubble ctrl={bubble} atlas={atlas} reduced={reduced} position={[0, 2.12, 0]} />
      </group>
      <NpcCapsule get={() => ({ x: brain.x, z: brain.z })} name="rec-opponent-capsule" />
    </group>
  )
}
