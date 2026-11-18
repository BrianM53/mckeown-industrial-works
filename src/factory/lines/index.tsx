/**
 * PRODUCTION SPINE (module root) — five visibly different process lines
 * feeding the rocket tower, the elevated collector, the payload monorail with
 * its QC scanner arch, and the Line Supervisor Console (3D).
 *
 * Everything moves from factory.state (read in useFrame): line phase / items /
 * status / defectFlash / rate / beltSpeed — no independent timers, so the
 * press ram hits bottom exactly when the audio thump plays (phase 0.5).
 *
 *   Debug: __MIW__.lines.stats() · .spots() · .colliders() · .reject() · .visitor() · .defect(id, s)
 *   Worker spots for the npc module: import { LINE_WORKER_SPOTS } from '@/factory/lines/spots'
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { CuboidCollider, CylinderCollider, RigidBody } from '@react-three/rapier'
import { GROUPS } from '@/core/collision'
import { registerDebug } from '@/core/debug'
import type { LineId } from '@/core/types'
import { useInteractable } from '@/core/interaction'
import { useGameStore } from '@/state/game'
import { useSettings } from '@/state/settings'
import { useUIStore } from '@/state/ui'
import { factory } from '@/systems/factory'
import { ANCHORS } from '@/world/layout'
import { COLLIDERS } from './config'
import { loadLineFonts } from './render/fonts'
import { ALL_LINE_WORKER_SPOTS } from './spots'
import { buildProduction } from './world'

const CONSOLE_POS = { x: ANCHORS.console.interact[0], y: 0, z: ANCHORS.console.interact[1] }

export default function ProductionLines() {
  const quality = useGameStore((s) => s.quality)
  const reduced = useSettings((s) => s.reducedMotion)
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced
  // Heavy geometry is built once for the tier active at load; later tier
  // changes (auto-downgrade) only toggle shadows and particle caps.
  const [buildTier] = useState(() => useGameStore.getState().quality)
  const world = useMemo(() => buildProduction(buildTier), [buildTier])

  useEffect(() => () => world.dispose(), [world])

  useEffect(() => {
    let alive = true
    loadLineFonts().then(() => {
      if (alive) world.atlas.redraw()
    })
    return () => {
      alive = false
    }
  }, [world])

  useEffect(() => world.setQuality(quality), [world, quality])

  useInteractable({
    id: 'station:console',
    verb: 'Operate',
    label: 'Line Supervisor Console',
    getPosition: () => CONSOLE_POS,
    onInteract: () => useUIStore.getState().openPanel('console'),
  })

  useEffect(
    () =>
      registerDebug('lines', {
        stats: () => world.stats(),
        spots: () => ALL_LINE_WORKER_SPOTS.map((s) => ({ ...s })),
        colliders: () => COLLIDERS.map((c) => ({ ...c })),
        /** Drop a payload pod into the reject bin (visual + boing). */
        reject: () => {
          world.payload.debugReject()
          return world.payload.stats()
        },
        /** Simulate the visitor walking through the QC arch (toast respects the 60 s rate limit). */
        visitor: () => {
          world.payload.debugVisitor()
          return world.payload.stats()
        },
        /**
         * Test hook: make a line's QC catch a defect right now (sets
         * factory.state.lines[id].defectFlash, which the sim decays) — tank
         * steam leak, circuit rack red, payload pod into the reject bin…
         */
        defect: (id: LineId = 'tank', seconds = 2.5) => {
          const L = factory.state.lines[id]
          if (!L) return null
          L.defectFlash = Math.max(L.defectFlash, Number.isFinite(seconds) ? seconds : 2.5)
          return { id, defectFlash: L.defectFlash }
        },
      }),
    [world],
  )

  useFrame((_, delta) => world.update(delta, reducedRef.current))

  return (
    <>
      <primitive object={world.group} />
      <LineColliders />
    </>
  )
}

function LineColliders() {
  return (
    <RigidBody type="fixed" colliders={false} name="production-lines">
      {COLLIDERS.map((c) => {
        const cy = (c.y0 + c.y1) / 2
        const hy = (c.y1 - c.y0) / 2
        const groups = c.group === 'camera' ? GROUPS.cameraBlocker : GROUPS.static
        if (c.shape === 'cyl' && c.c && c.r) {
          return <CylinderCollider key={c.id} args={[hy, c.r]} position={[c.c[0], cy, c.c[1]]} collisionGroups={groups} />
        }
        const r = c.rect
        return (
          <CuboidCollider
            key={c.id}
            args={[(r.maxX - r.minX) / 2, hy, (r.maxZ - r.minZ) / 2]}
            position={[(r.minX + r.maxX) / 2, cy, (r.minZ + r.maxZ) / 2]}
            collisionGroups={groups}
          />
        )
      })}
    </RigidBody>
  )
}
