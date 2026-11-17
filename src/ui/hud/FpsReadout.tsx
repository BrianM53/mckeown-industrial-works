import { runtime } from '@/core/runtime'
import { useSettings } from '@/state/settings'
import { usePoll } from '../lib/usePoll'

/** Small frame-rate readout (Settings → Show FPS). Polled at 4 Hz; not a live region. */
export function FpsReadout() {
  const show = useSettings((s) => s.showFps)
  const fps = usePoll(() => Math.round(Number.isFinite(runtime.frame.fps) ? runtime.frame.fps : 0), 4, show)
  if (!show) return null
  const tone = fps >= 50 ? 'good' : fps >= 30 ? 'ok' : 'low'
  return (
    <p className={`miw-fps miw-fps--${tone}`} data-testid="fps">
      <span className="miw-fps__value">{fps}</span> FPS
    </p>
  )
}
