import { useGameStore } from '@/state/game'
import { useIsTouch } from '../lib/modality'
import { Captions, useCaptionFeed } from './Captions'
import { ControlsHint } from './ControlsHint'
import { DialogueBubble } from './DialogueBubble'
import { FadeOverlay } from './FadeOverlay'
import { FpsReadout } from './FpsReadout'
import { InteractionPrompt } from './InteractionPrompt'
import { LaunchStrip } from './LaunchStrip'
import { RecoveryHint } from './RecoveryHint'
import { useSlowDeviceOffer } from './useSlowDeviceOffer'

/**
 * Game-mode heads-up display. Layout anchors:
 *   top-left column   launch strip, spawn controls hint (mouse/keyboard), FPS
 *   bottom-centre     spawn controls hint (touch: next to the stick and buttons it explains,
 *                     keeping the top of the view and the spawn wayfinding sign clear),
 *                     captions, recovery hint, dialogue, interaction prompt
 * Everything is pointer-transparent except real controls.
 */
export function Hud() {
  useCaptionFeed()
  useSlowDeviceOffer()
  const ready = useGameStore((s) => s.status === 'ready')
  const touch = useIsTouch()
  return (
    <section className="miw-hud" aria-label="Factory status" data-testid="hud">
      <FadeOverlay />
      <div className="miw-hud__tl">
        {ready && <LaunchStrip />}
        {!touch && <ControlsHint />}
        <FpsReadout />
      </div>
      <div className="miw-hud__bc">
        {touch && <ControlsHint />}
        <Captions />
        <RecoveryHint />
        <DialogueBubble />
        <InteractionPrompt />
      </div>
    </section>
  )
}
