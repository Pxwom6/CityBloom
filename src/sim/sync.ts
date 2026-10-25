/**
 * Out-of-step detection for shared cities (phase 4, M29). Every machine in a room runs the same
 * sim; these tell them, cheaply, whether they still agree, and if not, where they first differ.
 *
 * - `checksum`: every game hour, from key totals, every building's busiest fields and the raster
 *   sums. Exact: numbers are mixed by their bits, never rounded, so one changed last bit shows.
 * - `partHashes`: at each month's end, a hash per part of the saved state (the full hash, split so
 *   a mismatch already names the part).
 * - `desyncReport`: given two states, the first part, entry and field that differ.
 */
import { encodeValue, canonicalStringify } from './serialize';
import { fnv1a } from './hash';
import type { Sim } from './sim';
import type { SimState } from './state';
import { RNG_STREAMS } from './state';

// Mixing numbers by their bits (a Float64 store is exact on every engine).
const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

class Mixer {
  private h1 = 0x811c9dc5;
  private h2 = 0x01000193;
  num(v: number): void {
    f64[0] = v;
    this.word(u32[0]!);
    this.word(u32[1]!);
  }
  int(v: number): void {
    this.word(v | 0);
  }
  private word(w: number): void {
    this.h1 = Math.imul(this.h1 ^ w, 0x01000193);
    this.h2 = Math.imul(this.h2 ^ ((w >>> 16) | (w << 16)), 0x5bd1e995) ^ (this.h1 >>> 13);
  }
  str(s: string): void {
    for (let i = 0; i < s.length; i++) this.word(s.charCodeAt(i));
  }
  hex(): string {
    return (this.h1 >>> 0).toString(16).padStart(8, '0') + (this.h2 >>> 0).toString(16).padStart(8, '0');
  }
}

function sumArray(a: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]!;
  return s;
}

/**
 * A cheap fingerprint of the city (well under a millisecond at 100k residents): run it at the
 * same tick on two machines and compare. Covers what changes every hour; slower drift in parts it
 * skips shows at the month's full check.
 */
export function checksum(sim: Sim): string {
  const s = sim.state;
  const m = new Mixer();
  m.int(s.tick);
  m.num(s.treasury);
  m.int(s.nextId);
  for (const k of RNG_STREAMS) for (const w of sim.rng[k].getState()) m.int(w);
  const t = s.totals;
  for (const v of [t.population, t.workers, t.employed, t.jobs, t.jobsFilled, t.buildings, t.approval])
    m.num(v);
  m.int(s.buildings.size);
  for (const b of s.buildings.values()) {
    m.int(b.id);
    m.int(b.state);
    m.int(b.level);
    m.num(b.pop);
    m.num(b.employed);
    m.num(b.happiness);
    m.num(b.garbage);
    m.num(b.progress);
  }
  m.int(s.civics.size);
  for (const c of s.civics.values()) m.int(c.id);
  m.int(s.net.segments.size);
  m.int(s.net.nodes.size);
  m.int(s.vehicles.size);
  m.int(s.incidents.size);
  m.int(s.burning.length);
  m.int(s.disasters.length);
  let traffic = 0;
  for (const v of s.traffic.values()) traffic += v;
  m.num(traffic);
  m.num(sumArray(s.landValue));
  m.num(sumArray(s.groundPollution));
  m.num(sumArray(s.airPollution));
  m.num(sumArray(s.crime));
  m.num(sumArray(s.terrainDelta));
  m.num(s.weather.temp);
  return m.hex();
}

/** The saved state, part by part (in the state's own key order), as canonical JSON. */
export function stateParts(state: SimState): [string, string][] {
  const out: [string, string][] = [];
  for (const k of Object.keys(state) as (keyof SimState)[]) {
    if (k === 'net') {
      // The road network is big: one part per kind of entity.
      for (const n of Object.keys(state.net) as (keyof SimState['net'])[])
        out.push([`net.${n}`, canonicalStringify(encodeValue(state.net[n]))]);
      continue;
    }
    out.push([k, canonicalStringify(encodeValue(state[k]))]);
  }
  return out;
}

