import { describe, expect, it } from 'vitest';
import {
  ATOM_MARKS,
  ATOM_WINTERS_PER_CITY,
  MemoryRegionStore,
  REGION_LIMITS,
  RegionRoom,
  parseRegionMsg,
  type RegionClientMsg,
  type RegionConn,
  type RegionLimits,
  type RegionMeta,
  type RegionRoomMsg,
} from '../region';
import { ATOM_PROTOCOL, FRIENDS, MIN_REGION_PROTOCOL, PROTOCOL_VERSION } from '../protocol';
import { DAY_MS } from '../limits';
import { ATOM_WIRE, bombLine, cleanAtomReport, raceLine } from '../../src/data/atom';
import { regionUpdateFor } from '../../src/net/regionLink';
import type { Conn } from '../room';
import { FakeClock, makeRoom } from './harness';

/**
 * M40, step 9: the region room and protocol 7 (docs/plans/M40-design.md, calls 16 and 17): the race in
 * the report, announced once a step in notices and history lines for the pages that speak the bomb;
 * the permanent record (`atoms`) and the first finisher; the winters' reach; the plume for each
 * friend; the strike on a friend (`op: 'atom'`) with its refusals in words; and the firer flagged for
 * good in the friends' state. Fake pages and a fake clock, as the other region tests.
 */

interface Raw {
  got: RegionRoomMsg[];
  conn: RegionConn;
  say(m: object): void;
  closed: string | null;
}

function raw(room: RegionRoom): Raw {
  const r: Raw = {
    got: [],
    closed: null,
    conn: null as unknown as RegionConn,
    say: (m) => room.message(r.conn, JSON.stringify(m)),
  };
  r.conn = { send: (m) => r.got.push(m), close: (_c, reason) => (r.closed = reason || 'closed') };
  room.open(r.conn);
  return r;
}

const hello = (mayor: string, extra: Record<string, unknown> = {}) => ({
  t: 'rhello',
  v: PROTOCOL_VERSION,
  mayor,
  color: 0,
  city: `${mayor}ton`,
  ...extra,
});

/** Every research branch done: what a city that may launch reports (the room checks it for a strike). */
const FULL_TIERS = [4, 4, 4, 4, 4, 4];

const report = (city: string, extra: Record<string, unknown> = {}) => ({
  t: 'report',
  city,
  report: {
    population: 5_000,
    kind: 'suburb',
    workers: 10,
    jobs: 10,
    shoppers: 5,
    offers: { buy: { power: 0, water: 0, garbage: 0 }, sell: { power: 0, water: 0, garbage: 0 } },
    deals: [],
    projectBuilt: false,
    tiers: FULL_TIERS,
    counter: 250,
    clock: 100,
    ...extra,
  },
});

type Msg<T extends RegionRoomMsg['t']> = Extract<RegionRoomMsg, { t: T }>;
const all = <T extends RegionRoomMsg['t']>(r: Raw, t: T) => r.got.filter((m) => m.t === t) as Msg<T>[];
const last = <T extends RegionRoomMsg['t']>(r: Raw, t: T) => all(r, t).at(-1);
const notices = (r: Raw) => all(r, 'notice').map((n) => n.text);
/** The history lines a page was sent, by kind. */
const lines = (r: Raw, kind: 'race' | 'bomb') =>
  all(r, 'history')
    .map((m) => m.event)
    .filter((e) => e.kind === kind);

const BOMB_RULES = { war: true, scale: 'total', supers: true, bomb: true } as const;
const BUSY: Partial<RegionLimits> = {
  rate: 1_000,
  burst: 100_000,
  raidsPerDay: 1_000,
  battleBurst: 1_000,
  opBurst: 1_000,
  dailyRows: 1_000_000,
};

const WHO = ['Ada', 'Sam', 'Kit', 'Lou'] as const;
type Who = (typeof WHO)[number];
const SLOT: Record<Who, number> = { Ada: 1, Sam: 2, Kit: 3, Lou: 4 };

interface World {
  clock: FakeClock;
  store: MemoryRegionStore;
  room: RegionRoom;
  page: Record<Who, Raw>;
  ada: Raw;
  sam: Raw;
  kit: Raw;
  secrets: Record<string, string>;
  /** The region's own record, as it is in memory. */
  meta(): RegionMeta;
}

/**
 * A region of `who` (Ada the host, then the others in order), each with a first report, on the bomb's
 * rules unless `rules` says otherwise. `v` gives a page an older protocol.
 */
function world(
  opts: {
    who?: readonly Who[];
    rules?: object | null;
    limits?: Partial<RegionLimits>;
    v?: Partial<Record<Who, number>>;
    report?: Partial<Record<Who, Record<string, unknown>>>;
  } = {},
): World {
  const clock = new FakeClock();
  // Midday UTC, so a test's day doesn't end under it.
  clock.advance(((Math.ceil(clock.t / DAY_MS) * DAY_MS - clock.t) % DAY_MS) + 12 * 3600_000);
  const store = new MemoryRegionStore();
  const room = new RegionRoom(
    '7ATOM9',
    'local',
    store,
    // (The room's dice for a friend's spy are fixed: a roll of 0 always works.)
    { now: clock.now, later: clock.later, roll: () => 0 },
    { ...BUSY, atomPrep: 60_000, ...(opts.limits ?? {}) },
  );
  const rules = opts.rules === undefined ? BOMB_RULES : opts.rules;
  const page = {} as Record<Who, Raw>;
  const secrets: Record<string, string> = {};
  for (const w of opts.who ?? ['Ada', 'Sam', 'Kit']) {
    const r = raw(room);
    r.say(
      hello(w, {
        ...(opts.v?.[w] ? { v: opts.v[w] } : {}),
        ...(w === 'Ada' ? { create: { name: 'Vale', ...(rules ? { rules } : {}) } } : {}),
      }),
    );
    secrets[w] = last(r, 'rwelcome')!.secret;
    r.say(report(`${w}ton`, opts.report?.[w] ?? {}));
    page[w] = r;
  }
  return {
    clock,
    store,
    room,
    page,
    ada: page.Ada,
    sam: page.Sam,
    kit: page.Kit,
    secrets,
    meta: () => (room as unknown as { meta: RegionMeta }).meta,
  };
}

/** A page says how its race stands (and anything else a report's `atom` carries). */
const race = (w: World, who: Who, atom: Record<string, unknown>) =>
  w.page[who].say(report(`${who}ton`, { atom }));

/** A page says it was told nothing of a race. */
const quiet = (w: World, who: Who) => w.page[who].say(report(`${who}ton`));

/** A moment between moves (the room paces a city's diplomacy). */
const breathe = (w: World) => w.clock.advance(FRIENDS.actEvery);

/** Declare a total war from one page on another's city, let the warning pass: it is open. */
function openTotalWar(w: World, from: Who, to: Who): void {
  breathe(w);
  w.page[from].say({ t: 'wdeclare', to: SLOT[to], scale: 'total', reason: 'The final race' });
  w.clock.advance(FRIENDS.warning + 1_000);
  w.room.message(w.page[from].conn, 'ping');
}

let opN = 0;
const strike = (to: number, id = `bo-aaaaaaaa-${++opN}`) => ({ t: 'op', to, id, op: 'atom' });

/** Ada's launch prepared long enough in the room's eyes, and a total war open with Sam: ready to strike. */
function readyToStrike(w: World, extra: Record<string, unknown> = {}): void {
  openTotalWar(w, 'Ada', 'Sam');
  race(w, 'Ada', { stage: 6, ...extra });
  w.clock.advance(61_000);
}

describe('M40: protocol 7', () => {
  it('is the room’s version; a region still serves 5 and 6, a shared city only the same', () => {
    expect(PROTOCOL_VERSION).toBe(7);
    expect(ATOM_PROTOCOL).toBe(7);
    expect(MIN_REGION_PROTOCOL).toBe(5);
    expect(REGION_LIMITS.atomPrep).toBe(20 * 60_000);
    expect(REGION_LIMITS.atomPerDay).toBe(8);
  });

  it('keeps a shared city’s room to the same version as ever: a page on 6 is turned away, one on 7 let in', () => {
    const room = makeRoom('COOP07');
    const hi = (v: number) =>
      JSON.stringify({ t: 'hello', v, name: 'Ada', color: 0, create: { cityName: 'X' } });
    const page = (v: number) => {
      const got: { t: string; code?: string }[] = [];
      const conn = { send: (m: { t: string }) => got.push(m), close: () => {} } as unknown as Conn;
      room.open(conn);
      room.message(conn, hi(v));
      return got;
    };
    expect(page(6).find((m) => m.t === 'error')).toMatchObject({ code: 'version' });
    expect(page(PROTOCOL_VERSION).map((m) => m.t)).toContain('welcome');
  });

  it('serves a page on 5 or 6, which is sent none of the bomb’s messages, and turns away an 8', () => {
    const w = world({ v: { Sam: 6, Kit: 5 } });
    for (const who of ['Sam', 'Kit'] as const) {
      const welcome = last(w.page[who], 'rwelcome')!;
      expect(welcome).not.toHaveProperty('atoms');
      expect(welcome).not.toHaveProperty('winters');
    }
    expect(last(w.ada, 'rwelcome')).toMatchObject({ atoms: [], winters: [] });
    const late = raw(w.room);
    late.say(hello('Zed', { v: PROTOCOL_VERSION + 1 }));
    expect(late.got.find((m) => m.t === 'error')).toMatchObject({ code: 'version' });
  });
});

