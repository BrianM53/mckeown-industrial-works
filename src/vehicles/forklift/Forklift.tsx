import { createRef, memo, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BallCollider,
  CoefficientCombineRule,
  CuboidCollider,
  RigidBody,
  useAfterPhysicsStep,
  useBeforePhysicsStep,
  useRapier,
  type RapierRigidBody,
} from '@react-three/rapier'
import * as THREE from 'three'
import { actions } from '@/core/actions'
import { simClock } from '@/core/clock'
import { GROUPS } from '@/core/collision'
import { registerDebug } from '@/core/debug'
import { useInteractable } from '@/core/interaction'
import { clamp, damp } from '@/core/math'
import { runtime } from '@/core/runtime'
import { provideService } from '@/core/services'
import { PLAYER_LOOK } from '@/player/constants'
import { useGameStore } from '@/state/game'
import { useSettings } from '@/state/settings'
import { useUIStore } from '@/state/ui'
import { textures } from '@/world/materials'
import { WorkerModel } from '@/world/WorkerModel'
import { FORKLIFT, HOME } from '../constants'
import type { PuffPool } from '../fx/Puffs'
import { rearWheelAngle } from '../logic/drive'
import { ForkliftSystem } from './ForkliftSystem'
import { BEACON_POS, EXHAUST_TIP, STEERING, forkliftAssets } from './model'

/**
 * The drivable company forklift: dynamic Rapier body (compound colliders,
 * frictionless wheel balls — the arcade controller owns traction), procedural
 * visuals, seated driver, beacon, exhaust, interactables, service + debug.
 */

const START_POS: [number, number, number] = [HOME.x, 0.03, HOME.z]
const START_ROT: [number, number, number] = [0, HOME.yaw, 0]
const M = FORKLIFT.mass
const FB = FORKLIFT.frontBall
const RB = FORKLIFT.rearBall
const MIN = CoefficientCombineRule.Min

const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _qs = new THREE.Quaternion()
const _qx = new THREE.Quaternion()
const _m = new THREE.Matrix4()
const X_AXIS = new THREE.Vector3(1, 0, 0)
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const BEACON_ON = new THREE.Color('#FFB23F')
const _beacon = new THREE.Color()
const NO_RAYCAST = () => {}

/** Wheel layout: [x, z, radius, width, rear?] (left wheels are mirrored by a half turn). */
const WHEELS: Array<[number, number, number, number, boolean]> = [
  [-FORKLIFT.frontWheel.x, FORKLIFT.frontAxleZ, FORKLIFT.frontWheel.r, FORKLIFT.frontWheel.w, false],
  [FORKLIFT.frontWheel.x, FORKLIFT.frontAxleZ, FORKLIFT.frontWheel.r, FORKLIFT.frontWheel.w, false],
  [-FORKLIFT.rearWheel.x, FORKLIFT.rearAxleZ, FORKLIFT.rearWheel.r, FORKLIFT.rearWheel.w, true],
  [FORKLIFT.rearWheel.x, FORKLIFT.rearAxleZ, FORKLIFT.rearWheel.r, FORKLIFT.rearWheel.w, true],
]

interface VisualRefs {
  anchor: RefObject<THREE.Object3D | null>
  wobble: RefObject<THREE.Group | null>
  carriage: RefObject<THREE.Group | null>
  steering: RefObject<THREE.Mesh | null>
  wheels: RefObject<THREE.InstancedMesh | null>
  driver: RefObject<THREE.Group | null>
  halo: RefObject<THREE.Sprite | null>
  visual: RefObject<THREE.Group | null>
}

