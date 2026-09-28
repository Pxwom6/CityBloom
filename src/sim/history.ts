import { canonicalStringify, decodeValue, encodeValue } from './serialize';
import type { SimState } from './state';

/**
 * Undo and redo (M14). Rather than hand-written reversal code per command, every undoable command
 * is bracketed by two captures of the state it can touch; the difference, down to the fields (and
 * array elements) that changed, is the edit. Undo applies it backwards and redo forwards, so both
 * restore exactly what the command changed: bulldozed roads with their lots and buildings, civic
 * buildings with their modules, zoning, upgrades, moves.
 *
 * Time keeps running between an action and its undo. Structural things (roads, lots, where and what
 * a building is, the ground) must be as the action left them, or the undo is refused with the
 * reason; everyday changes (a building's residents, a vehicle's position, trees) are restored only
 * where nothing else has touched them since. Money is given back or taken as a delta, booked
 * against the ledger lines it was spent from. DESIGN.md §3.16.
 */

/** Actions kept for undo (SPEC-2: about the last 30). */
export const HISTORY_LIMIT = 30;

/** Entity containers commands change, by id. */
export type Container =
  | 'buildings'
  | 'civics'
  | 'vehicles'
  | 'incidents'
  | 'nodes'
  | 'segments'
  | 'blocks'
  | 'stops'
  | 'traffic'
  | 'roadDamage'
  | 'districts';

export const CONTAINERS: readonly Container[] = [
  'buildings',
  'civics',
  'vehicles',
  'incidents',
  'nodes',
  'segments',
  'blocks',
  'stops',
  'traffic',
  'roadDamage',
  'districts',
];

/**
 * Fields whose change since an action blocks undoing it: `true` for every field, a list for some,
 * `false` for none (restored where untouched, left alone otherwise).
 */
const STRUCTURAL: Record<Container, true | false | readonly string[]> = {
  buildings: [
    'def',
    'zone',
    'density',
    'wealth',
    'level',
    'block',
    'col',
    'w',
    'd',
    'x',
    'z',
    'angle',
    'side',
  ],
  civics: ['def', 'x', 'z', 'angle', 'side', 'modules'],
  vehicles: false,
  incidents: false,
  nodes: true,
  segments: true,
  blocks: ['seg', 'side', 's0', 'cols', 'zone', 'valid', 'bld'],
  stops: true,
  traffic: false,
  roadDamage: false,
  districts: false,
};

/** Whole-array state changed element by element: the ground is structural, trees aren't. */
const ARRAYS = { terrainDelta: true, trees: false, districtCells: false } as const;
type ArrayKey = keyof typeof ARRAYS;

/** Other values a command can change (restored where untouched). */
const VALUES = ['nextId', 'rng', 'burning', 'riders', 'load'] as const;
type ValueKey = (typeof VALUES)[number];

function containerOf(s: SimState, c: Container): Map<number, unknown> {
  switch (c) {
    case 'nodes':
      return s.net.nodes as Map<number, unknown>;
    case 'segments':
      return s.net.segments as Map<number, unknown>;
    case 'blocks':
      return s.net.blocks as Map<number, unknown>;
    case 'stops':
      return s.transit.stops as Map<number, unknown>;
    default:
      return s[c] as Map<number, unknown>;
  }
}

function valueOf(s: SimState, k: ValueKey): unknown {
  if (k === 'riders') return s.transit.riders;
  if (k === 'load') return s.transit.load;
  return s[k];
}

function setValue(s: SimState, k: ValueKey, v: unknown): void {
  if (k === 'riders') s.transit.riders = v as SimState['transit']['riders'];
  else if (k === 'load') s.transit.load = v as SimState['transit']['load'];
  else (s as unknown as Record<string, unknown>)[k] = v;
}

const enc = (v: unknown): string => canonicalStringify(encodeValue(v));
const dec = (json: string): unknown => decodeValue(JSON.parse(json));

/** What a command may touch; zoning only changes lots, so it captures far less. */
export interface Scope {
  containers: readonly Container[];
  arrays: readonly ArrayKey[];
}
export const FULL_SCOPE: Scope = { containers: CONTAINERS, arrays: ['terrainDelta', 'trees'] };
export const ZONING_SCOPE: Scope = { containers: ['blocks'], arrays: [] };
/** Terraforming (M24): the ground, the trees on it and the lots it makes (un)buildable. */
export const TERRAIN_SCOPE: Scope = { containers: ['blocks'], arrays: ['terrainDelta', 'trees'] };
/** Districts (M21): their records and the painted cells. */
export const DISTRICT_SCOPE: Scope = { containers: ['districts'], arrays: ['districtCells'] };