describe('M40: the race in the report', () => {
  it('is read field by field: a good one is kept, with the plume cut to what the room allows', () => {
    const good = {
      stage: 4,
      fuel: 100,
      fired: true,
      boom: 2,
      hit: 1,
      stopped: 3,
      plume: [
        { slot: 1, total: 12.3456 },
        { slot: 3, total: 0 },
      ],
      extra: 'not kept',
    };
    expect(cleanAtomReport(good)).toEqual({
      stage: 4,
      fuel: 100,
      fired: true,
      boom: 2,
      hit: 1,
      stopped: 3,
      plume: [
        { slot: 1, total: 12.346 },
        { slot: 3, total: 0 },
      ],
    });
    expect(cleanAtomReport({ stage: 0 })).toEqual({ stage: 0 });
    const w = world();
    race(w, 'Sam', good);
    expect(w.ada.closed).toBeNull();
    expect(w.sam.closed).toBeNull();
    const seen = last(w.ada, 'region')!.region.cities.find((c) => c.slot === 2)!.report!;
    expect(seen.atom).toEqual(cleanAtomReport(good));
  });

  it('is dropped, never null and never a close, when any part is wrong', () => {
    const bad: unknown[] = [
      null,
      'stage 3',
      [],
      {},
      { stage: -1 },
      { stage: 9 },
      { stage: 2.5 },
      { stage: '3' },
      { stage: 3, fuel: 101 },
      { stage: 3, fuel: -1 },
      { stage: 3, fired: false },
      { stage: 3, boom: -1 },
      { stage: 3, boom: ATOM_WIRE.maxCount + 1 },
      { stage: 3, hit: 1.5 },
      { stage: 3, stopped: 'many' },
      { stage: 3, plume: 'north' },
      { stage: 3, plume: [1, 2] },
      { stage: 3, plume: Array.from({ length: ATOM_WIRE.plume + 1 }, (_, k) => ({ slot: k + 1, total: 1 })) },
      { stage: 3, plume: [{ slot: 0, total: 1 }] },
      { stage: 3, plume: [{ slot: 2, total: -1 }] },
      { stage: 3, plume: [{ slot: 2, total: 1e9 }] },
      { stage: 3, plume: [{ slot: 2, total: Number.NaN }] },
      {
        stage: 3,
        plume: [
          { slot: 2, total: 1 },
          { slot: 2, total: 2 },
        ],
      },
    ];
    for (const atom of bad) expect(cleanAtomReport(atom), JSON.stringify(atom)).toBeNull();
    const w = world();
    for (const atom of bad) {
      // JSON can't carry NaN: the room sees null for it, which is wrong as well.
      w.sam.say(report('Samton', { atom }));
      expect(w.sam.closed, JSON.stringify(atom)).toBeNull();
      expect(w.ada.closed).toBeNull();
      const seen = last(w.ada, 'region')!.region.cities.find((c) => c.slot === 2)!;
      expect(seen.report, 'the rest of the report stands').toMatchObject({ population: 5_000, clock: 100 });
      expect(seen.report!.atom, JSON.stringify(atom)).toBeUndefined();
    }
    // Nothing was announced for any of it.
    expect(notices(w.ada).filter((t) => /atom|bomb|fuel|silo|plant|launch/.test(t))).toEqual([]);
    // The message as the parser reads it: the report is there, without its race.
    const parsed = parseRegionMsg(JSON.stringify(report('Samton', { atom: { stage: 99 } })));
    expect(parsed).toMatchObject({ t: 'report', report: { population: 5_000 } });
    expect((parsed as Extract<RegionClientMsg, { t: 'report' }>).report.atom).toBeUndefined();
  });

  it('passes the plume on to each friend as its own entry and no other', () => {
    const w = world();
    race(w, 'Kit', {
      stage: 8,
      fired: true,
      boom: 1,
      plume: [
        { slot: 1, total: 12.5 },
        { slot: 2, total: 3 },
      ],
    });
    race(w, 'Sam', { stage: 2, fuel: 40, plume: [{ slot: 3, total: 7 }] });
    const view = last(w.ada, 'region')!.region;
    const forAda = regionUpdateFor(view, 1);
    expect(forAda.cities.find((c) => c.slot === 3)!.atom).toEqual({
      stage: 8,
      fired: true,
      boom: 1,
      plume: 12.5,
    });
    // Sam's air goes to Kit, not Ada: Ada hears of his race and no plume.
    expect(forAda.cities.find((c) => c.slot === 2)!.atom).toEqual({ stage: 2, fuel: 40 });
    const forSam = regionUpdateFor(view, 2);
    expect(forSam.cities.find((c) => c.slot === 3)!.atom!.plume).toBe(3);
    const forKit = regionUpdateFor(view, 3);
    expect(forKit.cities.find((c) => c.slot === 2)!.atom!.plume).toBe(7);
    expect(forKit.cities.find((c) => c.slot === 1)!.atom).toBeUndefined();
    // A region where war is off passes none of it on.
    const peace = world({ rules: null });
    race(peace, 'Kit', { stage: 3 });
    expect(regionUpdateFor(last(peace.ada, 'region')!.region, 1).cities.every((c) => !c.atom)).toBe(true);
  });

  it('is dropped for a page that does not speak the bomb', () => {
    const w = world({ v: { Sam: 6 } });
    race(w, 'Sam', { stage: 5 });
    expect(last(w.ada, 'region')!.region.cities.find((c) => c.slot === 2)!.report!.atom).toBeUndefined();
    expect(w.meta().atoms ?? []).toEqual([]);
  });
});

