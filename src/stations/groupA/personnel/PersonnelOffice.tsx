import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { buildAtlas } from '../lib/canvas'
import { StaticColliders, type BoxCol, type CylCol } from '../lib/react'
import { personnelAtlasItems, recentMonths } from './art'
import { EmployeeWall } from './EmployeeWall'
import { OfficeDressing, PLANT } from './OfficeDressing'
import { RESUME_MACHINE_BOXES, ResumeMachine } from './ResumeMachine'

/**
 * PERSONNEL OFFICE (zone 'personnel'): the Résumé-O-Matic 3000, the Employee
 * of the Month wall and office dressing. The environment module builds the
 * shell, windows, desk, filing cabinets, chairs and water cooler.
 */
export const PERSONNEL_BOXES: BoxCol[] = [...RESUME_MACHINE_BOXES]
export const PERSONNEL_CYLS: CylCol[] = [{ c: [PLANT.x, 0.4, PLANT.z], r: PLANT.r, hh: 0.4 }]

export function PersonnelOffice({ shadows, atlasScale }: { shadows: boolean; atlasScale: number }) {
  const atlas = useMemo(() => buildAtlas(personnelAtlasItems(recentMonths()), 1024, { scale: atlasScale, anisotropy: 8 }), [atlasScale])
  const signMaterial = useMemo(() => new THREE.MeshStandardMaterial({ map: atlas.texture, roughness: 0.62, metalness: 0.08 }), [atlas])
  useEffect(
    () => () => {
      atlas.texture.dispose()
      signMaterial.dispose()
    },
    [atlas, signMaterial],
  )
  return (
    <group name="personnel-office">
      <ResumeMachine atlas={atlas} signMaterial={signMaterial} shadows={shadows} />
      <EmployeeWall atlas={atlas} signMaterial={signMaterial} shadows={shadows} />
      <OfficeDressing atlas={atlas} signMaterial={signMaterial} shadows={shadows} />
      <StaticColliders name="personnel-colliders" boxes={PERSONNEL_BOXES} cyls={PERSONNEL_CYLS} />
    </group>
  )
}
