import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useInteractable } from '@/core/interaction'
import { useUIStore } from '@/state/ui'
import { ANCHORS } from '@/world/layout'
import { Builder } from '../lib/builder'
import { canvasTexture, fitText, makeCanvas, roundRect } from '../lib/canvas'
import { C } from '../lib/materials'
import { BuiltMeshes, StaticColliders, useBuilt, type BoxCol } from '../lib/react'
import { drawDirectoryBoard } from './mapArt'

/**
 * DIRECTORY KIOSK (ANCHORS.directoryKiosk, intake plaza, facing east):
 * a lit "YOU ARE HERE" board whose map is generated from world/layout.ts.
 * "Read" opens the site directory panel.
 */
const [KX, KZ] = ANCHORS.directoryKiosk.position as [number, number]
const INTERACT = ANCHORS.directoryKiosk.interact as [number, number]
const BOARD = { w: 1.4, h: 1.9, y0: 0.64, x: KX + 0.06 }
const PX = { w: 700, h: 950 }

function buildKiosk(): Builder {
  const b = new Builder()
  const x = KX
  b.rbox('paint', [x - 0.02, 0.06, KZ], [0.55, 0.12, 1.85], 0.03, '#8c8a80')
  for (const dz of [-0.79, 0.79]) {
    b.box('paint', [x - 0.03, 1.44, KZ + dz], [0.1, 2.66, 0.1], C.gunmetal)
    b.box('paint', [x - 0.03, 0.17, KZ + dz], [0.2, 0.1, 0.2], C.charcoal)
  }
  // board backing + aluminium frame
  b.rbox('paint', [x - 0.03, BOARD.y0 + BOARD.h / 2, KZ], [0.09, BOARD.h + 0.12, BOARD.w + 0.12], 0.02, '#1b2122')
  for (const dz of [-1, 1]) b.box('metal', [BOARD.x - 0.005, BOARD.y0 + BOARD.h / 2, KZ + dz * (BOARD.w / 2 + 0.035)], [0.04, BOARD.h + 0.1, 0.03], C.steelLight)
  for (const y of [BOARD.y0 - 0.035, BOARD.y0 + BOARD.h + 0.035]) b.box('metal', [BOARD.x - 0.005, y, KZ], [0.04, 0.03, BOARD.w + 0.1], C.steelLight)
  // slanted rain hood with a hazard edge
  b.box('paint', [x + 0.12, BOARD.y0 + BOARD.h + 0.2, KZ], [0.5, 0.05, BOARD.w + 0.34], C.teal, [0, 0, -0.32])
  b.box('hazard', [x + 0.36, BOARD.y0 + BOARD.h + 0.12, KZ], [0.03, 0.07, BOARD.w + 0.34], '#ffffff', [0, 0, -0.32])
  // lamp bar under the hood (lights the board)
  b.box('paint', [x + 0.24, BOARD.y0 + BOARD.h + 0.08, KZ], [0.08, 0.05, BOARD.w - 0.1], C.charcoal)
  b.box('glow', [x + 0.24, BOARD.y0 + BOARD.h + 0.052, KZ], [0.05, 0.01, BOARD.w - 0.2], new THREE.Color('#FFE6BE').multiplyScalar(2.4))
  // "i" info cap sign on top
  b.rbox('paint', [x - 0.03, 2.98, KZ], [0.1, 0.36, 0.36], 0.04, C.blue)
  return b
}

export const KIOSK_BOXES: BoxCol[] = [{ c: [KX - 0.02, 1.45, KZ], h: [0.24, 1.45, 0.86] }]

export function DirectoryKiosk({ shadows }: { shadows: boolean }) {
  const meshes = useBuilt(buildKiosk, [])
  const board = useMemo(() => {
    const c = makeCanvas(PX.w, PX.h)
    drawDirectoryBoard(c.getContext('2d')!, PX.w, PX.h)
    const tex = canvasTexture(c, { anisotropy: 8 })
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.42, roughness: 0.45, metalness: 0.05 })
    const geo = new THREE.PlaneGeometry(BOARD.w, BOARD.h)
    // the little "i" cap sign (both faces)
    const ic = makeCanvas(128, 128)
    const ctx = ic.getContext('2d')!
    ctx.fillStyle = '#4F86A8'
    roundRect(ctx, 0, 0, 128, 128, 18)
    ctx.fill()
    ctx.fillStyle = '#f4efe2'
    ctx.beginPath()
    ctx.arc(64, 64, 50, 0, Math.PI * 2)
    ctx.fill()
    fitText(ctx, 'i', 64, 68, 60, 84, { color: '#4F86A8' })
    const itex = canvasTexture(ic)
    const imat = new THREE.MeshStandardMaterial({ map: itex, emissiveMap: itex, emissive: '#ffffff', emissiveIntensity: 0.3, roughness: 0.5 })
    const igeo = new THREE.PlaneGeometry(0.3, 0.3)
    return { tex, mat, geo, itex, imat, igeo }
  }, [])
  useEffect(
    () => () => {
      board.tex.dispose()
      board.mat.dispose()
      board.geo.dispose()
      board.itex.dispose()
      board.imat.dispose()
      board.igeo.dispose()
    },
    [board],
  )

  useInteractable({
    id: 'station:directory-kiosk',
    label: 'Site Directory',
    verb: 'Read',
    radius: 2.3,
    priority: 0.2,
    getPosition: () => ({ x: INTERACT[0], y: 0, z: INTERACT[1] }),
    onInteract: () => useUIStore.getState().openPanel('directory'),
  })

  return (
    <group name="directory-kiosk">
      <BuiltMeshes meshes={meshes} shadows={shadows} />
      <mesh geometry={board.geo} material={board.mat} position={[BOARD.x + 0.012, BOARD.y0 + BOARD.h / 2, KZ]} rotation-y={Math.PI / 2} />
      <mesh geometry={board.igeo} material={board.imat} position={[KX + 0.025, 2.98, KZ]} rotation-y={Math.PI / 2} />
      <mesh geometry={board.igeo} material={board.imat} position={[KX - 0.085, 2.98, KZ]} rotation-y={-Math.PI / 2} />
      <StaticColliders name="kiosk-colliders" boxes={KIOSK_BOXES} />
    </group>
  )
}