describe('M40: the race announced', () => {
  it('gives one notice and one history line for each step forward, to the pages that speak the bomb', () => {
    const w = world();
    const SAM = 'Samton';
    const names = [1, 2, 3, 4, 5, 6].map((s) => raceLine(s, SAM)!);
    expect(names).toEqual([
      'Samton has begun building an enrichment plant',
      'Samton has begun enriching fuel',
      'Samton has begun a silo',
      'Samton is building the bomb',
      'Samton has the atom bomb',
      'Samton is preparing a launch',
    ]);
    for (let stage = 1; stage <= 6; stage++) {
      race(w, 'Sam', { stage });
      // A report sent again changes nothing.
      race(w, 'Sam', { stage });
      race(w, 'Sam', { stage, fuel: stage <= 4 ? 10 * stage : undefined });
      for (const who of ['ada', 'kit', 'sam'] as const) {
        expect(notices(w[who]).filter((t) => names.includes(t))).toEqual(names.slice(0, stage));
        expect(lines(w[who], 'race').map((e) => e.text)).toEqual(names.slice(0, stage));
      }
    }
    // The line is the room's: who, when, what, on the region's own history.
    expect(lines(w.ada, 'race')[0]).toMatchObject({ kind: 'race', a: 2, b: 0, text: names[0] });
    expect(w.meta().history!.filter((e) => e.kind === 'race')).toHaveLength(6);
    // The bomb has left (the strike on a friend is its own line): stage 7 and 8 add no race line.
    race(w, 'Sam', { stage: 7, fired: true });
    race(w, 'Sam', { stage: 8, fired: true });
    expect(lines(w.ada, 'race')).toHaveLength(6);
    expect(lines(w.ada, 'bomb').map((e) => e.text)).toEqual(['Samton has fired the atom bomb']);
  });

  it('says nothing for a drop, and again for the step forward after it (a lost silo is re-armed)', () => {
    const w = world();
    for (const stage of [1, 2, 3, 4]) race(w, 'Sam', { stage });
    expect(lines(w.ada, 'race')).toHaveLength(4);
    race(w, 'Sam', { stage: 2 });
    race(w, 'Sam', { stage: 2, fuel: 50 });
    expect(lines(w.ada, 'race'), 'a drop says nothing').toHaveLength(4);
    race(w, 'Sam', { stage: 3 });
    expect(lines(w.ada, 'race').map((e) => e.text)).toEqual([
      ...[1, 2, 3, 4].map((s) => raceLine(s, 'Samton')!),
      'Samton has begun a silo',
    ]);
    // A report that has lost its race altogether drops it too.
    quiet(w, 'Sam');
    race(w, 'Sam', { stage: 1 });
    expect(lines(w.ada, 'race').at(-1)!.text).toBe('Samton has begun building an enrichment plant');
  });

  it('gives a city at most eight a day, and more the next', () => {
    const w = world();
    const flap = () => {
      for (let k = 0; k < 20; k++) {
        race(w, 'Sam', { stage: 3 });
        race(w, 'Sam', { stage: 4 });
      }
    };
    flap();
    expect(lines(w.ada, 'race')).toHaveLength(REGION_LIMITS.atomPerDay);
    expect(notices(w.ada).filter((t) => /^Samton (has begun|is building)/.test(t))).toHaveLength(
      REGION_LIMITS.atomPerDay,
    );
    // Another city has its own allowance.
    race(w, 'Kit', { stage: 1 });
    expect(lines(w.ada, 'race').at(-1)!.a).toBe(3);
    // The next UTC day, the city may be heard again.
    w.clock.advance(DAY_MS);
    flap();
    expect(lines(w.ada, 'race').filter((e) => e.a === 2)).toHaveLength(2 * REGION_LIMITS.atomPerDay);
  });

  it('is told to a page on 7 only: a page on 6 has none of the notices, lines or welcome history of it', () => {
    const w = world({ v: { Kit: 6 } });
    for (let stage = 1; stage <= 6; stage++) race(w, 'Sam', { stage });
    expect(lines(w.kit, 'race')).toEqual([]);
    expect(notices(w.kit).filter((t) => /Samton/.test(t))).toEqual([]);
    expect(lines(w.ada, 'race')).toHaveLength(6);
    // Joining: the history it is told leaves the bomb's lines out; a page on 7 is told them.
    const six = raw(w.room);
    six.say(hello('Kit', { v: 6, rejoin: { slot: 3, secret: w.secrets.Kit } }));
    const seven = raw(w.room);
    seven.say(hello('Ada', { rejoin: { slot: 1, secret: w.secrets.Ada } }));
    const kinds = (r: Raw) => last(r, 'rwelcome')!.friends!.history.map((e) => e.kind);
    expect(kinds(six)).not.toContain('race');
    expect(kinds(seven).filter((k) => k === 'race')).toHaveLength(6);
  });

  it('keeps the first to finish for good: one mark, told to that city alone, again when it comes back', () => {
    const w = world();
    for (let stage = 1; stage <= 4; stage++) race(w, 'Kit', { stage });
    expect(w.meta().atoms ?? []).toEqual([]);
    race(w, 'Sam', { stage: 5 });
    race(w, 'Kit', { stage: 5 });
    race(w, 'Sam', { stage: 6 });
    race(w, 'Sam', { stage: 5 });
    race(w, 'Sam', { stage: 5 });
    const at = w.clock.now();
    expect(w.meta().atoms).toEqual([
      { slot: 2, name: 'Samton', kind: 'ready', at, first: true },
      { slot: 3, name: 'Kitton', kind: 'ready', at },
    ]);
    expect(all(w.sam, 'atomFirst')).toEqual([{ t: 'atomFirst', at }]);
    expect(all(w.kit, 'atomFirst')).toEqual([]);
    expect(all(w.ada, 'atomFirst')).toEqual([]);
    // Everyone with the bomb's protocol hears the record grow, as a whole list.
    expect(last(w.ada, 'atoms')!.atoms.map((m) => [m.slot, m.kind, m.first])).toEqual([
      [2, 'ready', true],
      [3, 'ready', undefined],
    ]);
    // A page that was away is told on its return: the record, and that it was first.
    w.room.closed(w.sam.conn);
    const back = raw(w.room);
    back.say(hello('Sam', { rejoin: { slot: 2, secret: w.secrets.Sam } }));
    expect(last(back, 'rwelcome')!.atoms!.map((m) => m.first)).toEqual([true, undefined]);
    expect(all(back, 'atomFirst')).toHaveLength(1);
    // The one that was not first is not told it was.
    const kit2 = raw(w.room);
    kit2.say(hello('Kit', { rejoin: { slot: 3, secret: w.secrets.Kit } }));
    expect(all(kit2, 'atomFirst')).toEqual([]);
  });

  it('breaks a tie by arrival: the first stage-5 report the room sees', () => {
    const w = world();
    race(w, 'Kit', { stage: 5 });
    race(w, 'Sam', { stage: 5 });
    expect(w.meta().atoms!.map((m) => [m.slot, !!m.first])).toEqual([
      [3, true],
      [2, false],
    ]);
    // A city that comes to stage 5 by a jump (the room saw no 4) is marked all the same.
    const j = world();
    race(j, 'Sam', { stage: 2 });
    race(j, 'Sam', { stage: 6 });
    expect(j.meta().atoms!.map((m) => m.kind)).toEqual(['ready']);
    // (and every step it jumped over is announced, the red alert's included: see the review block below)
    expect(lines(j.ada, 'race').map((e) => e.text)).toEqual(
      [1, 2, 3, 4, 5, 6].map((s) => raceLine(s, 'Samton')),
    );
  });

  it('keeps sixteen marks at most, never the first finisher’s, and its lists under 2 KB', () => {
    const w = world();
    // City names are up to 40 characters: the worst case for the list's size.
    const long = 'Z'.repeat(40);
    w.kit.say(report(long, { atom: { stage: 5 } }));
    w.sam.say(report(long, { atom: { stage: 5 } }));
    // (A record as full as it can be: landed bombs are bounded by what a city’s neighbours can send, so
    // the rest is put there by hand, as a room of an older version could have left it.)
    const atoms = w.meta().atoms!;
    for (let k = 0; atoms.length < ATOM_MARKS; k++)
      atoms.push({ slot: 1, name: long, kind: k % 2 ? 'boom' : 'stopped', at: w.clock.now() - 1000 + k });
    for (let k = 0; k < 3; k++) {
      w.clock.advance(1000);
      w.sam.say(report(long, { atom: { stage: 5, stopped: 1 + k, hit: 0 } }));
    }
    expect(atoms).toHaveLength(ATOM_MARKS);
    expect(atoms[0]).toMatchObject({ slot: 3, kind: 'ready', first: true });
    expect(JSON.stringify(atoms).length).toBeLessThan(2048);
    expect(last(w.ada, 'atoms')!.atoms).toHaveLength(ATOM_MARKS);
  });
});

describe('M40: bombs fired, landed and stopped', () => {
  it('flags a city that reports its bomb fired, for good, with a mark and a line, once', () => {
    const w = world();
    race(w, 'Kit', { stage: 6 });
    race(w, 'Kit', { stage: 7, fired: true });
    race(w, 'Kit', { stage: 8, fired: true });
    race(w, 'Kit', { fired: true, stage: 8 });
    const fired = w.meta().atoms!.filter((m) => m.kind === 'fired');
    expect(fired).toEqual([{ slot: 3, name: 'Kitton', kind: 'fired', at: w.clock.now() }]);
    expect(lines(w.ada, 'bomb').map((e) => e.text)).toEqual([bombLine('fired', 'Kitton')]);
    expect(notices(w.ada)).toContain('Kitton has fired the atom bomb');
    expect(w.meta().friends!.pariahs).toEqual({ 3: w.clock.now() });
    // A page that stops reporting it still leaves the flag.
    quiet(w, 'Kit');
    expect(w.meta().friends!.pariahs![3]).toBeDefined();
    // The page that rejoined sees the mark in the welcome.
    const back = raw(w.room);
    back.say(hello('Ada', { rejoin: { slot: 1, secret: w.secrets.Ada } }));
    expect(last(back, 'rwelcome')!.atoms!.map((m) => m.kind)).toContain('fired');
  });

  it('marks and announces a bomb that fell here and one the dome stopped, each when the count rises', () => {
    // (A region of two: Sam has two neighbours that are the computer’s, so two bombs can be accounted for.)
    const w = world({ who: ['Ada', 'Sam'] });
    race(w, 'Sam', { stage: 0, hit: 0, stopped: 0, boom: 0 });
    race(w, 'Sam', { stage: 0, stopped: 1 });
    race(w, 'Sam', { stage: 0, stopped: 1 });
    race(w, 'Sam', { stage: 0, stopped: 1, hit: 1, boom: 1 });
    race(w, 'Sam', { stage: 0, stopped: 1, hit: 1, boom: 1 });
    expect(w.meta().atoms!.map((m) => [m.slot, m.kind])).toEqual([
      [2, 'stopped'],
      [2, 'boom'],
    ]);
    expect(lines(w.ada, 'bomb').map((e) => e.text)).toEqual([
      bombLine('stopped', 'Samton'),
      bombLine('boom', 'Samton'),
    ]);
    expect(bombLine('boom', 'Samton')).toBe('An atom bomb has fallen on Samton');
    // A count that falls (an older save) is not news again, nor is the same count after it.
    race(w, 'Sam', { stage: 0, stopped: 0, hit: 0, boom: 0 });
    race(w, 'Sam', { stage: 0, stopped: 1, hit: 1, boom: 1 });
    expect(w.meta().atoms).toHaveLength(2);
  });

  it('names no one hurt', () => {
    const said = [bombLine('fired', 'A', 'B'), bombLine('boom', 'B'), bombLine('stopped', 'B')];
    for (let s = 1; s <= 6; s++) said.push(raceLine(s, 'A')!);
    for (const t of said) expect(t).not.toMatch(/casualt|killed|dead|victim/i);
  });
});

