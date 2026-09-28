/** The map editor's brushes (M24). DESIGN.md §3.25. */
export type MapBrush =
  | 'raise'
  | 'lower'
  | 'level'
  | 'smooth'
  | 'water'
  | 'sea'
  | 'land'
  | 'forest'
  | 'clearForest'
  | 'ore'
  | 'oil'
  | 'clearResources';

export type MapBrushGroup = 'Sculpt' | 'Water' | 'Forests' | 'Resources';

export const MAP_BRUSHES: { id: MapBrush; group: MapBrushGroup; name: string; blurb: string }[] = [
  { id: 'raise', group: 'Sculpt', name: 'Raise', blurb: 'Build hills up. Hold to keep raising.' },
  { id: 'lower', group: 'Sculpt', name: 'Lower', blurb: 'Dig valleys down, below the water if you like.' },
  { id: 'level', group: 'Sculpt', name: 'Level', blurb: 'Flatten to the height where the drag starts.' },
  { id: 'smooth', group: 'Sculpt', name: 'Smooth', blurb: 'Soften bumps, banks and cliffs.' },
  {
    id: 'water',
    group: 'Water',
    name: 'River and lake',
    blurb: 'Dig a riverbed or a lake 4 m deep, with sloping banks. Drag for a river.',
  },
  {
    id: 'sea',
    group: 'Water',
    name: 'Sea',
    blurb: 'Deep water, 14 m down: coastlines, bays and a harbour deep enough for ships.',
  },
  { id: 'land', group: 'Water', name: 'Land', blurb: 'Fill water back in to a low shore.' },
  { id: 'forest', group: 'Forests', name: 'Plant forest', blurb: 'Thicken the woods on dry land.' },
  { id: 'clearForest', group: 'Forests', name: 'Clear trees', blurb: 'Fell the trees under the brush.' },
  { id: 'ore', group: 'Resources', name: 'Ore', blurb: 'Lay an ore deposit for mines (the mining specialisation).' },
  { id: 'oil', group: 'Resources', name: 'Oil', blurb: 'Lay an oil field for wells (the oil specialisation).' },
  { id: 'clearResources', group: 'Resources', name: 'Clear', blurb: 'Take ore and oil out.' },
];

export const MAP_EDIT = {
  /** Metres a raise or lower moves the ground at the brush's centre per pass, at strength 1. */
  step: 1.5,
  /** River and lake beds, the sea floor, and the shore that filling water back makes. */
  waterBed: -4,
  seaBed: -14,
  landHeight: 1.5,
  /** Forest, ore and oil density (0–255) added per pass at the centre, at strength 1. */
  forestStep: 90,
  resourceStep: 110,
  radius: { min: 16, max: 256, initial: 64 },
  strength: { min: 0.25, max: 3, initial: 1 },
} as const;
