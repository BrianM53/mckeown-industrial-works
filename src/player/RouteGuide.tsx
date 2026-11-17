import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { events } from '@/core/events'
import { runtime } from '@/core/runtime'
import { useUIStore } from '@/state/ui'
import { ZONES, zoneAt, type ZoneId } from '@/world/layout'
import { routeToZone } from '@/world/nav'
import { ROUTE } from './constants'
import { buildPolyline, distanceToPolyline, projectOnPolyline, sampleAt, type Polyline } from './routeMath'

/**
 * Directory assisted route: a glowing dashed chevron line on the ground from
 * the worker to the destination entrance (one instanced draw call), plus a tall
 * translucent light beacon at the entrance. Recomputes when the visitor strays,
 * clears itself on arrival.
 */

// ---- shared geometry/materials (module-level, created once)

function chevronShape(): THREE.Shape {
  const s = new THREE.Shape()
  // a fat "^" pointing toward -Z (forward) in the XZ plane (drawn in XY, rotated below)
  s.moveTo(0, 0.3)
  s.lineTo(0.38, -0.08)
  s.lineTo(0.38, -0.26)
  s.lineTo(0, 0.1)
  s.lineTo(-0.38, -0.26)
  s.lineTo(-0.38, -0.08)
  s.closePath()
  return s
}

/** Two-tone chevron in ONE geometry: dark outline (vertex color ~0) under a fill (vertex color 1). */
function chevronGeometry(): THREE.BufferGeometry {
  const fill = new THREE.ShapeGeometry(chevronShape())
  const outline = new THREE.ShapeGeometry(chevronShape())
  outline.translate(0, -0.02, 0)
  outline.scale(1.32, 1.32, 1)
  const parts: Array<[THREE.BufferGeometry, number, number]> = [
    [outline, 0.12, 0],
    [fill, 1, 0.004],
  ]
  let n = 0
  for (const [g] of parts) n += g.getAttribute('position').count
  const pos = new Float32Array(n * 3)
  const col = new Float32Array(n * 3)
  const idx: number[] = []
  let o = 0
  for (const [g, shade, lift] of parts) {
    const pa = g.getAttribute('position')
    for (let i = 0; i < pa.count; i++) {
      // XY → XZ with the tip toward -Z, lifted slightly for the fill
      pos[(o + i) * 3] = pa.getX(i)
      pos[(o + i) * 3 + 1] = lift
      pos[(o + i) * 3 + 2] = -pa.getY(i)
      col[(o + i) * 3] = col[(o + i) * 3 + 1] = col[(o + i) * 3 + 2] = shade
    }
    const gi = g.index
    if (gi) for (let i = 0; i < gi.count; i++) idx.push(o + gi.getX(i))
    o += pa.count
    g.dispose()
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  out.setAttribute('color', new THREE.BufferAttribute(col, 3))
  out.setIndex(idx)
  out.computeBoundingSphere()
  return out
}

let CHEVRON: THREE.BufferGeometry | null = null
let BEACON: THREE.BufferGeometry | null = null
let BEACON_CORE: THREE.BufferGeometry | null = null
let RING: THREE.BufferGeometry | null = null
let DIAMOND: THREE.BufferGeometry | null = null

/** Open cylinder whose vertex alpha fades out with height (normal blending). */
function beaconGeometry(radius: number, height: number, power: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, radius * 1.1, height, 28, 8, true)
  g.translate(0, height / 2, 0)
  const pos = g.getAttribute('position')
  const colors = new Float32Array(pos.count * 4)
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / height
    colors[i * 4] = colors[i * 4 + 1] = colors[i * 4 + 2] = 1
    colors[i * 4 + 3] = Math.pow(1 - t, power)
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 4))
  return g
}

function shared() {
  if (!CHEVRON) CHEVRON = chevronGeometry()
  if (!BEACON) BEACON = beaconGeometry(0.9, 18, 1.35)
  if (!BEACON_CORE) BEACON_CORE = beaconGeometry(0.2, 24, 0.9)
  if (!RING) RING = new THREE.RingGeometry(1.1, 1.42, 48).rotateX(-Math.PI / 2)
  if (!DIAMOND) DIAMOND = new THREE.OctahedronGeometry(0.42, 0)
  return { chevron: CHEVRON, beacon: BEACON, core: BEACON_CORE, ring: RING, diamond: DIAMOND }
}

/** A saturated, mid-light version of a zone color that reads on concrete. */
function vivid(hex: string, lightness = 0.58): THREE.Color {
  const c = new THREE.Color(hex)
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl, THREE.SRGBColorSpace)
  const s = hsl.s < 0.15 ? hsl.s : Math.max(hsl.s, 0.72)
  const l = hsl.s < 0.15 ? Math.max(hsl.l, 0.8) : Math.min(Math.max(hsl.l, lightness - 0.04), lightness + 0.04)
  return c.setHSL(hsl.h, s, l, THREE.SRGBColorSpace)
}