describe('M40: the winters’ reach', () => {
  it('begins one for every other city when a count of bombs landed rises, and none for the reporter', () => {
    const w = world();
    race(w, 'Kit', { stage: 0, boom: 0 });
    race(w, 'Kit', { stage: 0, boom: 1, hit: 1 });
    const at = w.clock.now();
    expect(w.meta().winters).toEqual([{ id: '3-1', at, slots: [1, 2] }]);
    for (const who of ['ada', 'sam'] as const)
      expect(last(w[who], 'winters')).toEqual({
        t: 'winters',
        winters: [{ id: '3-1', at, slots: [1, 2] }],
      });
    expect(all(w.kit, 'winters')).toEqual([]);
    // The same count again, or after a drop, is the same bomb.
    race(w, 'Kit', { stage: 0, boom: 1, hit: 1 });
    race(w, 'Kit', { stage: 0, boom: 0 });
    race(w, 'Kit', { stage: 0, boom: 1, hit: 1 });
    expect(w.meta().winters).toHaveLength(1);
    expect(all(w.ada, 'winters')).toHaveLength(1);
    // The next bomb is the next id (here it is Ada’s strike, which the room kept, that explains it).
    openTotalWar(w, 'Ada', 'Kit');
    race(w, 'Ada', { stage: 6 });
    w.clock.advance(61_000);
    w.ada.say(strike(3, 'w-1'));
    expect(last(w.ada, 'opKept')!.outcome).toBe('success');
    race(w, 'Kit', { stage: 0, boom: 2, hit: 2 });
    expect(w.meta().winters!.map((x) => x.id)).toEqual(['3-1', '3-2']);
    expect(last(w.sam, 'winters')!.winters.map((x) => x.id)).toEqual(['3-1', '3-2']);
    // Two at once are two winters, in one message.
    const two = world({ who: ['Ada', 'Sam'] });
    race(two, 'Sam', { stage: 0, boom: 2, hit: 2 });
    expect(two.meta().winters!.map((x) => [x.id, x.slots])).toEqual([
      ['2-1', [1]],
      ['2-2', [1]],
    ]);
    expect(all(two.ada, 'winters')).toHaveLength(1);
  });

  it('counts a firer’s own bomb on a computer neighbour too (the city is not the one struck)', () => {
    const w = world();
    race(w, 'Sam', { stage: 7, fired: true });
    race(w, 'Sam', { stage: 8, fired: true, boom: 1 });
    expect(w.meta().winters).toEqual([{ id: '2-1', at: w.clock.now(), slots: [1, 3] }]);
    // No bomb fell on the firer’s city, so there is no mark of one.
    expect(w.meta().atoms!.map((m) => m.kind)).toEqual(['ready', 'fired']);
  });

  it('spares a city that joins later, keeps a returning one’s place, and tells a page on 6 nothing', () => {
    // Sam's page is on 6 and goes away; Lou has not come yet.
    const w = world({ v: { Sam: 6 } });
    w.room.closed(w.sam.conn);
    race(w, 'Kit', { stage: 0, boom: 1, hit: 1 });
    // Sam was away (and could not be told in any case): kept in its place.
    expect(w.meta().winters![0]!.slots).toEqual([1, 2]);
    expect(all(w.ada, 'winters')).toHaveLength(1);
    const six = raw(w.room);
    six.say(hello('Sam', { v: 6, rejoin: { slot: 2, secret: w.secrets.Sam } }));
    expect(last(six, 'rwelcome')).not.toHaveProperty('winters');
    expect(all(six, 'winters')).toEqual([]);
    // It upgrades and returns: the winter it missed is in its welcome (a page applies each id once).
    w.room.closed(six.conn);
    const seven = raw(w.room);
    seven.say(hello('Sam', { rejoin: { slot: 2, secret: w.secrets.Sam } }));
    expect(last(seven, 'rwelcome')!.winters!.map((x) => x.id)).toEqual(['3-1']);
    // A city that joins afterwards is not chilled by it ...
    const lou = raw(w.room);
    lou.say(hello('Lou'));
    expect(last(lou, 'rwelcome')).toMatchObject({ slot: 4, winters: [] });
    lou.say(report('Louton'));
    expect(all(lou, 'winters')).toEqual([]);
    // ... but the next bomb includes it (a strike of Ada’s the room keeps at Kit explains it).
    openTotalWar(w, 'Ada', 'Kit');
    race(w, 'Ada', { stage: 6 });
    w.clock.advance(61_000);
    w.ada.say(strike(3, 'w-2'));
    race(w, 'Kit', { stage: 0, boom: 2, hit: 2 });
    expect(w.meta().winters!.map((x) => [x.id, x.slots])).toEqual([
      ['3-1', [1, 2]],
      ['3-2', [1, 2, 4]],
    ]);
    expect(last(lou, 'winters')!.winters.map((x) => x.id)).toEqual(['3-2']);
  });

  it('takes the first report as a baseline: bombs from before the city came are not news', () => {
    const w = world({ who: ['Ada'] });
    const sam = raw(w.room);
    sam.say(hello('Sam'));
    sam.say(report('Samton', { atom: { stage: 0, boom: 1, hit: 1, stopped: 0 } }));
    expect(w.meta().winters ?? []).toEqual([]);
    expect(w.meta().atoms ?? []).toEqual([]);
    sam.say(report('Samton', { atom: { stage: 0, boom: 2, hit: 2, stopped: 0 } }));
    expect(w.meta().winters!.map((x) => x.id)).toEqual(['2-2']);
    // (The baseline counts against what the room can account for, like any other: a first report that
    // claims more than a city’s neighbours could have sent is cut to what they could.)
    const big = world({ who: ['Ada'] });
    const kit = raw(big.room);
    kit.say(hello('Kit'));
    kit.say(report('Kitton', { atom: { stage: 0, boom: 9, hit: 9, stopped: 9 } }));
    kit.say(report('Kitton', { atom: { stage: 0, boom: 9, hit: 9, stopped: 9 } }));
    expect(big.meta().winters ?? []).toEqual([]);
    expect(big.meta().cities[1]!.atom).toMatchObject({ hit: 2, stopped: 0, boom: 2 });
  });

  it('keeps its list small and a city’s winters to what its bombs can account for, whatever a page reports', () => {
    // Four cities, each reporting thirty bombs fallen on it: the winters are the neighbours the computer had
    // when each joined (three, two, one, none).
    const four = world({ who: ['Ada', 'Sam', 'Kit', 'Lou'] });
    for (const who of WHO) for (let k = 1; k <= 30; k++) race(four, who, { stage: 0, boom: k, hit: k });
    const ids = four.meta().winters!.map((x) => x.id);
    expect(ids.filter((x) => x.startsWith('1-'))).toHaveLength(3);
    expect(ids.filter((x) => x.startsWith('2-'))).toHaveLength(2);
    expect(ids.filter((x) => x.startsWith('3-'))).toHaveLength(1);
    expect(ids.filter((x) => x.startsWith('4-'))).toHaveLength(0);
    expect(JSON.stringify(four.meta().winters).length).toBeLessThan(2048);
    // Two cities, each having fired at a computer neighbour: its own bomb and those that fell on it (Ada,
    // the first, had three computer neighbours when she joined, Sam two).
    const two = world({ who: ['Ada', 'Sam'] });
    for (const who of ['Ada', 'Sam'] as const)
      for (let k = 1; k <= 30; k++) race(two, who, { stage: 8, fired: true, boom: k, hit: k });
    const winters = two.meta().winters!;
    expect(winters.filter((x) => x.id.startsWith('1-'))).toHaveLength(4);
    expect(winters.filter((x) => x.id.startsWith('2-'))).toHaveLength(3);
    expect(JSON.stringify(winters).length).toBeLessThan(2048);
    // The list a city is kept to (`ATOM_WINTERS_PER_CITY`) stands even if the record were full: no more.
    const full = world();
    const old = Array.from({ length: ATOM_WINTERS_PER_CITY }, (_, k) => ({
      id: `3-${k + 11}`,
      at: full.clock.now(),
      slots: [1, 2],
    }));
    full.meta().winters = old;
    race(full, 'Kit', { stage: 0, boom: 1, hit: 1 });
    expect(full.meta().winters).toHaveLength(ATOM_WINTERS_PER_CITY);
    expect(full.meta().winters!.map((x) => x.id)).not.toContain('3-1');
    // What a page is told is its own part of it.
    expect(last(two.ada, 'winters')!.winters.every((x) => x.slots.includes(1))).toBe(true);
    expect(last(two.ada, 'winters')!.winters).toHaveLength(3);
    expect(last(two.sam, 'winters')!.winters).toHaveLength(4);
  });

  it('is written promptly, not lost with a room that restarts', () => {
    const w = world();
    race(w, 'Kit', { stage: 5 });
    race(w, 'Kit', { stage: 5, boom: 1, hit: 1 });
    const saved = w.store.meta!;
    expect(saved.winters!.map((x) => x.id)).toEqual(['3-1']);
    expect(saved.atoms!.map((m) => m.kind)).toEqual(['ready', 'boom']);
    // A room woken from the record carries on: the same stage is not announced again, nor the winter.
    const again = new RegionRoom('7ATOM9', 'local', w.store, { now: w.clock.now }, BUSY);
    const ada = raw(again);
    ada.say(hello('Ada', { rejoin: { slot: 1, secret: w.secrets.Ada } }));
    const kit = raw(again);
    kit.say(hello('Kit', { rejoin: { slot: 3, secret: w.secrets.Kit } }));
    kit.say(report('Kitton', { atom: { stage: 5, boom: 1, hit: 1 } }));
    expect(lines(ada, 'race')).toEqual([]);
    expect(all(ada, 'winters')).toEqual([]);
    expect(last(ada, 'rwelcome')!.winters!.map((x) => x.id)).toEqual(['3-1']);
  });
});

