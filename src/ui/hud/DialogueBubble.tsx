import type { MouseEvent } from 'react'
import { useUIStore } from '@/state/ui'
import { Icon } from '../kit/Icon'
import { Keycap } from '../kit/Keycap'
import { useIsTouch } from '../lib/modality'

/**
 * NPC dialogue card (bottom centre). Advances with E / Space / click (the key
 * handling lives in input/useUIKeyboard so it works wherever focus is); Esc or ✕
 * closes it. NPC chatter is in-world fiction and is tagged as such.
 */
export function DialogueBubble() {
  const d = useUIStore((s) => s.dialogue)
  const panelOpen = useUIStore((s) => s.panel !== null)
  const touch = useIsTouch()
  const show = d !== null && !panelOpen && d.lines.length > 0
  const line = show ? d.lines[Math.min(d.index, d.lines.length - 1)] : ''
  const last = show ? d.index >= d.lines.length - 1 : true

  const advance = () => useUIStore.getState().advanceDialogue()
  const onCardClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    advance()
  }

  return (
    <div className="miw-dialogue-host" aria-live="polite" data-testid="dialogue">
      {show && (
        <div className="miw-dialogue" onClick={onCardClick} onPointerDown={(e) => e.stopPropagation()}>
          <div className="miw-dialogue__head">
            <p className="miw-dialogue__who">
              <span className="miw-dialogue__name">{d.name}</span>
              {d.role && <span className="miw-dialogue__role">{d.role}</span>}
            </p>
            <span className="miw-dialogue__fiction">
              <span className="miw-dialogue__fiction-long">Factory chatter · </span>fiction
            </span>
            <button type="button" className="miw-dialogue__close" aria-label="Close dialogue" onClick={() => useUIStore.getState().closeDialogue()}>
              <Icon name="close" size={18} />
            </button>
          </div>
          <p className="miw-dialogue__line" key={d.index}>
            {line}
          </p>
          <div className="miw-dialogue__foot">
            {d.lines.length > 1 && (
              <span className="miw-dialogue__count" aria-label={`Line ${d.index + 1} of ${d.lines.length}`}>
                {d.index + 1}/{d.lines.length}
              </span>
            )}
            <span className="miw-dialogue__hint" aria-hidden="true">
              {touch ? (
                'Tap to continue'
              ) : (
                <>
                  <Keycap size="sm">E</Keycap> / <Keycap size="sm">Space</Keycap> / click to continue
                </>
              )}
            </span>
            <button type="button" className="miw-dialogue__next" onClick={advance}>
              {last ? 'Close' : 'Continue'}
              <Icon name={last ? 'close' : 'chevron'} size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
