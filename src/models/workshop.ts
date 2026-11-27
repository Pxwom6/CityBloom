/**
 * The Workshop (M47): what a player can make, the prompt that asks an AI 3D tool for it (in the
 * owner's own prompt style, `docs/models/PROMPTS-WAR.md`), and the check's problems as a teacher's
 * notes: what's wrong, why the game cares, how to fix it. Pure, so it runs in tests and the page alike.
 */
import { CIVIC, CIVIC_DEFS } from '../data/civic';
import { budgetOf, canHaveLook, targetId, type CustomProblem, type CustomTarget } from './customCheck';
import { CIVIC_HEIGHTS } from './heights';
import { ROLES } from './spec';
import { SPEC_V6 } from './specText';

export interface WorkshopTarget {
  target: CustomTarget;
  /** The id the model is checked as (`landmark2`, `firestation`). */
  id: string;
  name: string;
  site: { w: number; d: number };
  budget: number;
  /** How tall it should stand (m): a landmark's range by size, a look's around the game's own. */
  height: [number, number];
  /** The file name the prompt asks for. */
  file: string;
  /** In words, for the Pick step. */
  blurb: string;
}

/** Landmarks' heights by size: low enough to sit in a street, tall enough to stand out. */
const LANDMARK_HEIGHT: [number, number][] = [
  [4, 12],
  [6, 18],
  [8, 26],
  [10, 34],
];

const r1 = (n: number) => Math.round(n);

/** What a target is, for the Workshop. */
export function workshopTarget(t: CustomTarget): WorkshopTarget {
  const id = targetId(t);
  const d = CIVIC.get(id)!;
  if (t.kind === 'landmark')
    return {
      target: t,
      id,
      name: `Landmark ${t.size}×${t.size}`,
      site: { w: d.w, d: d.d },
      budget: budgetOf(t),
      height: LANDMARK_HEIGHT[t.size - 1]!,
      file: `${id}.glb`,
      blurb: `A decorative building of your own on ${t.size}×${t.size} cells: it works like a park of its size.`,
    };
  const h = CIVIC_HEIGHTS[id] ?? 10;
  return {
    target: t,
    id,
    name: d.name,
    site: { w: d.w, d: d.d },
    budget: budgetOf(t),
    height: [r1(Math.max(3, h * 0.7)), r1(h * 1.2 + 2)],
    file: `${id}.glb`,
    blurb: `A new look for the ${d.name.toLowerCase()}: it still works as the game's own.`,
  };
}

