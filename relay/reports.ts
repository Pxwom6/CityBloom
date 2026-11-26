/**
 * Problem reports (phase 6, M41): what a page sends when something breaks, and the cleaning every
 * hop applies. The page (`src/client/reports.ts`), the local relay and the Worker all use this file,
 * so a report means the same thing everywhere and a modified client can't send more than it allows.
 *
 * What a report never carries: names, chat, city names, saves, or anything typed into a text box.
 * The page scrubs the names it knows of from messages and stacks (`scrubText`), strips query strings
 * from addresses, and cleans the commands in a desync's replay (`cleanEvents`). The one piece of
 * typed text is the player's own message in a report they write (`note`).
 */
import { fnv1a } from '../src/sim/hash';

/** What went wrong. */
export const REPORT_KINDS = [
  /** An uncaught error or a rejected promise on the page. */
  'error',
  /** An error in the sim worker. */
  'worker',
  /** An error in a battle worker. */
  'battle',
  /** A save that failed. */
  'save',
  /** A save or file that wouldn't open. */
  'load',
  /** Building models that failed to load or check at start-up. */
  'model',
  /** Two players' state hashes disagreeing, in a shared city or a battle. */
  'desync',
  /** "Report a problem": the player's own report. */
  'user',
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/** Where the page was when it happened. */
export const REPORT_WHERE = ['boot', 'menu', 'city', 'editor', 'visit', 'battle'] as const;
export type ReportWhere = (typeof REPORT_WHERE)[number];

/** Whether the city is shared: on its own, in a room (co-op), or standing in a shared region. */
export const REPORT_SHARED = ['no', 'room', 'region'] as const;
export type ReportShared = (typeof REPORT_SHARED)[number];

/** The game and the machine it ran on. Nothing here names the player or their city. */
export interface ReportEnv {
  /** The commit the game was built from (`BUILD_ID`). */
  build: string;
  /** When that commit was made (s since 1970): says which of two builds is newer. */
  built?: number;
  /** "Chrome 142", "Safari 18.4", "Firefox 140" (from the browser's user agent, nothing finer). */
  browser: string;
  /** "macOS", "Windows", "iOS", "Android", "Linux", "ChromeOS". */
  os: string;
  /** The graphics quality (low, medium, high). */
  quality: string;
  /** The save version this build writes. */
  save: number;
  shared: ReportShared;
  where: ReportWhere;
}

/** The founding options of a city a replay can make again (never its name or a custom map). */
export interface ReportFounding {
  seed: string;
  preset: string;
  difficulty?: string;
  sandbox?: boolean;
  disasters?: boolean;
  elections?: boolean;
  rivals?: boolean;
  region?: boolean;
  /** The terrain generator's version. */
  terrain?: number;
}

/** Where a desync's replay starts: the last snapshot both sides agreed on. */
export interface ReportStart {
  /** The tick it stands at, and the room's sequence number of the last event in it. */
  tick: number;
  seq: number;
  /** Its hourly checksum, so a save given to the replay can be checked as the right one. */
  sum: string;
  /** The room's running fingerprint of events at the start (every hourly sum carries it). */
  eventHash?: number;
  /** Who could do what at the start (players by number, no names): commands are checked against it. */
  rules?: unknown;
  /** Set when the city was founded on this machine: the replay needs nothing more than this. */
  founded?: ReportFounding;
  /** The commands made before it was shared, each at its tick (`{ tick, cmd, by? }`), cleaned. */
  pre?: unknown[];
}

/** A desync: where the hashes disagreed, and what to replay it from. */
export interface ReportDesync {
  where: 'city' | 'battle';
  /** The tick the hashes disagreed at (a battle: the step it ended on). */
  tick: number;
  /** The hashes on each side: this page's, and the other side's (the room's pacer, or the other city). */
  mine: string;
  theirs: string;
  /** This page's hourly checksums up to the disagreement, oldest first. */
  sums?: [number, string][];
  /** The other side's, as the room kept them. */
  theirSums?: [number, string][];
  /** The last agreed snapshot (a shared city). */
  start?: ReportStart;
  /** The room's events since that snapshot, cleaned (`cleanEvents`), when they fit the cap. */
  events?: unknown[];
  /** Set when the events didn't fit and were left out. */
  cut?: boolean;
  /** A battle's version and how many steps each side ran. */
  battle?: { v: number; steps: number; theirSteps?: number };
  /** Which parts of the saved state differed, when the page could tell (a month's part hashes). */
  parts?: string[];
}

export interface Report {
  kind: ReportKind;
  env: ReportEnv;
  /** The error's message (or a short line saying what failed). */
  message: string;
  /** Its stack, addresses without query strings. */
  stack: string;
  /** When it happened on the player's clock (ms); the server keeps its own time. */
  at: number;
  /** How many times this browser saw it before sending (folded on the page). */
  count?: number;
  /** "Report a problem": the player's message. */
  note?: string;
  /** "Report a problem": a picture of the game (the 3D view only), as a JPEG data URL. */
  shot?: string;
  desync?: ReportDesync;
}

/** The caps every hop holds to. */
export const REPORT_CAPS = {
  message: 300,
  stack: 3000,
  note: 500,
  /** A JPEG data URL's characters (about 190 KB of picture). */
  shot: 260_000,
  /** The desync's events as JSON. */
  events: 120_000,
  eventsCount: 2000,
  sums: 200,
  parts: 60,
  /** A whole report as JSON; the server refuses a bigger body before reading it. */
  body: 400_000,
} as const;

/** Control characters (but tab and line breaks) and the invisible ones that reorder or hide text. */
function unseen(c: number): boolean {
  return (
    c < 9 ||
    c === 11 ||
    c === 12 ||
    (c > 13 && c < 32) ||
    c === 127 ||
    (c >= 0x200b && c <= 0x200f) ||
    (c >= 0x202a && c <= 0x202e) ||
    (c >= 0x2066 && c <= 0x2069) ||
    c === 0xfeff
  );
}

/** Text with control and invisible characters removed, cut to `max`. Keeps line breaks. */
export function cleanText(input: unknown, max: number): string {
  if (typeof input !== 'string') return '';
  let s = '';
  for (const ch of input.replace(/\r\n?/g, '\n')) if (!unseen(ch.charCodeAt(0))) s += ch;
  return s.slice(0, max);
}

/**
 * Quoted text that could be someone's words rather than a program's (it has a space in it, or runs
 * long): an error parsing a file quotes the file ("My name is"... is not valid JSON), so it goes.
 */
export function quietQuotes(text: string): string {
  return text.replace(/"[^"\n]*"|'[^'\n]*'|\u201c[^\u201d\n]*\u201d/g, (q) =>
    /\s/.test(q) || q.length > 26 ? '"…"' : q,
  );
}

