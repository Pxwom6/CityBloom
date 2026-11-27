/**
 * The model spec (v6) in plain words, for players (M47): the parts a player's building needs, every
 * number read from the check's own source (`check.ts`, `spec.ts`, `customCheck.ts`), so the guide and
 * the check can't drift apart. `npx tsx scripts/docs/modelSpec.ts` writes it into
 * `docs/making-buildings.md`; a test fails if the guide's copy is out of date.
 */
import { CIVIC } from '../data/civic';
import { EXACT } from './check';
import { CUSTOM } from './customCheck';
import { GROUND_FLOOR, PART, type Role } from './spec';
import { PLAYER_ROLES } from './workshop';

/** What each role (material name) is for, in a few words. Every role a player may use has words (a test). */
export const ROLE_WORDS: Record<Exclude<Role, 'light'>, string> = {
  wall: 'walls (the game repaints them for each copy)',
  wall_alt: 'a second wall colour: bands, panels, a lower storey',
  trim: 'white trim: cornices, sills, edges, columns',
  roof: 'roof surfaces only (repainted for each copy; snow settles on flat ones)',
  glass: 'window panes, which light up at night',
  shop_glass: 'shop windows, lit brighter at night',
  frame: 'window and door frames',
  door: 'doors and gates',
  awning: 'awnings and canopies (repainted)',
  sign: 'plain sign panels, no lettering (repainted)',
  metal: 'metal: rooftop units, posts, machinery',
  wood: 'wood: benches, decks, fences',
  accent: 'a bright detail: a clock face, a flag, a sculpture',
  grass: 'lawns and green roofs (they follow the seasons)',
  paving: 'paths, squares and steps',
  asphalt: 'car parks and yards',
  water: 'pools and fountains',
  hedge: 'hedges and planters (they follow the seasons)',
};

export interface SpecSection {
  heading: string;
  items: string[];
}

const cm = (m: number) => `${Math.round(m * 100)} cm`;

/** The spec a player needs, section by section. */
export function playerSpec(): SpecSection[] {
  const landmarks = ([1, 2, 3, 4] as const).map((n) => {
    const d = CIVIC.get(`landmark${n}`)!;
    return `${n}×${n}: ${d.w} × ${d.d} m, ${CUSTOM.landmarkBudgets[n - 1]!.toLocaleString('en-US')} triangles`;
  });
  return [
    {
      heading: 'Size and units',
      items: [
        'Every number is in metres, with y pointing up. A storey is about 3 m (3.6 m for shops and offices).',
        `The model fills its site exactly, measured to within ${cm(EXACT)}: something (a wall, a lawn or paving) reaches each of the four edges, and nothing goes past them.`,
        `Landmarks: ${landmarks.join('; ')}. A new look for a building takes that building's site (the Workshop shows it).`,
      ],
    },
    {
      heading: 'Which way it faces',
      items: [
        'The front faces the road, which is along −Z (in Blender, the −Y side before export: the "Front" view looks at it).',
        'Doors, entrances, shop windows, canopies and signs go on the front: the game works out which way a building faces from them.',
        "The model's origin (0, 0, 0) is the middle of the site, on the ground.",
      ],
    },
    {
      heading: 'On the ground',
      items: [
        `The lowest point is at height 0, within ${cm(EXACT)}: nothing floats above the ground or sinks below it.`,
        `Lawns, paths and paving lie flat, ${cm(GROUND_FLOOR)} to 10 cm above 0 (the game draws its own base under every building, just below them). No raised slab under the whole site.`,
        'Nothing hangs in the air: every part stands on the ground or on another part.',
      ],
    },
    {
      heading: 'Parts and their names',
      items: [
        'Every part is its own named object (don’t join them all into one): door, roof, wall, awning, sign, ac_unit, solar_panel…',
        `Each window is a group named "${PART.window}" holding a pane named "${PART.windowGlass}" (the game lights each one at night); a strip of glass along a floor is "${PART.windowBand}", in pieces 3–4 m long.`,
        'Set glass and frames 5–10 cm in front of their wall, never in it.',
        `Where a tree should stand, put a 1 m cube named "${PART.treeSpot}" on the ground: the game puts one of its own trees there. No trees, cars or people of your own.`,
        'Parts left with a 3D program’s own names (Cube, Cube.001) are refused: the game can’t tell a door from a roof.',
      ],
    },
    {
      heading: 'Colours',
      items: [
        'Plain colours only: no pictures (textures), no lettering or logos.',
        `Each colour (material) is named by its job: ${PLAYER_ROLES.map((r) => `**${r}** (${ROLE_WORDS[r]})`).join('; ')}.`,
        'Use the colours on the style reference sheet: pastel, brick or white walls, terracotta, slate or green roofs, white trim.',
      ],
    },
    {
      heading: 'Style',
      items: [
        'Bright, warm and toy-like: chunky, simple shapes with clean edges, like a board-game piece.',
        'Nothing thinner than about 30 cm (no railings, cables or thin poles): it reads from above.',
        'Your own design: nothing copied from a real landmark, a brand or another game.',
      ],
    },
    {
      heading: 'The file',
      items: [
        'One GLB file ("glTF Binary"), with everything inside it: nothing in other files.',
        `At most ${CUSTOM.maxBytes / 1_048_576} MB, and within the triangle budget of what it is (above for landmarks; the Workshop shows a building's).`,
      ],
    },
  ];
}

/** The spec as Markdown, for the guide. */
export function playerSpecMarkdown(): string {
  return playerSpec()
    .map((s) => [`### ${s.heading}`, '', ...s.items.map((i) => `- ${i}`)].join('\n'))
    .join('\n\n');
}

/** The markers the guide keeps the spec between. */
export const SPEC_MARKERS = {
  start: '<!-- model-spec:start (written by scripts/docs/modelSpec.ts; edit src/models/playerSpec.ts) -->',
  end: '<!-- model-spec:end -->',
} as const;

/** The guide with its spec block replaced by the current one. */
export function withPlayerSpec(guide: string): string {
  const a = guide.indexOf(SPEC_MARKERS.start);
  const b = guide.indexOf(SPEC_MARKERS.end);
  if (a < 0 || b < a) throw new Error('the guide has no model-spec markers');
  return `${guide.slice(0, a + SPEC_MARKERS.start.length)}\n\n${playerSpecMarkdown()}\n\n${guide.slice(b)}`;
}
