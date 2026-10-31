/**
 * The region's war history, as a page shows it (M39 step 7, design calls 8 and 10): the list in the
 * City history panel beside the city's own chart. Pure, with no clock and no DOM, so it is tested
 * alone and a page only draws what it says.
 *
 * The region room keeps the last 100 war events (declarations, wars opened, battles with their outcome
 * and score, ceasefires, treaties with their terms in words, capitulations, vassals, risings, pacts
 * broken) and the last 20 finished live battles as replays. A page hears the events in `rwelcome` when
 * it joins and one at a time as they happen (an event heard again with its id replaces the first: a
 * battle's line is first written when it ends and gains its outcome and score when the defender
 * reports), and it hears of each battle the room keeps in `rwelcome` and in `bend`. Times are the
 * room's, real time in milliseconds; this shows them in the player's day.
 */
import { FRIENDS, LIVE, type BattleOutcome, type WarEvent, type WarEventKind } from '../../relay/protocol';
import type { LiveReplay } from '../../relay/region';

// ---- Events --------------------------------------------------------------------------------

const KINDS: readonly WarEventKind[] = [
  'declared',
  'opened',
  'battle',
  'ceasefire',
  'treaty',
  'capitulated',
  'vassal',
  'freed',
  'hold',
  'broken',
  'ended',
];

const OUTCOMES: readonly BattleOutcome[] = ['raided', 'repelled', 'withdrew'];

/** The longest line kept: the room's own are well under it. */
export const TEXT_MAX = 400;

const whole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
/** A time from the room: any finite number of ms since the epoch or the room's start (rounded). */
const timeMs = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * An event as the room sent it, or null when it isn't one (a region in a friend's browser could send
 * anything): unknown keys are dropped, the line is cut to `TEXT_MAX`.
 */
export function cleanEvent(e: unknown): WarEvent | null {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
  const r = e as Record<string, unknown>;
  // (`at` is rounded rather than refused: a room on a fractional clock, as a browser's `performance.now()`
  // is, would otherwise lose every event it keeps.)
  if (!whole(r.id) || !timeMs(r.at) || !whole(r.a) || !whole(r.b)) return null;
  if (typeof r.kind !== 'string' || !KINDS.includes(r.kind as WarEventKind)) return null;
  if (typeof r.text !== 'string') return null;
  const out: WarEvent = {
    id: r.id,
    at: Math.round(r.at),
    kind: r.kind as WarEventKind,
    a: r.a,
    b: r.b,
    text: r.text.slice(0, TEXT_MAX),
  };
  if (whole(r.war)) out.war = r.war;
  const b = r.battle as Record<string, unknown> | undefined;
  if (b && typeof b === 'object' && whole(b.from) && typeof b.id === 'string' && b.id.length <= 60)
    out.battle = { from: b.from, id: b.id, ...(b.live === true ? { live: true as const } : {}) };
  if (typeof r.outcome === 'string' && OUTCOMES.includes(r.outcome as BattleOutcome))
    out.outcome = r.outcome as BattleOutcome;
  if (typeof r.score === 'number' && Number.isFinite(r.score)) out.score = r.score;
  return out;
}

/**
 * The history as it stands once `incoming` is heard: events with an id already in the list replace
 * it, the rest are added; oldest first by id (the room numbers them as it writes them), at most `cap`
 * of the newest. Anything that is not an event is left out. A fresh list; the first is not touched.
 */
export function mergeHistory(
  list: readonly WarEvent[],
  incoming: readonly unknown[],
  cap: number = FRIENDS.history,
): WarEvent[] {
  const byId = new Map<number, WarEvent>();
  for (const e of list) byId.set(e.id, e);
  for (const raw of incoming) {
    const e = cleanEvent(raw);
    if (e) byId.set(e.id, e);
  }
  const all = [...byId.values()].sort((x, y) => x.id - y.id);
  return all.length > cap ? all.slice(all.length - cap) : all;
}

