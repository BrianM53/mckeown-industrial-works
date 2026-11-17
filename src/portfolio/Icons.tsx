/** Tiny inline stroke icons for the HTML portfolio (decorative: always aria-hidden). */

export type IconName = 'external' | 'email' | 'linkedin' | 'github' | 'website' | 'pin' | 'arrow' | 'download' | 'play'

const PATHS: Record<IconName, string[]> = {
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  email: ['M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'M3 7l9 6 9-6'],
  linkedin: ['M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z', 'M7 11v6', 'M7 7.5v.01', 'M11 17v-6', 'M11 13.5c0-1.6 1-2.5 2.5-2.5S16 12 16 13.5V17'],
  github: ['M8 8l-4 4 4 4', 'M16 8l4 4-4 4', 'M13.5 5.5l-3 13'],
  website: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M3 12h18', 'M12 3c2.4 2.6 3.6 5.6 3.6 9s-1.2 6.4-3.6 9c-2.4-2.6-3.6-5.6-3.6-9S9.6 5.6 12 3z'],
  pin: ['M12 21s-6.5-5.7-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 15.3 12 21 12 21z', 'M12 7.6a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z'],
  arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
  download: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
  play: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M10 8.5v7l6-3.5z'],
}

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className ? `pf-icon ${className}` : 'pf-icon'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
