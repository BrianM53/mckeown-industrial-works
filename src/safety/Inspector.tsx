import { memo, useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { CapsuleCollider, RigidBody, useRapier, type RapierRigidBody } from '@react-three/rapier'
import * as THREE from 'three'
import { CG, GROUPS, interactionGroups } from '@/core/collision'
import { useGameStore } from '@/state/game'
import { useSettings } from '@/state/settings'
import { textures } from '@/world/materials'
import { WorkerModel } from '@/world/WorkerModel'
import { tweetArt, whumpArt } from './art'
import { INSPECTOR_LOOK, INSPECTOR_SEED } from './config'
import { easeOutBack, PartBuilder, vertexColorMat } from './geometry'
import type { OshaFsm } from './oshaFsm'

/**
 * The site safety inspector, rendered from the OSHA FSM's actor every frame:
 * shared WorkerModel (white hard hat, safety-orange vest, clipboard) + a whistle
 * on a lanyard attached to the spine bone, comic "TWEEEET!" / "WHUMP!" bursts,
 * dust puffs while he sprints, a ground-following height probe and an NPC
 * capsule that only blocks the visitor while he is patrolling (never mid-chase,
 * never while overlapping the visitor).
 */

const SPINE_BONE = 2
const BURIED = 1.95
const GROUND_RAY_GROUPS = interactionGroups(CG.NPC, [CG.STATIC])
const PARKED_Y = -40

/** Lanyard + brass whistle in the spine bone's local frame (bind pose: spine joint at y 1.05). */
function buildWhistleGeometry(): THREE.BufferGeometry {
  const b = new PartBuilder()
  const cord = '#B8322A'
  b.add(new THREE.TorusGeometry(0.104, 0.0085, 4, 20, Math.PI * 1.25), cord, { position: [0, 0.38, -0.05], rotation: [1.25, 0, -Math.PI * 0.125 + Math.PI] })
  b.add(new THREE.CylinderGeometry(0.006, 0.006, 0.11, 4), cord, { position: [0, 0.285, -0.152], rotation: [0.35, 0, 0] })
  // the whistle: barrel + mouthpiece + ring, a touch oversized so it reads at 5 m
  b.add(new THREE.CylinderGeometry(0.027, 0.027, 0.062, 12), '#D9A53B', { position: [0, 0.226, -0.178], rotation: [0, 0, Math.PI / 2] })
  b.add(new THREE.BoxGeometry(0.05, 0.022, 0.03), '#D9A53B', { position: [0.05, 0.236, -0.178] })
  b.add(new THREE.TorusGeometry(0.012, 0.004, 4, 10), '#C9C3B0', { position: [-0.036, 0.236, -0.178], rotation: [0, Math.PI / 2, 0] })
  return b.build()
}

let whistleGeo: THREE.BufferGeometry | null = null
function getWhistleGeometry(): THREE.BufferGeometry {
  if (!whistleGeo) whistleGeo = buildWhistleGeometry()
  return whistleGeo
}

let dustMat: THREE.MeshBasicMaterial | null = null
function getDustMaterial(): THREE.MeshBasicMaterial {
  if (!dustMat) {
    dustMat = new THREE.MeshBasicMaterial({
      map: textures.smokePuff(),
      color: '#d2c3aa',
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    })
    dustMat.name = 'safety-dust'
  }
  return dustMat
}
const DUST_GEO = new THREE.PlaneGeometry(1, 1)
const DUST_MAX = 12
const DUST_LIFE = 0.55
const DUST_EVERY = 0.045

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()

interface Puff {
  x: number
  z: number
  age: number
  size: number
}

function makePuffPool(): Puff[] {
  return Array.from({ length: DUST_MAX }, (_, i) => ({ x: 0, z: 0, age: Infinity, size: 0.55 + (i % 4) * 0.08 }))
}

export function InspectorVisual({ fsm }: { fsm: OshaFsm }) {
  const quality = useGameStore((s) => s.quality)
  const root = useRef<THREE.Group>(null)
  const workerWrap = useRef<THREE.Group>(null)
  const body = useRef<RapierRigidBody>(null)
  const sprite = useRef<THREE.Sprite>(null)
  const { world, rapier } = useRapier()

  const whistle = useMemo(() => {
    const m = new THREE.Mesh(getWhistleGeometry(), vertexColorMat(0.35, 0.55))
    m.name = 'inspector-whistle'
    m.castShadow = false
    return m
  }, [])
  const attachedTo = useRef<THREE.Object3D | null>(null)
  useEffect(
    () => () => {
      whistle.removeFromParent()
      attachedTo.current = null
    },
    [whistle],
  )

  const ray = useMemo(() => new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }), [rapier])
  const ground = useRef({ y: 0, x: NaN, z: NaN, t: 0 })

  const burstMat = useMemo(() => {
    const art = tweetArt()
    const m = new THREE.SpriteMaterial({ map: art?.texture ?? null, transparent: true, depthWrite: false, toneMapped: false })
    m.name = 'safety-burst'
    return m
  }, [])
  useEffect(() => () => burstMat.dispose(), [burstMat])

  const dust = useMemo(() => {
    const mesh = new THREE.InstancedMesh(DUST_GEO, getDustMaterial(), DUST_MAX)
    mesh.frustumCulled = false
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.renderOrder = 4
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    _m.makeScale(0, 0, 0)
    for (let i = 0; i < DUST_MAX; i++) mesh.setMatrixAt(i, _m)
    mesh.count = 0
    return mesh
  }, [])
  useEffect(() => () => dust.dispose(), [dust])
  const puffs = useMemo(makePuffPool, [])
  const puffHead = useRef(0)
  const puffClock = useRef(0)
  const puffsAlive = useRef(false)

  useFrame((state, rawDt) => {
    const dt = Math.min(Math.max(rawDt, 0), 0.1)
    const a = fsm.actor
    const g = root.current
    if (!g) return
    const ok = Number.isFinite(a.x) && Number.isFinite(a.z) && Number.isFinite(a.yaw)
    g.visible = ok
    if (!ok) return

    // --- ground height under him (raised decks, ramps); step-limited so a chain or sign never lifts him
    const gr = ground.current
    gr.t += dt
    if (Math.abs(a.x - gr.x) + Math.abs(a.z - gr.z) > 0.15 || gr.t > 0.5) {
      gr.t = 0
      gr.x = a.x
      gr.z = a.z
      try {
        ray.origin.x = a.x
        ray.origin.y = gr.y + 0.6
        ray.origin.z = a.z
        const hit = world.castRay(ray, 3, true, rapier.QueryFilterFlags.EXCLUDE_SENSORS, GROUND_RAY_GROUPS)
        const y = hit ? ray.origin.y - hit.timeOfImpact : 0
        gr.y = Number.isFinite(y) && y > -0.5 && y < 3 ? y : 0
      } catch {
        gr.y = 0
      }
    }

    // --- body (rising out of a hatch with a little hop)
    const lift = a.rise >= 1 ? 0 : (easeOutBack(a.rise, 2.2) - 1) * BURIED
    g.position.set(a.x, gr.y + lift, a.z)
    g.rotation.y = a.yaw

    // --- whistle on the spine bone (re-attached only if the rig was rebuilt)
    const att = attachedTo.current
    const wrap = workerWrap.current
    if (wrap && (!att || !att.parent || !whistle.parent)) {
      const sm = findSkinned(wrap)
      const bone = sm?.skeleton?.bones?.[SPINE_BONE]
      if (sm && bone) {
        bone.add(whistle)
        attachedTo.current = sm
      }
    }

    // --- blocking capsule (patrol only)
    const rb = body.current
    if (rb) {
      try {
        rb.setNextKinematicTranslation({ x: a.x, y: a.collidable ? gr.y : PARKED_Y, z: a.z })
      } catch {
        /* body not ready */
      }
    }

    // --- comic burst
    const sp = sprite.current
    if (sp) {
      if (a.burst) {
        const art = a.burst === 'tweet' ? tweetArt() : whumpArt()
        if (art && burstMat.map !== art.texture) {
          if (!burstMat.map) burstMat.needsUpdate = true
          burstMat.map = art.texture
        }
        const reduced = useSettings.getState().reducedMotion
        const T = a.burstT
        const pop = reduced ? 1 : T < 0.12 ? 0.5 + (T / 0.12) * 0.7 : T < 0.24 ? 1.2 - ((T - 0.12) / 0.12) * 0.2 : 1
        const fade = T > 0.95 ? Math.max(0, 1 - (T - 0.95) / 0.35) : 1
        const k = a.burst === 'whump' ? 1.15 : 1
        sp.scale.set(1.5 * pop * k, 0.75 * pop * k, 1)
        sp.position.set(a.x, gr.y + lift + 2.55 + (reduced ? 0 : Math.min(T, 0.6) * 0.25), a.z)
        burstMat.opacity = fade
        sp.visible = fade > 0.01 && !!art
      } else sp.visible = false
    }

    // --- sprint dust (fixed pool; off on low quality / reduced motion)
    const allowDust = quality !== 'low' && !useSettings.getState().reducedMotion
    if (allowDust && a.dust && a.rise >= 1) {
      puffClock.current += dt
      while (puffClock.current >= DUST_EVERY) {
        puffClock.current -= DUST_EVERY
        const pf = puffs[puffHead.current]
        puffHead.current = (puffHead.current + 1) % DUST_MAX
        const side = (puffHead.current % 3) - 1
        pf.x = a.x + Math.sin(a.yaw) * 0.35 + Math.cos(a.yaw) * side * 0.14
        pf.z = a.z + Math.cos(a.yaw) * 0.35 - Math.sin(a.yaw) * side * 0.14
        pf.age = 0
        puffsAlive.current = true
      }
    } else puffClock.current = 0
    if (puffsAlive.current) {
      let n = 0
      _q.copy(state.camera.quaternion)
      for (const pf of puffs) {
        if (pf.age >= DUST_LIFE) continue
        pf.age += dt
        if (pf.age >= DUST_LIFE) continue
        const u = pf.age / DUST_LIFE
        const sc = pf.size * (0.35 + 0.9 * u) * (u > 0.7 ? (1 - u) / 0.3 : 1)
        _m.compose(_p.set(pf.x, gr.y + 0.18 + u * 0.35, pf.z), _q, _s.set(sc, sc, sc))
        dust.setMatrixAt(n++, _m)
      }
      dust.count = n
      dust.visible = n > 0
      dust.instanceMatrix.needsUpdate = n > 0
      puffsAlive.current = n > 0
    } else if (dust.visible) {
      dust.visible = false
      dust.count = 0
    }
  })

  return (
    <>
      <group ref={root} name="safety-inspector">
        <group ref={workerWrap}>
          <WorkerModel
            look={INSPECTOR_LOOK}
            seed={INSPECTOR_SEED}
            anim={() => fsm.actor.anim}
            speed={() => fsm.actor.speed}
            lookYaw={() => fsm.actor.look}
            castShadow={quality !== 'low'}
          />
        </group>
      </group>
      <InspectorBody bodyRef={body} />
      <sprite ref={sprite} material={burstMat} visible={false} renderOrder={12} />
      <primitive object={dust} />
    </>
  )
}

function findSkinned(root: THREE.Object3D): THREE.SkinnedMesh | null {
  const stack: THREE.Object3D[] = [root]
  while (stack.length) {
    const o = stack.pop()!
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) return o as THREE.SkinnedMesh
    for (const c of o.children) stack.push(c)
  }
  return null
}

/** Kinematic NPC capsule (never re-renders: prop changes would reset the body). */
const InspectorBody = memo(function InspectorBody({ bodyRef }: { bodyRef: RefObject<RapierRigidBody | null> }) {
  return (
    <RigidBody ref={bodyRef} type="kinematicPosition" colliders={false} position={[0, PARKED_Y, 0]} canSleep={false} name="safety-inspector-body">
      <CapsuleCollider args={[0.5, 0.32]} position={[0, 0.86, 0]} collisionGroups={GROUPS.npc} />
    </RigidBody>
  )
})