export function Forklift({ puffs }: { puffs: PuffPool }) {
  const [sys] = useState(() => new ForkliftSystem())
  const { world, rapier } = useRapier()
  const bodyRef = useRef<RapierRigidBody>(null)
  // one stable container (the memoized body below must not re-render every frame)
  const [refs] = useState<VisualRefs>(() => ({
    anchor: createRef<THREE.Object3D>(),
    wobble: createRef<THREE.Group>(),
    carriage: createRef<THREE.Group>(),
    steering: createRef<THREE.Mesh>(),
    wheels: createRef<THREE.InstancedMesh>(),
    driver: createRef<THREE.Group>(),
    halo: createRef<THREE.Sprite>(),
    visual: createRef<THREE.Group>(),
  }))
  const quality = useGameStore((s) => s.quality)
  const beaconMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#5a3a10', name: 'vehicles:beacon' }), [])
  const haloMat = useMemo(
    () =>
      new THREE.SpriteMaterial({
        map: textures.glowDot(),
        color: '#FFB547',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        name: 'vehicles:beacon-halo',
      }),
    [],
  )
  useEffect(
    () => () => {
      beaconMat.dispose()
      haloMat.dispose()
    },
    [beaconMat, haloMat],
  )

  useEffect(() => {
    sys.attach(world, rapier)
  }, [sys, world, rapier])

  // Services, actions, debug, sim-clock guard, keyboard. StrictMode-safe.
  useEffect(() => {
    sys.mount()
    sys.puffs = puffs
    const offs: Array<() => void> = [
      provideService('forklift', sys.service()),
      registerDebug('forklift', sys.debugApi()),
      actions.on('horn', () => sys.horn()),
      simClock.onTick((dt) => sys.tick(dt)),
      sys.input.attach(),
      // a panel opening mid-drive drops the held keys (no runaway forklift on close)
      useUIStore.subscribe((s, prev) => {
        if ((s.panel && !prev.panel) || (s.dialogue && !prev.dialogue)) sys.input.clear()
      }),
    ]
    return () => {
      for (const off of offs) off()
      sys.dispose()
    }
  }, [sys, puffs])

  useBeforePhysicsStep((w) => {
    sys.body = bodyRef.current
    try {
      sys.step(w.timestep)
    } catch (err) {
      console.error('[vehicles] forklift step failed', err)
    }
  })
  useAfterPhysicsStep(() => {
    try {
      sys.afterStep()
    } catch (err) {
      console.error('[vehicles] forklift after-step failed', err)
    }
  })

  useInteractable({
    id: 'forklift',
    label: 'Forklift',
    get verb() {
      return sys.needsUpright ? 'Upright' : 'Drive'
    },
    modes: ['foot'],
    radius: 3,
    priority: 1,
    getPosition: () => runtime.forklift.position,
    enabled: () => !sys.occupied,
    onInteract: () => {
      sys.enter()
    },
  })
  useInteractable({
    id: 'forklift-exit',
    label: 'Forklift',
    verb: 'Exit',
    modes: ['forklift'],
    radius: 999,
    priority: 5,
    getPosition: () => runtime.forklift.position,
    enabled: () => sys.occupied,
    onInteract: () => {
      sys.exit()
    },
  })

  const anim = useRef({ spinF: 0, spinR: 0, prevSpeed: 0, accel: 0, pitch: 0, pitchV: 0, roll: 0, rollV: 0, fork: FORKLIFT.forkParked as number, beacon: 0, t: 0, look: 0, boundsDone: false, rayOff: false })

  useFrame((_, dtRaw) => {
    const dt = clamp(Number.isFinite(dtRaw) ? dtRaw : 0, 0, 0.1)
    const anchor = refs.anchor.current
    sys.group = anchor?.parent ?? null
    sys.frame(dt)
    const a = anim.current
    a.t += dt
    const reduced = !!useSettings.getState().reducedMotion
    const speed = Number.isFinite(sys.speed) ? sys.speed : 0
    const occupied = sys.occupied

    // ---- wheels: spin with speed, rear wheels steer (opposite the turn)
    a.spinF -= (speed / FORKLIFT.frontWheel.r) * dt
    a.spinR -= (speed / FORKLIFT.rearWheel.r) * dt
    a.spinF %= Math.PI * 2
    a.spinR %= Math.PI * 2
    const wheels = refs.wheels.current
    if (wheels) {
      const rearYaw = rearWheelAngle(sys.steer)
      for (let i = 0; i < WHEELS.length; i++) {
        const [x, z, r, w, rear] = WHEELS[i]
        const left = x < 0
        const spin = rear ? a.spinR : a.spinF
        _qs.setFromAxisAngle(Y_AXIS, (rear ? rearYaw : 0) + (left ? Math.PI : 0))
        _qx.setFromAxisAngle(X_AXIS, left ? -spin : spin)
        _q.copy(_qs).multiply(_qx)
        _m.compose(_p.set(x, r, z), _q, _s.set(w, r, r))
        wheels.setMatrixAt(i, _m)
      }
      wheels.instanceMatrix.needsUpdate = true
      if (!a.boundsDone) {
        wheels.computeBoundingSphere()
        a.boundsDone = true
      }
    }

    // ---- forks: lowered when parked, carried a hand high while driving, bob on the move
    const forkTarget = occupied || Math.abs(speed) > 0.3 ? FORKLIFT.forkDriving : FORKLIFT.forkParked
    a.fork = damp(a.fork, forkTarget, 3.5, dt)
    const moving = clamp(Math.abs(speed) / 3, 0, 1)
    const bob = reduced ? 0 : Math.sin(a.t * 10.5) * 0.012 * moving + (sys.lastImpact.t < 0.5 ? Math.sin(sys.lastImpact.t * 30) * 0.04 * (0.5 - sys.lastImpact.t) * sys.lastImpact.strength : 0)
    const carriage = refs.carriage.current
    if (carriage) carriage.position.y = a.fork + bob

    // ---- suspension wobble: squat on acceleration, dive on braking, lean in turns
    const accel = dt > 0 ? (speed - a.prevSpeed) / dt : 0
    a.prevSpeed = speed
    a.accel = damp(a.accel, clamp(accel, -14, 14), 9, dt)
    const k = reduced ? 0.5 : 1
    const pitchTarget = clamp(a.accel * 0.0075, -0.045, 0.045) * k
    const rollTarget = clamp(-speed * sys.yawRate * 0.0065, -0.04, 0.04) * k
    a.pitchV += ((pitchTarget - a.pitch) * 140 - a.pitchV * 14) * dt
    a.pitch += a.pitchV * dt
    a.rollV += ((rollTarget - a.roll) * 120 - a.rollV * 13) * dt
    a.roll += a.rollV * dt
    const wobble = refs.wobble.current
    if (wobble) {
      wobble.rotation.set(clamp(a.pitch, -0.08, 0.08), 0, clamp(a.roll, -0.07, 0.07))
      const honk = sys.hornAge < 0.28 && !reduced ? Math.sin((sys.hornAge / 0.28) * Math.PI) : 0
      wobble.scale.set(1 + honk * 0.015, 1 - honk * 0.035, 1 + honk * 0.015)
    }

    // ---- steering wheel turns with the input
    const sw = refs.steering.current
    if (sw) sw.rotation.y = -sys.steer * 2.4

    // ---- beacon: rotating flash while moving, steady glow when idling, dark when parked
    let glow = 0.08
    let halo = 0
    if (Math.abs(speed) > 0.25) {
      if (reduced) glow = 0.9
      else {
        a.beacon += dt * 2.4
        const flash = Math.pow(Math.max(0, Math.cos(a.beacon * Math.PI * 2)), 4)
        glow = 0.35 + 2.6 * flash
        halo = flash * 0.85
      }
    } else if (occupied) glow = 0.55
    _beacon.copy(BEACON_ON).multiplyScalar(glow)
    beaconMat.color.copy(_beacon)
    const hs = refs.halo.current
    if (hs) {
      hs.visible = halo > 0.02
      haloMat.opacity = halo
    }

    // ---- driver: seated, glances into turns, looks over the shoulder when reversing
    const drv = refs.driver.current
    if (drv) drv.visible = occupied
    const lookTarget = speed < -0.3 ? 1.05 : Math.abs(sys.steer) > 0.3 && Math.abs(speed) > 0.3 ? -sys.steer * 0.45 : 0
    a.look = damp(a.look, lookTarget, 5, dt)

    // ---- exhaust from the pipe tip
    const g = sys.group
    if (g && occupied) {
      _p.set(EXHAUST_TIP[0], EXHAUST_TIP[1], EXHAUST_TIP[2]).applyQuaternion(g.quaternion).add(g.position)
      sys.exhaust(dt, _p.x, _p.y, _p.z, useGameStore.getState().quality === 'low')
    }

    // ---- the camera may hide the parked forklift when it blocks the view of the
    // worker; once somebody drives it, it is always shown (the fader only
    // re-scans its flags every ~2 s, so never wait for it to un-hide us)
    const vis = refs.visual.current
    sys.visualObj = vis
    if (vis) {
      vis.userData.cameraFade = !occupied
      if (occupied && !vis.visible) vis.visible = true
      // The fader re-scans its flags only every ~2 s: while driving, also make the
      // meshes invisible to its rays so it can never pop the forklift out from
      // under the driver (only touched on enter / exit).
      if (a.rayOff !== occupied) {
        a.rayOff = occupied
        vis.traverse((o) => {
          if (!(o as THREE.Mesh).isMesh) return
          if (occupied) o.raycast = NO_RAYCAST
          else delete (o as Partial<THREE.Object3D>).raycast
        })
      }
    }
  })

  const lookYaw = useMemo(() => () => anim.current.look, [])
  return <ForkliftBody bodyRef={bodyRef} refs={refs} beaconMat={beaconMat} haloMat={haloMat} lookYaw={lookYaw} shadows={quality !== 'low'} />
}