/** A short label (build, browser, OS, quality): letters, digits, spaces and a few marks. */
function label(input: unknown, max = 40): string {
  if (typeof input !== 'string') return '?';
  const s = input
    .replace(/[^A-Za-z0-9 ._()+/-]/g, '')
    .trim()
    .slice(0, max);
  return s || '?';
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
/** A hash as the sims print them (a checksum and the event fingerprint: `0123abcd…:89ab`). */
const hex = (v: unknown): string => (typeof v === 'string' ? v.replace(/[^0-9a-f:]/gi, '').slice(0, 40) : '');

/**
 * Addresses without their query strings or fragments (a page's address can carry a city's name in
 * `?name=`), and the origin cut down to its path, so a stack names files, never the player's URL.
 */
export function stripAddresses(text: string): string {
  return text
    .replace(
      /\b(?:https?|blob|file|chrome-extension|moz-extension|webkit-masked-url):\/\/[^\s)'"]*/gi,
      (url) => {
        let s = url.replace(/^[a-z-]+:\/\/[^/]*/i, '');
        // Keep a stack frame's line and column; drop the query and fragment before them.
        const at = /(:\d+){1,2}$/.exec(s);
        const tail = at ? at[0] : '';
        if (at) s = s.slice(0, at.index);
        return s.replace(/[?#].*$/, '') + tail;
      },
    )
    .replace(/[?&](name|rname|join|region|visit|city)=[^\s&)'"]*/gi, '');
}

/**
 * Text with every name the page knows of (the player's, the city's, friends', districts') replaced,
 * longest first so a name inside another goes too. Names shorter than three letters are left (too
 * likely to be part of an ordinary word).
 */
export function scrubText(text: string, names: Iterable<string>): string {
  const list = [...new Set([...names].map((n) => n.trim()).filter((n) => n.length >= 3))].sort(
    (a, b) => b.length - a.length,
  );
  let out = text;
  for (const n of list) out = out.split(n).join('[name]');
  return out;
}

/** Commands whose typed text is replaced before a replay leaves the page. */
const TYPED: Record<string, string[]> = {
  renameCity: ['name'],
  createDistrict: ['name'],
  renameDistrict: ['name'],
  setMapInfo: ['name'],
  declareWar: ['reason'],
};

/** Fields that hold words someone wrote or a place's name, wherever they appear. */
const WORDS = /^(name|text|title|note|message|reason|city|cityName|mayor|label|description|words)$/;

/**
 * Commands that carry what other players or other towns hold (a region's news with friends' names,
 * battles fought in another town, a friend's war and its reason): a replay holding one isn't sent.
 */
export const OTHERS_COMMANDS = new Set([
  'regionUpdate',
  'battleResolve',
  'battleReport',
  'battleLive',
  'battleSettling',
  'missionResult',
  'opResolve',
  'spySettling',
  'helpSend',
  'helpEnd',
  'friendWar',
  'friendTreaty',
  'friendPacts',
  'friendFallout',
  'friendWinter',
  'warClock',
  'atomFirst',
]);

/** How deep a replay's JSON may go (commands are a few levels deep; more is someone's mischief). */
const MAX_DEPTH = 24;

/** Does a list of events or commands hold a command with others' words in it? */
export function holdsOthers(list: readonly unknown[]): boolean {
  for (const e of list) {
    const o = e as { cmd?: { type?: unknown }; ev?: { cmd?: { type?: unknown } } } | null;
    const t = o?.cmd?.type ?? o?.ev?.cmd?.type;
    if (typeof t === 'string' && OTHERS_COMMANDS.has(t)) return true;
  }
  return false;
}

/**
 * The room's events with every typed text replaced by a placeholder ("Name 1"): commands that carry a
 * name or a reason, and any string field that holds words (`WORDS`) deeper down. Hourly checksums
 * never read them, so a replay of the cleaned events reaches the same checksums. Throws on JSON
 * deeper than `MAX_DEPTH`.
 */
export function cleanEvents(events: readonly unknown[]): unknown[] {
  let k = 0;
  const walk = (v: unknown, typed: string[], depth: number): unknown => {
    if (depth > MAX_DEPTH) throw new Error('too deep');
    if (Array.isArray(v)) return v.map((x) => walk(x, [], depth + 1));
    if (!v || typeof v !== 'object') return v;
    const o = v as Record<string, unknown>;
    const fields = typeof o.type === 'string' ? (TYPED[o.type] ?? []) : typed;
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(o)) {
      if (typeof val === 'string' && (fields.includes(key) || WORDS.test(key))) out[key] = `Name ${++k}`;
      else out[key] = walk(val, [], depth + 1);
    }
    return out;
  };
  return events.map((e) => walk(e, [], 0));
}

/**
 * A map seed that the game made up (six letters and digits from the new-city screen's dice, or a
 * preset's word) rather than one a player typed, which could be their name: only those go in a report.
 */
export function generatedSeed(seed: string): boolean {
  return /^[0-9a-z]{6}$/.test(seed) && /\d/.test(seed) && /[a-z]/.test(seed);
}

function cleanPairs(v: unknown, max: number): [number, string][] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: [number, string][] = [];
  for (const p of v.slice(-max))
    if (Array.isArray(p) && isInt(p[0]) && typeof p[1] === 'string') out.push([p[0], hex(p[1])]);
  return out.length ? out : undefined;
}

const FOUNDING_FLAGS = ['sandbox', 'disasters', 'elections', 'rivals', 'region'] as const;

function cleanFounding(v: unknown): ReportFounding | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.seed !== 'string' || typeof o.preset !== 'string' || !generatedSeed(o.seed)) return undefined;
  const f: ReportFounding = { seed: o.seed.slice(0, 40), preset: label(o.preset, 20) };
  if (typeof o.difficulty === 'string') f.difficulty = label(o.difficulty, 10);
  for (const k of FOUNDING_FLAGS) if (typeof o[k] === 'boolean') f[k] = o[k];
  if (isInt(o.terrain)) f.terrain = o.terrain;
  return f;
}

