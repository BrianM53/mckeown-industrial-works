import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useSettings } from '@/state/settings'
import { textures } from '@/world/materials'
import { ANCHORS, ZONES } from '@/world/layout'
import { Builder, type V3 } from '../lib/builder'
import type { Atlas } from '../lib/canvas'
import { C } from '../lib/materials'
import { BuiltMeshes, StaticColliders, useBuilt, type BoxCol } from '../lib/react'

/**
 * RADIO MAST (ANCHORS.radioMast, outside the Broadcast Booth's south-east
 * corner): a ~31 m tapering square lattice tower in red/white aviation bands
 * with microwave dishes, panel antennas, a service platform and ladder, a
 * flashing red top beacon (gentle pulse with reduced motion) and steady mid
 * lights. A landmark visible from the east avenue. Coax drops to the booth.
 */
const [MX, MZ] = ANCHORS.radioMast.position as [number, number]
export const MAST = { height: 27, base: 1.3, top: 0.35, sections: 10, whip: 4.2 }
const RADIO_FP = ZONES.radio.building!.footprint
const BEACON_Y = MAST.height + MAST.whip + 0.15
const CABINET = { x: MX + 2.1, z: MZ + 1.2 }

export function halfWidthAt(y: number): number {
  const f = Math.max(0, Math.min(1, y / MAST.height))
  return MAST.base + (MAST.top - MAST.base) * f
}

function corner(y: number, sx: number, sz: number): V3 {
  const h = halfWidthAt(y)
  return [MX + sx * h, y, MZ + sz * h]
}

const CORNERS: [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
]

function buildMast(cells: Record<string, { uv: [number, number, number, number] }>): Builder {
  const b = new Builder()
  const RED = '#C8372B'
  const WHITE = '#E8E4DA'
  const dy = MAST.height / MAST.sections
  // ---- lattice -----------------------------------------------------------------
  for (let s = 0; s < MAST.sections; s++) {
    const y0 = s * dy
    const y1 = (s + 1) * dy
    const color = s % 2 === 0 ? RED : WHITE
    const legR = 0.075 - s * 0.003
    for (let c = 0; c < 4; c++) {
      const [sx, sz] = CORNERS[c]
      const [nx, nz] = CORNERS[(c + 1) % 4]
      b.tube('paint', corner(y0, sx, sz), corner(y1, sx, sz), legR, color, 6)
      b.tube('paint', corner(y1, sx, sz), corner(y1, nx, nz), 0.035, color, 5)
      // X bracing on this face
      b.tube('paint', corner(y0, sx, sz), corner(y1, nx, nz), 0.025, color, 4)
      b.tube('paint', corner(y0, nx, nz), corner(y1, sx, sz), 0.025, color, 4)
    }
  }
  // ---- top whip with dipoles ------------------------------------------------------
  b.cyl('metal', MX, MAST.height, MZ, 0.07, MAST.whip, C.steelLight, 8, 0.035)
  for (let k = 0; k < 3; k++) {
    const y = MAST.height + 0.9 + k * 1.05
    b.tube('metal', [MX - 0.55, y, MZ], [MX + 0.55, y, MZ], 0.018, C.steelLight, 5)
    b.tube('metal', [MX, y + 0.5, MZ - 0.45], [MX, y + 0.5, MZ + 0.45], 0.018, C.steelLight, 5)
  }
  b.cyl('paint', MX, BEACON_Y - 0.22, MZ, 0.1, 0.12, C.charcoal, 10)
  // ---- service platform ----------------------------------------------------------------
  const py = dy * 7
  const ph = halfWidthAt(py) + 0.45
  b.box('paint', [MX, py, MZ], [ph * 2, 0.06, ph * 2], '#3a4244')
  for (const [sx, sz] of CORNERS) b.cyl('paint', MX + sx * ph, py, MZ + sz * ph, 0.025, 1.0, C.hazard, 5)
  for (let c = 0; c < 4; c++) {
    const [sx, sz] = CORNERS[c]
    const [nx, nz] = CORNERS[(c + 1) % 4]
    b.tube('paint', [MX + sx * ph, py + 1.0, MZ + sz * ph], [MX + nx * ph, py + 1.0, MZ + nz * ph], 0.022, C.hazard, 5)
    b.tube('paint', [MX + sx * ph, py + 0.5, MZ + sz * ph], [MX + nx * ph, py + 0.5, MZ + nz * ph], 0.016, C.hazard, 5)
  }
  // ---- microwave dishes (west & south faces) + panel antennas -------------------------
  const dishes: { y: number; dir: [number, number] }[] = [
    { y: dy * 8 + 0.6, dir: [-1, 0] },
    { y: dy * 6 + 1.2, dir: [0, 1] },
  ]
  for (const d of dishes) {
    const h = halfWidthAt(d.y)
    const cx = MX + d.dir[0] * (h + 0.35)
    const cz = MZ + d.dir[1] * (h + 0.35)
    const axis: 'x' | 'z' = d.dir[0] !== 0 ? 'x' : 'z'
    b.tube('paint', [MX + d.dir[0] * h, d.y, MZ + d.dir[1] * h], [cx, d.y, cz], 0.04, C.steel, 6)
    b.cylAxis('paint', [cx, d.y, cz], axis, 0.62, 0.16, '#d8d6cf', 18, 0.45)
    b.cylAxis('paint', [cx + d.dir[0] * 0.09, d.y, cz + d.dir[1] * 0.09], axis, 0.5, 0.03, '#b9b7b0', 18)
  }
  const ay = MAST.height - 2.2
  for (const [sx, sz] of CORNERS) {
    const h = halfWidthAt(ay) + 0.18
    b.box('paint', [MX + sx * h, ay, MZ + sz * h], [0.22, 1.5, 0.12], '#efece4', [0, Math.atan2(sx, sz), 0])
  }
  // ---- ladder up the north-west leg + coax run --------------------------------------
  for (let y = 0.4; y < MAST.height - 0.3; y += 0.36) {
    const a = corner(y, -1, -1)
    b.tube('metal', [a[0] + 0.05, y, a[2] + 0.25], [a[0] + 0.25, y, a[2] + 0.05], 0.012, C.steelLight, 4)
  }
  b.tube('dark', corner(0.9, 1, -1), corner(MAST.height - 2.4, 1, -1), 0.045, C.rubber, 6)
  // ---- base: gravel pad, footings, transmitter cabinet + RF sign ---------------------
  b.box('paint', [MX, 0.03, MZ], [3.8, 0.06, 3.8], '#8a8880')
  for (const [sx, sz] of CORNERS) b.box('paint', [MX + sx * MAST.base, 0.2, MZ + sz * MAST.base], [0.6, 0.4, 0.6], '#a19e93')
  b.rbox('paint', [CABINET.x, 0.85, CABINET.z], [0.9, 1.7, 0.7], 0.04, '#9aa3a6')
  b.box('paint', [CABINET.x - 0.452, 0.9, CABINET.z], [0.01, 1.2, 0.5], '#8a9396')
  for (let k = 0; k < 6; k++) b.box('dark', [CABINET.x - 0.455, 1.3 + k * 0.05, CABINET.z], [0.01, 0.02, 0.4], '#2a2f30')
  b.plane('atlas', [CABINET.x - 0.458, 0.75, CABINET.z], 0.33, 0.3, '#ffffff', [0, -Math.PI / 2, 0], cells.rf?.uv ?? null)
  b.cyl('glow', CABINET.x - 0.2, 1.7, CABINET.z - 0.2, 0.04, 0.05, new THREE.Color('#5dff7a').multiplyScalar(2))
  // coax bundle from the tower to the booth's east wall (sagging in a gentle catenary)
  const a: V3 = corner(3.8, -1, -1)
  const w: V3 = [RADIO_FP.maxX + 0.03, 4.5, RADIO_FP.maxZ - 0.8]
  let prev: V3 = a
  for (let k = 1; k <= 6; k++) {
    const t = k / 6
    const p: V3 = [a[0] + (w[0] - a[0]) * t, a[1] + (w[1] - a[1]) * t - Math.sin(Math.PI * t) * 0.35, a[2] + (w[2] - a[2]) * t]
    b.tube('dark', prev, p, 0.035, C.rubber, 6)
    prev = p
  }
  b.box('paint', [w[0] + 0.03, w[1], w[2]], [0.06, 0.3, 0.3], C.charcoal)
  return b
}