// ---- Kinds ---------------------------------------------------------------------------------

/** What the list can be narrowed to (a player thinks in these, not in the room's eleven kinds). */
export type HistoryGroup = 'battles' | 'declarations' | 'treaties' | 'conquests' | 'broken';

export const HISTORY_GROUPS: readonly { id: HistoryGroup; name: string; kinds: readonly WarEventKind[] }[] = [
  { id: 'battles', name: 'Battles', kinds: ['battle'] },
  { id: 'declarations', name: 'Wars', kinds: ['declared', 'opened'] },
  { id: 'treaties', name: 'Treaties', kinds: ['treaty', 'ceasefire', 'ended'] },
  { id: 'conquests', name: 'Conquests', kinds: ['capitulated', 'hold', 'vassal', 'freed'] },
  { id: 'broken', name: 'Broken pacts', kinds: ['broken'] },
];

export function groupOf(kind: WarEventKind): HistoryGroup {
  return HISTORY_GROUPS.find((g) => g.kinds.includes(kind))?.id ?? 'declarations';
}

/** A battle's outcome in a word or two, from the attacker's side as the line reads. */
export const OUTCOME_NAMES: Record<BattleOutcome, string> = {
  raided: 'Raid struck',
  repelled: 'Beaten off',
  withdrew: 'Pulled back',
};

// ---- Replays -------------------------------------------------------------------------------

/** A finished live battle the region keeps, as a page knows it (the room's `LiveReplay` without its row). */
export type ReplayRef = Omit<LiveReplay, 'k'>;

/** The key a battle is known by in the region: its attacker's place and its id. */
export const replayKey = (from: number, id: string): string => `${from}:${id}`;

/** What `bend` says of a battle's end, as a replay. */
export interface BattleEnd {
  id: string;
  from: number;
  to: number;
  step: number;
  hash: string;
  agree: boolean;
  solo?: true;
  abandoned?: true;
  /** `false`: the room did not store this battle (its day's rows were spent): there is no replay to watch. */
  kept?: false;
}

function cleanRef(r: unknown): ReplayRef | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id.length > 60 || !whole(o.from) || !whole(o.to)) return null;
  if (!whole(o.step) || typeof o.hash !== 'string' || o.hash.length > 64) return null;
  return {
    id: o.id,
    from: o.from,
    to: o.to,
    step: o.step,
    hash: o.hash,
    agree: o.agree !== false,
    ...(o.solo === true ? { solo: true as const } : {}),
    ...(o.abandoned === true ? { abandoned: true as const } : {}),
  };
}

/** The replays the room says it keeps (`rwelcome`), oldest first, at most what it keeps. */
export function replaysFrom(list: readonly unknown[] | undefined): ReplayRef[] {
  const out: ReplayRef[] = [];
  for (const r of list ?? []) {
    const ref = cleanRef(r);
    if (ref) out.push(ref);
  }
  return out.slice(-LIVE.replays);
}

/**
 * A battle ended and the room keeps it: added to the list (one heard again replaces its first), and
 * the oldest drop off past what the room keeps. A battle the room did not store (`kept: false`) is not
 * added, and takes nothing off the list: the room still keeps the others. A fresh list.
 */
export function withReplay(
  list: readonly ReplayRef[],
  end: BattleEnd,
  cap: number = LIVE.replays,
): ReplayRef[] {
  const ref = end.kept === false ? null : cleanRef(end);
  if (!ref) return [...list];
  const rest = list.filter((r) => replayKey(r.from, r.id) !== replayKey(ref.from, ref.id));
  rest.push(ref);
  return rest.slice(-cap);
}

/** The replay of a battle, if the room keeps it. */
export function replayOf(list: readonly ReplayRef[], from: number, id: string): ReplayRef | undefined {
  return list.find((r) => r.from === from && r.id === id);
}

// ---- Rows ----------------------------------------------------------------------------------