/** A hash per part of the state; equal maps mean equal states (the full hash, split). */
export function partHashes(sim: Sim): Record<string, string> {
  sim.syncRngState();
  const out: Record<string, string> = {};
  for (const [k, json] of stateParts(sim.state)) out[k] = fnv1a(json);
  return out;
}

/** The parts two sets of part hashes disagree on, in state order. */
export function differingParts(a: Record<string, string>, b: Record<string, string>): string[] {
  const keys = [...Object.keys(a), ...Object.keys(b).filter((k) => !(k in a))];
  return keys.filter((k) => a[k] !== b[k]);
}

export interface DesyncReport {
  /** The first part that differs ("buildings", "net.segments", "treasury"…), or null if none. */
  part: string | null;
  /** Within it, the path to the first difference ("#1234.employed", "[3].stored"…). */
  path: string;
  a: string;
  b: string;
  /** Every part that differs. */
  parts: string[];
  /** One line for a log or a message. */
  text: string;
}

const short = (v: unknown) => {
  const s = JSON.stringify(v) ?? 'undefined';
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
};

/** The first place two encoded values differ, as a path below `at`. */
function firstDifference(
  a: unknown,
  b: unknown,
  at: string,
): { path: string; a: unknown; b: unknown } | null {
  if (canonicalStringify(a) === canonicalStringify(b)) return null;
  if (
    a === null ||
    b === null ||
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return { path: at, a, b };
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  // Maps are encoded as { $m: [[id, value]…] }: name entries by id.
  if (Array.isArray(ao.$m) && Array.isArray(bo.$m)) {
    const am = ao.$m as [unknown, unknown][];
    const bm = bo.$m as [unknown, unknown][];
    const bIndex = new Map(bm.map(([k, v]) => [String(k), v]));
    for (const [k, v] of am) {
      if (!bIndex.has(String(k))) return { path: `${at}#${String(k)}`, a: 'present', b: 'missing' };
      const d = firstDifference(v, bIndex.get(String(k)), `${at}#${String(k)}`);
      if (d) return d;
    }
    const aKeys = new Set(am.map(([k]) => String(k)));
    for (const [k] of bm)
      if (!aKeys.has(String(k))) return { path: `${at}#${String(k)}`, a: 'missing', b: 'present' };
    return { path: `${at} (order)`, a: am.map(([k]) => k).slice(0, 8), b: bm.map(([k]) => k).slice(0, 8) };
  }
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    for (let i = 0; i < Math.max(a.length, bb.length); i++) {
      const d = firstDifference(a[i], bb[i], `${at}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  // Typed arrays ({ $t, d }): the first differing element.
  if (typeof ao.$t === 'string' && typeof bo.$t === 'string')
    return { path: `${at} (raster)`, a: '…', b: '…' };
  const keys = [...new Set([...Object.keys(ao), ...Object.keys(bo)])].sort();
  for (const k of keys) {
    const d = firstDifference(ao[k], bo[k], `${at}.${k}`);
    if (d) return d;
  }
  return null;
}

/** Where two sims first differ (their live random streams copied into the state first). */
export function simDesync(a: Sim, b: Sim): DesyncReport {
  a.syncRngState();
  b.syncRngState();
  return desyncReport(a.state, b.state);
}

/** Where two states first differ (for logs, tests and the resync message). */
export function desyncReport(a: SimState, b: SimState): DesyncReport {
  const pa = stateParts(a);
  const pb = new Map(stateParts(b));
  const parts = pa.filter(([k, json]) => pb.get(k) !== json).map(([k]) => k);
  if (!parts.length) return { part: null, path: '', a: '', b: '', parts, text: 'The cities agree' };
  const part = parts[0]!;
  const get = (s: SimState) =>
    part.startsWith('net.')
      ? encodeValue(s.net[part.slice(4) as keyof SimState['net']])
      : encodeValue(s[part as keyof SimState]);
  const d = firstDifference(get(a), get(b), '') ?? { path: '', a: '', b: '' };
  const text = `First difference in ${part}${d.path}: ${short(d.a)} vs ${short(d.b)}${
    parts.length > 1 ? ` (also ${parts.slice(1).join(', ')})` : ''
  }`;
  return { part, path: d.path, a: short(d.a), b: short(d.b), parts, text };
}