function cleanDesync(v: unknown): ReportDesync | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  if ((o.where !== 'city' && o.where !== 'battle') || !isInt(o.tick)) return undefined;
  const d: ReportDesync = { where: o.where, tick: o.tick, mine: hex(o.mine), theirs: hex(o.theirs) };
  const sums = cleanPairs(o.sums, REPORT_CAPS.sums);
  if (sums) d.sums = sums;
  const theirSums = cleanPairs(o.theirSums, REPORT_CAPS.sums);
  if (theirSums) d.theirSums = theirSums;
  const s = o.start as Record<string, unknown> | undefined;
  if (s && typeof s === 'object' && isInt(s.tick) && isInt(s.seq)) {
    d.start = { tick: s.tick, seq: s.seq, sum: hex(s.sum) };
    if (isInt(s.eventHash)) d.start.eventHash = s.eventHash;
    if (s.rules && typeof s.rules === 'object' && JSON.stringify(s.rules).length <= 4000)
      d.start.rules = cleanEvents([s.rules])[0];
    const f = cleanFounding(s.founded);
    // A founded start carries the commands before sharing; without them it isn't one.
    const pre = Array.isArray(s.pre) ? s.pre.slice(0, REPORT_CAPS.eventsCount) : null;
    const preOk =
      !!pre &&
      pre.length === (s.pre as unknown[]).length &&
      pre.every((e) => {
        const x = e as Record<string, unknown> | null;
        return (
          !!x && typeof x === 'object' && isInt(x.tick) && ((!!x.cmd && typeof x.cmd === 'object') || x.settle === true)
        );
      });
    if (f && preOk && !holdsOthers(pre)) {
      const cleaned = cleanEvents(pre);
      if (JSON.stringify(cleaned).length <= REPORT_CAPS.events / 2) {
        d.start.founded = f;
        d.start.pre = cleaned;
      }
    }
  }
  if (Array.isArray(o.events)) {
    const list = o.events.slice(0, REPORT_CAPS.eventsCount);
    const ok = list.every((e) => {
      const x = e as Record<string, unknown> | null;
      return (
        !!x && typeof x === 'object' && isInt(x.tick) && isInt(x.seq) && !!x.ev && typeof x.ev === 'object'
      );
    });
    // Typed text is cleaned again here: a modified page mustn't slip a name through.
    const cleaned = ok && !holdsOthers(list) ? cleanEvents(list) : null;
    if (cleaned && list.length === o.events.length && JSON.stringify(cleaned).length <= REPORT_CAPS.events)
      d.events = cleaned;
    else d.cut = true;
  }
  if (o.cut === true) d.cut = true;
  const b = o.battle as Record<string, unknown> | undefined;
  if (b && typeof b === 'object' && isInt(b.v) && isInt(b.steps)) {
    d.battle = { v: b.v, steps: b.steps };
    if (isInt(b.theirSteps)) d.battle.theirSteps = b.theirSteps;
  }
  if (Array.isArray(o.parts))
    d.parts = o.parts
      .filter((p): p is string => typeof p === 'string')
      .slice(0, REPORT_CAPS.parts)
      .map((p) => label(p, 40));
  return d;
}

