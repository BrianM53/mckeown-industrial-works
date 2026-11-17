import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useSettings } from '@/state/settings'
import { buildKit } from '../lib/batch'
import { envMats } from '../lib/envMaterials'
import { roofOpacity } from './StaticWorld'
import type { Spinner } from './types'

/** Instanced rotating parts: fan rotors, roof whirlybirds and the R&D radar dish. */
let fanGeo: THREE.BufferGeometry | null = null
let turbineGeo: THREE.BufferGeometry | null = null
let radarGeo: THREE.BufferGeometry | null = null

function geometryFor(kind: Spinner['kind']): THREE.BufferGeometry {
  if (kind === 'fan') {
    fanGeo ??= buildKit((b) => {
      b.cylY('k', 0, -0.05, 0, 0.16, 0.1, '#3A4042', 10)
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2
        b.box('k', Math.cos(a) * 0.56, 0, Math.sin(a) * 0.56, 0.8, 0.02, 0.22, '#9AA3A5', -a, 0.35, 0)
      }
    })
    return fanGeo
  }
  if (kind === 'turbine') {
    turbineGeo ??= buildKit((b) => {
      b.sphere('k', 0, 0.35, 0, 0.95, '#B9C0C2', 14, 8, 0.75)
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2
        b.box('k', Math.cos(a) * 0.92, 0.3, Math.sin(a) * 0.92, 0.06, 0.62, 0.32, '#8D979A', -a + 0.5)
      }
      b.cylY('k', 0, 0.98, 0, 0.12, 0.08, '#5A6265', 8)
    })
    return turbineGeo
  }
  radarGeo ??= buildKit((b) => {
    const pts: THREE.Vector2[] = []
    for (let k = 0; k <= 8; k++) {
      const t = k / 8
      pts.push(new THREE.Vector2(t, t * t * 0.35))
    }
    const dish = new THREE.LatheGeometry(pts, 18)
    b.geo('k', dish, [0, 0.2, 0.15], [-1.25, 0, 0], [1, 1, 1], '#E2E4DE')
    b.cylBetween('k', [0, 0.2, 0.15], [0, 0.55, -0.45], 0.03, '#5A6265', 5)
    b.box('k', 0, 0.05, 0, 0.3, 0.3, 0.3, '#5A6265')
  })
  return radarGeo
}

const _q = new THREE.Quaternion()
const _qb = new THREE.Quaternion()
const _qs = new THREE.Quaternion()
const _m = new THREE.Matrix4()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _f = new THREE.Vector3()
const Y = new THREE.Vector3(0, 1, 0)

function SpinnerSet({ kind, list }: { kind: Spinner['kind']; list: Spinner[] }) {
  const reduced = useSettings((s) => s.reducedMotion)
  const mesh = useMemo(() => {
    const m = new THREE.InstancedMesh(geometryFor(kind), envMats.kit(), list.length)
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    m.frustumCulled = false
    m.castShadow = false
    m.receiveShadow = true
    m.name = `env-spin:${kind}`
    for (let i = 0; i < list.length; i++) m.setColorAt(i, new THREE.Color('#ffffff'))
    return m
  }, [kind, list])
  const bases = useMemo(
    () =>
      list.map((s) => {
        if (s.vertical) return new THREE.Quaternion()
        _f.set(-Math.sin(s.yaw), 0, -Math.cos(s.yaw))
        return new THREE.Quaternion().setFromUnitVectors(Y, _f)
      }),
    [list],
  )
  useEffect(() => () => mesh.dispose(), [mesh])
  useFrame((state) => {
    const t = state.clock.elapsedTime
    const slow = reduced ? 0.35 : 1
    for (let i = 0; i < list.length; i++) {
      const s = list[i]
      const vis = s.building ? (roofOpacity.get(s.building) ?? 1) > 0.5 : true
      _qb.copy(bases[i])
      _qs.setFromAxisAngle(Y, t * s.speed * slow + i * 1.7)
      _q.multiplyQuaternions(_qb, _qs)
      _m.compose(_p.set(s.x, s.y, s.z), _q, vis ? _s.setScalar(s.radius) : _s.setScalar(0))
      mesh.setMatrixAt(i, _m)
    }
    mesh.instanceMatrix.needsUpdate = true
  })
  return <primitive object={mesh} />
}

export function Spinners({ spinners }: { spinners: Spinner[] }) {
  const groups = useMemo(() => {
    const g: Record<Spinner['kind'], Spinner[]> = { fan: [], turbine: [], radar: [] }
    for (const s of spinners) g[s.kind].push(s)
    return g
  }, [spinners])
  return (
    <group name="env-spinners">
      {(Object.keys(groups) as Spinner['kind'][]).map((k) => (groups[k].length ? <SpinnerSet key={k} kind={k} list={groups[k]} /> : null))}
    </group>
  )
}
