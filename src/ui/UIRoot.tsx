import { Suspense } from 'react'
import { useUIStore } from '@/state/ui'
import { panelRegistry } from './panels/registry'

/**
 * TEMPORARY STUB — the ui module replaces this with the full HUD/overlay layer
 * (top bar, quick links, directory, prompts, captions, toasts, touch controls,
 * loading screen, fade overlay, dialogue bubble). Must keep: default export,
 * props { mode }, and rendering the open panel through panelRegistry.
 */
export default function UIRoot({ mode }: { mode: 'game' | 'fallback' }) {
  const panel = useUIStore((s) => s.panel)
  const close = useUIStore((s) => s.closePanel)
  const Comp = panel ? panelRegistry[panel.id] : null
  return (
    <div className="ui-root" data-mode={mode}>
      {Comp && panel && (
        <Suspense fallback={null}>
          <Comp params={panel.params} onClose={close} />
        </Suspense>
      )}
    </div>
  )
}