describe('M40: the strike on a friend', () => {
  it('is read as an operation of its own, with no target and no branch', () => {
    const ok = { t: 'op', to: 2, id: 'bo-1a2b3c4d-9', op: 'atom' };
    expect(parseRegionMsg(JSON.stringify(ok))).toEqual(ok);
    expect(parseRegionMsg(JSON.stringify({ ...ok, target: 'plant' }))).toBeNull();
    expect(parseRegionMsg(JSON.stringify({ ...ok, branch: 'land' }))).toBeNull();
    expect(parseRegionMsg(JSON.stringify({ ...ok, op: 'bomb' }))).toBeNull();
  });

  it('is refused in words, each reason on its own, and the sender stays', () => {
    // The rules turn the bomb off.
    const off = world({ rules: { war: true, scale: 'total', supers: true } });
    readyToStrike(off);
    off.ada.say(strike(2, 'off-1'));
    expect(last(off.ada, 'opRefused')).toMatchObject({
      id: 'off-1',
      reason: 'The region’s rules turn the atom bomb off',
    });

    const w = world();
    const why = (id: string) => {
      w.ada.say(strike(2, id));
      expect(w.ada.closed, 'the sender stays').toBeNull();
      expect(w.sam.closed).toBeNull();
      return last(w.ada, 'opRefused')!.reason;
    };
    // No launch prepared: the last report is below stage 6.
    race(w, 'Ada', { stage: 5 });
    openTotalWar(w, 'Ada', 'Sam');
    expect(why('n-1')).toBe('Adaton has no launch prepared');
    // Prepared, but the room has not seen it so for the time it keeps: the report cannot skip the wait.
    race(w, 'Ada', { stage: 6 });
    expect(why('n-2')).toBe('Adaton’s launch is still being prepared: the region waits 60 seconds more');
    w.clock.advance(61_000);
    // (Not yet a war: a fresh region with the launch prepared but no war open.)
    const calm = world();
    race(calm, 'Ada', { stage: 6 });
    calm.clock.advance(61_000);
    calm.ada.say(strike(2, 'calm-1'));
    expect(last(calm.ada, 'opRefused')!.reason).toBe('There is no total war open between Adaton and Samton');
    // A war declared but not yet open, and an open one of a smaller scale, are no total war.
    breathe(calm);
    calm.ada.say({ t: 'wdeclare', to: 2, scale: 'total', reason: 'x' });
    calm.ada.say(strike(2, 'calm-2'));
    expect(last(calm.ada, 'opRefused')!.reason).toMatch(/^There is no total war open/);
    const small = world();
    breathe(small);
    small.ada.say({ t: 'wdeclare', to: 2, scale: 'war', reason: 'x' });
    small.clock.advance(FRIENDS.warning + 1_000);
    race(small, 'Ada', { stage: 6 });
    small.clock.advance(61_000);
    small.ada.say(strike(2, 'small-1'));
    expect(last(small.ada, 'opRefused')!.reason).toMatch(/^There is no total war open/);
    // The target's player is not here.
    w.room.closed(w.sam.conn);
    expect(why('n-3')).toBe('Samton’s player is not here: the bomb waits');
    const back = raw(w.room);
    back.say(hello('Sam', { rejoin: { slot: 2, secret: w.secrets.Sam } }));
    back.say(report('Samton'));
    // Neutral.
    back.say(report('Samton', { shield: 'neutral' }));
    expect(why('n-4')).toBe('Samton is neutral');
    // A newcomer that has not struck first.
    back.say(report('Samton', { shield: 'new' }));
    expect(why('n-5')).toBe('Samton is too young or small for that, unless it strikes first');
    // ... but one that raided Ada lately has no such shield (a battle Sam fought against Ada).
    back.say({ t: 'battle', to: 1, id: 'b1', part: 0, parts: 1, data: 'INPUT' });
    w.ada.say({ t: 'battleSeen', id: 'b1', from: 2 });
    back.say(report('Samton'));
    // The room's verdicts so far kept nothing.
    expect(all(back, 'opOn')).toEqual([]);
    expect(all(w.ada, 'opKept')).toEqual([]);
    expect(w.meta().cities[0]!.atom?.used).toBeUndefined();
    expect(w.meta().friends?.pariahs).toBeUndefined();
  });

  it('is refused for a page on 6, on either side, in words and without a close', () => {
    const w = world({ v: { Sam: 6 } });
    readyToStrike(w);
    w.ada.say(strike(2, 'old-1'));
    expect(last(w.ada, 'opRefused')!.reason).toBe(
      'Samton’s game is older than this room: it can neither race for the atom bomb nor be struck by it',
    );
    expect(w.ada.closed).toBeNull();
    expect(w.sam.closed).toBeNull();
    // Its own page cannot launch one, though it may send the message.
    const six = world({ v: { Ada: 6 } });
    openTotalWar(six, 'Ada', 'Sam');
    six.clock.advance(61_000);
    race(six, 'Ada', { stage: 6 });
    six.ada.say(strike(2, 'old-2'));
    expect(last(six.ada, 'opRefused')!.reason).toBe(
      'Adaton’s game is older than this room: it can neither race for the atom bomb nor use it',
    );
    expect(six.ada.closed).toBeNull();
  });

  it('is kept: the verdict stored for a resend, the target told, the sender flagged, a mark and a line', () => {
    const w = world();
    readyToStrike(w);
    w.ada.say(strike(2, 'bo-aaaaaaaa-1'));
    expect(last(w.ada, 'opKept')).toEqual({ t: 'opKept', id: 'bo-aaaaaaaa-1', outcome: 'success' });
    const at = w.clock.now();
    // Sam hears of it at once, as an operation of the bomb's, with no target.
    expect(last(w.sam, 'opOn')).toEqual({
      t: 'opOn',
      from: 1,
      id: 'bo-aaaaaaaa-1',
      op: 'atom',
      outcome: 'success',
      late: false,
    });
    expect(w.meta().cities[1]!.ops).toEqual([
      { id: 'bo-aaaaaaaa-1', from: 1, op: 'atom', outcome: 'success', at },
    ]);
    // Ada is flagged for good, her mark and the room's line say whom she fired at, and everyone is told.
    expect(w.meta().friends!.pariahs).toEqual({ 1: at });
    expect(w.meta().atoms!.filter((m) => m.kind === 'fired')).toEqual([
      { slot: 1, name: 'Adaton', kind: 'fired', at, to: 2 },
    ]);
    for (const r of [w.ada, w.sam, w.kit]) {
      expect(lines(r, 'bomb').map((e) => [e.a, e.b, e.text])).toEqual([
        [1, 2, 'Adaton has fired the atom bomb at Samton'],
      ]);
      expect(notices(r)).toContain('Adaton has fired the atom bomb at Samton');
    }
    expect(last(w.kit, 'atoms')!.atoms.map((m) => m.kind)).toContain('fired');
    // Sent again (the answer was lost): the same answer, no second strike, no second line.
    w.ada.say(strike(2, 'bo-aaaaaaaa-1'));
    expect(all(w.ada, 'opKept')).toHaveLength(2);
    expect(all(w.sam, 'opOn')).toHaveLength(1);
    expect(lines(w.ada, 'bomb')).toHaveLength(1);
    // ... and it is written at once.
    expect(w.store.meta!.friends!.pariahs).toEqual({ 1: at });
    expect(w.store.meta!.cities[1]!.ops).toHaveLength(1);
    // One bomb a city, ever: another id is turned away, even at another city, even though the report
    // has not changed.
    w.ada.say(strike(3, 'bo-aaaaaaaa-2'));
    expect(last(w.ada, 'opRefused')!.reason).toBe('Adaton has used its atom bomb: there is only ever one');
    w.ada.say(strike(2, 'bo-aaaaaaaa-3'));
    expect(last(w.ada, 'opRefused')!.reason).toBe('Adaton has used its atom bomb: there is only ever one');
    // The report that follows (the bomb in the air) adds nothing.
    race(w, 'Ada', { stage: 7, fired: true });
    expect(lines(w.ada, 'bomb')).toHaveLength(1);
    expect(w.meta().atoms!.filter((m) => m.kind === 'fired')).toHaveLength(1);
    // Sam sees it until he says so; a returning page is told it again (late).
    w.sam.say({ t: 'opSeen', id: 'bo-aaaaaaaa-1', from: 1 });
    expect(w.meta().cities[1]!.ops ?? []).toEqual([]);
  });

  it('waits in the region for a target’s page that speaks the bomb', () => {
    const w = world();
    readyToStrike(w);
    w.ada.say(strike(2, 'wait-1'));
    // Sam leaves before taking it, and comes back on a page that does not speak the bomb: nothing.
    w.room.closed(w.sam.conn);
    const six = raw(w.room);
    six.say(hello('Sam', { v: 6, rejoin: { slot: 2, secret: w.secrets.Sam } }));
    expect(all(six, 'opOn')).toEqual([]);
    w.room.closed(six.conn);
    expect(w.meta().cities[1]!.ops).toHaveLength(1);
    // On a page that does it is told, late (its sim takes it as it comes).
    const seven = raw(w.room);
    seven.say(hello('Sam', { rejoin: { slot: 2, secret: w.secrets.Sam } }));
    expect(all(seven, 'opOn')).toEqual([
      { t: 'opOn', from: 1, id: 'wait-1', op: 'atom', outcome: 'success', late: true },
    ]);
  });

  it('counts as no spy, saboteur or superweapon in the target’s day, and lets a newcomer answer', () => {
    const w = world();
    readyToStrike(w);
    w.ada.say(strike(2, 'day-1'));
    const sam = last(w.ada, 'region')!.region.cities.find((c) => c.slot === 2)!;
    expect(sam).toMatchObject({ opsLeft: 4, supersLeft: 1 });
    expect(sam.raidedBy).toEqual([1]);
  });
});

