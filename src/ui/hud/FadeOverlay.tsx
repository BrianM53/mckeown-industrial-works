import { useUIStore } from '@/state/ui'

/**
 * Full-screen black fade (teleport, tackle respawn). Driven by ui store `fade`.
 * Never blocks input unless mostly opaque; sits below the top bar and panels.
 */
export function FadeOverlay() {
  const fade = useUIStore((s) => s.fade)
  const opacity = Number.isFinite(fade.opacity) ? Math.min(1, Math.max(0, fade.opacity)) : 0
  if (opacity <= 0.001) return null
  return (
    <div
      className="miw-fade"
      style={{ opacity, pointerEvents: opacity > 0.5 ? 'auto' : 'none' }}
      data-testid="fade-overlay"
      aria-hidden={opacity < 0.5 || !fade.label}
    >
      {fade.label && opacity > 0.35 && (
        <p className="miw-fade__label" role="status">
          {fade.label}
        </p>
      )}
    </div>
  )
}
