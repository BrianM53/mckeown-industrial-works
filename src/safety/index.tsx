/**
 * SAFETY module root (rendered inside <Canvas><Physics> by world/Scene.tsx).
 *
 *  - Site safety inspector (original parody character, no agency branding):
 *    patrols the restricted zones and the tower plaza with his clipboard,
 *    investigates NPC mishaps ('gag:start'), and pops out of a safety hatch to
 *    tackle visitors who walk into a restricted zone (OSHA FSM, oshaFsm.ts).
 *  - Night Shift button + blackout FSM (sole writer of runtime.lighting, with a
 *    watchdog that always restores the lights).
 *  - PA announcer (implausible corporate awards, paced by the director).
 *
 * Debug (dev/test builds): __MIW__.osha.{trigger, getState, reset},
 * __MIW__.nightShift.{start, getState, restore}, __MIW__.pa.{announce, getState}.
 */
import { Isolate } from './Isolate'
import { NightShiftSystem } from './NightShiftButton'
import { OshaSystem } from './OshaSystem'
import { PaSystem } from './PaSystem'

export default function SafetyModule() {
  return (
    <group name="safety">
      <Isolate name="osha">
        <OshaSystem />
      </Isolate>
      <Isolate name="night-shift">
        <NightShiftSystem />
      </Isolate>
      <Isolate name="pa">
        <PaSystem />
      </Isolate>
    </group>
  )
}