/**
 * A captured entity: its JSON, or for one holding typed arrays (lots), the JSON of its other fields
 * and copies of the arrays, which compare faster than they encode.
 */
type Snap = string | { rest: string; arrays: Record<string, Uint8Array | Int32Array | Float32Array> };

function snap(v: unknown): Snap {
  const o = v as Record<string, unknown>;
  let arrays: Record<string, Uint8Array | Int32Array | Float32Array> | null = null;
  for (const k in o) if (ArrayBuffer.isView(o[k])) (arrays ??= {})[k] = (o[k] as Uint8Array).slice();
  if (!arrays) return JSON.stringify(v);
  const rest: Record<string, unknown> = {};
  for (const k in o) if (!(k in arrays)) rest[k] = o[k];
  return { rest: JSON.stringify(rest), arrays };
}

function sameSnap(a: Snap, b: Snap): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  if (a.rest !== b.rest) return false;
  for (const k in a.arrays) {
    const x = a.arrays[k]!;
    const y = b.arrays[k];
    if (!y || x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  }
  return true;
}

/** The entity's full JSON (typed arrays encoded), as changes store it. */
function full(v: Snap): string {
  if (typeof v === 'string') return v;
  return JSON.stringify(encodeValue({ ...(JSON.parse(v.rest) as object), ...v.arrays }));
}

export interface Capture {
  scope: Scope;
  maps: Partial<Record<Container, Map<number, Snap>>>;
  arrays: Partial<Record<ArrayKey, Float32Array | Uint8Array>>;
  values: Record<ValueKey, string>;
  treasury: number;
  month: Record<string, number>;
}

/** Snapshot of everything in `scope` (the sim syncs its generators into `state.rng` first). */
export function capture(s: SimState, scope: Scope): Capture {
  const maps: Capture['maps'] = {};
  for (const c of scope.containers) {
    const m = new Map<number, Snap>();
    // Only lots hold typed arrays; everything else is plain data, which native JSON is fastest at.
    if (c === 'blocks') for (const [id, v] of containerOf(s, c)) m.set(id, snap(v));
    else for (const [id, v] of containerOf(s, c)) m.set(id, JSON.stringify(v));
    maps[c] = m;
  }
  const arrays: Capture['arrays'] = {};
  for (const a of scope.arrays) arrays[a] = s[a].slice();
  const values = {} as Record<ValueKey, string>;
  for (const k of VALUES) values[k] = enc(valueOf(s, k));
  return { scope, maps, arrays, values, treasury: s.treasury, month: { ...s.economy.month } };
}

/**
 * One change: an entity (`c`, `id`), one of its fields (`f`), or an element of an array field or
 * of a whole-state array (`i`). `b` and `a` are the values before and after (JSON for entities and
 * fields, numbers for elements, null for an entity that doesn't exist).
 */
export interface Change {
  c: string;
  id?: number;
  f?: string;
  i?: number;
  b: string | number | null;
  a: string | number | null;
}

export interface Edit {
  /** What the player did, for "Undo: bulldozing". */
  label: string;
  tick: number;
  changes: Change[];
  /** Treasury change, and per ledger line (with the lines that didn't exist before). */
  treasury: number;
  ledger: Record<string, number>;
  newLines: string[];
  /**
   * Containers whose order of entries changed (entities added, removed or re-inserted), with the
   * order before and after: iteration order is part of the city's state (systems visit entities
   * in it), so undo and redo put it back.
   */
  orders: { c: Container; b: number[]; a: number[] }[];
  /** Zoning strokes merge into one edit. */
  stroke?: number;
}

