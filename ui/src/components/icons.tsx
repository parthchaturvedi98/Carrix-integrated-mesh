import type { ReactNode } from 'react'

// Minimal, consistent line-icon set (24x24, stroke=currentColor) — no emoji, demo-safe.
const PATHS: Record<string, ReactNode> = {
  mesh: (
    <>
      <circle cx="5" cy="6" r="2" />
      <circle cx="5" cy="18" r="2" />
      <circle cx="18.5" cy="12" r="2.5" />
      <path d="M6.7 7l9.6 4M6.7 17l9.6-4" />
    </>
  ),
  yard: (
    <>
      <rect x="3" y="13" width="7" height="7" rx="1" />
      <rect x="14" y="13" width="7" height="7" rx="1" />
      <rect x="8.5" y="4.5" width="7" height="7" rx="1" />
    </>
  ),
  gate: (
    <>
      <path d="M3 7h11v8H3z" />
      <path d="M14 10h3.8l3.2 3.2V15H14z" />
      <circle cx="7" cy="17.5" r="1.5" />
      <circle cx="17.5" cy="17.5" r="1.5" />
    </>
  ),
  vessel: (
    <>
      <path d="M4 13.5h16l-2.4 5a2 2 0 0 1-1.8 1.1H8.2a2 2 0 0 1-1.8-1.1z" />
      <path d="M7 13.5V7.5h6l3.2 6" />
      <path d="M11 7.5V3.5" />
    </>
  ),
  fees: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 9.5v5M18 9.5v5" />
    </>
  ),
  check: <path d="M5 12.5l4.2 4.2L19 7" />,
  cross: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  warning: (
    <>
      <path d="M12 4l8.5 15H3.5z" />
      <path d="M12 10v4.5M12 17.4v.1" />
    </>
  ),
  play: <path d="M8 5.5l10 6.5-10 6.5z" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8v.1" />
    </>
  ),
  reset: (
    <>
      <path d="M4 12a8 8 0 1 1 2.5 5.8" />
      <path d="M4 19v-5h5" />
    </>
  ),
}

export function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name] ?? null}
    </svg>
  )
}

export const AGENT_ICON: Record<string, string> = {
  Yard: 'yard',
  Gate: 'gate',
  Vessel: 'vessel',
  Fees: 'fees',
}
