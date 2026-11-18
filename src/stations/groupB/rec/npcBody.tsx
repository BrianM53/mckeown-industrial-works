import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { CapsuleCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import { GROUPS } from '@/core/collision'

/**
 * Kinematic capsule (GROUPS.npc) that follows an NPC so the visitor cannot walk
 * through it. The NPC group does not collide with balls, so the game logic (not
 * physics) decides saves/returns. `get` returns the current feet position.
 */
export function NpcCapsule({ get, name }: { get: () => { x: number; z: number }; name: string }) {
  const rb = useRef<RapierRigidBody>(null)
  const last = useRef({ x: NaN, z: NaN })
  const initial = get()
  const vec = useRef({ x: 0, y: 0.9, z: 0 })
  useFrame(() => {
    const body = rb.current
    if (!body) return
    const p = get()
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return
    if (Math.abs(p.x - last.current.x) < 1e-4 && Math.abs(p.z - last.current.z) < 1e-4) return
    last.current.x = p.x
    last.current.z = p.z
    vec.current.x = p.x
    vec.current.z = p.z
    try {
      body.setNextKinematicTranslation(vec.current)
    } catch {
      /* body removed during unmount */
    }
  })
  useEffect(() => {
    last.current.x = NaN
  }, [])
  return (
    <RigidBody ref={rb} type="kinematicPosition" colliders={false} position={[initial.x, 0.9, initial.z]} name={name}>
      <CapsuleCollider args={[0.5, 0.32]} collisionGroups={GROUPS.npc} />
    </RigidBody>
  )
}