/** A picture of the game: a JPEG or PNG data URL within the cap, or nothing. */
function cleanShot(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length > REPORT_CAPS.shot) return undefined;
  return /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(v) ? v : undefined;
}

export type Cleaned = { ok: true; report: Report } | { ok: false; why: string };

/**
 * A report as every hop keeps it: the known fields only, each checked for shape and cut to its cap.
 * What doesn't fit the shape at all is refused with a reason; text that's too long is cut.
 */
export function cleanReport(raw: unknown): Cleaned {
  if (!raw || typeof raw !== 'object') return { ok: false, why: 'not a report' };
  const r = raw as Record<string, unknown>;
  if (!REPORT_KINDS.includes(r.kind as ReportKind)) return { ok: false, why: 'unknown kind' };
  const e = r.env as Record<string, unknown> | undefined;
  if (!e || typeof e !== 'object') return { ok: false, why: 'no env' };
  const env: ReportEnv = {
    build: label(e.build, 16),
    ...(isInt(e.built) && e.built > 0 ? { built: e.built } : {}),
    browser: label(e.browser, 30),
    os: label(e.os, 20),
    quality: label(e.quality, 10),
    save: isInt(e.save) ? Math.max(0, Math.min(9999, e.save)) : 0,
    shared: REPORT_SHARED.includes(e.shared as ReportShared) ? (e.shared as ReportShared) : 'no',
    where: REPORT_WHERE.includes(e.where as ReportWhere) ? (e.where as ReportWhere) : 'boot',
  };
  const kind = r.kind as ReportKind;
  const report: Report = {
    kind,
    env,
    message: quietQuotes(stripAddresses(cleanText(r.message, REPORT_CAPS.message * 2))).slice(0, REPORT_CAPS.message),
    stack: quietQuotes(stripAddresses(cleanText(r.stack, REPORT_CAPS.stack * 2))).slice(0, REPORT_CAPS.stack),
    at: isInt(r.at) ? r.at : 0,
  };
  if (isInt(r.count) && r.count > 1) report.count = Math.min(r.count, 10_000);
  if (kind === 'user') {
    const note = cleanText(r.note, REPORT_CAPS.note).trim();
    if (note) report.note = note;
    const shot = cleanShot(r.shot);
    if (shot) report.shot = shot;
    if (!note && !shot && !report.message) return { ok: false, why: 'an empty report' };
  } else if (!report.message && !report.stack) return { ok: false, why: 'no message' };
  if (kind === 'desync') {
    let d: ReportDesync | undefined;
    try {
      d = cleanDesync(r.desync);
    } catch {
      return { ok: false, why: 'a malformed desync' };
    }
    if (!d) return { ok: false, why: 'a desync without its hashes' };
    report.desync = d;
  }
  return { ok: true, report };
}

