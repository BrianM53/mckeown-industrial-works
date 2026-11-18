/**
 * STATIONS — GROUP A (module 'stations-a'):
 *
 *  - Personnel Office: the RÉSUMÉ-O-MATIC 3000 (opens the résumé panel), the
 *    Employee of the Month wall, office dressing
 *  - Contact mailbox: brass pneumatic-tube post (opens the contact panel)
 *  - Directory kiosk: "YOU ARE HERE" map board drawn from world/layout (opens the directory)
 *  - Manufacturing Control Room (Harmony AI): monitor wall with live telemetry
 *    from the factory sim (opens the Harmony panel)
 *  - Broadcast Booth (Code Story): ON AIR light, mixing desk, equalizer,
 *    tuning dial, episode poster, station jingle (opens the Code Story panel)
 *  - Radio mast: 28 m lattice landmark with blinking aviation lights
 *
 * Rendered inside <Canvas><Physics> by world/Scene.tsx (ModuleSlot). Canvas
 * text needs the local fonts, so the module suspends briefly until they are
 * loaded (never longer than ~4 s).
 *
 * Interactables: station:resume, station:employee-wall, station:contact-mailbox,
 * station:directory-kiosk, station:harmony-console, station:codestory-desk,
 * station:radio-jingle.
 * Debug (dev/test builds) — window.__MIW__.stationsA:
 *   print('normal'|'shred'?) · freezePrint(t|null) · printState()
 *   send() · freezeSend(t|null) · sendState()
 *   jingle() · onAir() · stats()
 */
import { use, useEffect, useRef } from 'react'
import type * as THREE from 'three'
import { registerDebug } from '@/core/debug'
import { useGameStore } from '@/state/game'
import { ContactMailbox } from './contact/ContactMailbox'
import { ControlRoom } from './control/ControlRoom'
import { DirectoryKiosk } from './kiosk/DirectoryKiosk'
import { loadStationFonts } from './lib/fonts'
import { PersonnelOffice } from './personnel/PersonnelOffice'
import { RadioStation } from './radio/RadioStation'

export default function StationsA() {
  use(loadStationFonts())
  const quality = useGameStore((s) => s.quality)
  // Heavy canvas atlases are built once for the tier active at load time;
  // later tier changes (auto-downgrade) only toggle shadows / particles.
  const buildTier = useRef(quality).current
  const atlasScale = buildTier === 'low' ? 0.75 : 1
  const shadows = quality !== 'low'
  const root = useRef<THREE.Group>(null)
  useEffect(() => registerDebug('stationsA', { stats: () => sceneStats(root.current) }), [])
  return (
    <group name="stations-a" ref={root}>
      <PersonnelOffice shadows={shadows} atlasScale={atlasScale} />
      <ContactMailbox shadows={shadows} atlasScale={atlasScale} />
      <DirectoryKiosk shadows={shadows} />
      <ControlRoom shadows={shadows} lowTier={buildTier === 'low'} />
      <RadioStation shadows={shadows} atlasScale={atlasScale} />
    </group>
  )
}

interface GroupStats {
  meshes: number
  triangles: number
  shadowCasters: number
}

/**
 * Debug: visible meshes (≈ draw calls before frustum culling), triangles and
 * shadow casters of this module, in total and per station group.
 */
function sceneStats(root: THREE.Group | null): { total: GroupStats; groups: Record<string, GroupStats> } {
  const total: GroupStats = { meshes: 0, triangles: 0, shadowCasters: 0 }
  const groups: Record<string, GroupStats> = {}
  if (!root) return { total, groups }
  for (const child of root.children) {
    const g: GroupStats = { meshes: 0, triangles: 0, shadowCasters: 0 }
    child.traverseVisible((o) => {
      const m = o as THREE.Mesh & { isInstancedMesh?: boolean; count?: number }
      if (!m.isMesh || !m.geometry) return
      const geo = m.geometry
      const verts = geo.index ? geo.index.count : (geo.attributes.position?.count ?? 0)
      const n = m.isInstancedMesh ? (m.count ?? 0) : 1
      g.meshes++
      g.triangles += Math.round((verts / 3) * n)
      if (m.castShadow) g.shadowCasters++
    })
    groups[child.name || child.type] = g
    total.meshes += g.meshes
    total.triangles += g.triangles
    total.shadowCasters += g.shadowCasters
  }
  return { total, groups }
}
