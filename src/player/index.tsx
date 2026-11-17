import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { CapsuleCollider, RigidBody, useBeforePhysicsStep, useRapier, type RapierCollider, type RapierRigidBody } from '@react-three/rapier'
import * as THREE from 'three'
import { actions } from '@/core/actions'
import { GROUPS } from '@/core/collision'
import { DEBUG_ENABLED, registerDebug } from '@/core/debug'
import { events } from '@/core/events'
import { listInteractables } from '@/core/interaction'
import { provideService } from '@/core/services'
import { useSettings } from '@/state/settings'
import { isOverlayBlocking, useUIStore } from '@/state/ui'
import { WorkerModel } from '@/world/WorkerModel'
import { CAMERA, PLAYER, PLAYER_LOOK } from './constants'
import { createDebugBoxes, type DebugBoxOpts } from './debugTools'
import { RouteGuide } from './RouteGuide'
import { PlayerSystem, initialSpawn } from './system'

/**
 * Player module root: worker controller (Rapier kinematic character
 * controller), third-person camera rig, input, interaction, recovery, route
 * guide. Rendered inside <Canvas><Physics> by world/Scene.tsx.
 *
 * Services: 'player' (teleport/respawn/tackle/setLocked/setVisible) and
 * 'camera' (recenter/follow/set). Debug: __MIW__.player / .camera / .interaction.
 */

/** Where the worker body was last seen — keeps position across dev hot reloads. */
let lastKnown: { x: number; z: number; yaw: number } | null = null

export default function PlayerModule() {
  // useState initializers: stable for the component's lifetime (useMemo is only a cache hint).
  const [spawn] = useState(() => lastKnown ?? initialSpawn())
  const [sys] = useState(() => new PlayerSystem(spawn))
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  const cameraRef = useRef(camera)
  cameraRef.current = camera

  // Own the default perspective camera.
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    if (cam.isPerspectiveCamera && cam.fov !== CAMERA.fov) {
      cam.fov = CAMERA.fov
      cam.updateProjectionMatrix()
    }
  }, [camera])

  // Input listeners (keyboard on window; mouse/wheel/pointer-lock on the canvas only).
  useEffect(() => sys.input.attach(gl.domElement), [sys, gl])

  // Services, actions, events, debug hooks.
  useEffect(() => {
    sys.mount()
    sys.setMode('foot')
    const offs: Array<() => void> = [
      provideService('player', sys.playerService()),
      provideService('camera', sys.cameraService()),
      actions.on('interact', () => sys.interact()),
      actions.on('recover', () => sys.recover()),
      actions.on('recenter', () => sys.recenter()),
      events.on('shake', (p) => sys.rig.addShake(p.intensity, p.duration, !!useSettings.getState().reducedMotion)),
      events.on('forklift:enter', () => sys.enterVehicle()),
      events.on('forklift:exit', () => sys.exitVehicle()),
      registerDebug('player', sys.debugPlayer()),
      registerDebug('camera', sys.debugCamera(() => cameraRef.current)),
      registerDebug('interaction', {
        list: () => listInteractables().map((i) => i.id),
        nearest: () => useUIStore.getState().prompt,
        target: () => sys.target?.id ?? null,
      }),
      useSettings.subscribe((s) => {
        if (!s.pointerLock) sys.input.releasePointerLock()
      }),
      // Drop held keys when a panel/dialogue opens so the worker never walks off on close.
      useUIStore.subscribe((s, prev) => {
        if ((s.panel !== null && prev.panel === null) || (s.dialogue !== null && prev.dialogue === null)) {
          sys.input.clear()
          sys.input.releasePointerLock()
        }
      }),
    ]
    return () => {
      for (const off of offs) off()
      const p = sys.ctrl.pos
      if (Number.isFinite(p.x) && Number.isFinite(p.z)) lastKnown = { x: p.x, z: p.z, yaw: sys.ctrl.facing }
      sys.dispose()
    }
  }, [sys])

  // Dev/test-only collider boxes (see debugTools.ts).
  useEffect(() => {
    if (!DEBUG_ENABLED) return
    const boxes = createDebugBoxes(
      () => sys.ctrl.world,
      () => sys.ctrl.rapier,
      scene,
    )
    const off = registerDebug('player', { debugBox: (o: DebugBoxOpts) => boxes.add(o), debugBoxClear: () => boxes.clear() })
    return () => {
      off()
      boxes.clear()
    }
  }, [sys, scene])

  // Frame orchestration: visuals → runtime → camera → interaction → recovery.
  useFrame((state, dt) => sys.frame(dt, state.camera, state.scene))

  return (
    <>
      <PlayerBody sys={sys} spawn={spawn} />
      <PlayerVisual sys={sys} />
      <TargetRing sys={sys} />
      <RouteGuide />
    </>
  )
}