/** A message with what changes between occurrences (numbers, hashes, quoted values) taken out. */
export function normaliseMessage(message: string): string {
  return message
    .replace(/0x[0-9a-f]+/gi, '#')
    .replace(/\b[0-9a-f]{8,}\b/gi, '#')
    .replace(/\d+(\.\d+)?/g, '#')
    .replace(/"[^"]{0,80}"/g, '"…"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * The first frame's function, if it has a readable name (minified names of one or two letters change
 * between builds), else the file's name without its build hash: the place an error came from, kept
 * the same across versions so an error that comes back on a newer build finds its old entry.
 */
export function firstFrame(stack: string): string {
  for (const line of stack.split('\n')) {
    // V8: "at fn (file:1:2)" or "at file:1:2"; Gecko and WebKit: "fn@file:1:2".
    const chrome = /^\s*at\s+(?:async\s+)?(?:(.+?)\s+\()?([^()\s]+)\)?\s*$/.exec(line);
    const gecko = /^\s*([^@\s]*)@(\S*)/.exec(line);
    const m = line.trim().startsWith('at ') ? chrome : gecko;
    if (!m) continue;
    // A method keeps its name in a minified build; its class's name doesn't ("Xy.step" → "step").
    const fn = (m[1] ?? '').replace(/^new\s+/, '').split('.').pop() ?? '';
    if (fn.length >= 4 && fn !== '<anonymous>') return fn;
    const file = (m[2] ?? '')
      .split('/')
      .pop()
      ?.replace(/(:\d+)+$/, '')
      .replace(/-[\w-]{6,}(?=\.\w+$)/, '');
    if (file) return file;
  }
  return '';
}

/**
 * The key reports fold under: the same error from any version is one entry (with its versions
 * counted), so an entry marked fixed can reopen when it comes back on a newer build. Desyncs fold by
 * where they happened; written reports are one entry, each kept as an item.
 */
export function reportKey(r: Report): string {
  // Written reports are one entry, each kept as an item: one sender can't fill the desk with entries.
  if (r.kind === 'user') return 'user';
  if (r.kind === 'desync') return `desync-${r.desync?.where ?? 'city'}`;
  return `${r.kind}-${fnv1a(`${r.kind}|${normaliseMessage(r.message)}|${firstFrame(r.stack)}`)}`;
}

/** A report's size on the wire. */
export const reportBytes = (r: Report): number => JSON.stringify(r).length;
