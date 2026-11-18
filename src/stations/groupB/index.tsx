/**
 * STATIONS-B module root (spec §5.4–5.6): Server Hall (GitHub), Recreation Yard
 * (soccer + volleyball) and R&D Annex (Gaussian-SLAM scanner, Row-Pergfect rig,
 * DO NOT PRESS, data-driven project benches).
 *
 * Rendered inside <Canvas><Physics> by world/Scene.tsx (own error boundary).
 * Suspends briefly (≤ 3.5 s) for the local sign fonts used by canvas text.
 */
import { use } from 'react'
import { RecYard } from './rec/RecYard'
import { loadStationFonts } from './shared/fonts'
import { useLampDimmer } from './shared/hooks'
import { ServerHall } from './server/ServerHall'

export default function StationsB() {
  use(loadStationFonts())
  useLampDimmer()
  return (
    <group name="stations-b">
      <ServerHall />
      <RecYard />
    </group>
  )
}
