import { CuboidCollider, CylinderCollider, RigidBody } from '@react-three/rapier'
import { GROUPS } from '@/core/collision'
import { environmentColliders } from '../data/colliders'

/**
 * Every environment collider in one fixed body (buildings, furniture, decor,
 * barriers, structures). Primitive colliders only; GROUPS.static blocks bodies
 * and the camera boom, GROUPS.cameraBlocker only the camera (overhead beams).
 */
export function EnvColliders() {
  const list = environmentColliders()
  return (
    <RigidBody type="fixed" colliders={false} name="environment-static">
      {list.map((c) =>
        c.shape === 'cyl' ? (
          <CylinderCollider key={c.id} args={[c.hy ?? 0.5, c.r ?? 0.2]} position={[c.x, c.y, c.z]} collisionGroups={GROUPS.static} />
        ) : (
          <CuboidCollider
            key={c.id}
            args={[c.hx ?? 0.5, c.hy ?? 0.5, c.hz ?? 0.5]}
            position={[c.x, c.y, c.z]}
            rotation={[c.pitch ?? 0, c.yaw ?? 0, 0]}
            collisionGroups={c.group === 'camera' ? GROUPS.cameraBlocker : GROUPS.static}
          />
        ),
      )}
    </RigidBody>
  )
}