export const MAST_BOXES: BoxCol[] = [
  { c: [MX, 1.6, MZ], h: [MAST.base + 0.32, 1.6, MAST.base + 0.32] },
  { c: [CABINET.x, 0.85, CABINET.z], h: [0.46, 0.85, 0.36] },
]

export function RadioMast({ shadows, atlas, atlasMat }: { shadows: boolean; atlas: Atlas; atlasMat: THREE.Material }) {
  const meshes = useBuilt(() => buildMast(atlas.cells), [atlas])
  const reduced = useSettings((s) => s.reducedMotion)
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced

  const lights = useMemo(() => {
    const geo = new THREE.SphereGeometry(1, 12, 8)
    const topMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2a1c').multiplyScalar(3) })
    const midMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2a1c').multiplyScalar(2) })
    const halo = new THREE.SpriteMaterial({ map: textures.glowDot(), color: '#ff3a26', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8, toneMapped: false })
    return { geo, topMat, midMat, halo }
  }, [])
  useEffect(
    () => () => {
      lights.geo.dispose()
      lights.topMat.dispose()
      lights.midMat.dispose()
      lights.halo.dispose()
    },
    [lights],
  )
  const topRef = useRef<THREE.Mesh>(null)
  const haloRef = useRef<THREE.Sprite>(null)
  const t = useRef(0)

  useFrame((_, dt) => {
    t.current += Math.min(Math.max(dt, 0), 0.1)
    // aviation red: ~40 flashes / min; reduced motion = slow gentle pulse instead
    const k = reducedRef.current ? 0.55 + 0.45 * Math.sin(t.current * 1.6) : (t.current % 1.5) < 0.75 ? 1 : 0.06
    if (topRef.current) topRef.current.visible = k > 0.1
    if (haloRef.current) {
      haloRef.current.material.opacity = 0.85 * k
      haloRef.current.visible = k > 0.08
    }
  })

  const midY = MAST.height * 0.52
  const midH = halfWidthAt(midY)
  return (
    <group name="radio-mast">
      <BuiltMeshes meshes={meshes} shadows={shadows} materialFor={(key) => (key === 'atlas' ? atlasMat : undefined)} />
      <mesh ref={topRef} geometry={lights.geo} material={lights.topMat} position={[MX, BEACON_Y, MZ]} scale={0.17} />
      <sprite ref={haloRef} material={lights.halo} position={[MX, BEACON_Y, MZ]} scale={[2.6, 2.6, 2.6]} />
      <mesh geometry={lights.geo} material={lights.midMat} position={[MX - midH, midY, MZ - midH]} scale={0.1} />
      <mesh geometry={lights.geo} material={lights.midMat} position={[MX + midH, midY, MZ + midH]} scale={0.1} />
      <StaticColliders name="mast-colliders" boxes={MAST_BOXES} />
    </group>
  )
}