/** The difference between two captures of the same scope. */
export function diff(pre: Capture, post: Capture): Omit<Edit, 'label' | 'tick'> {
  const changes: Change[] = [];
  const orders: Edit['orders'] = [];
  for (const c of pre.scope.containers) {
    const p = pre.maps[c]!;
    const q = post.maps[c]!;
    const pk = [...p.keys()];
    const qk = [...q.keys()];
    if (pk.length !== qk.length || pk.some((id, n) => id !== qk[n])) orders.push({ c, b: pk, a: qk });
    const ids = [...new Set([...p.keys(), ...q.keys()])].sort((x, y) => x - y);
    for (const id of ids) {
      const ps = p.get(id);
      const qs = q.get(id);
      if (ps !== undefined && qs !== undefined && sameSnap(ps, qs)) continue;
      const pb = ps === undefined ? null : full(ps);
      const qa = qs === undefined ? null : full(qs);
      if (pb === qa) continue;
      if (pb === null || qa === null) {
        changes.push({ c, id, b: pb, a: qa });
        continue;
      }
      const po = dec(pb) as Record<string, unknown>;
      const qo = dec(qa) as Record<string, unknown>;
      for (const f of [...new Set([...Object.keys(po), ...Object.keys(qo)])].sort()) {
        const pv = po[f];
        const qv = qo[f];
        if (
          ArrayBuffer.isView(pv) &&
          ArrayBuffer.isView(qv) &&
          (pv as Uint8Array).length === (qv as Uint8Array).length
        ) {
          const pa = pv as unknown as ArrayLike<number>;
          const qa2 = qv as unknown as ArrayLike<number>;
          for (let i = 0; i < pa.length; i++)
            if (pa[i] !== qa2[i]) changes.push({ c, id, f, i, b: pa[i]!, a: qa2[i]! });
          continue;
        }
        const eb = pv === undefined ? null : enc(pv);
        const ea = qv === undefined ? null : enc(qv);
        if (eb !== ea) changes.push({ c, id, f, b: eb, a: ea });
      }
    }
  }
  for (const k of pre.scope.arrays) {
    const p = pre.arrays[k]!;
    const q = post.arrays[k]!;
    for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) changes.push({ c: k, i, b: p[i]!, a: q[i]! });
  }
  for (const k of VALUES)
    if (pre.values[k] !== post.values[k]) changes.push({ c: `v:${k}`, b: pre.values[k], a: post.values[k] });
  const ledger: Record<string, number> = {};
  const newLines: string[] = [];
  for (const k of new Set([...Object.keys(pre.month), ...Object.keys(post.month)])) {
    const d = (post.month[k] ?? 0) - (pre.month[k] ?? 0);
    if (d) ledger[k] = d;
    if (d && !(k in pre.month)) newLines.push(k);
  }
  return { changes, treasury: post.treasury - pre.treasury, ledger, newLines, orders };
}

/** Fold a later edit into an earlier one (a zoning stroke painted over several commands). */
export function merge(into: Edit, later: Omit<Edit, 'label' | 'tick'>): void {
  const key = (ch: Change) => `${ch.c}|${ch.id ?? ''}|${ch.f ?? ''}|${ch.i ?? ''}`;
  const at = new Map(into.changes.map((ch, n) => [key(ch), n]));
  for (const ch of later.changes) {
    const n = at.get(key(ch));
    if (n === undefined) {
      at.set(key(ch), into.changes.length);
      into.changes.push({ ...ch });
    } else into.changes[n]!.a = ch.a;
  }
  into.changes = into.changes.filter((ch) => ch.a !== ch.b);
  for (const o of later.orders) {
    const mine = into.orders.find((x) => x.c === o.c);
    if (mine) mine.a = o.a;
    else into.orders.push({ ...o });
  }
  into.treasury += later.treasury;
  for (const [k, d] of Object.entries(later.ledger)) into.ledger[k] = (into.ledger[k] ?? 0) + d;
  for (const k of later.newLines) if (!into.newLines.includes(k)) into.newLines.push(k);
}

/** What applying an edit changed, so the sim can re-index and tell the client. */
export interface Touched {
  ids: Partial<Record<Container, Set<number>>>;
  arrays: Partial<Record<ArrayKey, number[]>>;
  values: Set<ValueKey>;
}

const REASONS: Partial<Record<string, string>> = {
  blocks: 'buildings have grown or lots have changed there since',
  buildings: 'the buildings there have changed since',
  civics: 'that building has changed since',
  nodes: 'the roads there have changed since',
  segments: 'the roads there have changed since',
  stops: 'the bus stops there have changed since',
  terrainDelta: 'the ground there has been reshaped since',
};

function structural(c: string, f?: string): boolean {
  if (c in ARRAYS) return ARRAYS[c as ArrayKey];
  const s = STRUCTURAL[c as Container];
  if (s === undefined) return false;
  if (typeof s === 'boolean') return s;
  return f === undefined ? s.length > 0 : s.includes(f);
}

/** Do an existing entity's structural fields match a recorded version? */
function sameStructure(c: Container, cur: unknown, recorded: string): boolean {
  const s = STRUCTURAL[c];
  const r = dec(recorded) as Record<string, unknown>;
  const o = cur as Record<string, unknown>;
  const fields = s === true ? [...new Set([...Object.keys(o), ...Object.keys(r)])] : s === false ? [] : s;
  return fields.every((f) => enc(o[f]) === enc(r[f]));
}

/**
 * Apply an edit backwards (`undo`) or forwards (`redo`). Checks first, so a refused edit changes
 * nothing; returns what changed, or why it can't.
 */
