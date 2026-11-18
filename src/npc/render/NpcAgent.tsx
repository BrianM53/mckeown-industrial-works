import { memo, useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { CapsuleCollider, RigidBody, type RapierCollider, type RapierRigidBody } from '@react-three/rapier'
import * as THREE from 'three'
import { GROUPS } from '@/core/collision'
import { useInteractable } from '@/core/interaction'
import { runtime } from '@/core/runtime'
import { WorkerModel, type WorkerAnim } from '@/world/WorkerModel'
import type { NpcBrain } from '../brain'
import type { NpcDef } from '../types'
import type { NpcWorld } from '../world'
import { Parts, paintedMat } from './build'

/** NPC capsule: 1.8 m tall like the visitor, a touch slimmer. */
export const NPC_CAPSULE = { halfHeight: 0.55, radius: 0.3, centerY: 0.9 }
/** Re-enable a gag actor's capsule only once the visitor is clear of it. */
const SOLID_CLEARANCE = 0.85

// ---------------------------------------------------------------------------
// Carried component box (cardboard + tape), held in front at chest height
// ---------------------------------------------------------------------------

let boxGeo: THREE.BufferGeometry | null = null
function carryBoxGeometry(): THREE.BufferGeometry {
  if (boxGeo) return boxGeo
  const p = new Parts()
  p.rbox(0.44, 0.3, 0.36, 0.02, '#B98B57', [0, 0, 0])
  p.box(0.446, 0.012, 0.08, '#D9C6A0', [0, 0.151, 0])
  p.box(0.08, 0.31, 0.366, '#D9C6A0', [0, 0, 0])
  p.box(0.16, 0.1, 0.004, '#EFE8D6', [0.08, 0.02, -0.182])
  p.box(0.07, 0.05, 0.005, '#C0392B', [-0.12, 0.05, -0.182])
  boxGeo = p.build()
  return boxGeo
}

// ---------------------------------------------------------------------------
// Tint (soot / slime): a clone of the shared worker material that reuses its
// shader patch AND program cache key, so swapping it in never compiles a shader.
// ---------------------------------------------------------------------------

const SOOT = new THREE.Color('#2a2624')
const SLIME = new THREE.Color('#7dff62')
const SLIME_GLOW = new THREE.Color('#39ff5a')
const WHITE = new THREE.Color(1, 1, 1)
const _c = new THREE.Color()
const _s = new THREE.Color()

class TintController {
  private mesh: THREE.SkinnedMesh | null = null
  private mat: THREE.MeshStandardMaterial | null = null
  private base: THREE.Material | null = null

  update(root: THREE.Object3D, soot: number, slime: number): void {
    if (!this.mesh || !this.mesh.parent) {
      let found: THREE.SkinnedMesh | null = null
      root.traverse((o) => {
        if (!found && (o as THREE.SkinnedMesh).isSkinnedMesh) found = o as THREE.SkinnedMesh
      })
      this.mesh = found
      const mesh = found as THREE.SkinnedMesh | null
      if (!mesh) return
      const cur = mesh.material as THREE.Material | THREE.Material[]
      if (!cur || Array.isArray(cur) || !(cur as THREE.MeshStandardMaterial).isMeshStandardMaterial) return
      const base = cur as THREE.MeshStandardMaterial
      if (base === this.mat) {
        // already ours
      } else if (this.mat && this.base === base) {
        mesh.material = this.mat
      } else {
        this.mat?.dispose()
        const m = base.clone()
        m.onBeforeCompile = base.onBeforeCompile
        m.customProgramCacheKey = base.customProgramCacheKey
        m.name = 'npc-worker-tint'
        this.base = base
        this.mat = m
        mesh.material = m
      }
    }
    const m = this.mat
    if (!m) return
    _c.copy(WHITE).lerp(SOOT, soot)
    if (slime > 0) _c.multiply(_s.copy(WHITE).lerp(SLIME, slime))
    m.color.copy(_c)
    m.emissive.copy(SLIME_GLOW).multiplyScalar(slime * 0.22)
  }

  dispose(): void {
    if (this.mesh && this.base) this.mesh.material = this.base
    this.mat?.dispose()
    this.mat = null
    this.mesh = null
  }
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export interface NpcAgentProps {
  world: NpcWorld
  brain: NpcBrain
  def: NpcDef
  shadows: boolean
  /** This NPC can get tinted by a gag (soot / slime). */
  tintable: boolean
}

export function NpcAgent({ world, brain, def, shadows, tintable }: NpcAgentProps) {
  const bodyRef = useRef<RapierRigidBody>(null)
  const colRef = useRef<RapierCollider>(null)
  const groupRef = useRef<THREE.Group>(null)
  const leanRef = useRef<THREE.Group>(null)
  const boxRef = useRef<THREE.Mesh>(null)
  const solid = useRef(true)
  const tint = useMemo(() => (tintable ? new TintController() : null), [tintable])
  useEffect(() => () => tint?.dispose(), [tint])

  // Getters for WorkerModel (no React re-renders per frame).
  const getters = useMemo(
    () => ({
      anim: (): WorkerAnim => brain.anim,
      speed: (): number => brain.speed,
      lookYaw: (): number | null => brain.lookYaw,
    }),
    [brain],
  )

  // "Talk" interactable at the worker's live position (lower priority than stations).
  const pos = useMemo(() => ({ x: brain.x, y: 0, z: brain.z }), [brain])
  useInteractable({
    id: `npc:${def.id}`,
    label: `${def.name} (${def.role})`,
    verb: 'Talk',
    radius: def.talkRadius ?? 2.2,
    priority: -0.6,
    getPosition: () => {
      pos.x = brain.x
      pos.z = brain.z
      return pos
    },
    enabled: () => world.canTalk(def.id),
    onInteract: () => world.talk(def.id),
  })

  useFrame(() => {
    const g = groupRef.current
    if (!g) return
    const x = Number.isFinite(brain.x) ? brain.x : 0
    const z = Number.isFinite(brain.z) ? brain.z : 0
    g.position.set(x, Number.isFinite(brain.y) ? brain.y : 0, z)
    g.rotation.y = Number.isFinite(brain.yaw) ? brain.yaw : 0
    g.visible = !brain.hidden
    const lg = leanRef.current
    if (lg) lg.rotation.x = brain.lean
    const box = boxRef.current
    if (box) box.visible = brain.carry && brain.anim === 'carry'
    if (tint && lg) tint.update(lg, brain.soot, brain.slime)

    // Kinematic capsule follows the feet (stays on the ground while sitting/lying).
    const body = bodyRef.current
    if (body) {
      try {
        body.setNextKinematicTranslation({ x, y: 0, z })
      } catch {
        /* body not ready */
      }
    }
    const col = colRef.current
    if (col) {
      let want = brain.solid
      if (want && !solid.current) {
        const p = runtime.player.position
        if (Math.hypot(p.x - x, p.z - z) < SOLID_CLEARANCE) want = false
      }
      if (want !== solid.current) {
        try {
          col.setEnabled(want)
          solid.current = want
        } catch {
          /* collider not ready */
        }
      }
    }
  })

  const start = useMemo<[number, number, number]>(() => [brain.x, 0, brain.z], [brain])

  return (
    <>
      <NpcBody bodyRef={bodyRef} colRef={colRef} position={start} name={`npc:${def.id}`} />
      <group ref={groupRef} name={`npc-${def.id}`}>
        <group ref={leanRef}>
          <WorkerModel look={def.look} anim={getters.anim} speed={getters.speed} lookYaw={getters.lookYaw} seed={def.seed} castShadow={shadows} />
          {def.carries && <mesh ref={boxRef} geometry={carryBoxGeometry()} material={paintedMat()} position={[0, 1.0, -0.42]} visible={false} castShadow={shadows} />}
        </group>
      </group>
    </>
  )
}

/** Never re-renders (prop changes would reset the kinematic body transform). */
const NpcBody = memo(function NpcBody({
  bodyRef,
  colRef,
  position,
  name,
}: {
  bodyRef: RefObject<RapierRigidBody | null>
  colRef: RefObject<RapierCollider | null>
  position: [number, number, number]
  name: string
}) {
  return (
    <RigidBody ref={bodyRef} type="kinematicPosition" colliders={false} canSleep={false} position={position} name={name}>
      <CapsuleCollider ref={colRef} args={[NPC_CAPSULE.halfHeight, NPC_CAPSULE.radius]} position={[0, NPC_CAPSULE.centerY, 0]} collisionGroups={GROUPS.npc} friction={0} />
    </RigidBody>
  )
})
