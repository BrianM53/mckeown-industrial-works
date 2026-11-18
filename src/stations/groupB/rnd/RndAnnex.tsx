import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'
import { registerDebug } from '@/core/debug'
import { events } from '@/core/events'
import { useInteractable } from '@/core/interaction'
import { runtime } from '@/core/runtime'
import { useUIStore } from '@/state/ui'
import { ZONES } from '@/world/layout'
import { BatchMeshes } from '../shared/BatchMeshes'
import { StaticColliders } from '../shared/colliders'
import { useQuality, useReducedMotion } from '../shared/hooks'
import { annexColliders, benchInteractPoint, buildAnnexStatic, type BenchAssignment } from './annex'
import { DoNotPress } from './DoNotPress'
import { assignBenches, genericStationProjects, INFO_INTERACT } from './layout'
import { RowingModel } from './rowing'
import { RowRig } from './RowRig'
import { buildRndSigns, makeRndSignMaterials } from './signs'
import { SlamScanner } from './SlamScanner'

/**
 * R&D ANNEX (spec §5.6 + §16): Gaussian-SLAM scanner, Row-Pergfect test rig,
 * DO NOT PRESS, the annex directory board (→ 'rnd' panel) and a generic,
 * data-driven ProjectStation bench for every other featured R&D project in
 * PROJECTS (none today: both featured projects have bespoke machines).
 *
 * The contents render while the player is inside, or while the camera is
 * outdoors within sight of the annex (it has low N/S windows and a glass door).
 */
const CENTER = { x: ZONES.rnd.center[0], z: ZONES.rnd.center[1] }
const SEE_RANGE = 40

function useAnnexGate(ref: RefObject<THREE.Object3D | null>): void {
  const acc = useRef(1)
  useFrame((_, dt) => {
    acc.current += dt
    if (acc.current < 0.2) return
    acc.current = 0
    const o = ref.current
    if (!o) return
    const inside = runtime.world.interior
    const c = runtime.camera.position
    let vis = inside === 'rnd'
    if (!vis && inside === null) vis = !Number.isFinite(c.x) || !Number.isFinite(c.z) || Math.hypot(c.x - CENTER.x, c.z - CENTER.z) < SEE_RANGE
    if (o.visible !== vis) o.visible = vis
  })
}

function InfoInteract() {
  useInteractable({
    id: 'rnd:info',
    verb: 'Read',
    label: 'R&D Annex Directory',
    radius: 2.2,
    priority: 0.1,
    getPosition: () => ({ x: INFO_INTERACT[0], y: 0, z: INFO_INTERACT[1] }),
    onInteract: () => {
      events.emit('sfx', { name: 'ui-click', volume: 0.6 })
      useUIStore.getState().openPanel('rnd')
    },
  })
  return null
}

/** ProjectStation: one generic bench per extra featured R&D project (data-driven). */
function BenchInteract({ a }: { a: BenchAssignment }) {
  const p = benchInteractPoint(a.slot)
  useInteractable({
    id: `rnd:bench:${a.project.id}`,
    verb: 'Inspect',
    label: a.project.name,
    radius: 2.2,
    priority: 0.2,
    getPosition: () => ({ x: p.x, y: 0, z: p.z }),
    onInteract: () => {
      events.emit('sfx', { name: 'scanner-beep', position: [a.slot.x, 1.2, a.slot.z], volume: 0.6 })
      useUIStore.getState().openPanel('project', { projectId: a.project.id })
    },
  })
  return null
}

export function RndAnnex() {
  const root = useRef<THREE.Group>(null)
  const quality = useQuality()
  const reduced = useReducedMotion()
  const benches = useMemo(() => assignBenches(genericStationProjects()), [])
  const built = useMemo(() => {
    const signs = buildRndSigns(benches.map((b) => b.project))
    const mats = makeRndSignMaterials(signs.texture)
    const geos = buildAnnexStatic(signs.uv, benches)
    return { signs, mats, geos }
  }, [benches])
  const colliders = useMemo(() => annexColliders(benches), [benches])
  const model = useMemo(() => new RowingModel(62), [])
  const scanDebug = useMemo(() => ({ forceProgress: null as number | null }), [])
  useAnnexGate(root)

  useEffect(
    () => () => {
      built.mats.sign.dispose()
      built.mats.lit.dispose()
      built.signs.texture.dispose()
    },
    [built],
  )

  useEffect(
    () =>
      registerDebug('rnd', {
        /** Pin the scanner reconstruction at 0..1 (null = live cycle). */
        setScanProgress: (p: number | null) => {
          scanDebug.forceProgress = p === null || !Number.isFinite(p) ? null : Math.min(1, Math.max(0, p))
        },
        rowing: () => ({ phase: model.pose.phase, error: model.pose.error, score: +model.pose.score.toFixed(2), lamps: { ...model.pose.lamps } }),
        benches: () => benches.map((b) => ({ projectId: b.project.id, x: b.slot.x, z: b.slot.z })),
        visible: () => !!root.current?.visible,
      }),
    [scanDebug, model, benches],
  )

  return (
    <group name="stations-b:rnd-annex">
      <group ref={root}>
        <BatchMeshes geos={built.geos} shadows={false} materials={{ sign: built.mats.sign, signLit: built.mats.lit }} name="rnd" />
        <SlamScanner quality={quality} reduced={reduced} debug={scanDebug} />
        <RowRig uv={built.signs.uv} reduced={reduced} model={model} signMat={built.mats.sign} />
        <DoNotPress uv={built.signs.uv} signMat={built.mats.sign} quality={quality} reduced={reduced} />
      </group>
      <StaticColliders defs={colliders} name="stations-b:rnd-colliders" />
      <InfoInteract />
      {benches.map((a) => (
        <BenchInteract key={a.project.id} a={a} />
      ))}
    </group>
  )
}
