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
 */
import { use, useRef } from 'react'
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
  return (
    <group name="stations-a">
      <PersonnelOffice shadows={shadows} atlasScale={atlasScale} />
      <ContactMailbox shadows={shadows} atlasScale={atlasScale} />
      <DirectoryKiosk shadows={shadows} />
      <ControlRoom shadows={shadows} lowTier={buildTier === 'low'} />
      <RadioStation shadows={shadows} atlasScale={atlasScale} />
    </group>
  )
}
