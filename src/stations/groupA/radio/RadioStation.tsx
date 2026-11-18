import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { buildAtlas } from '../lib/canvas'
import { radioAtlasItems } from './art'
import { RadioBooth } from './RadioBooth'
import { RadioMast } from './RadioMast'

/** Broadcast Booth + radio mast (shared signage atlas). */
export function RadioStation({ shadows, atlasScale }: { shadows: boolean; atlasScale: number }) {
  const atlas = useMemo(() => buildAtlas(radioAtlasItems(), 1024, { scale: atlasScale, anisotropy: 8 }), [atlasScale])
  const atlasMat = useMemo(
    () => new THREE.MeshStandardMaterial({ map: atlas.texture, roughness: 0.55, metalness: 0.05, emissiveMap: atlas.texture, emissive: '#ffffff', emissiveIntensity: 0.12 }),
    [atlas],
  )
  useEffect(
    () => () => {
      atlas.texture.dispose()
      atlasMat.dispose()
    },
    [atlas, atlasMat],
  )
  return (
    <group name="radio-station">
      <RadioBooth shadows={shadows} atlas={atlas} atlasMat={atlasMat} />
      <RadioMast shadows={shadows} atlas={atlas} atlasMat={atlasMat} />
    </group>
  )
}
