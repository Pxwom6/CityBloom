/** World dimensions and terrain constants. See DESIGN.md §2.1. */
export const MAP_SIZE = 2048; // metres, buildable area is [0, MAP_SIZE]²
/** The highway's (and the regional railway's) connection node sits this far inside the west edge. */
export const HIGHWAY_CONNECT_X = 24;
export const HEIGHT_STEP = 8; // metres between height samples
export const HEIGHT_RES = MAP_SIZE / HEIGHT_STEP + 1; // 257 samples per side
export const GRID_CELL = 16; // raster cell size in metres
export const GRID_RES = MAP_SIZE / GRID_CELL; // 128 cells per side
export const WATER_LEVEL = 0;
/** Terrain below this height counts as water for building and zoning. */
export const SHORE_HEIGHT = 0.6;
/** How far the rendered scenery extends beyond the buildable area. */
export const SCENERY_MARGIN = 3000;

export type MapPreset = 'river' | 'coast' | 'lakes' | 'highlands';
export const MAP_PRESETS: { id: MapPreset; name: string; blurb: string }[] = [
  {
    id: 'river',
    name: 'River Valley',
    blurb: 'A meandering river splits the land; bridges open the far bank.',
  },
  { id: 'coast', name: 'Coastal Bay', blurb: 'Beaches and a long coastline to the east.' },
  { id: 'lakes', name: 'Lakelands', blurb: 'Rolling hills dotted with lakes.' },
  { id: 'highlands', name: 'Highlands', blurb: 'Steep hills, ore-rich ridges and a narrow stream.' },
];