/** Everything the Workshop offers: the four landmarks, then the city's buildings by name (not military ones). */
export function workshopTargets(): WorkshopTarget[] {
  const landmarks = ([1, 2, 3, 4] as const).map((size) => workshopTarget({ kind: 'landmark', size }));
  const looks = CIVIC_DEFS.filter((d) => canHaveLook(d.id) && !d.military)
    .map((d) => workshopTarget({ kind: 'look', def: d.id }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...landmarks, ...looks];
}

/** The spec to paste once at the start of a chat with an AI 3D tool (the owner's spec v6, word for word). */
export const workshopSpec = (): string => SPEC_V6;

/** A starting description when the player hasn't written one. */
function starter(t: WorkshopTarget): string {
  if (t.target.kind === 'landmark')
    return 'A cheerful little landmark for a town square: a pavilion, a bandstand, a fountain, a statue on a chunky plinth or a garden folly, with paving and lawns around it and a couple of tree_spot markers.';
  return `A ${t.name.toLowerCase()} in the game's toy-like style, easy to recognise from above: a clear entrance facing the road, bold roofs, and what a ${t.name.toLowerCase()} needs to look like itself.`;
}

/** A player's words made safe to paste into a prompt: one paragraph, no backticks, at most 600 characters. */
export function cleanIdea(raw: string): string {
  let out = '';
  for (const ch of raw) {
    const c = ch.codePointAt(0)!;
    out += c < 32 || c === 127 || ch === '`' ? ' ' : ch;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, 600);
}

/**
 * The building's own prompt, in the owner's style: its name and file, the site, the budget and the
 * height, then what it is.
 */
export function buildingPrompt(t: WorkshopTarget, idea = '', name = ''): string {
  const title = cleanIdea(name) || t.name;
  const what = cleanIdea(idea) || starter(t);
  return [
    `Citybloom model, following the model spec (v6) and style reference: ${title}. Save as ${t.file}.`,
    `Site ${t.site.w} x ${t.site.d} m (${t.site.w} m along the road, ${t.site.d} m deep); the front is on the road, facing -Z. Budget ${t.budget.toLocaleString('en-US')} triangles. About ${t.height[0]}-${t.height[1]} m tall.`,
    what,
  ].join('\n');
}

/** The roles a player's model may use (the war buildings' lamps aside). */
export const PLAYER_ROLES = ROLES.filter((r) => r !== 'light');

/**
 * The whole prompt, ready to copy: the spec, then this building's prompt with the roles spelled out
 * again (an AI tool reads the last lines most closely).
 */
export function workshopPrompt(t: WorkshopTarget, idea = '', name = ''): string {
  return [
    SPEC_V6,
    '',
    buildingPrompt(t, idea, name),
    `Name every material by its role, exactly: ${PLAYER_ROLES.join(', ')}. One GLB file, every part its own named mesh.`,
  ].join('\n');
}

/** A problem as a teacher's note: what's wrong, why the game cares, how to fix it. */
export interface TeacherNote {
  /** The common mistake it is, when it is one (tests and pictures key on it). */
  kind:
    | 'scale'
    | 'small'
    | 'size'
    | 'outside'
    | 'centre'
    | 'backwards'
    | 'sideways'
    | 'floating'
    | 'sunk'
    | 'triangles'
    | 'unnamed'
    | 'colours'
    | 'textures'
    | 'links'
    | 'file'
    | 'window'
    | 'hanging'
    | 'unreadable'
    | 'other';
  title: string;
  why: string;
  fix: string[];
  /** The checker's own words, for anyone who wants them. */
  words: string;
}

const num = (s: string | undefined) => Number(s ?? 0);

/** One problem from the check, as a note. `site` is what it was checked for (m). */
export function teacherNote(p: CustomProblem, site: { w: number; d: number }): TeacherNote {
  const w = p.words;
  const note = (kind: TeacherNote['kind'], title: string, why: string, fix: string[]): TeacherNote => ({
    kind,
    title,
    why,
    fix,
    words: w,
  });
  let m: RegExpMatchArray | null;
  if ((m = w.match(/^It is ([\d.]+) × ([\d.]+) m; its (?:site|lot) is/))) {
    const k = Math.max(num(m[1]) / site.w, num(m[2]) / site.d);
    if (k > 30)
      return note(
        'scale',
        'It was made in centimetres',
        `It comes out ${Math.round(k)} times too big: ${m[1]} m across for a ${site.w} m site. The game reads every number in a model as metres.`,
        [
          'In Blender: Scene Properties → Units → Unit System Metric, Unit Scale 1.0, Length Metres.',
          'Scale the model down so it measures its site (press N to see its size), then Object → Apply → Scale (Ctrl+A).',
          'An AI tool: ask again for "metres, y up", with the site size in metres.',
        ],
      );
    if (k < 0.05)
      return note(
        'small',
        'It is far too small',
        `It is only ${m[1]} × ${m[2]} m for a ${site.w} × ${site.d} m site: the units were probably metres read as kilometres, or the model was scaled down.`,
        [
          'Scale it up until it measures its site, then Object → Apply → Scale (Ctrl+A) in Blender.',
          'Export with "Apply Unit" and a scale of 1.',
        ],
      );
    return note(
      'size',
      'It is not the size of its site',
      `It is ${m[1]} × ${m[2]} m; its site is ${site.w} × ${site.d} m. The game stands it exactly on its site, so it must fill it: something (a wall, a lawn or paving) reaches each of the four edges, and nothing goes past them.`,
      [
        `Make the ground under it (paving or lawn) exactly ${site.w} m wide (along the road) and ${site.d} m deep.`,
        'Or pick the size that fits it in step 1.',
      ],
    );
  }
  if (/^Outside the (site|lot)/.test(w))
    return note(
      'outside',
      'Parts stick out of the site',
      'The parts named here reach past the site: next to a road they would stand in it, and next to a neighbour, in its garden.',
      ['Move or shorten them so they stay inside the site.', 'Steps and awnings at the front count too.'],
    );
  if (/origin isn't at the centre/.test(w))
    return note(
      'centre',
      "It isn't centred on its site",
      'The game puts the middle of the site at the model’s origin (0, 0, 0), so an off-centre model sits half on the road or in a neighbour.',
      [
        'Move the whole model so its middle is at x 0, z 0 (in Blender, select all and set the location, or move the origin to the centre of the site).',
      ],
    );
  if (/front faces \+Z/.test(w))
    return note(
      'backwards',
      'It faces backwards',
      'Its doors and entrances look away from the road. The game turns every building to face its road along −Z, so this one would show the street its back.',
      [
        'Turn the whole model half round (180°) about the up axis, then apply the rotation (Ctrl+A → Rotation in Blender).',
        'In Blender the front is the −Y side in the top view before export (Blender’s glTF export turns −Y into −Z): its "Front" view looks at it.',
      ],
    );
  if (/front faces along X/.test(w))
    return note(
      'sideways',
      'It faces sideways',
      'Its doors are in a side wall, so in the city they would face along the street instead of onto it.',
      ['Turn the whole model a quarter round (90°) so the doors face the road (−Z), and apply the rotation.'],
    );
  if ((m = w.match(/floats ([\d.]+) m above the ground/)))
    return note(
      'floating',
      'It floats above the ground',
      `Its lowest point is ${m[1]} m up, so in the city you would see daylight under it.`,
      [
        'Move the whole model down so its lowest point is at height 0 (the ground).',
        'In Blender: set the origin to the bottom of the model, then its Z location to 0, and apply the location.',
      ],
    );
  if ((m = w.match(/goes ([\d.]+) m below the ground/)))
    return note(
      'sunk',
      'It is sunk into the ground',
      `Part of it goes ${m[1]} m below ground level, where it would be hidden or poke through the lot.`,
      ['Move the whole model up so its lowest point is at height 0.'],
    );
  if ((m = w.match(/^It has ([\d,]+) triangles, over its budget of ([\d,]+)/)))
    return note(
      'triangles',
      'It has too many triangles',
      `It has ${m[1]} triangles; a building of this kind may have ${m[2]}. A city draws thousands of buildings, so each one keeps to its budget to keep the game smooth, on phones too.`,
      [
        'Remove detail too small to see from above: tiny bevels, round edges, fine railings, bolts.',
        'Use fewer sides on round things (a column needs 8–12 sides, not 32).',
        'In Blender: the Decimate modifier (Collapse, a ratio like 0.5), then apply it. An AI tool: ask for "low-poly, chunky shapes" and the budget again.',
      ],
    );
  if (/parts keep their default names/.test(w))
    return note(
      'unnamed',
      'Its parts have no names',
      'The game finds doors, windows and roofs by their names: it lights windows at night by them, and works out which way the building faces from its doors.',
      [
        'In Blender, double-click each object in the Outliner and name it by what it is: door, window_glass (inside a "window" group), roof, wall, awning, sign…',
        'Keep each part its own object (don’t join them all into one).',
      ],
    );
  if (/materials that aren't roles in the spec/.test(w))
    return note(
      'colours',
      'Its colours are not named by their job',
      'Each colour (material) is named by its job, so the game knows what to repaint for each copy, what lights up at night and what turns white with snow.',
      [
        `Rename each material to one of: ${PLAYER_ROLES.join(', ')}.`,
        'Give it a plain colour (Base Color) and no texture.',
      ],
    );
  if (/textures/.test(w))
    return note(
      'textures',
      'It uses pictures (textures) as colours',
      'The game paints buildings in plain colours from its palette, lit and repainted for each copy: pictures would look out of place and make the file big.',
      ['Remove the image textures and give each material a plain Base Color instead.'],
    );
  if (/points to files outside itself/.test(w))
    return note(
      'links',
      'Its data is in other files',
      'The game takes one file with everything inside it, so nothing has to be fetched from anywhere else.',
      ['Export again as "glTF Binary (.glb)", not "glTF Separate" or "glTF Embedded".'],
    );
  if ((m = w.match(/^It is ([\d.]+) MB/)))
    return note(
      'file',
      'The file is too big',
      `It is ${m[1]} MB; the game takes models up to 1 MB, so they load quickly and pass between friends.`,
      [
        'Fewer triangles make it smaller (see the budget).',
        'Delete hidden parts nobody sees, and export without textures, cameras or lights.',
      ],
    );
  if (/window group/.test(w))
    return note(
      'window',
      'A window has no glass',
      'A part called "window" is a group holding a "window_glass" pane: the game lights the pane at night.',
      ['Put a pane named window_glass (in the glass material) inside each window group.'],
    );
  if (/hangs/.test(w))
    return note(
      'hanging',
      'Something hangs in the air',
      'A wall stands past what holds it up, as if floating.',
      ['Rest it on the floor or wall below it, or shorten it.'],
    );
  if (/can't be read|isn't a GLB|took too long/.test(w))
    return note('unreadable', 'The game can’t read the file', 'It isn’t a GLB file the game understands.', [
      'Export as "glTF Binary (.glb)" from Blender, or download the GLB from your AI tool.',
    ]);
  return note('other', 'Something to fix', '', [w]);
}

/** Every problem as a note, the common mistakes first. */
export function teacherNotes(problems: CustomProblem[], site: { w: number; d: number }): TeacherNote[] {
  return problems.map((p) => teacherNote(p, site));
}
