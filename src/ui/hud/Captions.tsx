import { useGameEvent } from '@/core/events'
import { useSettings } from '@/state/settings'
import { pushCaption, pushToast, useFeed, type CaptionKind } from '../lib/feed'

const KIND_LABEL: Record<CaptionKind, string> = {
  sound: 'Sound',
  pa: 'PA',
  info: 'Info',
  warning: 'Warning',
}

/** Subscribes to 'caption' events. With captions off, warnings still surface as toasts. */
export function useCaptionFeed(): void {
  useGameEvent('caption', (p) => {
    if (!p || typeof p.text !== 'string') return
    if (useSettings.getState().captions) pushCaption(p)
    else if (p.kind === 'warning') pushToast({ text: p.text, kind: 'warning', duration: p.duration })
  })
}

/** Stacked, auto-expiring captions for sound-only cues (subtitle style). */
export function Captions() {
  const items = useFeed((s) => s.captions)
  const enabled = useSettings((s) => s.captions)
  return (
    <div className="miw-captions" role="log" aria-live="polite" aria-label="Captions" data-testid="captions">
      {enabled &&
        items.map((c) => (
          <p key={c.id} className={`miw-caption miw-caption--${c.kind}`}>
            <span className="miw-caption__tag">{KIND_LABEL[c.kind] ?? 'Sound'}</span>
            <span className="miw-caption__text">{c.text}</span>
          </p>
        ))}
    </div>
  )
}
