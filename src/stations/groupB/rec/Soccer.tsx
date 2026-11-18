import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BallCollider, CuboidCollider, RigidBody, type IntersectionEnterPayload, type RapierRigidBody } from '@react-three/rapier'
import * as THREE from 'three'
import { GROUPS } from '@/core/collision'
import { registerDebug } from '@/core/debug'
import { events } from '@/core/events'
import { useInteractable } from '@/core/interaction'
import { wrapAngle, yawToward } from '@/core/math'
import { createRng } from '@/core/rng'
import { useUIStore } from '@/state/ui'
import { director } from '@/systems/director'
import { WorkerModel, type WorkerAnim, type WorkerLook } from '@/world/WorkerModel'
import { Bubble, useBubbleController, type BubbleAtlas } from '../shared/Bubble'
import { ballMaterial, soccerBallGeometry } from './balls'
import { planKick, type KickPlan } from './ballMath'
import { pickKeeperReaction, KeeperBrain, type KeeperReaction } from './keeper'
import { BALL_SPOT, GOAL, INSIDE, KEEPER_HOME, SOCCER_BALL_R } from './layout'
import { NpcCapsule } from './npcBody'
import { recScore } from './score'
import { dribble, makeBallTracker, trackBall, type BallTracker } from './tracker'

/**
 * SOCCER (spec §5.5): kick the ball at the tiny goal. The kick is aim-assisted
 * (always on target, a little random); the goal sensor (GROUPS.sensor) plus a
 * geometric fallback count goals once per attempt. The keeper (WorkerModel)
 * dives the wrong way spectacularly, flails late, punches it into his own net
 * and celebrates anyway — or, occasionally, saves it. Spectacular variants go
 * through the director (ambient gags). The ball returns to its spot after a
 * goal, when it leaves the yard, or after sitting idle 20 s away from it.
 */
const LIN_DAMP = 0.3
const ANG_DAMP = 0.9
const IDLE_RESET = 20
const GOAL_RESET = 3.2

export const KEEPER_LOOK: Partial<WorkerLook> = {
  helmet: '#2f6fb5',
  helmetStripe: '#f2f2ea',
  vest: '#57b35a',
  stripe: '#e9efe9',
  shirt: '#2b3a46',
  pants: '#262c33',
  gloves: '#f08a24',
  face: 'mustache',
}

export const KEEPER_LINES: string[][] = [
  ['I’m the goalkeeper. Also the referee. Also the groundskeeper.', 'Conflict of interest? Never heard of it.'],
  ['My strategy is to dive the opposite way.', 'It confuses everyone. Mostly me.'],
  ['Saves this season: some. Goals conceded: a lot.', 'Vibes: immaculate.'],
  ['If you score, it was the wind. There is no wind in here. Still the wind.'],
]

export const KEEPER_PHRASES = ['NOT TODAY!', 'SAVE! …OH.', 'ASSIST!', 'WIND!', 'I SLIPPED.', 'DOESN’T COUNT!']

interface Flight {
  plan: KickPlan
  reaction: KeeperReaction | null
  deflected: boolean
  scored: boolean
}

export interface SoccerDebug {
  kick: () => boolean
  setNextReaction: (r: KeeperReaction | null) => void
  resetBall: () => void
  placeBall: (x: number, z: number) => void
  state: () => Record<string, unknown>
}

