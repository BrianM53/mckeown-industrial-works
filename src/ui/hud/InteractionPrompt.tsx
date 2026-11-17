import { useUIStore } from '@/state/ui'
import { Keycap } from '../kit/Keycap'
import { useIsTouch } from '../lib/modality'

/**
 * "E · Inspect · Résumé-O-Matic 3000" prompt (bottom centre). Hidden while a
 * panel/dialogue is open and on touch devices (the big Interact button shows the
 * label there instead). The wrapper is a persistent polite live region.
 */
export function InteractionPrompt() {
  const prompt = useUIStore((s) => s.prompt)
  const blocked = useUIStore((s) => s.panel !== null || s.dialogue !== null)
  const touch = useIsTouch()
  const show = prompt !== null && !blocked && !touch
  return (
    <div className="miw-prompt-host" role="status" aria-live="polite" data-testid="interaction-prompt">
      {show && (
        <div className="miw-prompt" key={prompt.id}>
          <Keycap size="lg" className="miw-prompt__key">
            E
          </Keycap>
          <span className="miw-prompt__verb">{prompt.verb}</span>
          <span className="miw-prompt__label">{prompt.label}</span>
        </div>
      )}
    </div>
  )
}
