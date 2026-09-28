/** Original line icons (24×24 viewBox, stroke = currentColor). */
import type { JSX } from 'preact';

type P = JSX.SVGAttributes<SVGSVGElement>;
/** Icons are decorative: buttons carry their own text or aria-label. */
const base = {
  'aria-hidden': 'true',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 2,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
} as const;

export const IconPause = (p: P) => (
  <svg {...base} {...p}>
    <path d="M8 5v14M16 5v14" />
  </svg>
);
export const IconSpeed1 = (p: P) => (
  <svg {...base} {...p}>
    <path d="M9 6l7 6-7 6z" fill="currentColor" />
  </svg>
);
export const IconSpeed2 = (p: P) => (
  <svg {...base} {...p}>
    <path d="M5 6l6 6-6 6zM13 6l6 6-6 6z" fill="currentColor" />
  </svg>
);
export const IconSpeed3 = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 7l5 5-5 5zM10 7l5 5-5 5zM17 7l5 5-5 5z" fill="currentColor" stroke-width="1.5" />
  </svg>
);

export const IconPointer = (p: P) => (
  <svg {...base} {...p}>
    <path d="M5 3l14 8-6 1.5L10 19z" />
  </svg>
);
export const IconRoad = (p: P) => (
  <svg {...base} {...p}>
    <path d="M6 21L9 3M18 21L15 3M12 5v2M12 11v2M12 17v2" />
  </svg>
);
export const IconZone = (p: P) => (
  <svg {...base} {...p}>
    <rect x="3" y="3" width="8" height="8" rx="1" />
    <rect x="13" y="3" width="8" height="8" rx="1" />
    <rect x="3" y="13" width="8" height="8" rx="1" />
    <rect x="13" y="13" width="8" height="8" rx="1" />
  </svg>
);
export const IconHouse = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6" />
  </svg>
);
export const IconShop = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 9h16l-1.5-5h-13zM4 9c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3M5 12v8h14v-8M10 20v-5h4v5" />
  </svg>
);
export const IconFactory = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 20V10l5 3V10l5 3V10l5 3V4h3v16zM7 17h2M12 17h2M17 17h2" />
  </svg>
);
export const IconEraser = (p: P) => (
  <svg {...base} {...p}>
    <path d="M16 3l5 5-11 11H5l-3-3zM9 20h12M11 8l5 5" />
  </svg>
);
export const IconBulldozer = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 17h11M4 17a2 2 0 104 0M10 17a2 2 0 104 0M5 13V8h6l2 5M3 13h11M16 9l5 2v8h-4" />
  </svg>
);
export const IconStraight = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 20L20 4" />
    <circle cx="4" cy="20" r="1.5" fill="currentColor" />
    <circle cx="20" cy="4" r="1.5" fill="currentColor" />
  </svg>
);
export const IconCurve = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 20C4 10 10 4 20 4" />
    <circle cx="4" cy="20" r="1.5" fill="currentColor" />
    <circle cx="20" cy="4" r="1.5" fill="currentColor" />
  </svg>
);
export const IconFreeform = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 18c3-6 5 2 8-4s4-8 7-6 2 7 3 7" />
  </svg>
);
export const IconGrid = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
  </svg>
);
export const IconUndo = (p: P) => (
  <svg {...base} {...p}>
    <path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" />
  </svg>
);
export const IconRedo = (p: P) => (
  <svg {...base} {...p}>
    <path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" />
  </svg>
);
export const IconMove = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />
  </svg>
);
export const IconLock = (p: P) => (
  <svg {...base} {...p}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 018 0v4" />
  </svg>
);
export const IconBolt = (p: P) => (
  <svg {...base} {...p}>
    <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
  </svg>
);
export const IconDrop = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 3c4 5 6 8 6 11a6 6 0 01-12 0c0-3 2-6 6-11z" />
  </svg>
);
export const IconTrash = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
  </svg>
);
export const IconLayers = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5" />
  </svg>
);
export const IconFlame = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 3c1 4 5 6 5 11a5 5 0 01-10 0c0-3 2-4 2-7 1.5 1 2.5 2.5 3 4 .5-3 0-5.5 0-8z" />
  </svg>
);
export const IconShield = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z" />
    <path d="M9.5 12l2 2 3.5-4" />
  </svg>
);
export const IconHealth = (p: P) => (
  <svg {...base} {...p}>
    <rect x="4" y="4" width="16" height="16" rx="4" />
    <path d="M12 8v8M8 12h8" />
  </svg>
);
export const IconBook = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 6l9-3 9 3-9 3z" />
    <path d="M7 8v5c0 1.5 2.5 3 5 3s5-1.5 5-3V8M21 6v6" />
  </svg>
);
export const IconTree = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 3l6 8h-3l4 6H5l4-6H6z" />
    <path d="M12 17v4" />
  </svg>
);
export const IconUpgrade = (p: P) => (
  <svg {...base} {...p}>
    <path d="M5 20V9M19 20V9M12 4l-4 4h8z" />
    <path d="M12 8v12" stroke-dasharray="2 2" />
  </svg>
);
export const IconBus = (p: P) => (
  <svg {...base} {...p}>
    <rect x="4" y="4" width="16" height="13" rx="2" />
    <path d="M4 11h16M8 20v-3M16 20v-3" />
    <circle cx="8" cy="14" r="0.6" fill="currentColor" />
    <circle cx="16" cy="14" r="0.6" fill="currentColor" />
  </svg>
);
export const IconMoney = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.6 2.5 2 2.5.9 2.5 2-1 2-2.5 2c-1.2 0-2.2-.6-2.6-1.5M12 6.5v11" />
  </svg>
);
export const IconBell = (p: P) => (
  <svg {...base} {...p}>
    <path d="M6 16V11a6 6 0 0112 0v5l2 2H4zM10 20a2 2 0 004 0" />
  </svg>
);
export const IconChat = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 5h16v11H9l-5 4z" />
  </svg>
);
export const IconAlert = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 3l10 18H2zM12 10v5M12 18v.5" />
  </svg>
);
export const IconQuake = (p: P) => (
  <svg {...base} {...p}>
    <path d="M2 12h4l2-5 3 10 3-8 2 5 2-2h4" />
  </svg>
);
export const IconTornado = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 5h18M5 9h13M8 13h9M10 17h5M12 21h2" />
  </svg>
);
export const IconWaves = (p: P) => (
  <svg {...base} {...p}>
    <path d="M2 8c3-3 5 3 8 0s5 3 8 0 3-1 4 0M2 13c3-3 5 3 8 0s5 3 8 0 3-1 4 0M2 18c3-3 5 3 8 0s5 3 8 0 3-1 4 0" />
  </svg>
);
export const IconMeteor = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="15" cy="15" r="5" />
    <path d="M11 11L3 3M13 9L7 3M9 13L3 7" />
  </svg>
);
export const IconLandmark = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 2l3 5v14H9V7zM9 12h6M5 21h14" />
  </svg>
);
export const IconCrate = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 8l9-4 9 4v9l-9 4-9-4zM3 8l9 4 9-4M12 12v9" />
  </svg>
);
export const IconTrophy = (p: P) => (
  <svg {...base} {...p}>
    <path d="M7 4h10v5a5 5 0 01-10 0zM7 6H4a3 3 0 003 4M17 6h3a3 3 0 01-3 4M12 14v4M8 21h8M9 18h6" />
  </svg>
);
/** A tower crane: big projects. */
export const IconCrane = (p: P) => (
  <svg {...base} {...p}>
    <path d="M6 21V4M6 4h14M6 4 3 7M6 8l4-4M16 4v5M14 9h4v3h-4zM3 21h8" />
  </svg>
);
/** A camera: photo mode. */
export const IconCamera = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 8h4l2-3h6l2 3h4v11H3z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);
/** A line climbing over a timeline with a marker: the city history. */
export const IconHistory = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 3v18h18M6 16l4-5 3 3 6-7M17 7h2v2" />
  </svg>
);
export const IconCity = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 21V10l5-3v14M8 21V4l7 3v14M15 21v-9l6 2v7M2 21h20" />
  </svg>
);
export const IconOneWay = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 12h14M13 7l5 5-5 5" />
    <path d="M3 5h8M3 19h8" stroke-width="1.5" />
  </svg>
);
export const IconRoundabout = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="5" />
    <path d="M12 2v5M12 17v5M2 12h5M17 12h5" />
  </svg>
);
export const IconDrawOneWay = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 19c3-7 8-11 15-13" />
    <path d="M14 4.5l5 1.5-2 4.8" />
  </svg>
);