export function Soccer({ atlas, reduced }: { atlas: BubbleAtlas; reduced: boolean }) {
  const rb = useRef<RapierRigidBody>(null)
  const ballMesh = useRef<THREE.Mesh>(null)
  const keeperRoot = useRef<THREE.Group>(null)
  const keeperBody = useRef<THREE.Group>(null)
  const bubbleGroup = useRef<THREE.Group>(null)
  const bubble = useBubbleController()
  const rng = useMemo(() => createRng(20251117), [])
  const brain = useMemo(() => new KeeperBrain(), [])
  const tracker = useMemo<BallTracker>(() => makeBallTracker(BALL_SPOT[0], SOCCER_BALL_R, BALL_SPOT[1]), [])
  const game = useRef({ flight: null as Flight | null, postGoal: -1, forced: null as KeeperReaction | null, pop: 1, lastBounce: 0 })
  const pose = useRef({ anim: 'idle' as WorkerAnim, speed: 0, look: null as number | null })
  const talkIdx = useRef(0)

  const resetBall = (x = BALL_SPOT[0], z = BALL_SPOT[1]) => {
    const body = rb.current
    if (!body) return
    try {
      body.setTranslation({ x, y: SOCCER_BALL_R + 0.03, z }, true)
      body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    } catch {
      return
    }
    tracker.pos.set(x, SOCCER_BALL_R, z)
    tracker.idle = 0
    tracker.skip = 3
    game.current.flight = null
    game.current.postGoal = -1
    game.current.pop = 0
  }

  const scoreGoal = () => {
    const g = game.current
    if (g.postGoal >= 0) return
    if (g.flight) g.flight.scored = true
    g.postGoal = 0
    const n = recScore.addGoal()
    brain.onGoal()
    events.emit('sfx', { name: 'goal-horn', position: [GOAL.x, 1.2, GOAL.z] })
    events.emit('toast', { text: n === 1 ? 'GOAL! Back of the net.' : `GOAL! That’s ${n} today.`, kind: 'success', duration: 3 })
    events.emit('achievement', { id: 'goal' })
    const r = g.flight?.reaction
    if (r === 'own') bubble.say(KEEPER_PHRASES[1], 2.4)
    else if (r === 'wrong') bubble.say(rng() < 0.5 ? KEEPER_PHRASES[3] : KEEPER_PHRASES[4], 2.2)
    else if (r === 'late') bubble.say(KEEPER_PHRASES[5], 2.0)
  }

  const kick = (): boolean => {
    const body = rb.current
    if (!body || game.current.postGoal >= 0) return false
    const b = tracker.pos
    const plan = planKick({ x: b.x, y: Math.max(b.y, SOCCER_BALL_R), z: b.z }, rng, LIN_DAMP)
    try {
      body.setLinvel(plan.v, true)
      body.setAngvel({ x: plan.v.z * 4, y: (rng() - 0.5) * 6, z: -plan.v.x * 4 }, true)
    } catch {
      return false
    }
    events.emit('sfx', { name: 'ball-kick', position: [b.x, 0.3, b.z] })
    let reaction: KeeperReaction | null = null
    if (plan.kind === 'shot') {
      reaction = game.current.forced ?? pickKeeperReaction(rng, recScore.goals)
      game.current.forced = null
      // gag variants need the director's blessing; otherwise a plain reaction
      let spectacular = false
      if (reaction === 'wrong') spectacular = director.request({ id: 'gag:rec-keeper-dive', kind: 'ambient', cooldown: 8, duration: 3.5 })
      if (reaction === 'own' && !director.request({ id: 'gag:rec-own-goal', kind: 'ambient', cooldown: 25, duration: 5 })) reaction = 'late'
      brain.onKick(plan.side, reaction, spectacular)
    }
    game.current.flight = { plan, reaction, deflected: false, scored: false }
    tracker.idle = 0
    return true
  }

  // --- interactables -------------------------------------------------------
  useInteractable({
    id: 'rec:soccer-ball',
    verb: 'Kick',
    label: 'Soccer Ball',
    radius: 2.0,
    priority: 1,
    getPosition: () => ({ x: tracker.pos.x, y: tracker.pos.y, z: tracker.pos.z }),
    enabled: () => game.current.postGoal < 0 && tracker.speed < 3.5 && tracker.pos.y < 0.7,
    onInteract: () => {
      kick()
    },
  })
  useInteractable({
    id: 'rec:keeper',
    verb: 'Talk',
    label: 'Moose (Goalkeeper)',
    radius: 1.9,
    priority: -0.3,
    getPosition: () => ({ x: KEEPER_HOME[0] + brain.dx, y: 0, z: KEEPER_HOME[1] }),
    enabled: () => brain.state === 'ready',
    onInteract: () => {
      const lines = KEEPER_LINES[talkIdx.current % KEEPER_LINES.length]
      talkIdx.current++
      useUIStore.getState().openDialogue({ npcId: 'rec:keeper', name: 'Moose', role: 'Goalkeeper · Staff League', lines })
    },
  })

  // --- goal sensor ------------------------------------------------------------
  const onSensor = (p: IntersectionEnterPayload) => {
    const body = rb.current
    if (body && p.other.rigidBody && p.other.rigidBody.handle === body.handle) scoreGoal()
  }

  // --- debug (dev/test builds only; no-op in production) -------------------------
  useEffect(
    () =>
      registerSoccerDebug({
        kick,
        setNextReaction: (r) => {
          game.current.forced = r
        },
        resetBall: () => resetBall(),
        placeBall: (x, z) => resetBall(x, z),
        state: () => ({
          ball: [+tracker.pos.x.toFixed(2), +tracker.pos.y.toFixed(2), +tracker.pos.z.toFixed(2)],
          speed: +tracker.speed.toFixed(2),
          idle: +tracker.idle.toFixed(1),
          keeper: brain.state,
          reaction: brain.reaction,
          goals: recScore.goals,
          postGoal: +game.current.postGoal.toFixed(2),
        }),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // --- per frame ------------------------------------------------------------------
  useFrame((_, rawDt) => {
    const dt = Math.min(Math.max(rawDt, 0), 0.1)
    const body = rb.current
    const mesh = ballMesh.current
    const g = game.current
    if (!body || !mesh) return
    const obj = mesh.parent
    if (obj) trackBall(tracker, obj.position, dt)
    const b = tracker.pos

    // pop-in after a reset
    if (g.pop < 1) {
      g.pop = Math.min(1, g.pop + dt / (reduced ? 0.05 : 0.28))
      const k = g.pop < 1 ? 0.2 + 0.8 * g.pop + Math.sin(g.pop * Math.PI) * 0.25 : 1
      mesh.scale.setScalar(k)
    }

    // keeper deflections (scripted: NPC capsules never touch balls)
    const f = g.flight
    if (f && f.reaction && !f.deflected && (f.reaction === 'save' || f.reaction === 'own') && b.z <= KEEPER_HOME[1] + 0.15 && b.z > GOAL.mouthZ - 0.2) {
      f.deflected = true
      const dir = f.plan.side
      try {
        if (f.reaction === 'save') {
          body.setLinvel({ x: dir * 3.4, y: 3.6, z: 4.6 }, true)
          brain.onSaved()
          bubble.say(KEEPER_PHRASES[0], 2.2)
          events.emit('sfx', { name: 'boing', position: [b.x, b.y, b.z], volume: 0.6 })
        } else {
          body.setLinvel({ x: -dir * 0.5, y: 4.2, z: -3.4 }, true)
          events.emit('sfx', { name: 'boing', position: [b.x, b.y, b.z], volume: 0.5 })
        }
      } catch {
        /* removed */
      }
    }

    // geometric goal check (fallback for the sensor)
    if (g.postGoal < 0 && Math.abs(b.x - GOAL.x) < GOAL.width / 2 - GOAL.post && b.z < GOAL.mouthZ - SOCCER_BALL_R && b.z > GOAL.backZ - 0.3 && b.y < GOAL.height) scoreGoal()

    // after a goal: hold, then return the ball to the spot
    if (g.postGoal >= 0) {
      g.postGoal += dt
      if (g.postGoal > GOAL_RESET) resetBall()
    } else {
      // out of the yard / fell through / NaN → reset
      const out = !Number.isFinite(b.x) || !Number.isFinite(b.z) || b.y < -1 || b.x < INSIDE.minX - 0.8 || b.x > INSIDE.maxX + 0.8 || b.z < INSIDE.minZ - 0.8 || b.z > INSIDE.maxZ + 0.8
      if (out) resetBall()
      else if (tracker.idle > IDLE_RESET) resetBall()
      // flight over: ball slow again
      if (g.flight && tracker.speed < 0.6 && b.y < SOCCER_BALL_R + 0.05) g.flight = null
    }

    // walking into the ball nudges it along (dribble)
    if (g.postGoal < 0) dribble(tracker, body, 0.68, 1.3)

    // bounce sounds
    if (tracker.bounced && tracker.impact > 1.6) {
      const now = performance.now()
      if (now - g.lastBounce > 140) {
        g.lastBounce = now
        events.emit('sfx', { name: 'ball-bounce', position: [b.x, b.y, b.z], volume: Math.min(1, tracker.impact / 7) })
      }
    }

    // keeper pose
    const kp = brain.update(dt, b.x - KEEPER_HOME[0])
    const root = keeperRoot.current
    const kb = keeperBody.current
    if (root && kb) {
      kb.position.set(-kp.dx, kp.lift, 0)
      kb.rotation.z = kp.roll
      pose.current.anim = kp.anim
      pose.current.speed = kp.speed
      if (kp.lookAtBall) {
        const kx = KEEPER_HOME[0] + kp.dx
        pose.current.look = wrapAngle(yawToward({ x: kx, z: KEEPER_HOME[1] }, { x: b.x, z: b.z }) - Math.PI)
      } else pose.current.look = null
      if (bubbleGroup.current) bubbleGroup.current.position.x = -kp.dx
    }
  })

  return (
    <group name="rec-soccer">
      <RigidBody
        ref={rb}
        type="dynamic"
        colliders={false}
        ccd
        canSleep
        linearDamping={LIN_DAMP}
        angularDamping={ANG_DAMP}
        position={[BALL_SPOT[0], SOCCER_BALL_R + 0.03, BALL_SPOT[1]]}
        name="rec-soccer-ball"
      >
        <BallCollider args={[SOCCER_BALL_R]} mass={0.43} restitution={0.55} friction={0.7} collisionGroups={GROUPS.ball} />
        <mesh ref={ballMesh} geometry={soccerBallGeometry(SOCCER_BALL_R)} material={ballMaterial()} castShadow />
      </RigidBody>
      {/* goal sensor: inside the net, below the bar */}
      <RigidBody type="fixed" colliders={false} name="rec-goal-sensor">
        <CuboidCollider
          sensor
          args={[GOAL.width / 2 - GOAL.post - 0.02, GOAL.height / 2 - 0.05, (GOAL.mouthZ - GOAL.backZ) / 2 - 0.12]}
          position={[GOAL.x, GOAL.height / 2, (GOAL.mouthZ + GOAL.backZ) / 2 - 0.08]}
          collisionGroups={GROUPS.sensor}
          onIntersectionEnter={onSensor}
        />
      </RigidBody>
      {/* goalkeeper */}
      <group ref={keeperRoot} position={[KEEPER_HOME[0], 0, KEEPER_HOME[1]]} rotation-y={Math.PI}>
        <group ref={keeperBody}>
          <WorkerModel look={KEEPER_LOOK} anim={() => pose.current.anim} speed={() => pose.current.speed} lookYaw={() => pose.current.look} seed={11} />
        </group>
        <group ref={bubbleGroup}>
          <Bubble ctrl={bubble} atlas={atlas} reduced={reduced} position={[0, 2.12, 0]} />
        </group>
      </group>
      <NpcCapsule get={() => ({ x: KEEPER_HOME[0] + brain.dx, z: KEEPER_HOME[1] })} name="rec-keeper-capsule" />
    </group>
  )
}

export function registerSoccerDebug(api: SoccerDebug): () => void {
  return registerDebug('rec', {
    kick: () => api.kick(),
    setKeeper: (r: KeeperReaction | null) => api.setNextReaction(r),
    resetBall: () => api.resetBall(),
    placeBall: (x: number, z: number) => api.placeBall(x, z),
    soccer: () => api.state(),
  })
}
