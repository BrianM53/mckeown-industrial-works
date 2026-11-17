import { useGameStore } from '@/state/game'
import { Captions, useCaptionFeed } from './Captions'
import { ControlsHint } from './ControlsHint'
import { DialogueBubble } from './DialogueBubble'
import { FadeOverlay } from './FadeOverlay'
import { FpsReadout } from './FpsReadout'
import { InteractionPrompt } from './InteractionPrompt'
import { LaunchStrip } from './LaunchStrip'
import { RecoveryHint } from './RecoveryHint'

/**
 * Game-mode heads-up display. Layout anchors:
 *   top-left column   launch strip, spawn controls hint, FPS
 *   bottom-centre     captions, recovery hint, dialogue, interaction prompt
 * Everything is pointer-transparent except real controls.
 */
export function Hud() {
  useCaptionFeed()
  const ready = useGameStore((s) => s.status === 'ready')
  return (
    <section className="miw-hud" aria-label="Factory status" data-testid="hud">
      <FadeOverlay />
      <div className="miw-hud__tl">
        {ready && <LaunchStrip />}
        <ControlsHint />
        <FpsReadout />
      </div>
      <div className="miw-hud__bc">
        <Captions />
        <RecoveryHint />
        <DialogueBubble />
        <InteractionPrompt />
      </div>
    </section>
  )
}
