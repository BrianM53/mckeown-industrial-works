import type { ReactNode } from 'react'

/**
 * Small inline stroke icons (24×24 grid, currentColor). Original drawings: no
 * icon font, no brand logos, no network requests. Always decorative
 * (aria-hidden); the surrounding control carries the accessible name.
 */
const PATHS = {
  map: (
    <>
      <path d="M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5z" />
      <path d="M9 4v13.5M15 6.5V20" />
    </>
  ),
  links: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="1.5" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </>
  ),
  'sound-on': (
    <>
      <path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" />
      <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.3 6.5a8 8 0 0 1 0 11" />
    </>
  ),
  'sound-off': (
    <>
      <path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" />
      <path d="m16 9.5 5 5M21 9.5l-5 5" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1" />
      <circle cx="15" cy="6.5" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="17.5" r="2" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.7" />
      <path d="M12 17.2v.1" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6M20 4l-8.5 8.5" />
      <path d="M18 13.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5.5" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  run: <path d="m5 6 6 6-6 6M12 6l6 6-6 6" />,
  recenter: (
    <>
      <circle cx="12" cy="12" r="6.5" />
      <circle cx="12" cy="12" r="1.8" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
    </>
  ),
  recover: (
    <>
      <path d="M4 4.5V10h5.5" />
      <path d="M5.2 14.5a7.5 7.5 0 1 0 1.6-7.4L4 10" />
    </>
  ),
  hand: (
    <>
      <path d="M8.5 12.5V5.8a1.4 1.4 0 0 1 2.8 0V11" />
      <path d="M11.3 10.5V4.4a1.4 1.4 0 0 1 2.8 0v6.1" />
      <path d="M14.1 10.6V6.4a1.4 1.4 0 0 1 2.8 0v7.4a6.2 6.2 0 0 1-6.2 6.2h-.4a6 6 0 0 1-4.8-2.4l-2.7-3.6a1.4 1.4 0 0 1 2.2-1.7l2.1 2.4" />
    </>
  ),
  pause: (
    <>
      <path d="M9 5.5v13M15 5.5v13" />
    </>
  ),
  horn: (
    <>
      <path d="M3.5 10.5v3a1 1 0 0 0 1 1h2l8 4.5v-14l-8 4.5h-2a1 1 0 0 0-1 1z" />
      <path d="M18 9a4.5 4.5 0 0 1 0 6" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="18.5" r="2" />
      <circle cx="18" cy="5.5" r="2" />
      <path d="M8 18.5h7.5a3.3 3.3 0 0 0 0-6.6h-7a3.3 3.3 0 0 1 0-6.4H16" />
    </>
  ),
  travel: <path d="M4 6.5 11 12l-7 5.5zM12.5 6.5l7 5.5-7 5.5z" />,
  open: (
    <>
      <path d="M6 3.5h8.5l3.5 3.5v13.5H6z" />
      <path d="M14 3.5V7.5h4M9 12h6M9 15.5h6" />
    </>
  ),
  trophy: (
    <>
      <path d="M8 4h8v5.5a4 4 0 0 1-8 0z" />
      <path d="M8 6H5.2a3 3 0 0 0 3 4M16 6h2.8a3 3 0 0 1-3 4M12 13.5V17M8.5 20h7M10 17h4" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="1.5" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </>
  ),
  warning: (
    <>
      <path d="M12 3.5 2.5 20h19z" />
      <path d="M12 10v4.5M12 17.2v.1" />
    </>
  ),
  print: (
    <>
      <path d="M7 9V3.5h10V9" />
      <rect x="3.5" y="9" width="17" height="8" rx="1.5" />
      <path d="M7 14h10v6.5H7z" />
    </>
  ),
  download: <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />,
  briefcase: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="1.5" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 12.5h18" />
    </>
  ),
  code: <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a13.5 13.5 0 0 1 0 18M12 3a13.5 13.5 0 0 0 0 18" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.6v.1" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  person: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  gauge: (
    <>
      <path d="M3.5 17.5a8.5 8.5 0 1 1 17 0" />
      <path d="m12 17.5 4-6M7 17.5h10" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
    </>
  ),
  ball: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m12 7.5 4 3-1.5 4.5h-5L8 10.5z" />
      <path d="M12 3.5v4M16 10.5l4-1M14.5 15l2.5 3.5M9.5 15 7 18.5M8 10.5l-4-1" />
    </>
  ),
  volleyball: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5c-.6 3.4.4 6.3 3 8.5s5.3 2.4 5.3 2.4" />
      <path d="M12 12c-3 1.6-5.4 1.4-7.9-.3M12 12c.4 3.4 2 5.8 4.4 7.4" />
    </>
  ),
  flask: <path d="M9 3.5h6M10 3.5v6l-5.2 8.8A1.8 1.8 0 0 0 6.3 21h11.4a1.8 1.8 0 0 0 1.5-2.7L14 9.5v-6M7.5 15h9" />,
  rocket: (
    <>
      <path d="M12 2.5c2.8 2.3 4 5.6 4 8.7V16H8v-4.8c0-3.1 1.2-6.4 4-8.7z" />
      <path d="M8 12.5 5 15.5v3.5h3M16 12.5l3 3v3.5h-3M10.5 19.5h3" />
    </>
  ),
  forklift: (
    <>
      <path d="M3 17.5V9h6l3 4.5v4M15 3.5v14h6" />
      <circle cx="6" cy="18.5" r="2" />
      <circle cx="12" cy="18.5" r="2" />
    </>
  ),
  console: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M7 20h10M12 16v4M7 12l3-3 2.5 2 4.5-4" />
    </>
  ),
  factory: (
    <>
      <path d="M3 20.5V11l5 3V11l5 3v-3l5 3V4h3v16.5z" />
      <path d="M7 17.5h2M12 17.5h2M17 17.5h1.5" />
    </>
  ),
  chevron: <path d="m9 6 6 6-6 6" />,
  back: <path d="m15 6-6 6 6 6" />,
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className ? `miw-icon ${className}` : 'miw-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}