describe('M40: the firer is a pariah among friends', () => {
  /** Ada and Kit in an alliance, a trade agreement and a ceasefire-free peace; Ada and Sam in a total war. */
  function allied(): World {
    const w = world();
    breathe(w);
    w.ada.say({ t: 'tprop', id: 't-alliance', to: 3, terms: [{ k: 'alliance' }, { k: 'trade' }] });
    w.kit.say({ t: 'tans', id: 't-alliance', accept: true });
    readyToStrike(w);
    return w;
  }

  it('ends its pacts of friendship and keeps its trade, and says so', () => {
    const w = allied();
    const pacts = () =>
      w
        .meta()
        .friends!.pacts.map((p) => p.kind)
        .sort();
    expect(pacts()).toEqual(['alliance', 'trade']);
    w.ada.say(strike(2, 'p-1'));
    expect(pacts()).toEqual(['trade']);
    for (const r of [w.ada, w.sam, w.kit]) {
      expect(last(r, 'pacts')!.pacts.map((p) => p.kind)).toEqual(['trade']);
    }
    const broken = all(w.kit, 'history').filter((m) => m.event.kind === 'broken');
    expect(broken.at(-1)!.event.text).toBe(
      'The alliance between Adaton and Kitton ends: Adaton fired the atom bomb',
    );
  });

  it('turns away a new pact of friendship, from either side, and still lets them make peace and trade', () => {
    const w = allied();
    w.ada.say(strike(2, 'p-2'));
    const asked = (from: Raw, to: number, id: string, term: object) => {
      breathe(w);
      from.say({ t: 'tprop', id, to, terms: [term] });
      return all(from, 'trefused').find((m) => m.id === id)?.why;
    };
    const fired = 'Adaton fired the atom bomb: no one signs a pact of friendship with it';
    expect(asked(w.kit, 1, 'p-a', { k: 'alliance' })).toBe(fired);
    expect(asked(w.kit, 1, 'p-b', { k: 'defensivePact' })).toBe(fired);
    expect(asked(w.ada, 3, 'p-c', { k: 'nonAggression', months: 6 })).toBe(fired);
    // Not friendship: an embargo stands (it is a settlement of a kind, as the sim leaves it).
    expect(asked(w.kit, 1, 'p-d', { k: 'embargo' })).toBeUndefined();
    // A proposal waiting for a pact is turned back when the bomb is fired.
    const w2 = world();
    breathe(w2);
    w2.kit.say({ t: 'tprop', id: 'wait-1', to: 1, terms: [{ k: 'alliance' }] });
    readyToStrike(w2);
    w2.ada.say(strike(2, 'p-3'));
    expect(all(w2.kit, 'trefused').find((m) => m.id === 'wait-1')?.why).toBe(fired);
    w2.ada.say({ t: 'tans', id: 'wait-1', accept: true });
    expect(last(w2.ada, 'trefused')!.why).toMatch(/gone|answered/i);
  });

  it('can be declared on at once: no cooldown, no newcomer’s shield', () => {
    const w = world({ who: ['Ada', 'Sam', 'Kit', 'Lou'] });
    // Kit and Ada made peace not long ago: the cooldown keeps them from a new war.
    openTotalWar(w, 'Kit', 'Ada');
    breathe(w);
    w.kit.say({ t: 'tprop', id: 'peace-1', to: 1, terms: [{ k: 'peace' }] });
    w.ada.say({ t: 'tans', id: 'peace-1', accept: true });
    breathe(w);
    w.kit.say({ t: 'wdeclare', to: 1, scale: 'total', reason: 'Again' });
    expect(last(w.kit, 'wrefused')!.why).toMatch(/ended too recently/);
    // Lou is a newcomer in the room's eyes and has struck no one: Sam cannot declare on it.
    w.page.Lou.say(report('Louton', { shield: 'new' }));
    breathe(w);
    w.page.Sam.say({ t: 'wdeclare', to: 4, scale: 'total', reason: 'x' });
    expect(last(w.sam, 'wrefused')!.why).toMatch(/too young or small/);
    // Ada and Lou fire the bomb (Ada by a strike the room kept, Lou by a report that says it did).
    openTotalWar(w, 'Ada', 'Sam');
    race(w, 'Ada', { stage: 6 });
    w.clock.advance(61_000);
    w.ada.say(strike(2, 'cool-1'));
    expect(last(w.ada, 'opKept')!.outcome).toBe('success');
    w.page.Lou.say(report('Louton', { shield: 'new', atom: { stage: 7, fired: true } }));
    expect(w.meta().friends!.pariahs).toMatchObject({ 1: expect.any(Number), 4: expect.any(Number) });
    // The cooldown no longer stands between Kit and Ada, nor the shield between Sam and Lou.
    w.kit.say({ t: 'wdeclare', to: 1, scale: 'total', reason: 'The bomb' });
    expect(last(w.kit, 'war')!.war).toMatchObject({ a: 3, b: 1, scale: 'total', state: 'declared' });
    breathe(w);
    w.page.Sam.say({ t: 'wdeclare', to: 4, scale: 'total', reason: 'The bomb' });
    expect(last(w.sam, 'war')!.war).toMatchObject({ a: 2, b: 4, state: 'declared' });
    // The rest of the rules stand: a smaller scale than the region allows, and a war already on.
    breathe(w);
    w.page.Sam.say({ t: 'wdeclare', to: 4, scale: 'total', reason: 'Twice' });
    expect(last(w.sam, 'wrefused')!.why).toMatch(/at war with/);
  });
});

