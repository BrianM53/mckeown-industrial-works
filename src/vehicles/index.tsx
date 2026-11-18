import { Forklift } from './forklift/Forklift'
import { Puffs, usePuffPool } from './fx/Puffs'
import { BumpableProps } from './props/BumpableProps'
import { TutorialSign } from './sign/TutorialSign'

/**
 * VEHICLES module root (rendered inside <Canvas><Physics> by world/Scene.tsx):
 *  - the company forklift in the Maintenance Bay (enter with E, drive with
 *    W/S + A/D, H/Space horn, E exit, R recover) — service 'forklift',
 *    debug __MIW__.forklift
 *  - ~40 bumpable props (bay, back lot, west yard, warehouse practice area)
 *  - the "FORKLIFT OPERATION" tutorial sign
 *  - pooled exhaust / dust / poof puffs
 * The root group must stay at the identity transform (rigid-body visuals are
 * read as world-space poses).
 */
export default function VehiclesModule() {
  const puffs = usePuffPool(72)
  return (
    <group name="vehicles-root">
      <Forklift puffs={puffs} />
      <BumpableProps puffs={puffs} />
      <TutorialSign />
      <Puffs pool={puffs} />
    </group>
  )
}