// ---------------------------------------------------------------------------
// Physics body: kinematic capsule driven by the character controller each step
// ---------------------------------------------------------------------------

function PlayerBody({ sys, spawn }: { sys: PlayerSystem; spawn: { x: number; z: number } }) {
  const { world, rapier } = useRapier()
  const bodyRef = useRef<RapierRigidBody>(null)
  const colRef = useRef<RapierCollider>(null)
  const anchorRef = useRef<THREE.Object3D>(null)

  useEffect(() => {
    sys.attachPhysics(world, rapier)
    return () => sys.detachPhysics()
  }, [sys, world, rapier])

  useBeforePhysicsStep((w) => {
    sys.ctrl.body = bodyRef.current
    sys.ctrl.collider = colRef.current
    sys.anchor = anchorRef.current
    try {
      sys.fixedStep(w.timestep)
    } catch (err) {
      console.error('[player] fixed step failed', err)
    }
  })

  const position = useMemo<[number, number, number]>(() => [spawn.x, 0.06, spawn.z], [spawn])
  return <BodyMemo bodyRef={bodyRef} colRef={colRef} anchorRef={anchorRef} position={position} />
}

/** Never re-renders (prop changes would make react-three-rapier reset the body transform). */
const BodyMemo = memo(function BodyMemo({
  bodyRef,
  colRef,
  anchorRef,
  position,
}: {
  bodyRef: RefObject<RapierRigidBody | null>
  colRef: RefObject<RapierCollider | null>
  anchorRef: RefObject<THREE.Object3D | null>
  position: [number, number, number]
}) {
  return (
    <RigidBody ref={bodyRef} type="kinematicPosition" colliders={false} canSleep={false} position={position} name="player">
      <CapsuleCollider ref={colRef} args={[PLAYER.halfHeight, PLAYER.radius]} position={[0, PLAYER.centerY, 0]} collisionGroups={GROUPS.player} friction={0} />
      <object3D ref={anchorRef} />
    </RigidBody>
  )
})

// ---------------------------------------------------------------------------
// Worker visual
// ---------------------------------------------------------------------------

function PlayerVisual({ sys }: { sys: PlayerSystem }) {
  const setRoot = useCallback(
    (g: THREE.Group | null) => {
      sys.rootGroup = g
    },
    [sys],
  )
  const setLean = useCallback(
    (g: THREE.Group | null) => {
      sys.leanGroup = g
    },
    [sys],
  )
  return (
    <group ref={setRoot} name="player-worker">
      <group ref={setLean}>
        <WorkerModel look={PLAYER_LOOK} anim={sys.anim} speed={sys.speed} opacity={sys.opacity} lookYaw={sys.lookYaw} seed={7} castShadow />
      </group>
    </group>
  )
}

// ---------------------------------------------------------------------------
// Interaction highlight: a small pulsing ground ring under the current target
// ---------------------------------------------------------------------------

const RING_GEO = new THREE.RingGeometry(0.44, 0.56, 48).rotateX(-Math.PI / 2)
const RING_INNER_GEO = new THREE.RingGeometry(0.2, 0.25, 32).rotateX(-Math.PI / 2)

function TargetRing({ sys }: { sys: PlayerSystem }) {
  const group = useRef<THREE.Group>(null)
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#FFC94A',
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
    [],
  )
  useEffect(() => () => mat.dispose(), [mat])
  const t = useRef(0)
  useFrame((_, dt) => {
    const g = group.current
    if (!g) return
    t.current += Math.min(dt, 0.1)
    const target = sys.target
    const show = !!target && sys.ctrl.mode === 'foot' && !isOverlayBlocking()
    g.visible = show
    if (!show || !target) return
    let x = 0
    let z = 0
    try {
      const p = target.getPosition()
      x = p.x
      z = p.z
    } catch {
      g.visible = false
      return
    }
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      g.visible = false
      return
    }
    const pulse = 0.5 + 0.5 * Math.sin(t.current * 5)
    g.position.set(x, sys.visual.y + 0.05, z)
    const k = 1 + pulse * 0.14
    g.scale.set(k, 1, k)
    mat.opacity = 0.55 + pulse * 0.4
  })
  return (
    <group ref={group} visible={false} name="interaction-ring">
      <mesh geometry={RING_GEO} material={mat} renderOrder={2} />
      <mesh geometry={RING_INNER_GEO} material={mat} renderOrder={2} />
    </group>
  )
}