// ---------------------------------------------------------------------------
// Physics body + visuals. Memoized: re-rendering with new props must never
// make react-three-rapier re-apply the start transform.
// ---------------------------------------------------------------------------

interface BodyProps {
  bodyRef: RefObject<RapierRigidBody | null>
  refs: VisualRefs
  beaconMat: THREE.MeshBasicMaterial
  haloMat: THREE.SpriteMaterial
  lookYaw: () => number
  shadows: boolean
}

const ForkliftBody = memo(function ForkliftBody({ bodyRef, refs, beaconMat, haloMat, lookYaw, shadows }: BodyProps) {
  const A = forkliftAssets()
  const steerQuat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(Y_AXIS, STEERING.axis), [])
  const g = GROUPS.vehicle
  return (
    <RigidBody
      ref={bodyRef}
      type="dynamic"
      colliders={false}
      position={START_POS}
      rotation={START_ROT}
      ccd
      canSleep
      linearDamping={0.05}
      angularDamping={0.6}
      name="forklift"
    >
      {/* chassis + engine cover */}
      <CuboidCollider args={[0.62, 0.29, 1.02]} position={[0, 0.58, 0.18]} mass={M.chassis} collisionGroups={g} friction={0.55} restitution={0.05} />
      {/* counterweight: heavy and low at the back (low centre of mass) */}
      <CuboidCollider args={[0.6, 0.24, 0.26]} position={[0, 0.5, 1.14]} mass={M.counterweight} collisionGroups={g} friction={0.55} restitution={0.05} />
      {/* mast + carriage */}
      <CuboidCollider args={[0.53, 1.13, 0.12]} position={[0, 1.25, -1.1]} mass={M.mast} collisionGroups={g} friction={0.4} restitution={0.05} />
      {/* fork blades */}
      <CuboidCollider args={[0.36, 0.04, 0.48]} position={[0, 0.12, -1.7]} mass={M.forks} collisionGroups={g} friction={0.2} restitution={0.05} />
      {/* overhead guard roof (lands on it when upside down) */}
      <CuboidCollider args={[0.6, 0.05, 0.88]} position={[0, FORKLIFT.guardY, 0.06]} mass={M.guard} collisionGroups={g} friction={0.5} restitution={0.05} />
      {/* wheels: frictionless balls — traction is the controller's job */}
      {[-1, 1].map((s) => (
        <BallCollider
          key={`f${s}`}
          args={[FB.r]}
          position={[s * FB.x, FB.r, FORKLIFT.frontAxleZ]}
          mass={M.wheel}
          collisionGroups={g}
          friction={0}
          frictionCombineRule={MIN}
          restitution={0}
          restitutionCombineRule={MIN}
        />
      ))}
      {[-1, 1].map((s) => (
        <BallCollider
          key={`r${s}`}
          args={[RB.r]}
          position={[s * RB.x, RB.r, FORKLIFT.rearAxleZ]}
          mass={M.wheel}
          collisionGroups={g}
          friction={0}
          frictionCombineRule={MIN}
          restitution={0}
          restitutionCombineRule={MIN}
        />
      ))}

      <object3D ref={refs.anchor} />
      <group ref={refs.visual} name="forklift-visual">
        {/* wheels stay out of the wobble group (the body rocks on its tyres) */}
        <instancedMesh ref={refs.wheels} args={[A.wheel, A.rubber, 4]} castShadow={shadows} receiveShadow name="forklift-wheels" />
        <group ref={refs.wobble}>
          <mesh geometry={A.body} material={A.paint} castShadow={shadows} receiveShadow />
          <mesh geometry={A.metal} material={A.metalMat} castShadow={shadows} receiveShadow />
          <mesh geometry={A.lamps} material={A.lampMat} />
          <mesh geometry={A.decals} material={A.decalMat} renderOrder={1} />
          <group ref={refs.carriage} position={[0, FORKLIFT.forkParked, 0]}>
            <mesh geometry={A.carriage} material={A.metalMat} castShadow={shadows} receiveShadow />
          </group>
          <group position={STEERING.position} quaternion={steerQuat}>
            <mesh ref={refs.steering} geometry={A.steering} material={A.paint} castShadow={shadows} />
          </group>
          <mesh geometry={A.beacon} material={beaconMat} position={BEACON_POS} />
          {/* never raycast (the camera occluder fader walks this subtree; sprites need raycaster.camera) */}
          <sprite ref={refs.halo} material={haloMat} position={[BEACON_POS[0], BEACON_POS[1] + 0.1, BEACON_POS[2]]} scale={[0.75, 0.75, 0.75]} visible={false} raycast={NO_RAYCAST} />
          <group ref={refs.driver} visible={false} position={[0, FORKLIFT.seatTop - 0.4, FORKLIFT.seatZ]}>
            <WorkerModel look={PLAYER_LOOK} anim="sit" speed={0} seed={7} lookYaw={lookYaw} castShadow={shadows} />
          </group>
        </group>
      </group>
    </RigidBody>
  )
})
