/**
 * Rigid-skinning rig for every moving machine part of the production spine.
 * Moving parts are merged into ONE skinned mesh (plus one additive FX skinned
 * mesh) sharing this skeleton, so ~60 animated parts cost two draw calls.
 *
 * Bones are created at their pivot (world rest position + rest yaw). Parts are
 * modelled in world space at the rest pose; at runtime `pose()` applies a delta
 * rotation (in the bone's own rest frame), a delta translation (bone frame)
 * and a scale (0 hides a part).
 */
import * as THREE from 'three'
import type { V3 } from './builder'

const _e = new THREE.Euler()
const _q = new THREE.Quaternion()
const _v = new THREE.Vector3()

interface BoneRest {
  /** Rest position relative to the parent (parent's rest frame). */
  pos: THREE.Vector3
  /** Rest rotation relative to the parent. */
  quat: THREE.Quaternion
  /** World rest pose (for children). */
  wpos: THREE.Vector3
  wquat: THREE.Quaternion
}

export class Rig {
  readonly root = new THREE.Bone()
  readonly bones: THREE.Bone[] = [this.root]
  private rest: BoneRest[] = [{ pos: new THREE.Vector3(), quat: new THREE.Quaternion(), wpos: new THREE.Vector3(), wquat: new THREE.Quaternion() }]
  private names = new Map<string, number>()
  skeleton: THREE.Skeleton | null = null

  constructor() {
    this.root.name = 'lines-rig-root'
  }

  /** Add a bone with pivot at world `pos`, rest rotation `yaw` (+ optional pitch/roll, YXZ), under `parent` (0 = root). */
  add(name: string, parent: number, pos: V3, yaw = 0, pitch = 0, roll = 0): number {
    const p = this.rest[parent]
    if (!p) throw new Error(`rig: bad parent ${parent} for ${name}`)
    const wquat = new THREE.Quaternion().setFromEuler(_e.set(pitch, yaw, roll, 'YXZ'))
    const wpos = new THREE.Vector3(pos[0], pos[1], pos[2])
    const inv = p.wquat.clone().invert()
    const lpos = wpos.clone().sub(p.wpos).applyQuaternion(inv)
    const lquat = inv.clone().multiply(wquat)
    const bone = new THREE.Bone()
    bone.name = name
    bone.position.copy(lpos)
    bone.quaternion.copy(lquat)
    this.bones[parent].add(bone)
    this.bones.push(bone)
    this.rest.push({ pos: lpos, quat: lquat, wpos, wquat })
    const idx = this.bones.length - 1
    this.names.set(name, idx)
    return idx
  }

  index(name: string): number {
    const i = this.names.get(name)
    if (i === undefined) throw new Error(`rig: unknown bone ${name}`)
    return i
  }

  get count(): number {
    return this.bones.length
  }

  /** Create the skeleton once all bones exist (bones must be at rest). */
  finalize(): THREE.Skeleton {
    if (this.skeleton) return this.skeleton
    this.root.updateMatrixWorld(true)
    this.skeleton = new THREE.Skeleton(this.bones)
    return this.skeleton
  }

  /**
   * Pose bone `i`: delta rotation (rx, ry, rz; XYZ order, bone rest frame),
   * delta translation (dx, dy, dz; bone rest frame) and uniform scale.
   */
  pose(i: number, rx = 0, ry = 0, rz = 0, dx = 0, dy = 0, dz = 0, scale = 1): void {
    const b = this.bones[i]
    const r = this.rest[i]
    if (!b || !r) return
    if (rx !== 0 || ry !== 0 || rz !== 0) b.quaternion.copy(r.quat).multiply(_q.setFromEuler(_e.set(rx, ry, rz, 'XYZ')))
    else b.quaternion.copy(r.quat)
    if (dx !== 0 || dy !== 0 || dz !== 0) b.position.copy(r.pos).add(_v.set(dx, dy, dz).applyQuaternion(r.quat))
    else b.position.copy(r.pos)
    const s = Number.isFinite(scale) ? Math.max(0, scale) : 1
    b.scale.set(s, s, s)
  }

  /** Non-uniform scale (e.g. a pour stream growing in length) on top of pose(). */
  scale(i: number, sx: number, sy: number, sz: number): void {
    const b = this.bones[i]
    if (b) b.scale.set(sx, sy, sz)
  }
}