export function applyEdit(
  s: SimState,
  edit: Edit,
  dir: 'undo' | 'redo',
): { ok: true; touched: Touched } | { ok: false; reason: string } {
  const from = (ch: Change) => (dir === 'undo' ? ch.a : ch.b);
  const to = (ch: Change) => (dir === 'undo' ? ch.b : ch.a);
  const order = dir === 'undo' ? [...edit.changes].reverse() : edit.changes;

  // Lots whose building is part of this edit (their zoning may change with them).
  const lotsInEdit = new Set<string>();
  for (const ch of edit.changes) if (ch.c === 'blocks' && ch.f === 'bld') lotsInEdit.add(`${ch.id}:${ch.i}`);

  // 1. Check: every structural change must find things as the edit left them.
  for (const ch of order) {
    if (!structural(ch.c, ch.f)) continue;
    const want = from(ch);
    if (ch.c in ARRAYS) {
      if (s[ch.c as ArrayKey][ch.i!] !== want) return { ok: false, reason: REASONS[ch.c]! };
      continue;
    }
    const c = ch.c as Container;
    const cur = containerOf(s, c).get(ch.id!);
    if (ch.f === undefined) {
      if (want === null ? cur !== undefined : cur === undefined || !sameStructure(c, cur, want as string))
        return { ok: false, reason: REASONS[c] ?? 'things there have changed since' };
      continue;
    }
    if (cur === undefined) return { ok: false, reason: REASONS[c] ?? 'things there have changed since' };
    const v = (cur as Record<string, unknown>)[ch.f];
    const now = ch.i !== undefined ? (v as ArrayLike<number>)[ch.i] : v === undefined ? null : enc(v);
    if (now !== want) return { ok: false, reason: REASONS[c] ?? 'things there have changed since' };
  }

  // 2. Apply.
  const touched: Touched = { ids: {}, arrays: {}, values: new Set() };
  const touch = (c: Container, id: number) => (touched.ids[c] ??= new Set()).add(id);
  for (const ch of order) {
    const want = from(ch);
    const next = to(ch);
    if (ch.c in ARRAYS) {
      const arr = s[ch.c as ArrayKey];
      if (arr[ch.i!] !== want) continue; // trees regrown or cleared since: leave them
      arr[ch.i!] = next as number;
      (touched.arrays[ch.c as ArrayKey] ??= []).push(ch.i!);
      continue;
    }
    if (ch.c.startsWith('v:')) {
      const k = ch.c.slice(2) as ValueKey;
      if (enc(valueOf(s, k)) !== want) continue;
      setValue(s, k, dec(next as string));
      touched.values.add(k);
      continue;
    }
    const c = ch.c as Container;
    const map = containerOf(s, c);
    const cur = map.get(ch.id!);
    if (ch.f === undefined) {
      if (next === null) {
        if (cur !== undefined) map.delete(ch.id!);
      } else if (cur === undefined || structural(c) || enc(cur) === want) {
        map.set(ch.id!, dec(next as string));
      } else continue;
      touch(c, ch.id!);
      continue;
    }
    if (cur === undefined) continue;
    const o = cur as Record<string, unknown>;
    if (ch.i !== undefined) {
      const arr = o[ch.f] as Uint8Array;
      if (arr[ch.i] !== want) continue;
      // Don't take zoning from under a building that grew there since.
      if (c === 'blocks' && ch.f === 'zone') {
        const b = o as { bld: Int32Array };
        if (b.bld[ch.i] && !lotsInEdit.has(`${ch.id}:${ch.i}`)) continue;
      }
      arr[ch.i] = next as number;
    } else {
      if ((o[ch.f] === undefined ? null : enc(o[ch.f])) !== want) continue;
      if (next === null) delete o[ch.f];
      else o[ch.f] = dec(next as string);
    }
    touch(c, ch.id!);
  }

  // 3. The order entries were in: the recorded order for those still there, then any others.
  for (const o of edit.orders) {
    const map = containerOf(s, o.c);
    const want = dir === 'undo' ? o.b : o.a;
    const seen = new Set<number>();
    const entries: [number, unknown][] = [];
    for (const id of want)
      if (map.has(id)) {
        entries.push([id, map.get(id)]);
        seen.add(id);
      }
    for (const [id, v] of map) if (!seen.has(id)) entries.push([id, v]);
    map.clear();
    for (const [id, v] of entries) map.set(id, v);
  }

  // 4. Money: give back or take again what the action cost, on the same ledger lines.
  const sign = dir === 'undo' ? -1 : 1;
  s.treasury += sign * edit.treasury;
  const month = s.economy.month;
  for (const [k, d] of Object.entries(edit.ledger)) {
    const v = (month[k] ?? 0) + sign * d;
    if (v === 0 && dir === 'undo' && edit.newLines.includes(k)) delete month[k];
    else month[k] = v;
  }
  return { ok: true, touched };
}
