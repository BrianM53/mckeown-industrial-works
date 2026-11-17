import type { ReactNode } from 'react'

/** A physical-looking key label, e.g. <Keycap>E</Keycap>. */
export function Keycap({ children, size = 'md', className }: { children: ReactNode; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return <kbd className={`miw-key miw-key--${size}${className ? ` ${className}` : ''}`}>{children}</kbd>
}