describe('M40: the plant as a saboteur’s target, with the protocol gate', () => {
  const plant = (to: number, id: string) => ({ t: 'op', to, id, op: 'sabotage', target: 'plant' });

  it('turns away a target on a page below 7 in words, and a target with no race, and keeps a race', () => {
    const w = world({ v: { Sam: 6 } });
    w.ada.say(plant(2, 'pl-1'));
    expect(last(w.ada, 'opRefused')!.reason).toBe(
      'Samton’s game is older than this room: it can neither race for the atom bomb nor be struck by it',
    );
    w.ada.say(plant(3, 'pl-2'));
    expect(last(w.ada, 'opRefused')!.reason).toBe('Kitton isn’t racing for the atom bomb');
    expect(w.ada.closed).toBeNull();
    expect(all(w.ada, 'opKept')).toEqual([]);
    race(w, 'Kit', { stage: 3 });
    w.ada.say(plant(3, 'pl-3'));
    expect(last(w.ada, 'opKept')).toMatchObject({ id: 'pl-3', outcome: 'success' });
    expect(last(w.kit, 'opOn')).toMatchObject({ op: 'sabotage', target: 'plant' });
    // A race that has left the stages that can be slowed is no target either.
    race(w, 'Kit', { stage: 7, fired: true });
    w.clock.advance(DAY_MS);
    w.ada.say(plant(3, 'pl-4'));
    expect(last(w.ada, 'opRefused')!.reason).toBe('Kitton isn’t racing for the atom bomb');
  });
});

// ---------------------------------------------------------------------------------------------
// The review of step 9: what the room believes of a report. A page is a friend's, but a report is
// one number away from a lie, and these are the numbers the others act on: a cloud that falls on a
// named friend's city, a winter that chills the whole region, the permanent record, the strike.
// ---------------------------------------------------------------------------------------------

describe('M40 review: the cloud a report names', () => {
  const plumeSeenBy = (w: World, receiver: number, of: number) =>
    regionUpdateFor(last(w.ada, 'region')!.region, receiver).cities.find((c) => c.slot === of)!.atom?.plume;
  const storedPlume = (w: World, of: number) =>
    last(w.ada, 'region')!.region.cities.find((c) => c.slot === of)!.report!.atom?.plume;

  it('is never thicker than all the air a region’s bombs could make: a number past it drops the race', () => {
    expect(ATOM_WIRE.plumeMax).toBeLessThan(1e5);
    expect(ATOM_WIRE.plumePerBomb).toBeLessThan(ATOM_WIRE.plumeMax);
    const top = [{ slot: 1, total: ATOM_WIRE.plumeMax }];
    expect(cleanAtomReport({ stage: 0, plume: top })).not.toBeNull();
    expect(cleanAtomReport({ stage: 0, plume: [{ slot: 1, total: ATOM_WIRE.plumeMax + 1 }] })).toBeNull();
    // A forged total reaches no one: the race is dropped, the report and the connection stay.
    const w = world();
    race(w, 'Kit', { stage: 0, plume: [{ slot: 1, total: 9_999_999 }] });
    expect(w.kit.closed).toBeNull();
    const kit = regionUpdateFor(last(w.ada, 'region')!.region, 1).cities.find((c) => c.slot === 3)!;
    expect(kit.atom).toBeUndefined();
    expect(kit.population).toBe(5_000);
  });

  it('is not believed where no bomb has fallen in the region', () => {
    const w = world();
    race(w, 'Kit', { stage: 0, plume: [{ slot: 1, total: 300 }] });
    expect(plumeSeenBy(w, 1, 3)).toBeUndefined();
    expect(storedPlume(w, 3)).toBeUndefined();
    // Not by a race either: a city racing, even one with the bomb ready, has dropped nothing.
    race(w, 'Kit', { stage: 5, plume: [{ slot: 1, total: 300 }] });
    expect(plumeSeenBy(w, 1, 3)).toBeUndefined();
    // A region whose rules have no bomb has no bomb on record.
    const none = world({ rules: { war: true, scale: 'total', supers: true } });
    race(none, 'Sam', { stage: 0, hit: 1, boom: 1 });
    race(none, 'Kit', { stage: 0, plume: [{ slot: 1, total: 300 }] });
    expect(plumeSeenBy(none, 1, 3)).toBeUndefined();
  });

  it('is believed once a bomb is on record, but no thicker than the bombs on record could make', () => {
    const w = world();
    // A bomb has fallen on Sam (the room has no strike of its own to point to: a computer neighbour's).
    race(w, 'Sam', { stage: 0, hit: 1, boom: 1 });
    // A cloud passing through Kit, which was never hit itself, still goes on to its friends.
    race(w, 'Kit', {
      stage: 0,
      plume: [
        { slot: 1, total: 5_000 },
        { slot: 2, total: 300 },
        { slot: 3, total: 10 },
      ],
    });
    // Too thick is cut to what one bomb could make; a thinner one stands; a city never names itself.
    expect(storedPlume(w, 3)).toEqual([
      { slot: 1, total: ATOM_WIRE.plumePerBomb },
      { slot: 2, total: 300 },
    ]);
    expect(plumeSeenBy(w, 1, 3)).toBe(ATOM_WIRE.plumePerBomb);
    expect(plumeSeenBy(w, 2, 3)).toBe(300);
    // A second bomb (Ada's, at a computer neighbour) doubles what the region could have on the air.
    race(w, 'Ada', { stage: 7, fired: true });
    race(w, 'Kit', { stage: 0, plume: [{ slot: 1, total: 5_000 }] });
    expect(plumeSeenBy(w, 1, 3)).toBe(2 * ATOM_WIRE.plumePerBomb);
  });
});

describe('M40 review: the bombs a report may count', () => {
  const winterIds = (w: World) => (w.meta().winters ?? []).map((x) => x.id);
  const marks = (w: World, slot: number, kind: string) =>
    (w.meta().atoms ?? []).filter((m) => m.slot === slot && m.kind === kind);

  it('starts no winter for a bomb that fell nowhere: a count past what fell on the city is nothing', () => {
    const w = world();
    race(w, 'Kit', { stage: 0, boom: 1 });
    expect(winterIds(w)).toEqual([]);
    expect(all(w.ada, 'winters')).toEqual([]);
    expect(w.meta().atoms ?? []).toEqual([]);
    // Ahead of what fell on it (one bomb is all its sides allow in a region of three): only that one.
    race(w, 'Kit', { stage: 0, boom: 3, hit: 1 });
    expect(winterIds(w)).toEqual(['3-1']);
    expect(marks(w, 3, 'boom')).toHaveLength(1);
  });

  it('takes none of it in a region whose rules have no bomb', () => {
    const w = world({ rules: { war: true, scale: 'total', supers: true } });
    race(w, 'Sam', { stage: 0, boom: 3, hit: 3, stopped: 1 });
    race(w, 'Sam', { stage: 3 });
    expect(winterIds(w)).toEqual([]);
    expect(w.meta().atoms ?? []).toEqual([]);
    expect(lines(w.ada, 'bomb')).toEqual([]);
    expect(all(w.kit, 'winters')).toEqual([]);
  });

  it('takes no more than a strike the room kept and the city’s computer neighbours can account for', () => {
    // Lou is the fourth to join: all three of its neighbours are players. Only a friend’s strike, kept,
    // can fall on it.
    const w = world({ who: ['Ada', 'Sam', 'Kit', 'Lou'] });
    race(w, 'Lou', { stage: 0, hit: 1, boom: 1 });
    expect(winterIds(w)).toEqual([]);
    expect(marks(w, 4, 'boom')).toEqual([]);
    // Ada’s strike at Lou is kept: one bomb can fall on Lou now, and no second.
    openTotalWar(w, 'Ada', 'Lou');
    race(w, 'Ada', { stage: 6 });
    w.clock.advance(61_000);
    w.ada.say(strike(4, 'review-1'));
    expect(last(w.ada, 'opKept')).toMatchObject({ id: 'review-1', outcome: 'success' });
    race(w, 'Lou', { stage: 0, hit: 2, boom: 2, stopped: 1 });
    expect(winterIds(w)).toEqual(['4-1']);
    expect(marks(w, 4, 'boom')).toHaveLength(1);
    expect(marks(w, 4, 'stopped')).toEqual([]);
    // Kit joined third, when one of its neighbours was the computer’s: it can account for one bomb more
    // (and it still can once Lou has come and taken that neighbour’s place: the computer’s bomb may
    // have been sent before).
    race(w, 'Kit', { stage: 0, hit: 2, boom: 2, stopped: 1 });
    expect(winterIds(w)).toEqual(['4-1', '3-1']);
    // Sam, the second, had two; Ada, the first, three.
    race(w, 'Sam', { stage: 0, hit: 9, boom: 9 });
    race(w, 'Ada', { stage: 0, hit: 9, boom: 9 });
    expect(winterIds(w).filter((x) => x.startsWith('2-'))).toHaveLength(2);
    expect(winterIds(w).filter((x) => x.startsWith('1-'))).toHaveLength(3);
  });

  it('gives a firer’s own bomb a winter only when it fell on a computer neighbour, not for a strike on a friend', () => {
    const w = world();
    readyToStrike(w);
    w.ada.say(strike(2, 'review-2'));
    expect(last(w.ada, 'opKept')!.outcome).toBe('success');
    // Ada’s bomb is on a friend (Sam’s sim lands it): her own sim lands nothing, and claims nothing.
    race(w, 'Ada', { stage: 8, fired: true, boom: 1 });
    expect(winterIds(w)).toEqual([]);
    // Kit’s bomb the room never saw go: its report says it left, then that it landed at a computer neighbour.
    race(w, 'Kit', { stage: 7, fired: true });
    race(w, 'Kit', { stage: 8, fired: true, boom: 1 });
    expect(winterIds(w)).toEqual(['3-1']);
  });

  it('keeps a bomb that fell as news when the rules were turned off after the strike was kept', () => {
    const w = world();
    readyToStrike(w);
    w.ada.say(strike(2, 'review-3'));
    expect(last(w.ada, 'opKept')!.outcome).toBe('success');
    // The host turns the bomb off while it is in the air: the strike stands, and so does its landing.
    w.ada.say({ t: 'rrules', rules: { war: true, scale: 'total', supers: true } });
    race(w, 'Sam', { stage: 0, hit: 1, boom: 1 });
    expect(winterIds(w)).toEqual(['2-1']);
    expect(marks(w, 2, 'boom')).toHaveLength(1);
    // ... but not a second.
    race(w, 'Sam', { stage: 0, hit: 2, boom: 2 });
    expect(winterIds(w)).toEqual(['2-1']);
  });
});