/** One line of the list. */
export interface HistoryRow {
  id: number;
  /** The room's time (ms). */
  at: number;
  kind: WarEventKind;
  group: HistoryGroup;
  a: number;
  b: number;
  text: string;
  /** A battle: fought live (the others are the old way, without a replay). */
  live: boolean;
  outcome?: BattleOutcome;
  /** The war's score after a battle, from its declarer's side. */
  score?: number;
  /** The battle's replay, if the room still keeps it. */
  replay?: ReplayRef;
}

/** What the list is narrowed to: a city (its place), and the groups of kinds shown (none: all). */
export interface HistoryFilter {
  city: number | null;
  groups: readonly HistoryGroup[];
}

export const NO_FILTER: HistoryFilter = { city: null, groups: [] };

/** The lines that pass the filter, newest first. */
export function historyRows(
  events: readonly WarEvent[],
  replays: readonly ReplayRef[],
  filter: HistoryFilter = NO_FILTER,
): HistoryRow[] {
  const rows: HistoryRow[] = [];
  for (const e of events) {
    const group = groupOf(e.kind);
    if (filter.groups.length && !filter.groups.includes(group)) continue;
    if (filter.city !== null && e.a !== filter.city && e.b !== filter.city) continue;
    const replay = e.battle ? replayOf(replays, e.battle.from, e.battle.id) : undefined;
    rows.push({
      id: e.id,
      at: e.at,
      kind: e.kind,
      group,
      a: e.a,
      b: e.b,
      text: e.text,
      live: !!e.battle?.live,
      ...(e.outcome ? { outcome: e.outcome } : {}),
      ...(e.score !== undefined ? { score: e.score } : {}),
      ...(replay ? { replay } : {}),
    });
  }
  return rows.sort((x, y) => y.at - x.at || y.id - x.id);
}

/** A city the list can be narrowed to. */
export interface HistoryCity {
  slot: number;
  name: string;
  /** No longer in the region. */
  gone?: true;
}

/**
 * The cities to choose from: those in the region now, and those the history mentions that have left
 * (their lines stay; the room has no name for them any more).
 */
export function historyCities(
  events: readonly WarEvent[],
  inRegion: readonly { slot: number; name: string }[],
): HistoryCity[] {
  const out: HistoryCity[] = inRegion.map((c) => ({ slot: c.slot, name: c.name }));
  const known = new Set(out.map((c) => c.slot));
  for (const e of events)
    for (const slot of [e.a, e.b])
      if (!known.has(slot)) {
        known.add(slot);
        out.push({ slot, name: `A former city (#${slot})`, gone: true });
      }
  return out.sort((x, y) => Number(!!x.gone) - Number(!!y.gone) || x.name.localeCompare(y.name));
}

// ---- Dates ---------------------------------------------------------------------------------

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const DAY_MS = 86_400_000;

/** The player's offset from UTC in minutes (east positive) at that moment, as the browser has it. */
export const localOffset = (at: number): number => -new Date(at).getTimezoneOffset();

/**
 * An offset from UTC in minutes: one for every moment, or a function of the moment, because the offset
 * changes when the clocks do (an event from before the change is shown in the time it was).
 */
export type Offset = number | ((at: number) => number);

const offsetAt = (o: Offset, at: number): number => (typeof o === 'number' ? o : o(at));

const two = (n: number) => String(n).padStart(2, '0');

