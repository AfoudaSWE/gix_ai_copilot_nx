import type { SVGProps } from 'react';

/**
 * Inline stroke icons (24px grid, currentColor). Decorative by default (aria-hidden); pass a
 * `title` to give one an accessible name.
 */
const PATHS = {
  chat: 'M4 5h16v10H8l-4 4V5z',
  bot: 'M12 3v3M6 8h12v10H6zM9 12h.01M15 12h.01M9 16h6',
  tool: 'M14.5 6.5a4 4 0 0 0-5.3 5.3L4 17l3 3 5.2-5.2a4 4 0 0 0 5.3-5.3l-2.5 2.5-2.5-.5-.5-2.5z',
  layout: 'M4 4h16v16H4zM4 10h16M10 10v10',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  memory: 'M6 4h12v16H6zM9 8h6M9 12h6M9 16h3',
  workflow: 'M5 4h4v4H5zM15 16h4v4h-4zM7 8v4a4 4 0 0 0 4 4h4',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  shieldCheck: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 5v16',
  rocket: 'M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M12 15l-3-3a13 13 0 0 1 9-9c.3 3.4-.9 6.8-3 9zM15 9h.01',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5',
  terminal: 'M4 5h16v14H4zM7 10l3 2-3 2M12 15h5',
  api: 'M4 7h6v10H4zM14 7h6v4h-6zM14 13h6v4h-6z',
  plug: 'M9 3v5M15 3v5M6 8h12v4a6 6 0 0 1-12 0zM12 18v3',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M17 11a3 3 0 1 0 0-6M22 21a6 6 0 0 0-4-5.6',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  handshake: 'M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z',
  audit: 'M8 3h8l4 4v14H4V3zM8 11h8M8 15h8M8 7h4',
  building: 'M4 21V5l8-3 8 3v16M9 21v-4h6v4M8 9h.01M12 9h.01M16 9h.01M8 13h.01M12 13h.01M16 13h.01',
  gauge: 'M12 21a9 9 0 1 1 9-9M12 12l4-4',
  dollar: 'M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  fingerprint: 'M12 11v4M8 7a6 6 0 0 1 10 4v2M6 11a6 6 0 0 1 .5-2.4M9 21c1-2 1.5-4 1.5-6M15 21c.6-1.6 1-3.4 1-5',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  chevronLeft: 'M15 6l-6 6 6 6',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  copy: 'M9 9h11v11H9zM5 15V4h11',
  check: 'M5 12l5 5 9-10',
  wrap: 'M4 7h16M4 12h13a3 3 0 0 1 0 6h-4M15 16l-2 2 2 2M4 17h5',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
  monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-5M12 8h.01',
  lightbulb: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V16h8v-1.3A7 7 0 0 0 12 2z',
  alert: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  flask: 'M9 3h6M10 3v6l-6 11h16L14 9V3',
  github: 'M9 19c-4 1.5-4-2-6-2.5M15 21v-3.5a3 3 0 0 0-.9-2.4c3-.3 6-1.5 6-6.6a5.2 5.2 0 0 0-1.4-3.6 4.8 4.8 0 0 0-.1-3.6s-1.1-.3-3.6 1.4a12.3 12.3 0 0 0-6.4 0C6.1 1 5 1.3 5 1.3a4.8 4.8 0 0 0-.1 3.6A5.2 5.2 0 0 0 3.5 8.5c0 5.1 3 6.3 6 6.6a3 3 0 0 0-.9 2.3V21',
  hash: 'M5 9h14M5 15h14M10 3L8 21M16 3l-2 18',
  sparkles: 'M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  node: 'M12 2l9 5v10l-9 5-9-5V7z',
  file: 'M6 2h9l5 5v15H6zM14 2v6h6',
  play: 'M7 4l13 8-13 8z',
  thumbsUp: 'M7 11v10H3V11zM7 11l4-8a2 2 0 0 1 3 2l-1 5h6a2 2 0 0 1 2 2.3l-1.3 7A2 2 0 0 1 17.7 21H7',
  thumbsDown: 'M17 13V3h4v10zM17 13l-4 8a2 2 0 0 1-3-2l1-5H5a2 2 0 0 1-2-2.3l1.3-7A2 2 0 0 1 6.3 3H17',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, title, ...rest }: { readonly name: IconName; readonly size?: number; readonly title?: string } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true, focusable: false })}
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
