import type { MouseEvent, ReactNode } from 'react'
import { contactOptions } from '@/content/links'
import type { PanelId } from '@/state/ui'
import { ExternalLink } from '../kit/Panel'
import { Icon, type IconName } from '../kit/Icon'
import { openPanelFromControl } from '../lib/nav'

/** Titled panel section with a stamped heading rule. */
export function Section({ title, children, className, headingLevel = 3 }: { title: string; children: ReactNode; className?: string; headingLevel?: 3 | 4 }) {
  const H = headingLevel === 3 ? 'h3' : 'h4'
  return (
    <section className={`miw-sec${className ? ` ${className}` : ''}`}>
      <H className="miw-sec__title">{title}</H>
      {children}
    </section>
  )
}

export function Chips({ items, label }: { items: string[]; label?: string }) {
  if (items.length === 0) return null
  return (
    <ul className="miw-chips" aria-label={label}>
      {items.map((t) => (
        <li key={t} className="miw-chip">
          {t}
        </li>
      ))}
    </ul>
  )
}

/** Button that switches to another panel (keeps the original return-focus target). */
export function PanelLink({
  to,
  params,
  children,
  variant = 'default',
  icon,
  className,
  ariaLabel,
}: {
  to: PanelId
  params?: Record<string, string>
  children: ReactNode
  variant?: 'default' | 'primary' | 'ghost'
  icon?: IconName
  className?: string
  /** Explicit accessible name for repeated short labels ("Details: Row-Pergfect 1.0"). */
  ariaLabel?: string
}) {
  const cls = `miw-btn${variant === 'primary' ? ' miw-btn--primary' : variant === 'ghost' ? ' miw-btn--ghost' : ''}${className ? ` ${className}` : ''}`
  return (
    <button type="button" className={cls} aria-label={ariaLabel} onClick={(e: MouseEvent<HTMLButtonElement>) => openPanelFromControl(to, e, params)}>
      {icon && <Icon name={icon} size={18} />}
      {children}
    </button>
  )
}

export type ContactOption = ReturnType<typeof contactOptions>[number]

export const CONTACT_ICON: Record<ContactOption['kind'], IconName> = {
  email: 'mail',
  linkedin: 'briefcase',
  github: 'code',
  website: 'globe',
}

export const CONTACT_KIND_LABEL: Record<ContactOption['kind'], string> = {
  email: 'Email',
  linkedin: 'LinkedIn',
  github: 'GitHub',
  website: 'Website',
}

/** One contact option as a link: mailto stays in-tab, web links open safely in a new tab. */
export function ContactLink({ option, className, children }: { option: ContactOption; className?: string; children?: ReactNode }) {
  const body = children ?? option.label
  if (option.kind === 'email') {
    return (
      <a href={option.href} className={className}>
        {body}
      </a>
    )
  }
  return (
    <ExternalLink href={option.href} className={className}>
      {body}
    </ExternalLink>
  )
}
