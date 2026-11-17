import { Panel } from '@/ui/kit/Panel'
import type { PanelComponentProps } from './registry'

/** Temporary placeholder until the ui module implements real panels. */
export default function PlaceholderPanel({ onClose }: PanelComponentProps) {
  return (
    <Panel title="Under construction" kicker="PLACEHOLDER" onClose={onClose} size="sm">
      <p>This panel is being built.</p>
    </Panel>
  )
}
