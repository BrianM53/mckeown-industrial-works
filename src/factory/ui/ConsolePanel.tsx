import { Panel } from '@/ui/kit/Panel'
import type { PanelComponentProps } from '@/ui/panels/registry'

/** Line Supervisor Console (optimization minigame) panel. TEMPORARY STUB — factory-sim module replaces. */
export default function ConsolePanel({ onClose }: PanelComponentProps) {
  return (
    <Panel title="Line Supervisor Console" kicker="PRODUCTION SPINE" onClose={onClose} tone="hmi">
      <p>Console booting…</p>
    </Panel>
  )
}