/** "14:32", in the day the offset gives. */
export function timeLabel(at: number, offset: Offset): string {
  const d = new Date(at + offsetAt(offset, at) * 60_000);
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

const dayNumber = (at: number, offset: Offset): number =>
  Math.floor((at + offsetAt(offset, at) * 60_000) / DAY_MS);

/** "Today", "Yesterday" or "Mon 12 Oct" (and the year when it isn't this one). */
export function dayLabel(at: number, now: number, offset: Offset): string {
  const diff = dayNumber(now, offset) - dayNumber(at, offset);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const d = new Date(at + offsetAt(offset, at) * 60_000);
  const year = new Date(now + offsetAt(offset, now) * 60_000).getUTCFullYear();
  const base = `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return d.getUTCFullYear() === year ? base : `${base} ${d.getUTCFullYear()}`;
}

/** The rows under their day's heading, newest first (rows already newest first). */
export function byDay(
  rows: readonly HistoryRow[],
  now: number,
  offset: Offset,
): { day: string; rows: HistoryRow[] }[] {
  const out: { day: string; key: number; rows: HistoryRow[] }[] = [];
  for (const r of rows) {
    const key = dayNumber(r.at, offset);
    const last = out.at(-1);
    if (last && last.key === key) last.rows.push(r);
    else out.push({ day: dayLabel(r.at, now, offset), key, rows: [r] });
  }
  return out.map(({ day, rows: list }) => ({ day, rows: list }));
}

// ---- What the panel says -------------------------------------------------------------------

/**
 * Whether the City history panel offers the region's war history beside the city's own: only when war
 * is on for the city (its sim has a war state) or for the region it stands in. A peaceful city, in a
 * region or out of one, and a city in a region with war off, are shown nothing new (peaceful play
 * is unchanged).
 */
export function offersRegionHistory(o: { cityWar: boolean; regionWar: boolean | undefined }): boolean {
  return o.cityWar || o.regionWar === true;
}

/**
 * Whether there is a list to show, and if not, why. `joining`: the city is on its way into a region and
 * has not heard its rules yet; `loading`: the region has not told this page its history yet;
 * `unsupported`: the region's room is of an older version that keeps no history, so none will come.
 */
export type HistoryState = 'list' | 'joining' | 'loading' | 'unsupported' | 'empty' | 'off' | 'none';

export function historyState(o: {
  inRegion: boolean;
  /** The city has a region (it is joining or rejoining one) though its view has not come yet. */
  joining?: boolean;
  warOn: boolean;
  events: number;
  /** The region has told this page its whole state since the link came up. */
  synced?: boolean;
  /** The region's room answered the welcome without a history: it doesn't speak wars between friends. */
  unsupported?: boolean;
}): HistoryState {
  if (!o.inRegion) return o.joining ? 'joining' : 'none';
  if (!o.warOn) return 'off';
  if (o.events) return 'list';
  if (o.unsupported) return 'unsupported';
  return o.synced === false ? 'loading' : 'empty';
}

export const STATE_WORDS: Record<Exclude<HistoryState, 'list'>, string> = {
  none: 'This city isn’t in a region. In a region with war on, the wars, battles and treaties between its cities are kept here (the Region panel, Shift+N, starts or joins one).',
  off: 'War is off in this region. When its host turns it on, the wars, battles and treaties between its cities are kept here.',
  joining: 'Joining the region… its history will be asked for as soon as the city is in.',
  loading: 'Asking the region for its history…',
  unsupported:
    'This region runs an older version of the game that does not keep a war history. Its host needs to update, and then the wars, battles and treaties between its cities will be kept here.',
  empty:
    'Nothing has happened between the cities of this region yet. Declared wars, battles, treaties, conquests and broken pacts will be listed here, the last 100.',
};

// ---- Replays: how a viewer's run is judged --------------------------------------------------

/** What the replay is held to: how the battle ended when it was fought. */
export interface ReplayExpect {
  step: number;
  hash: string;
}

/** The end a replay is held to, or null when there is none to hold it to (a battle nobody finished). */
export function expectOf(ref: ReplayRef): ReplayExpect | null {
  return ref.abandoned ? null : { step: ref.step, hash: ref.hash };
}

export type ReplayVerdict = 'checked' | 'differs';

/** How a replay's run ended against the battle as it was fought. */
export function replayVerdict(expect: ReplayExpect, ran: { step: number; hash: string }): ReplayVerdict {
  return ran.step === expect.step && ran.hash === expect.hash ? 'checked' : 'differs';
}
