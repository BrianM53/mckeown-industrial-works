import { Icon, type IconName } from '../kit/Icon'
import { removeToast, useFeed, type ToastItem } from '../lib/feed'

const ICON: Record<ToastItem['kind'], IconName> = { info: 'info', success: 'check', warning: 'warning' }

/** Short, stacked notifications (both modes). Polite live region; never steals focus. */
export function Toasts() {
  const toasts = useFeed((s) => s.toasts)
  return (
    <section className="miw-toasts" aria-label="Notifications">
      <div className="miw-toasts__list" role="log" aria-live="polite" data-testid="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`miw-toast miw-toast--${t.variant ?? t.kind}${t.actions ? ' is-offer' : ''}`}>
          <Icon name={t.variant === 'achievement' ? 'trophy' : ICON[t.kind]} size={20} className="miw-toast__icon" />
          <p className="miw-toast__body">
            {t.title && (
              <>
                <span className="miw-toast__title">{t.title}</span>
                <span className="sr-only">: </span>
              </>
            )}
            <span className="miw-toast__text">{t.text}</span>
            {t.actions && (
              <span className="miw-toast__actions">
                {t.actions.map((a) => (
                  <a key={a.href} className={`miw-btn miw-btn--sm${a.primary ? ' miw-btn--primary' : ''}`} href={a.href}>
                    {a.label}
                  </a>
                ))}
              </span>
            )}
          </p>
          <button type="button" className="miw-toast__close" aria-label="Dismiss notification" onClick={() => removeToast(t.id)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
      </div>
    </section>
  )
}