export function RouteGuide() {
  const target = useUIStore((s) => s.routeTarget)
  if (!target || !Object.prototype.hasOwnProperty.call(ZONES, target)) return null
  return <ActiveRoute key={target} zoneId={target as ZoneId} />
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const _sample = { x: 0, z: 0, dx: 0, dz: -1 }

function ActiveRoute({ zoneId }: { zoneId: ZoneId }) {
  const zone = ZONES[zoneId]
  const geo = shared()
  const mats = useMemo(() => {
    const base = vivid(zone.color)
    return {
      chevron: new THREE.MeshBasicMaterial({
        color: base,
        vertexColors: true,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
      beacon: new THREE.MeshBasicMaterial({
        color: base,
        vertexColors: true,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        fog: false,
      }),
      core: new THREE.MeshBasicMaterial({
        color: vivid(zone.color, 0.78),
        vertexColors: true,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      }),
      ring: new THREE.MeshBasicMaterial({
        color: base,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
      diamond: new THREE.MeshBasicMaterial({ color: base, toneMapped: false, fog: false }),
    }
  }, [zone.color])
  useEffect(
    () => () => {
      for (const m of Object.values(mats)) m.dispose()
    },
    [mats],
  )

  const inst = useRef<THREE.InstancedMesh>(null)
  const ringRef = useRef<THREE.Mesh>(null)
  const diamondRef = useRef<THREE.Mesh>(null)
  const beaconRef = useRef<THREE.Group>(null)
  const st = useRef<{ poly: Polyline; recheck: number; t: number; arrived: boolean }>({
    poly: buildPolyline(routeToZone(runtime.player.position.x, runtime.player.position.z, zoneId)),
    recheck: 0,
    t: 0,
    arrived: false,
  })

  useFrame((_, rawDt) => {
    const dt = Math.min(Math.max(rawDt, 0), 0.1)
    const s = st.current
    s.t += dt
    const px = runtime.player.position.x
    const pz = runtime.player.position.z
    const [ex, ez] = zone.entrance

    // arrival
    if (!s.arrived && (Math.hypot(px - ex, pz - ez) <= ROUTE.arriveRadius || zoneAt(px, pz) === zoneId)) {
      s.arrived = true
      events.emit('toast', { text: `Arrived: ${zone.name}`, kind: 'success', duration: 2600 })
      // defer the store write out of the render loop tick
      queueMicrotask(() => {
        if (useUIStore.getState().routeTarget === zoneId) useUIStore.getState().setRouteTarget(null)
      })
      return
    }

    // recompute when the visitor strays (≤ 1 Hz)
    s.recheck += dt
    if (s.recheck >= 1) {
      s.recheck = 0
      if (distanceToPolyline(s.poly, px, pz) > ROUTE.strayDistance) s.poly = buildPolyline(routeToZone(px, pz, zoneId))
    }

    // chevrons marching along the remaining route
    const mesh = inst.current
    if (mesh) {
      const poly = s.poly
      const from = projectOnPolyline(poly, px, pz).s + ROUTE.lead
      const end = poly.length - 0.6
      const offset = (s.t * ROUTE.marchSpeed) % ROUTE.spacing
      let i0 = Math.max(0, Math.ceil((from - offset) / ROUTE.spacing))
      let n = 0
      for (; n < ROUTE.maxChevrons; i0++) {
        const sArc = i0 * ROUTE.spacing + offset
        if (sArc > end) break
        sampleAt(poly, sArc, _sample)
        // grow in near the worker, shrink out at the destination
        const grow = Math.min(1, (sArc - from) / 1.6 + 0.15)
        const shrink = Math.min(1, (end - sArc) / 2.2 + 0.2)
        const sc = Math.max(0.05, Math.min(grow, shrink))
        const yaw = Math.atan2(-_sample.dx, -_sample.dz)
        _q.setFromAxisAngle(_up, yaw)
        _p.set(_sample.x, ROUTE.y, _sample.z)
        _s.set(sc * 1.15, 1, sc * 1.15)
        mesh.setMatrixAt(n, _m.compose(_p, _q, _s))
        n++
      }
      mesh.count = n
      mesh.instanceMatrix.needsUpdate = true
    }

    // beacon pulse
    const pulse = 0.5 + 0.5 * Math.sin(s.t * 3)
    if (ringRef.current) {
      const k = 1 + pulse * 0.12
      ringRef.current.scale.set(k, 1, k)
      ;(ringRef.current.material as THREE.MeshBasicMaterial).opacity = 0.55 + pulse * 0.35
    }
    if (diamondRef.current) {
      diamondRef.current.position.y = 3.4 + Math.sin(s.t * 2.2) * 0.25
      diamondRef.current.rotation.y += dt * 1.6
    }
    if (beaconRef.current) {
      const b = beaconRef.current.children[0] as THREE.Mesh | undefined
      if (b) (b.material as THREE.MeshBasicMaterial).opacity = 0.26 + pulse * 0.1
    }
  })

  return (
    <group name={`route-guide:${zoneId}`}>
      <instancedMesh ref={inst} args={[geo.chevron, mats.chevron, ROUTE.maxChevrons]} frustumCulled={false} renderOrder={1} />
      <group ref={beaconRef} position={[zone.entrance[0], 0, zone.entrance[1]]}>
        <mesh geometry={geo.beacon} material={mats.beacon} renderOrder={3} />
        <mesh geometry={geo.core} material={mats.core} renderOrder={3} />
        <mesh ref={ringRef} geometry={geo.ring} material={mats.ring} position={[0, 0.05, 0]} renderOrder={2} />
        <mesh ref={diamondRef} geometry={geo.diamond} material={mats.diamond} position={[0, 3.4, 0]} scale={[1, 1.5, 1]} />
      </group>
    </group>
  )
}