describe('M40 review: the permanent record', () => {
  /** Sam first to the bomb, then Kit, who has also fired: the marks that must be kept. */
  function raced(): World {
    const w = world();
    race(w, 'Sam', { stage: 5 });
    race(w, 'Kit', { stage: 5 });
    race(w, 'Kit', { stage: 7, fired: true });
    return w;
  }
  const names = (w: World) => (w.meta().atoms ?? []).map((m) => `${m.slot}:${m.kind}`);

  it('cannot be flushed by one city’s reports, whatever counts it makes', () => {
    const w = raced();
    const before = names(w);
    expect(before).toEqual(['2:ready', '3:ready', '3:fired']);
    for (let k = 1; k <= 20; k++) race(w, 'Ada', { stage: 0, hit: k, stopped: k, boom: k });
    expect(names(w).slice(0, 3)).toEqual(before);
    expect((w.meta().atoms ?? []).filter((m) => m.slot === 1).length).toBeLessThanOrEqual(ATOM_WIRE.sides);
    expect(w.meta().atoms![0]).toMatchObject({ slot: 2, kind: 'ready', first: true });
  });

  it('drops the oldest landed or stopped bomb of the city that holds the most when it is full, never a ready or fired mark', () => {
    const w = raced();
    // A record full of Ada’s marks (what an older room or a bug could have left): 3 + 13 = 16.
    const atoms = w.meta().atoms!;
    const at = w.clock.now();
    for (let k = 0; atoms.length < ATOM_MARKS; k++)
      atoms.push({ slot: 1, name: 'Adaton', kind: k % 2 ? 'boom' : 'stopped', at: at - 10_000 + k });
    expect(atoms).toHaveLength(ATOM_MARKS);
    // A bomb falls on Sam: one more than the record holds.
    race(w, 'Sam', { stage: 5, hit: 1, boom: 1 });
    expect(w.meta().atoms).toHaveLength(ATOM_MARKS);
    expect(names(w).slice(0, 3)).toEqual(['2:ready', '3:ready', '3:fired']);
    expect(names(w).at(-1)).toBe('2:boom');
    // It is Ada’s oldest that went: twelve are left, and the first is not the one that was first.
    const ada = w.meta().atoms!.filter((m) => m.slot === 1);
    expect(ada).toHaveLength(12);
    expect(ada[0]!.at).toBe(at - 10_000 + 1);
    // The record that goes out is the whole of it.
    expect(last(w.kit, 'atoms')!.atoms).toHaveLength(ATOM_MARKS);
  });

  it('marks a city ready once for good: a mark that has left the list is not made again, at a new time', () => {
    const w = world();
    race(w, 'Sam', { stage: 5 });
    race(w, 'Kit', { stage: 5 });
    expect(names(w)).toEqual(['2:ready', '3:ready']);
    // Sam’s mark is gone from the list (it was the oldest of a full record).
    w.meta().atoms!.shift();
    w.clock.advance(60_000);
    race(w, 'Sam', { stage: 6 });
    race(w, 'Sam', { stage: 5 });
    expect(names(w)).toEqual(['3:ready']);
    // And it is not made first again, nor is Sam told it was.
    expect(all(w.sam, 'atomFirst')).toHaveLength(1);
    expect(w.meta().atoms![0]!.first).toBeUndefined();
    // The flag is the room’s, kept with the city.
    expect(w.store.meta!.cities[1]!.atom!.ready).toBe(true);
  });
});

describe('M40 review: the announcements', () => {
  it('keep the cap for a city’s stages to the stages: the line that says it fired is never lost to it', () => {
    const w = world();
    for (let k = 0; k < 10; k++) {
      race(w, 'Sam', { stage: 3 });
      race(w, 'Sam', { stage: 4 });
    }
    expect(lines(w.ada, 'race')).toHaveLength(REGION_LIMITS.atomPerDay);
    race(w, 'Sam', { stage: 7, fired: true });
    expect(lines(w.ada, 'bomb').map((e) => e.text)).toEqual(['Samton has fired the atom bomb']);
    expect(notices(w.ada)).toContain('Samton has fired the atom bomb');
    expect(w.meta().atoms!.map((m) => m.kind)).toContain('fired');
    // Nor the lines for a bomb that fell and one the dome stopped (each is bounded by what can happen).
    race(w, 'Sam', { stage: 8, fired: true, hit: 1, boom: 1 });
    expect(lines(w.ada, 'bomb').map((e) => e.text)).toEqual([
      'Samton has fired the atom bomb',
      bombLine('boom', 'Samton'),
    ]);
  });

  it('say every step a report jumps over, and a city’s first report only the step it is at', () => {
    const w = world();
    const step = (s: number) => raceLine(s, 'Samton')!;
    const said = () => lines(w.ada, 'race').map((e) => e.text);
    race(w, 'Sam', { stage: 4 });
    // (The room saw no step before: it is told of each one the city has taken.)
    expect(said()).toEqual([1, 2, 3, 4].map(step));
    // Between two reports the city finishes the bomb and goes on to prepare a launch: the red alert is not skipped.
    race(w, 'Sam', { stage: 6 });
    expect(said()).toEqual([1, 2, 3, 4, 5, 6].map(step));
    expect(notices(w.ada).filter((t) => /^Samton (has|is)/.test(t) && !/joined/.test(t))).toEqual(
      [1, 2, 3, 4, 5, 6].map(step),
    );
    expect(step(5)).toBe('Samton has the atom bomb');
    // A step that falls and is climbed again, over two steps at once, is said again, each step crossed
    // (within the eight a day).
    race(w, 'Sam', { stage: 4 });
    race(w, 'Sam', { stage: 6 });
    expect(said().slice(6)).toEqual([5, 6].map(step));
    // A city whose first report is already at stage 5 says only where it is: the room saw no steps.
    const two = world({ who: ['Ada', 'Sam'] });
    const kit = raw(two.room);
    kit.say(hello('Kit'));
    kit.say(report('Kitton', { atom: { stage: 5 } }));
    expect(lines(two.ada, 'race').map((e) => e.text)).toEqual([raceLine(5, 'Kitton')]);
  });
});

describe('M40 review: the strike’s evidence', () => {
  it('needs the research done: a city that says it is at stage 6 with its branches unfinished is turned away', () => {
    const w = world();
    openTotalWar(w, 'Ada', 'Sam');
    const prepared = (tiers: number[]) => w.ada.say(report('Adaton', { tiers, atom: { stage: 6 } }));
    prepared([0, 0, 0, 0, 0, 0]);
    w.clock.advance(61_000);
    w.ada.say(strike(2, 'tier-1'));
    expect(last(w.ada, 'opRefused')).toMatchObject({
      id: 'tier-1',
      reason: 'Adaton has not finished the research the atom bomb needs',
    });
    prepared([4, 4, 4, 4, 4, 3]);
    w.ada.say(strike(2, 'tier-2'));
    expect(last(w.ada, 'opRefused')!.reason).toBe('Adaton has not finished the research the atom bomb needs');
    expect(w.ada.closed).toBeNull();
    expect(w.meta().friends?.pariahs).toBeUndefined();
    expect(all(w.ada, 'opKept')).toEqual([]);
    // The branches all done, the same report is the launch.
    prepared(FULL_TIERS);
    w.ada.say(strike(2, 'tier-3'));
    expect(last(w.ada, 'opKept')).toMatchObject({ id: 'tier-3', outcome: 'success' });
  });
});
