import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { ZONES } from '@/world/layout'

/**
 * Broadcast Booth acoustic foam around the monitor wall: 0.5 m wedge tiles in
 * the classic checkerboard (every other tile turned 90°) in two columns
 * flanking the east-wall equalizer. The environment module already lines the
 * north/south walls with flat foam panels and hangs a hearing-protection
 * poster on the east wall at z ≈ 13.3–13.9, so this only treats the bare
 * east-wall flanks, in the same two foam shades.
 * One instanced draw call, no colliders (flush with the wall), no shadows.
 */
const IN = ZONES.radio.building!.interior
const TILE = 0.5
const DEPTH = 0.065
const RIDGES = 4
/** Clear of the environment's 4 cm interior lining. */
const OFF = 0.05
/** Rows above the wainscot rail (1.21), below the ON AIR / call-sign band. */
const FLANK_Y = [1.7, 2.2, 2.7, 3.2, 3.7]
/**
 * Columns north of the floor speaker (z ≥ 8.44) and south of the
 * environment's hearing-protection poster (z ≤ 13.94), short of the corners.
 */
const FLANK_Z = [7.0, 7.5, 8.0, 14.2, 14.7, 15.2]

/** The environment's two foam shades (environment decor: radio booth foam). */
const FOAM_A = new THREE.Color('#2F333B')
const FOAM_B = new THREE.Color('#3A3F48')

type P = [number, number, number]

function push(out: number[], ...pts: P[]): void {
  for (const p of pts) out.push(p[0], p[1], p[2])
}

/** One tile in local XY (the wall plane), wedges protruding along +Z, ridges along Y. */
export function wedgeTileGeometry(): THREE.BufferGeometry {
  const pos: number[] = []
  const w = TILE / RIDGES
  const h = TILE / 2
  for (let i = 0; i < RIDGES; i++) {
    const x0 = -TILE / 2 + i * w
    const xm = x0 + w / 2
    const x1 = x0 + w
    // left slope
    push(pos, [x0, -h, 0], [xm, -h, DEPTH], [xm, h, DEPTH], [x0, -h, 0], [xm, h, DEPTH], [x0, h, 0])
    // right slope
    push(pos, [xm, -h, DEPTH], [x1, -h, 0], [x1, h, 0], [xm, -h, DEPTH], [x1, h, 0], [xm, h, DEPTH])
    // top + bottom end caps
    push(pos, [x0, h, 0], [xm, h, DEPTH], [x1, h, 0])
    push(pos, [x1, -h, 0], [xm, -h, DEPTH], [x0, -h, 0])
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  g.computeBoundingSphere()
  return g
}

export interface FoamTile {
  x: number
  y: number
  z: number
  /** Wall yaw: rotates the tile's +Z onto the wall's inward normal. */
  yaw: number
  /** Checkerboard: wedges run vertically, or horizontally when turned. */
  turned: boolean
}

/** Tile placements (pure; exported for tests). */
export function foamTiles(): FoamTile[] {
  const tiles: FoamTile[] = []
  FLANK_Y.forEach((y, r) => {
    FLANK_Z.forEach((z, c) => {
      // east wall, facing west (−X) into the booth
      tiles.push({ x: IN.maxX - OFF, y, z, yaw: -Math.PI / 2, turned: (r + c) % 2 === 1 })
    })
  })
  return tiles
}

const Y_AXIS = new THREE.Vector3(0, 1, 0)
const Z_AXIS = new THREE.Vector3(0, 0, 1)

export function AcousticFoam({ shadows }: { shadows: boolean }) {
  const mesh = useMemo(() => {
    const tiles = foamTiles()
    const geo = wedgeTileGeometry()
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, metalness: 0 })
    const m = new THREE.InstancedMesh(geo, mat, tiles.length)
    m.name = 'acoustic-foam'
    const mtx = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const roll = new THREE.Quaternion()
    const p = new THREE.Vector3()
    const one = new THREE.Vector3(1, 1, 1)
    const c = new THREE.Color()
    tiles.forEach((t, i) => {
      q.setFromAxisAngle(Y_AXIS, t.yaw)
      if (t.turned) q.multiply(roll.setFromAxisAngle(Z_AXIS, Math.PI / 2))
      mtx.compose(p.set(t.x, t.y, t.z), q, one)
      m.setMatrixAt(i, mtx)
      // the env's two shades, plus a slight per-tile value variation
      const v = 0.94 + ((i * 37) % 11) / 90
      m.setColorAt(i, c.copy(t.turned ? FOAM_B : FOAM_A).multiplyScalar(v))
    })
    m.instanceMatrix.needsUpdate = true
    m.computeBoundingSphere()
    m.castShadow = false
    return m
  }, [])
  useEffect(
    () => () => {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
      mesh.dispose()
    },
    [mesh],
  )
  return <primitive object={mesh} receiveShadow={shadows} />
}
