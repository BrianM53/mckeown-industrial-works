/**
 * ENVIRONMENT module root: the whole static world of McKeown Industrial Works.
 *
 *  - sky dome + warm haze, global lighting (sun shadow follows the player),
 *    Night Shift response (runtime.lighting) with red emergency beacons
 *  - ground: concrete slab, asphalt, worn paint, lane lines, stencils, arrows
 *  - building shells for every ZONES[*].building (+ roof cutaway that writes
 *    runtime.world.interior / emits 'world:interior')
 *  - wayfinding: welcome arch, gantry sign, junction signposts, zone beacons
 *  - restricted-zone dressing, perimeter wall + gate, far skyline backdrop
 *  - aggressively factory decor: pipe racks, tanks, trucks, fans, steam...
 *  - colliders for everything above (GROUPS.static / cameraBlocker)
 *
 * Geometry is merged per material into a few dozen draw calls; repeats are
 * instanced. Building the world needs the local sign fonts, so the module
 * suspends briefly until they are loaded (never longer than ~4 s).
 */
import { use, useMemo, useRef } from 'react'
import { useGameStore } from '@/state/game'
import { QUALITY } from './config'
import { atlasMaterials } from './lib/envMaterials'
import { loadEnvFonts } from './lib/fonts'
import { Beacons } from './parts/Beacons'
import { EnvColliders } from './parts/EnvColliders'
import { EnvDebug } from './parts/EnvDebug'
import { ExecutiveOffice } from './parts/ExecutiveOffice'
import { AmbientEmitters, Flags, Flare } from './parts/Extras'
import { Ground } from './parts/Ground'
import { Lighting } from './parts/Lighting'
import { getSignAtlas } from './parts/signAtlas'
import { Sky } from './parts/Sky'
import { Spinners } from './parts/Spinners'
import { Steam } from './parts/Steam'
import { Kits, Roofs, StaticMeshes } from './parts/StaticWorld'
import { buildWorld } from './parts/world'

export default function Environment() {
  use(loadEnvFonts())
  const quality = useGameStore((s) => s.quality)
  // Heavy geometry/atlases are built once for the tier active at load time;
  // later tier changes (e.g. auto-downgrade) only toggle shadows/particles.
  const buildTier = useRef(quality).current
  const cfg = QUALITY[buildTier]
  const live = QUALITY[quality]
  const atlas = useMemo(() => getSignAtlas(cfg.atlasScale, cfg.anisotropy), [cfg])
  const world = useMemo(() => buildWorld(cfg, atlas), [cfg, atlas])
  const mats = atlasMaterials(atlas.texture, `signs${cfg.atlasScale}`)

  return (
    <group name="environment-root">
      <Sky quality={quality} />
      <Lighting quality={quality} />
      <Ground quality={buildTier} />
      <StaticMeshes world={world} sign={mats.sign} poster={mats.poster} shadows={live.shadows} />
      <Roofs world={world} shadows={live.shadows} />
      <Kits world={world} shadows={live.shadows} />
      <Spinners spinners={world.spinners} />
      <Beacons />
      <Steam emitters={world.steam} max={live.particles} />
      <Flags />
      <Flare />
      <AmbientEmitters />
      <ExecutiveOffice />
      <EnvColliders />
      <EnvDebug world={world} />
    </group>
  )
}
