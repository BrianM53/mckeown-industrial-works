import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { OccluderFader } from './occluders'

const DT = 1 / 60

function setup() {
  const scene = new THREE.Scene()
  const geo = new THREE.BoxGeometry(1, 1, 1)
  const mat = new THREE.MeshBasicMaterial()
  const pipe = new THREE.Mesh(geo, mat)
  pipe.position.set(0, 2, 3) // between camera (z=6) and head (z=0)
  pipe.userData.cameraFade = true
  const wall = new THREE.Mesh(geo, mat) // not opted in
  wall.position.set(0, 2, 4)
  const group = new THREE.Group() // opted-in group with a child mesh, off the line of sight
  group.userData.cameraFade = true
  const child = new THREE.Mesh(geo, mat)
  child.position.set(5, 2, 3)
  group.add(child)
  scene.add(pipe, wall, group)
  scene.updateMatrixWorld(true)
  return { scene, pipe, wall, group }
}

const run = (f: OccluderFader, scene: THREE.Scene, from: THREE.Vector3, to: THREE.Vector3, seconds: number) => {
  for (let t = 0; t < seconds; t += DT) f.update(DT, scene, from, to)
}

describe('selective occluder fading', () => {
  it('hides opted-in props blocking the view, never others, and restores them once clear', () => {
    const { scene, pipe, wall, group } = setup()
    const f = new OccluderFader()
    const cam = new THREE.Vector3(0, 2, 6)
    const head = new THREE.Vector3(0, 2, 0)
    run(f, scene, cam, head, 0.5)
    expect(f.trackedCount).toBe(2)
    expect(pipe.visible).toBe(false)
    expect(wall.visible).toBe(true)
    expect(group.visible).toBe(true)
    // camera swings around: line of sight clear again → pipe comes back (after a short delay)
    const side = new THREE.Vector3(-6, 2, 0)
    run(f, scene, side, head, 0.15)
    expect(pipe.visible).toBe(false)
    run(f, scene, side, head, 0.6)
    expect(pipe.visible).toBe(true)
  })

  it('opted-in groups are tested through their children', () => {
    const { scene, group } = setup()
    const f = new OccluderFader()
    run(f, scene, new THREE.Vector3(5, 2, 6), new THREE.Vector3(5, 2, 0), 0.5)
    expect(group.visible).toBe(false)
  })

  it('restoreAll un-hides everything (unmount)', () => {
    const { scene, pipe } = setup()
    const f = new OccluderFader()
    run(f, scene, new THREE.Vector3(0, 2, 6), new THREE.Vector3(0, 2, 0), 0.5)
    expect(pipe.visible).toBe(false)
    f.restoreAll()
    expect(pipe.visible).toBe(true)
  })

  it('objects removed from the scene are restored and forgotten', () => {
    const { scene, pipe } = setup()
    const f = new OccluderFader()
    run(f, scene, new THREE.Vector3(0, 2, 6), new THREE.Vector3(0, 2, 0), 0.5)
    scene.remove(pipe)
    run(f, scene, new THREE.Vector3(0, 2, 6), new THREE.Vector3(0, 2, 0), 2.1)
    expect(pipe.visible).toBe(true)
    expect(f.trackedCount).toBe(1)
  })
})
