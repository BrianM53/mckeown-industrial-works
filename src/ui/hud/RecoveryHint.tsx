import type { MouseEvent } from 'react'
import { actions } from '@/core/actions'
import { useUIStore } from '@/state/ui'
import { Icon } from '../kit/Icon'
import { focusGame, isPointerActivation } from '../lib/focus'

/** Non-intrusive "Stuck? Press R" suggestion from the player module, with a clickable Recover button. */
export function RecoveryHint() {
  const hint = useUIStore((s) => s.recoveryHint)
  const blocked = useUIStore((s) => s.panel !== null)
  if (!hint || blocked) return null
  const onRecover = (e: MouseEvent<HTMLButtonElement>) => {
    actions.trigger('recover')
    if (isPointerActivation(e)) focusGame()
  }
  return (
    <div className="miw-recovery" role="status" data-testid="recovery-hint">
      <Icon name="warning" size={18} className="miw-recovery__icon" />
      <span className="miw-recovery__text">{hint}</span>
      <button type="button" className="miw-recovery__btn" onClick={onRecover} onPointerDown={(e) => e.stopPropagation()}>
        <Icon name="recover" size={16} /> Recover
      </button>
    </div>
  )
}
