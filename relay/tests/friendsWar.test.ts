import { describe, expect, it } from 'vitest';
import {
  FAIR,
  MemoryRegionStore,
  REGION_LIMITS,
  RegionRoom,
  parseRegionMsg,
  type RegionConn,
  type RegionLimits,
  type RegionRoomMsg,
} from '../region';
import { FRIENDS, PROTOCOL_VERSION, termsFor, type FriendTerm, type FriendWar } from '../protocol';
import { DAY_MS } from '../limits';
import { DIPLOMACY } from '../../src/data/diplomacy';
import { FriendsWar, cleanFriendTerm, emptyFriends, type FwContext } from '../friendsWar';
import { FakeClock } from './harness';

/**
 * M39, step 5a: wars and treaties between friends, kept by the region room (protocol 6; design calls 9
 * and 10), with fake pages and a fake clock. The room keeps the truth of who is at war with whom, the
 * score, the pacts, the vassals and the treaties each city hasn't applied; it opens a declared war after
 * its warning, runs a ceasefire out, lets a proposal lapse, all at the next message after the time
 * (it has no timers); and every city then mirrors it in its own sim (step 5b).
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
    tiers: [0, 0, 0, 0, 2, 0],
    counter: 250,
    clock: 100,
    ...extra,
  },
});

type Msg<T extends RegionRoomMsg['t']> = Extract<RegionRoomMsg, { t: T }>;
const all = <T extends RegionRoomMsg['t']>(r: Raw, t: T) => r.got.filter((m) => m.t === t) as Msg<T>[];
const last = <T extends RegionRoomMsg['t']>(r: Raw, t: T) => all(r, t).at(-1);
const notices = (r: Raw) => all(r, 'notice').map((n) => n.text);

/** A fast pager's limits: a test sends far more than two messages a second, and many raids. */
const BUSY: Partial<RegionLimits> = {
  rate: 1_000,
  burst: 100_000,
  raidsPerDay: 1_000,
  battleBurst: 1_000,
  dailyRows: 1_000_000,
};

const SLOT = { Ada: 1, Sam: 2, Kit: 3, Lou: 4 } as const;

interface World {
  clock: FakeClock;
  store: MemoryRegionStore;
  room: RegionRoom;
  ada: Raw;
  sam: Raw;
  kit: Raw;
  lou: Raw;
  secrets: Record<string, string>;
}

/** A region (Ada, Sam, Kit and Lou: slots 1 to 4), each reported, at war on `rules` unless it says otherwise. */
function world(
  opts: {
    rules?: { war: boolean; scale: 'skirmish' | 'war' | 'total' } | null;
    limits?: Partial<RegionLimits>;
    kind?: 'local' | 'p2p';
    shield?: Partial<Record<keyof typeof SLOT, 'new' | 'neutral'>>;
    v?: Partial<Record<keyof typeof SLOT, number>>;
  } = {},
): World {
  const clock = new FakeClock();
  // Midday UTC, so a test's day doesn't end under it.
  clock.advance(((Math.ceil(clock.t / DAY_MS) * DAY_MS - clock.t) % DAY_MS) + 12 * 3600_000);
  const store = new MemoryRegionStore();
  const room = new RegionRoom(
    '7FRND1',
    opts.kind ?? 'local',
    store,
    { now: clock.now, later: clock.later },
    {
      ...BUSY,
      ...(opts.limits ?? {}),
    },
  );
  const rules = opts.rules === undefined ? { war: true, scale: 'total' as const } : opts.rules;
  const people: (keyof typeof SLOT)[] = ['Ada', 'Sam', 'Kit', 'Lou'];
  const out: Partial<Record<keyof typeof SLOT, Raw>> = {};
  const secrets: Record<string, string> = {};
  for (const who of people) {
    const r = raw(room);
    r.say(
      hello(who, {
        ...(opts.v?.[who] ? { v: opts.v[who] } : {}),
        ...(who === 'Ada'
          ? { create: { name: 'Vale', ...(rules ? { rules: { ...rules, supers: true } } : {}) } }
          : {}),
      }),
    );
    secrets[who] = last(r, 'rwelcome')!.secret;
    const shield = opts.shield?.[who];
    r.say(report(`${who}ton`, shield ? { shield } : {}));
    out[who] = r;
  }
  return { clock, store, room, ada: out.Ada!, sam: out.Sam!, kit: out.Kit!, lou: out.Lou!, secrets };
}

/** Let time pass (the room notices at the next message, any message). */
function wait(w: World, ms: number): void {
  w.clock.advance(ms);
  w.room.message(w.ada.conn, 'ping');
}

/** A moment between diplomatic moves, so the room's pacing of them (a few at once) doesn't get in the way. */
const breathe = (w: World) => w.clock.advance(FRIENDS.actEvery);

const declare = (w: World, from: Raw, to: number, extra: Record<string, unknown> = {}) => {
  breathe(w);
  from.say({ t: 'wdeclare', to, scale: 'war', reason: 'An old feud', ...extra });
};

/** Declare `from` → `to`, let the warning pass, and return the war as the room tells it. */
function openWar(w: World, from: Raw, to: number, scale: 'skirmish' | 'war' | 'total' = 'war'): FriendWar {
  declare(w, from, to, { scale });
  wait(w, FRIENDS.warning + 1_000);
  return last(from, 'war')!.war;
}

let battleN = 0;
/**
 * A battle `from` fights against `to` (the old way, kept at once because `to` is here) and `to`'s
 * result for it.
 */
function fight(
  _w: World,
  attacker: Raw,
  aSlot: number,
  defender: Raw,
  dSlot: number,
  outcome: 'raided' | 'repelled' | 'withdrew',
  extra: Record<string, unknown> = {},
  id = `b${++battleN}`,
): string {
  attacker.say({ t: 'battle', to: dSlot, id, part: 0, parts: 1, data: 'INPUT' });
  defender.say({ t: 'battleSeen', id, from: aSlot });
  defender.say({ t: 'battleResult', id, from: aSlot, to: dSlot, outcome, ...extra });
  return id;
}

const warOf = (r: Raw) => last(r, 'war')?.war;
const refusals = (r: Raw) => all(r, 'trefused').map((m) => m.why);
const declined = (r: Raw) => all(r, 'wrefused').map((m) => m.why);

/** Terms from the proposer's side; the proposal is sent and the target says yes. */
function sign(w: World, from: Raw, to: Raw, toSlot: number, terms: object[], id = `t${++battleN}`): void {
  breathe(w);
  from.say({ t: 'tprop', id, to: toSlot, terms });
  to.say({ t: 'tans', id, accept: true });
}

const PEACE = [{ k: 'peace' }];

describe('M39 step 5a: wars and treaties between friends, kept by the region', () => {
  it('reads only sensible messages about wars and treaties', () => {
    const ok = [
      { t: 'wdeclare', to: 2, scale: 'war', reason: 'An old feud' },
      { t: 'wdeclare', to: 2, scale: 'total', reason: '', breakPact: true },
      { t: 'wdeclare', to: 2, scale: 'skirmish', reason: 'x' },
      {
        t: 'tprop',
        id: 'p-1',
        to: 2,
        terms: [{ k: 'peace' }, { k: 'reparations', payer: 'us', amount: 5000 }],
      },
      { t: 'tprop', id: 'p-1', to: 2, terms: [{ k: 'vassal' }], imposed: true },
      { t: 'tans', id: 'p-1', accept: true },
      { t: 'tans', id: 'p-1', accept: false },
      { t: 'tbreak', pact: 4 },
      { t: 'tseen', id: 'p-1' },
      { t: 'battleResult', id: 'b1', from: 1, to: 2, outcome: 'raided' },
      {
        t: 'battleResult',
        id: 'b1',
        from: 1,
        to: 2,
        outcome: 'repelled',
        decisive: 0.5,
        worth: 12000,
        seatDown: true,
        away: true,
      },
    ];
    for (const m of ok) expect(parseRegionMsg(JSON.stringify(m)), JSON.stringify(m)).toEqual(m);
    // The reason is cleaned like chat; a decisive margin is kept to two places.
    expect(
      parseRegionMsg(JSON.stringify({ t: 'wdeclare', to: 2, scale: 'war', reason: '  no\u0001te  ' })),
    ).toEqual({ t: 'wdeclare', to: 2, scale: 'war', reason: 'note' });
    expect(
      parseRegionMsg(
        JSON.stringify({ t: 'battleResult', id: 'b', from: 1, to: 2, outcome: 'raided', decisive: 0.456 }),
      ),
    ).toMatchObject({ decisive: 0.46 });
    const bad: object[] = [
      { t: 'wdeclare', to: 0, scale: 'war', reason: '' },
      { t: 'wdeclare', to: 2, scale: 'huge', reason: '' },
      { t: 'wdeclare', to: 2, scale: 'war' },
      { t: 'wdeclare', to: 2, scale: 'war', reason: 'x'.repeat(401) },
      { t: 'tprop', id: 'has spaces', to: 2, terms: [{ k: 'peace' }] },
      { t: 'tprop', id: 'p', to: 2, terms: [] },
      { t: 'tprop', id: 'p', to: 2, terms: 'peace' },
      { t: 'tprop', id: 'p', to: 2, terms: ['peace'] },
      { t: 'tprop', id: 'p', to: 2, terms: Array.from({ length: 17 }, () => ({ k: 'peace' })) },
      { t: 'tprop', id: 'p', to: 2, terms: [{ k: 'peace', pad: 'x'.repeat(5_000) }] },
      { t: 'tans', id: 'p' },
      { t: 'tans', id: 'p', accept: 'yes' },
      { t: 'tbreak', pact: 0 },
      { t: 'tbreak', pact: 1.5 },
      { t: 'tseen' },
      { t: 'battleResult', id: 'b', from: 1, to: 2, outcome: 'won' },
      { t: 'battleResult', id: 'b', from: 0, to: 2, outcome: 'raided' },
      { t: 'battleResult', id: 'b', from: 1, to: 2, outcome: 'raided', decisive: 1.5 },
      { t: 'battleResult', id: 'b', from: 1, to: 2, outcome: 'raided', worth: -1 },
    ];
    for (const m of bad) expect(parseRegionMsg(JSON.stringify(m)), JSON.stringify(m).slice(0, 80)).toBeNull();
  });

  it('counts game time in real time at the fair clock’s pace, and keeps M36’s numbers', () => {
    // A game hour is 7.5 s at 1× (the fair clock's), a game month is a game day.
    expect(FRIENDS.hour).toBe(FAIR.msPerHour);
    expect(FRIENDS.month).toBe(24 * FAIR.msPerHour);
    // M36's cooldown after a war, in real time: three game months, nine minutes.
    expect(FRIENDS.cooldown).toBe(DIPLOMACY.cooldownMonths * FRIENDS.month);
    expect(FRIENDS.cooldown).toBe(9 * 60_000);
    // The warning is design call 9's two minutes (M36's twelve game hours would be a minute and a half).
    expect(FRIENDS.warning).toBe(120_000);
    expect(DIPLOMACY.warningHours * FRIENDS.hour).toBeLessThanOrEqual(FRIENDS.warning);
    expect(FRIENDS.maxTerms).toBe(DIPLOMACY.maxTerms);
    expect(FRIENDS.reasonMax).toBe(DIPLOMACY.reasonMax);
    // Friends are away more than computers: a proposal and a winner's terms wait a day.
    expect(FRIENDS.proposal).toBe(DAY_MS);
    expect(FRIENDS.terms).toBe(DAY_MS);
    // Some of the cleaning is M36's, kinds that need a computer town's state are left out.
    expect(cleanFriendTerm({ k: 'ceasefire', hours: 11 })).toHaveProperty('problem');
    expect(cleanFriendTerm({ k: 'ceasefire', hours: 12 })).toEqual({ term: { k: 'ceasefire', hours: 12 } });
    expect(cleanFriendTerm({ k: 'tribute', payer: 'us', amount: 50, months: 3 })).toHaveProperty('problem');
    expect(cleanFriendTerm({ k: 'vassal', side: 'us' })).toEqual({ term: { k: 'vassal' } });
    for (const k of ['dmz', 'occupy', 'release', 'liberate'])
      expect(cleanFriendTerm({ k, side: 'us', district: 1, months: 3, town: 1 })).toHaveProperty('problem');
    expect(cleanFriendTerm({ k: 'nope' })).toEqual({ problem: 'A term doesn’t make sense' });
  });

  describe('declaring war', () => {
    it('opens after a warning of two minutes, noticed at the next message (no timers), and tells everyone', () => {
      const w = world();
      declare(w, w.ada, SLOT.Sam, { reason: 'Your border is ours' });
      const war = warOf(w.ada)!;
      expect(war).toMatchObject({
        id: 1,
        a: SLOT.Ada,
        b: SLOT.Sam,
        scale: 'war',
        reason: 'Your border is ours',
        score: 0,
        battles: 0,
        state: 'declared',
      });
      expect(war.opens - war.declared).toBe(FRIENDS.warning);
      // Both cities are told; the others get a notice and a history line.
      expect(warOf(w.sam)).toEqual(war);
      expect(warOf(w.kit)).toBeUndefined();
      expect(notices(w.kit).at(-1)).toMatch(
        /Adaton declares war on Samton: “Your border is ours”\. It opens in 2 minutes/,
      );
      expect(last(w.kit, 'history')!.event).toMatchObject({ kind: 'declared', a: 1, b: 2, war: 1 });
      expect(last(w.ada, 'war')!.at).toBe(w.clock.t);
      // A minute and a half later it hasn't opened; a raid between them isn't allowed yet either.
      wait(w, 90_000);
      expect(all(w.ada, 'war')).toHaveLength(1);
      w.ada.say({ t: 'battle', to: SLOT.Sam, id: 'early', part: 0, parts: 1, data: 'X' });
      expect(last(w.ada, 'battleRefused')!.reason).toMatch(/war with Samton opens in 30 seconds/);
      // Past the warning nothing happens by itself: the next message of anyone opens it.
      w.clock.advance(31_000);
      expect(all(w.ada, 'war')).toHaveLength(1);
      w.room.message(w.kit.conn, 'ping');
      expect(warOf(w.ada)!.state).toBe('open');
      expect(warOf(w.sam)!.state).toBe('open');
      expect(last(w.kit, 'history')!.event).toMatchObject({ kind: 'opened', war: 1 });
      expect(warOf(w.kit)).toBeUndefined();
    });

    it('is on the list a city sees when it joins, with the history', () => {
      const w = world();
      openWar(w, w.ada, SLOT.Sam);
      w.room.closed(w.kit.conn);
      const kit = raw(w.room);
      kit.say(hello('Kit', { rejoin: { slot: 3, secret: w.secrets.Kit } }));
      const f = last(kit, 'rwelcome')!.friends!;
      expect(f.wars).toHaveLength(1);
      expect(f.wars[0]).toMatchObject({ a: 1, b: 2, state: 'open' });
      expect(f.now).toBe(w.clock.t);
      expect(f.history.map((e) => e.kind)).toEqual(['declared', 'opened']);
      expect(f.pacts).toEqual([]);
      expect(f.vassals).toEqual([]);
      expect(f.proposals).toEqual([]);
      // None of it rides on the region broadcast.
      expect(JSON.stringify(last(kit, 'region'))).not.toMatch(/"wars"|"pacts"|"vassals"|"history"/);
    });

    it('is refused when war is off, the scale is too big, a city is neutral, a newcomer, or not in the region', () => {
      const off = world({ rules: null });
      declare(off, off.ada, SLOT.Sam);
      expect(declined(off.ada)).toEqual(['War is off in this region']);

      const skirmish = world({ rules: { war: true, scale: 'skirmish' } });
      declare(skirmish, skirmish.ada, SLOT.Sam, { scale: 'war' });
      declare(skirmish, skirmish.ada, SLOT.Sam, { scale: 'total' });
      expect(declined(skirmish.ada)).toEqual([
        'This region’s rules allow skirmishes only',
        'This region’s rules allow skirmishes only',
      ]);
      // A skirmish war is within them.
      declare(skirmish, skirmish.ada, SLOT.Sam, { scale: 'skirmish' });
      expect(warOf(skirmish.ada)).toMatchObject({ scale: 'skirmish', state: 'declared' });

      const war = world({ rules: { war: true, scale: 'war' } });
      declare(war, war.ada, SLOT.Sam, { scale: 'total' });
      expect(declined(war.ada)).toEqual(['This region’s rules don’t allow total war']);
      declare(war, war.ada, SLOT.Sam, { scale: 'war' });
      expect(warOf(war.ada)!.scale).toBe('war');

      const w = world({ shield: { Sam: 'neutral', Kit: 'new', Lou: 'new' } });
      declare(w, w.ada, SLOT.Sam);
      expect(declined(w.ada).at(-1)).toBe('Samton is neutral');
      declare(w, w.sam, SLOT.Ada);
      expect(declined(w.sam).at(-1)).toBe('Samton is neutral: a neutral city doesn’t go to war');
      declare(w, w.ada, SLOT.Kit);
      expect(declined(w.ada).at(-1)).toBe(
        'Kitton is too young or small to go to war with, unless it strikes first',
      );
      // The newcomer may declare itself (as it may raid), and it may answer a city that raided it.
      declare(w, w.kit, SLOT.Ada);
      expect(warOf(w.kit)).toMatchObject({ a: 3, b: 1 });
      declare(w, w.ada, SLOT.Lou);
      expect(declined(w.ada).at(-1)).toMatch(/too young or small/);
      w.lou.say({ t: 'battle', to: SLOT.Ada, id: 'first', part: 0, parts: 1, data: 'X' });
      expect(last(w.lou, 'battleKept')).toBeTruthy();
      declare(w, w.ada, SLOT.Lou);
      expect(warOf(w.ada)).toMatchObject({ a: 1, b: 4 });

      declare(w, w.ada, 9);
      expect(declined(w.ada).at(-1)).toBe('That city isn’t in the region');
      declare(w, w.ada, SLOT.Ada);
      expect(declined(w.ada).at(-1)).toBe('That city isn’t in the region');
    });

    it('is refused for a war already on, a reason too long, an older page, a city not yet reporting and for pace', () => {
      const w = world({ v: { Kit: 5 } });
      declare(w, w.ada, SLOT.Sam);
      declare(w, w.ada, SLOT.Sam);
      declare(w, w.sam, SLOT.Ada);
      expect(declined(w.ada)).toEqual(['Adaton is at war with Samton already']);
      expect(declined(w.sam)).toEqual(['Samton is at war with Adaton already']);
      declare(w, w.ada, SLOT.Lou, { reason: 'x'.repeat(DIPLOMACY.reasonMax + 1) });
      expect(declined(w.ada).at(-1)).toBe('That reason is too long');
      declare(w, w.ada, SLOT.Kit);
      expect(declined(w.ada).at(-1)).toBe(
        'Kitton’s page is an older version, which can’t go to war with friends',
      );
      // An older page sending these is not heard at all.
      w.kit.say({ t: 'wdeclare', to: SLOT.Lou, scale: 'war', reason: '' });
      expect(all(w.kit, 'wrefused')).toHaveLength(0);
      expect(all(w.kit, 'war')).toHaveLength(0);
      // A city that hasn't reported isn't in the region's war yet.
      const fresh = world();
      const eve = raw(fresh.room);
      eve.say(hello('Eve'));
      fresh.ada.say({ t: 'wdeclare', to: 5, scale: 'war', reason: '' });
      expect(declined(fresh.ada).at(-1)).toBe('That city isn’t in the region');
    });

    it('paces a city’s diplomatic moves, and takes none past the day’s rows', () => {
      const w = world();
      for (let i = 0; i < FRIENDS.actBurst; i++)
        w.ada.say({ t: 'tprop', id: `p${i}`, to: SLOT.Sam, terms: [{ k: 'trade' }] });
      // Only the first got through the one-at-a-time rule; the rest were refused on that, not on pace.
      w.ada.say({ t: 'wdeclare', to: SLOT.Sam, scale: 'war', reason: '' });
      expect(declined(w.ada).at(-1)).toBe('The region takes a few diplomatic moves at a time');
      w.clock.advance(FRIENDS.actEvery);
      w.ada.say({ t: 'wdeclare', to: SLOT.Sam, scale: 'war', reason: '' });
      expect(warOf(w.ada)).toBeTruthy();
      // Past the day's rows nothing new starts (changes would not be kept), but answers still go.
      w.store.rowsWritten += 2_000_000;
      declare(w, w.kit, SLOT.Lou);
      expect(declined(w.kit).at(-1)).toMatch(/has reached today's limit/);
      breathe(w);
      w.kit.say({ t: 'tprop', id: 'late', to: SLOT.Lou, terms: [{ k: 'trade' }] });
      expect(refusals(w.kit).at(-1)).toMatch(/has reached today's limit/);
    });

    it('keeps a binding pact in the way until the city agrees to break it', () => {
      const w = world();
      sign(w, w.ada, w.sam, SLOT.Sam, [{ k: 'nonAggression', months: 24 }]);
      declare(w, w.ada, SLOT.Sam);
      const refused = last(w.ada, 'wrefused')!;
      expect(refused).toMatchObject({ to: 2, breaks: true });
      expect(refused.why).toBe('That breaks your non-aggression pact with Samton');
      expect(warOf(w.ada)).toBeUndefined();
      // Sent again, agreeing: the pact goes, the war is declared, and the history says so.
      declare(w, w.ada, SLOT.Sam, { breakPact: true });
      expect(warOf(w.ada)).toMatchObject({ state: 'declared' });
      expect(last(w.kit, 'pacts')!.pacts).toEqual([]);
      const kinds = last(w.kit, 'history')!.event;
      expect(kinds.kind).toBe('declared');
      expect(all(w.kit, 'history').map((h) => h.event.kind)).toContain('broken');
    });

    it('waits out a cooldown after a war (M36’s, in real time), and lets a vassal rise only against its overlord', () => {
      const w = world();
      openWar(w, w.ada, SLOT.Sam);
      sign(w, w.ada, w.sam, SLOT.Sam, PEACE);
      expect(warOf(w.ada)!.state).toBe('ended');
      declare(w, w.sam, SLOT.Ada);
      expect(declined(w.sam).at(-1)).toMatch(
        /^The last war with Adaton ended too recently \(\d+ minutes to wait\)$/,
      );
      w.clock.advance(FRIENDS.cooldown - 2 * FRIENDS.actEvery);
      declare(w, w.sam, SLOT.Ada);
      expect(declined(w.sam)).toHaveLength(1);
      w.clock.advance(FRIENDS.actEvery);
      declare(w, w.sam, SLOT.Ada);
      expect(warOf(w.sam)).toMatchObject({ a: 2, b: 1, state: 'declared' });
    });
  });
});

describe('treaties between friends', () => {
  const tsigns = (r: Raw) => all(r, 'tsign');
  const tprops = (r: Raw) => all(r, 'tprop');

  it('puts terms to a city, which answers yes: signed for both, kept for each until it has seen it', () => {
    const w = world();
    const terms = [
      { k: 'nonAggression', months: 12 },
      { k: 'reparations', payer: 'us', amount: 5000 },
    ];
    breathe(w);
    w.ada.say({ t: 'tprop', id: 'p-1', to: SLOT.Sam, terms });
    // Put to Sam (and no one else), in the proposer's terms, with a day to answer.
    expect(tprops(w.sam)).toEqual([
      {
        t: 'tprop',
        id: 'p-1',
        from: 1,
        to: 2,
        terms,
        made: w.clock.t,
        expires: w.clock.t + DAY_MS,
        at: w.clock.t,
      },
    ]);
    expect(tprops(w.ada)).toHaveLength(0);
    expect(tprops(w.kit)).toHaveLength(0);
    w.sam.say({ t: 'tans', id: 'p-1', accept: true });
    for (const r of [w.ada, w.sam]) expect(tsigns(r)).toHaveLength(1);
    const signed = tsigns(w.ada)[0]!;
    expect(signed).toMatchObject({ id: 'p-1', a: 1, b: 2, terms });
    expect(signed.imposed).toBeUndefined();
    // Each city reads the terms from its own side: Ada pays, Samton is paid.
    expect(termsFor(signed.terms, 'a')[1]).toMatchObject({ payer: 'us' });
    expect(termsFor(signed.terms, 'b')[1]).toMatchObject({ payer: 'them' });
    // Everyone hears of the pact; the history has the treaty in words.
    const pacts = last(w.kit, 'pacts')!;
    expect(pacts.pacts).toHaveLength(1);
    expect(pacts.pacts[0]).toMatchObject({ a: 1, b: 2, kind: 'nonAggression', since: w.clock.t });
    expect(pacts.pacts[0]!.until).toBe(w.clock.t + 12 * FRIENDS.month);
    expect(last(w.kit, 'history')!.event.text).toBe(
      'Adaton and Samton sign a treaty: a non-aggression pact for 12 months; Adaton pays $5,000 in reparations',
    );
    expect(tsigns(w.kit)).toHaveLength(0);

    // Sam is disconnected before it has seen it: the treaty is there again when it comes back.
    w.room.closed(w.sam.conn);
    const sam = raw(w.room);
    sam.say(hello('Sam', { rejoin: { slot: 2, secret: w.secrets.Sam } }));
    expect(tsigns(sam).map((t) => t.id)).toEqual(['p-1']);
    sam.say({ t: 'tseen', id: 'p-1' });
    // Ada has not said so yet; it still has its copy, and Sam's is gone for good.
    w.room.closed(w.ada.conn);
    const ada = raw(w.room);
    ada.say(hello('Ada', { rejoin: { slot: 1, secret: w.secrets.Ada } }));
    expect(tsigns(ada).map((t) => t.id)).toEqual(['p-1']);
    ada.say({ t: 'tseen', id: 'p-1' });
    ada.say({ t: 'tseen', id: 'p-1' });
    w.room.closed(sam.conn);
    const sam2 = raw(w.room);
    sam2.say(hello('Sam', { rejoin: { slot: 2, secret: w.secrets.Sam } }));
    expect(tsigns(sam2)).toHaveLength(0);
    // Nothing else says a thing about it, and it can't be signed twice.
    breathe(w);
    ada.say({ t: 'tprop', id: 'p-1', to: SLOT.Sam, terms: [{ k: 'trade' }] });
    expect(refusals(ada)).toEqual(['That proposal has been answered already']);
  });

  it('is turned down: the proposer is told, and the proposal is gone', () => {
    const w = world();
    breathe(w);
    w.ada.say({ t: 'tprop', id: 'p-1', to: SLOT.Sam, terms: [{ k: 'alliance' }] });
    w.sam.say({ t: 'tans', id: 'p-1', accept: false });
    expect(all(w.ada, 'trefused')).toEqual([
      { t: 'trefused', id: 'p-1', why: 'Samton turned down your proposal', declined: true },
    ]);
    expect(tsigns(w.ada)).toHaveLength(0);
    w.sam.say({ t: 'tans', id: 'p-1', accept: true });
    expect(refusals(w.sam)).toEqual(['That proposal is gone']);
    // Another may be made now.
    breathe(w);
    w.ada.say({ t: 'tprop', id: 'p-2', to: SLOT.Sam, terms: [{ k: 'alliance' }] });
    expect(tprops(w.sam).map((p) => p.id)).toEqual(['p-1', 'p-2']);
  });

  it('is kept for a city that is away, and delivered when it comes back; one nobody answers lapses after a day', () => {
    const w = world();
    w.room.closed(w.sam.conn);
    breathe(w);
    w.ada.say({ t: 'tprop', id: 'p-1', to: SLOT.Sam, terms: [{ k: 'trade' }] });
    w.ada.say({ t: 'tprop', id: 'p-9', to: SLOT.Sam, terms: [{ k: 'trade' }] });
    expect(refusals(w.ada)).toEqual(['Wait for an answer to the last proposal']);
    // Ada's own list shows it is waiting, in the welcome after a reload.
    w.room.closed(w.ada.conn);
    const ada = raw(w.room);
    ada.say(hello('Ada', { rejoin: { slot: 1, secret: w.secrets.Ada } }));
    expect(last(ada, 'rwelcome')!.friends!.proposals.map((p) => p.id)).toEqual(['p-1']);
    // Hours later Sam comes back: the welcome is followed by the proposal.
    wait(w, 5 * 3600_000);
    const sam = raw(w.room);
    sam.say(hello('Sam', { rejoin: { slot: 2, secret: w.secrets.Sam } }));
    expect(sam.got.map((m) => m.t).slice(0, 2)).toEqual(['rwelcome', 'tprop']);
    expect(tprops(sam)[0]).toMatchObject({ id: 'p-1', from: 1, terms: [{ k: 'trade' }] });
    // It is a day after it was made: nobody has answered; the next message of anyone lapses it.
    wait(w, DAY_MS - 5 * 3600_000 - 1_000);
    expect(refusals(ada)).toEqual([]);
    wait(w, 2_000);
    expect(all(ada, 'trefused').at(-1)).toEqual({
      t: 'trefused',
      id: 'p-1',
      why: 'That proposal ran out',
      expired: true,
    });
    sam.say({ t: 'tans', id: 'p-1', accept: true });
    expect(refusals(sam).at(-1)).toBe('That proposal is gone');
    expect(tsigns(sam)).toHaveLength(0);
    // A proposal answered just in time is signed; one a moment late isn't (the room's clock, at the answer).
    breathe(w);
    ada.say({ t: 'tprop', id: 'p-2', to: SLOT.Sam, terms: [{ k: 'trade' }] });
    w.clock.advance(DAY_MS - 1_000);
    sam.say({ t: 'tans', id: 'p-2', accept: true });
    expect(tsigns(sam).map((t) => t.id)).toEqual(['p-2']);
  });

  it('refuses terms that make no sense, in words', () => {
    const w = world();
    const refused = (terms: object[], who = w.ada, to: number = SLOT.Sam): string => {
      breathe(w);
      const before = all(who, 'trefused').length;
      who.say({ t: 'tprop', id: `x${++battleN}`, to, terms });
      const n = all(who, 'trefused');
      return n.length > before ? n.at(-1)!.why : '(put)';
    };
    // No war: no ceasefire or peace.
    expect(refused([{ k: 'ceasefire', hours: 72 }])).toBe('Adaton isn’t at war with Samton');
    expect(refused(PEACE)).toBe('Adaton isn’t at war with Samton');
    // Kinds that need a computer town's state.
    expect(refused([{ k: 'dmz', side: 'us', months: 3 }])).toBe(
      'Demilitarised zone is for computer towns, not for friends',
    );
    expect(refused([{ k: 'occupy', side: 'us', district: 1 }])).toMatch(/for computer towns/);
    expect(refused([{ k: 'ceasefire', hours: 1 }])).toBe(
      'A term doesn’t make sense'.replace(/.*/, 'Ceasefire: 12 to 720 hours'),
    );
    expect(refused([{ k: 'tribute', payer: 'us', amount: 5, months: 3 }])).toMatch(
      /^Tribute: \$100 or more a month/,
    );
    expect(
      refused([
        { k: 'nonAggression', months: 6 },
        { k: 'nonAggression', months: 6 },
      ]),
    ).toBe('Non-aggression pact is listed twice');
    expect(refused(Array.from({ length: 9 }, () => ({ k: 'trade' })))).toBe('A treaty has 8 terms at most');
    expect(refused([{ k: 'independence' }])).toBe('Neither city is the other’s vassal');
    expect(refused([{ k: 'vassal' }])).toBe('Vassalage can only be imposed by the winner of a total war');
    expect(refused([{ k: 'embargo' }, { k: 'trade' }])).toBe('An embargo and trade together make no sense');
    expect(refused([{ k: 'alliance' }], w.ada, 9)).toBe('That city isn’t in the region');
    // Imposing is for the winner of a capitulated war.
    breathe(w);
    w.ada.say({ t: 'tprop', id: 'imp', to: SLOT.Sam, terms: PEACE, imposed: true });
    expect(refusals(w.ada).at(-1)).toBe('Only the winner of a war Samton capitulated in can impose terms');
    // Good ones are put, and a few that stand until the situation changes.
    expect(refused([{ k: 'alliance' }])).toBe('(put)');
    expect(refused([{ k: 'embargo' }], w.sam, SLOT.Kit)).toBe('(put)');
    // The war changes what may be asked.
    openWar(w, w.kit, SLOT.Lou);
    expect(refused([{ k: 'nonAggression', months: 6 }], w.kit, SLOT.Lou)).toBe(
      'A non-aggression pact needs peace first',
    );
    expect(refused([{ k: 'alliance' }], w.lou, SLOT.Kit)).toBe('Alliance needs peace first');
    expect(refused([{ k: 'peace' }, { k: 'nonAggression', months: 6 }], w.kit, SLOT.Lou)).toBe('(put)');
    expect(refused([{ k: 'peace' }, { k: 'ceasefire', hours: 72 }], w.lou, SLOT.Kit)).toBe(
      'Peace and a ceasefire together make no sense',
    );
    // A neutral city joins no wars.
    const n = world({ shield: { Sam: 'neutral' } });
    n.ada.say({ t: 'tprop', id: 'n1', to: SLOT.Sam, terms: [{ k: 'defensivePact' }] });
    expect(refusals(n.ada)).toEqual(['Samton is neutral: it joins no wars']);
    // War off: nothing is put or answered.
    const off = world({ rules: null });
    off.ada.say({ t: 'tprop', id: 'o1', to: SLOT.Sam, terms: [{ k: 'trade' }] });
    expect(refusals(off.ada)).toEqual(['War is off in this region']);
  });

  it('knows one proposal from another: ids, one for each pair, the region’s eight, who may answer, what has changed', () => {
    const w = world();
    const put = (r: Raw, id: string, to: number) => {
      breathe(w);
      r.say({ t: 'tprop', id, to, terms: [{ k: 'trade' }] });
    };
    put(w.ada, 'a1', SLOT.Sam);
    put(w.sam, 'a1', SLOT.Kit);
    expect(refusals(w.sam)).toEqual(['That proposal id is taken']);
    // Sent again by its own city (nothing came back): put to Sam again, and still one.
    put(w.ada, 'a1', SLOT.Sam);
    expect(tprops(w.sam).map((p) => p.id)).toEqual(['a1', 'a1']);
    put(w.ada, 'a2', SLOT.Sam);
    expect(refusals(w.ada)).toEqual(['Wait for an answer to the last proposal']);
    // Who may answer.
    w.kit.say({ t: 'tans', id: 'a1', accept: true });
    expect(refusals(w.kit)).toEqual(['That proposal isn’t yours to answer']);
    w.ada.say({ t: 'tans', id: 'a1', accept: true });
    expect(refusals(w.ada).at(-1)).toBe('That proposal isn’t yours to answer');
    // Eight at most in the region: Ada has one, Sam two more...
    put(w.ada, 'b1', SLOT.Kit);
    put(w.ada, 'b2', SLOT.Lou);
    put(w.sam, 'c1', SLOT.Ada);
    put(w.sam, 'c2', SLOT.Kit);
    put(w.sam, 'c3', SLOT.Lou);
    put(w.kit, 'd1', SLOT.Ada);
    put(w.kit, 'd2', SLOT.Sam);
    expect(refusals(w.sam)).toEqual(['That proposal id is taken']);
    put(w.kit, 'd3', SLOT.Lou);
    expect(refusals(w.kit).at(-1)).toBe('The region holds 8 proposals at a time');
    // Things move on: a ceasefire put to Samton is moot if the war has ended meanwhile.
    const v = world();
    openWar(v, v.ada, SLOT.Sam);
    breathe(v);
    v.ada.say({ t: 'tprop', id: 'cf', to: SLOT.Sam, terms: [{ k: 'ceasefire', hours: 72 }] });
    sign(v, v.sam, v.ada, SLOT.Ada, PEACE, 'pc');
    v.sam.say({ t: 'tans', id: 'cf', accept: true });
    expect(refusals(v.sam).at(-1)).toBe('Adaton isn’t at war with Samton');
    expect(refusals(v.ada).at(-1)).toBe('Adaton isn’t at war with Samton');
    expect(tsigns(v.sam).map((t) => t.id)).toEqual(['pc']);
  });

  it('records the pacts, ends them early for either city, and runs a non-aggression pact out', () => {
    const w = world();
    sign(w, w.ada, w.sam, SLOT.Sam, [{ k: 'nonAggression', months: 1 }, { k: 'alliance' }], 'pa');
    sign(w, w.kit, w.lou, SLOT.Lou, [{ k: 'defensivePact' }, { k: 'embargo' }], 'pb');
    const list = last(w.lou, 'pacts')!.pacts;
    expect(list.map((p) => [p.a, p.b, p.kind])).toEqual([
      [1, 2, 'nonAggression'],
      [1, 2, 'alliance'],
      [3, 4, 'defensivePact'],
      [3, 4, 'embargo'],
    ]);
    // A raid under a pact that binds is refused, naming it; an embargo doesn't bind.
    w.ada.say({ t: 'battle', to: SLOT.Sam, id: 'r1', part: 0, parts: 1, data: 'X' });
    expect(last(w.ada, 'battleRefused')!.reason).toBe(
      'That breaks your non-aggression pact with Samton: end it first',
    );
    // Trade replaces the embargo, and an embargo the trade.
    sign(w, w.lou, w.kit, SLOT.Kit, [{ k: 'trade' }], 'pc');
    expect(
      last(w.ada, 'pacts')!
        .pacts.map((p) => p.kind)
        .filter((k) => k === 'embargo' || k === 'trade'),
    ).toEqual(['trade']);
    sign(w, w.lou, w.kit, SLOT.Kit, [{ k: 'embargo' }], 'pd');
    expect(
      last(w.ada, 'pacts')!
        .pacts.map((p) => p.kind)
        .filter((k) => k === 'embargo' || k === 'trade'),
    ).toEqual(['embargo']);
    // Only a city to a pact may end it. The other is told, and so is everyone.
    const nonAgg = list[0]!;
    breathe(w);
    w.kit.say({ t: 'tbreak', pact: nonAgg.id });
    expect(refusals(w.kit).at(-1)).toBe('No such pact');
    w.sam.say({ t: 'tbreak', pact: nonAgg.id });
    expect(last(w.kit, 'pacts')!.pacts.map((p) => p.kind)).not.toContain('nonAggression');
    expect(last(w.kit, 'history')!.event).toMatchObject({
      kind: 'broken',
      a: 2,
      b: 1,
      text: 'Samton ends the non-aggression pact with Adaton',
    });
    // The alliance still binds.
    w.ada.say({ t: 'battle', to: SLOT.Sam, id: 'r2', part: 0, parts: 1, data: 'X' });
    expect(last(w.ada, 'battleRefused')!.reason).toBe('That breaks your alliance with Samton: end it first');
    const ally = last(w.kit, 'pacts')!.pacts.find((p) => p.kind === 'alliance')!;
    w.ada.say({ t: 'tbreak', pact: ally.id });
    w.ada.say({ t: 'battle', to: SLOT.Sam, id: 'r3', part: 0, parts: 1, data: 'X' });
    expect(last(w.ada, 'battleKept')!.id).toBe('r3');
    // A pact with a time runs out by itself, noticed at the next message.
    sign(w, w.ada, w.sam, SLOT.Sam, [{ k: 'nonAggression', months: 1 }], 'pe');
    expect(last(w.ada, 'pacts')!.pacts.some((p) => p.kind === 'nonAggression')).toBe(true);
    wait(w, FRIENDS.month + 1_000);
    expect(last(w.ada, 'pacts')!.pacts.some((p) => p.kind === 'nonAggression')).toBe(false);
    expect(last(w.kit, 'history')!.event.text).toBe(
      'The non-aggression pact between Adaton and Samton has run its course',
    );
  });
});

describe('peace and ceasefire', () => {
  it('ends a war with peace: told to both, gone from the list, with pacts and money in the same treaty', () => {
    const w = world();
    openWar(w, w.ada, SLOT.Sam);
    sign(w, w.ada, w.sam, SLOT.Sam, [{ k: 'nonAggression', months: 3 }], 'np');
    expect(refusals(w.ada).at(-1)).toBe('A non-aggression pact needs peace first');
    sign(
      w,
      w.sam,
      w.ada,
      SLOT.Ada,
      [
        { k: 'peace' },
        { k: 'tribute', payer: 'us', amount: 1_000, months: 6 },
        { k: 'nonAggression', months: 3 },
      ],
      'pp',
    );
    for (const r of [w.ada, w.sam]) {
      expect(warOf(r)).toMatchObject({ id: 1, state: 'ended' });
      expect(
        all(r, 'tsign')
          .at(-1)!
          .terms.map((t) => t.k),
      ).toEqual(['peace', 'tribute', 'nonAggression']);
    }
    expect(last(w.kit, 'pacts')!.pacts.map((p) => p.kind)).toEqual(['nonAggression']);
    expect(last(w.kit, 'history')!.event.text).toBe(
      'Samton and Adaton sign a treaty: peace; Samton pays $1,000 a month for 6 months; a non-aggression pact for 3 months',
    );
    // A city joining now sees no war; the cooldown carries on.
    w.room.closed(w.kit.conn);
    const kit = raw(w.room);
    kit.say(hello('Kit', { rejoin: { slot: 3, secret: w.secrets.Kit } }));
    expect(last(kit, 'rwelcome')!.friends!.wars).toEqual([]);
    // Peace during the warning calls the war off.
    const v = world();
    declare(v, v.ada, SLOT.Sam);
    sign(v, v.sam, v.ada, SLOT.Ada, PEACE, 'cancel');
    expect(warOf(v.ada)!.state).toBe('ended');
    wait(v, FRIENDS.warning * 2);
    expect(all(v.ada, 'war').map((m) => m.war.state)).toEqual(['declared', 'ended']);
  });

  it('pauses the war under a ceasefire: no raids, the front frozen, and it is on again when it ends', () => {
    const w = world();
    const war = openWar(w, w.ada, SLOT.Sam, 'total');
    // The war has to have opened for a ceasefire.
    const early = world();
    declare(early, early.ada, SLOT.Sam);
    breathe(early);
    early.ada.say({ t: 'tprop', id: 'e1', to: SLOT.Sam, terms: [{ k: 'ceasefire', hours: 72 }] });
    expect(refusals(early.ada)).toEqual(['The war hasn’t opened yet: ask for peace instead']);

    // Ada holds Samton's seat of power; then they agree to a ceasefire of 72 game hours (nine minutes).
    fight(w, w.ada, SLOT.Ada, w.sam, SLOT.Sam, 'raided', { decisive: 1, seatDown: true });
    expect(warOf(w.ada)!.hold).toMatchObject({ by: 1 });
    sign(w, w.sam, w.ada, SLOT.Ada, [{ k: 'ceasefire', hours: 72 }], 'cf');
    expect(warOf(w.ada)).toMatchObject({ id: war.id, state: 'ceasefire', paused: w.clock.t });
    const cease = last(w.kit, 'pacts')!.pacts.find((p) => p.kind === 'ceasefire')!;
    expect(cease).toMatchObject({ a: 2, b: 1, war: war.id, until: w.clock.t + 72 * FRIENDS.hour });
    w.ada.say({ t: 'battle', to: SLOT.Sam, id: 'cr', part: 0, parts: 1, data: 'X' });
    expect(last(w.ada, 'battleRefused')!.reason).toBe('There is a ceasefire with Samton');
    breathe(w);
    w.ada.say({ t: 'tprop', id: 'cf2', to: SLOT.Sam, terms: [{ k: 'ceasefire', hours: 72 }] });
    expect(refusals(w.ada).at(-1)).toBe('There is a ceasefire already');
    // The hold, which would have conquered Samton by now, was frozen with the war.
    wait(w, 72 * FRIENDS.hour + 1_000);
    expect(warOf(w.ada)!.state).toBe('open');
    expect(last(w.kit, 'pacts')!.pacts).toEqual([]);
    expect(last(w.kit, 'history')!.event.text).toBe(
      'The ceasefire between Samton and Adaton has run its course',
    );
    expect(last(w.sam, 'vassals' as never)).toBeUndefined();
    expect(warOf(w.ada)!.hold).toBeTruthy();
    expect(all(w.ada, 'tsign').map((t) => t.id)).toEqual(['cf']);
    // The raid under way is allowed again.
    w.ada.say({ t: 'battle', to: SLOT.Sam, id: 'cr2', part: 0, parts: 1, data: 'X' });
    expect(last(w.ada, 'battleKept')!.id).toBe('cr2');

    // Ended early by either city: the war is on again at once.
    const x = world();
    openWar(x, x.ada, SLOT.Sam);
    sign(x, x.ada, x.sam, SLOT.Sam, [{ k: 'ceasefire', hours: 720 }], 'cx');
    expect(warOf(x.sam)!.state).toBe('ceasefire');
    const pact = last(x.kit, 'pacts')!.pacts[0]!;
    breathe(x);
    x.sam.say({ t: 'tbreak', pact: pact.id });
    expect(warOf(x.sam)!.state).toBe('open');
    expect(last(x.kit, 'history')!.event.text).toBe(
      'Samton ends the ceasefire with Adaton: the war is on again',
    );
  });
});

describe('the score, capitulation and the winner’s terms', () => {
  it('moves the score as M36’s scoreBattle does, from the declarer’s side, once for each battle the defender reports', () => {
    const w = world();
    openWar(w, w.ada, SLOT.Sam);
    const score = () => warOf(w.ada)!.score;
    // The attacker wins by how decisively: 8 to 15 points.
    fight(w, w.ada, 1, w.sam, 2, 'raided', { decisive: 1 });
    expect(score()).toBe(DIPLOMACY.score.battleMax);
    fight(w, w.ada, 1, w.sam, 2, 'repelled', { decisive: 0 });
    expect(score()).toBe(DIPLOMACY.score.battleMax - DIPLOMACY.score.battleMin);
    // Sam attacks and wins by half, and a hundred thousand dollars of Adaton's buildings fall: the
    // 11.5 points, and a point for each $25,000 of damage.
    fight(w, w.sam, 2, w.ada, 1, 'raided', { decisive: 0.5, worth: 100_000 });
    expect(score()).toBe(7 - 15.5);
    // A raid that withdrew is the defender's.
    fight(w, w.ada, 1, w.sam, 2, 'withdrew');
    expect(score()).toBe(-8.5 - 8);
    expect(warOf(w.ada)!.battles).toBe(4);
    // The history carries the outcome and the score, one line to a battle (the line made when it was kept).
    const lines = all(w.kit, 'history')
      .map((h) => h.event)
      .filter((e) => e.kind === 'battle');
    expect(new Set(lines.map((e) => e.id)).size).toBe(4);
    expect(lines.at(-1)).toMatchObject({
      outcome: 'withdrew',
      score: -16.5,
      text: 'Adaton raided Samton: the raiders withdrew. War score: Adaton -16.5',
    });
    // Both cities are told each time.
    expect(all(w.sam, 'war').at(-1)!.war.score).toBe(-16.5);
  });

  it('counts only a battle the region knew of, once, from its defender, in a war that is open', () => {
    const w = world();
    const war = openWar(w, w.ada, SLOT.Sam);
    // Never fought.
    w.sam.say({ t: 'battleResult', id: 'ghost', from: 1, to: 2, outcome: 'raided', decisive: 1 });
    // Fought, but reported by the attacker, or by a defender that isn't the target.
    w.ada.say({ t: 'battle', to: SLOT.Sam, id: 'real', part: 0, parts: 1, data: 'X' });
    w.sam.say({ t: 'battleSeen', id: 'real', from: 1 });
    w.ada.say({ t: 'battleResult', id: 'real', from: 1, to: 2, outcome: 'raided', decisive: 1 });
    w.kit.say({ t: 'battleResult', id: 'real', from: 1, to: 2, outcome: 'raided', decisive: 1 });
    expect(warOf(w.ada)!.score).toBe(war.score);
    // Reported by its defender: counted. Again: not.
    w.sam.say({ t: 'battleResult', id: 'real', from: 1, to: 2, outcome: 'raided', decisive: 1 });
    w.sam.say({ t: 'battleResult', id: 'real', from: 1, to: 2, outcome: 'repelled', decisive: 1 });
    expect(warOf(w.ada)!.score).toBe(15);
    expect(warOf(w.ada)!.battles).toBe(1);
    // A battle in peace or before the war opens moves nothing, but is a line in the history.
    const v = world();
    fight(v, v.ada, 1, v.sam, 2, 'raided', { decisive: 1 }, 'peace1');
    expect(all(v.kit, 'war')).toHaveLength(0);
    expect(last(v.kit, 'history')!.event).toMatchObject({
      kind: 'battle',
      outcome: 'raided',
      text: 'Adaton raided Samton: the raid succeeded',
    });
    declare(v, v.ada, SLOT.Sam);
    fight(v, v.sam, 2, v.ada, 1, 'raided', { decisive: 1 }, 'warning1');
    expect(v.sam.got.filter((m) => m.t === 'battleKept' && m.id === 'warning1')).toHaveLength(0);
    expect(warOf(v.ada)!.score).toBe(0);
  });

  it('ends in a capitulation at −60: no more battles, and the winner sets its terms, signed at once', () => {
    const w = world();
    openWar(w, w.ada, SLOT.Sam);
    for (let i = 0; i < 3; i++) fight(w, w.sam, 2, w.ada, 1, 'raided', { decisive: 1 });
    expect(warOf(w.ada)).toMatchObject({ score: -45, state: 'open' });
    fight(w, w.sam, 2, w.ada, 1, 'raided', { decisive: 1 });
    expect(warOf(w.ada)).toMatchObject({ score: -60, state: 'capitulated', capitulated: { by: 1 } });
    expect(warOf(w.sam)!.state).toBe('capitulated');
    const text = last(w.kit, 'notice')!.text;
    expect(text).toBe('Adaton capitulates to Samton: Samton may set its terms within 24 hours');
    // The war is over: raids are refused for both sides, in their own words.
    w.sam.say({ t: 'battle', to: SLOT.Ada, id: 'more', part: 0, parts: 1, data: 'X' });
    expect(last(w.sam, 'battleRefused')!.reason).toBe('Adaton has capitulated: set your terms');
    w.ada.say({ t: 'battle', to: SLOT.Sam, id: 'more2', part: 0, parts: 1, data: 'X' });
    expect(last(w.ada, 'battleRefused')!.reason).toBe('The city capitulated to Samton');
    // A battle result now moves nothing.
    // Only the winner may impose, and only what a loser can be made to do.
    const impose = (r: Raw, to: number, terms: object[], id: string) => {
      breathe(w);
      r.say({ t: 'tprop', id, to, terms, imposed: true });
    };
    impose(w.ada, SLOT.Sam, [{ k: 'reparations', payer: 'us', amount: 5000 }], 'i1');
    expect(refusals(w.ada).at(-1)).toBe('Only the winner of a war Samton capitulated in can impose terms');
    impose(w.sam, SLOT.Ada, [{ k: 'reparations', payer: 'us', amount: 5000 }], 'i2');
    expect(refusals(w.sam).at(-1)).toBe('Imposed money is paid by the side that capitulated');
    impose(w.sam, SLOT.Ada, [{ k: 'alliance' }], 'i3');
    expect(refusals(w.sam).at(-1)).toBe('Alliance can’t be imposed');
    impose(w.sam, SLOT.Ada, [{ k: 'vassal' }], 'i4');
    expect(refusals(w.sam).at(-1)).toBe('Only a total war ends in vassalage');
    expect(all(w.ada, 'tprop')).toHaveLength(0);
    impose(
      w.sam,
      SLOT.Ada,
      [
        { k: 'reparations', payer: 'them', amount: 20_000 },
        { k: 'tribute', payer: 'them', amount: 1_000, months: 24 },
      ],
      'i5',
    );
    // Signed at once: no answer asked of Adaton, peace first among the terms, told as imposed.
    const t = all(w.ada, 'tsign').at(-1)!;
    expect(t).toMatchObject({ id: 'i5', a: 2, b: 1, imposed: true });
    expect(t.terms.map((x) => x.k)).toEqual(['peace', 'reparations', 'tribute']);
    expect(termsFor(t.terms, 'b')[1]).toMatchObject({ payer: 'us', amount: 20_000 });
    expect(all(w.sam, 'tsign').at(-1)!.id).toBe('i5');
    expect(warOf(w.sam)!.state).toBe('ended');
    expect(all(w.ada, 'tprop')).toHaveLength(0);
    expect(last(w.kit, 'history')!.event.text).toBe(
      'Samton imposes terms on Adaton: peace; Adaton pays $20,000 in reparations; Adaton pays $1,000 a month for 24 months',
    );
  });

  it('stands on plain peace if the winner sets no terms within a day', () => {
    const w = world();
    openWar(w, w.ada, SLOT.Sam);
    for (let i = 0; i < 4; i++) fight(w, w.ada, 1, w.sam, 2, 'raided', { decisive: 1 });
    expect(warOf(w.sam)).toMatchObject({ state: 'capitulated', capitulated: { by: 2 } });
    wait(w, DAY_MS - 60_000);
    expect(warOf(w.sam)!.state).toBe('capitulated');
    wait(w, 61_000);
    expect(warOf(w.sam)!.state).toBe('ended');
    const t = all(w.sam, 'tsign').at(-1)!;
    expect(t).toMatchObject({ id: 'w1-peace', a: 1, b: 2, imposed: true, terms: [{ k: 'peace' }] });
    expect(all(w.ada, 'tsign').at(-1)!.id).toBe('w1-peace');
  });

  it('makes a city that capitulated in a total war a vassal, if the winner says so, and holds it to that', () => {
    const w = world();
    openWar(w, w.sam, SLOT.Ada, 'total');
    for (let i = 0; i < 4; i++) fight(w, w.sam, 2, w.ada, 1, 'raided', { decisive: 1 });
    expect(warOf(w.ada)).toMatchObject({ state: 'capitulated', capitulated: { by: 1 }, score: 60 });
    breathe(w);
    w.sam.say({
      t: 'tprop',
      id: 'v1',
      to: SLOT.Ada,
      terms: [{ k: 'vassal' }, { k: 'tribute', payer: 'them', amount: 500, months: 12 }],
      imposed: true,
    });
    const t = all(w.ada, 'tsign').at(-1)!;
    expect(t.terms.map((x) => x.k)).toEqual(['peace', 'vassal', 'tribute']);
    expect(termsFor(t.terms, 'b')[1]).toEqual({ k: 'vassal' });
    const pacts = last(w.kit, 'pacts')!;
    expect(pacts.vassals).toEqual([
      { vassal: 1, overlord: 2, since: w.clock.t, share: DIPLOMACY.vassal.taxShare },
    ]);
    expect(last(w.kit, 'history')!.event).toMatchObject({ kind: 'vassal', a: 2, b: 1 });
    expect(all(w.kit, 'history').at(-2)!.event.text).toMatch(
      /Samton imposes terms on Adaton: peace; Adaton becomes Samton’s vassal; /,
    );
    // What a vassal is held to: no war but against its overlord, no raids but on it, and not
    // raided, or declared on, by its overlord in peace; and it is nobody's vassal twice.
    declare(w, w.ada, SLOT.Kit);
    expect(declined(w.ada).at(-1)).toBe('A vassal can’t go to war, except to rise against its overlord');
    w.ada.say({ t: 'battle', to: SLOT.Kit, id: 'v-r1', part: 0, parts: 1, data: 'X' });
    expect(last(w.ada, 'battleRefused')!.reason).toBe(
      'A vassal sends no forces, except to rise against its overlord',
    );
    w.ada.say({ t: 'battle', to: SLOT.Sam, id: 'v-r2', part: 0, parts: 1, data: 'X' });
    expect(last(w.ada, 'battleRefused')!.reason).toBe(
      'A vassal sends no forces, except to rise against its overlord',
    );
    w.sam.say({ t: 'battle', to: SLOT.Ada, id: 'v-r3', part: 0, parts: 1, data: 'X' });
    expect(last(w.sam, 'battleRefused')!.reason).toBe('Adaton is your vassal');
    w.clock.advance(FRIENDS.cooldown);
    declare(w, w.sam, SLOT.Ada);
    expect(declined(w.sam).at(-1)).toBe('Adaton is your vassal');
    // Others may raid it, as ever.
    w.kit.say({ t: 'battle', to: SLOT.Ada, id: 'v-r4', part: 0, parts: 1, data: 'X' });
    expect(last(w.kit, 'battleKept')!.id).toBe('v-r4');
    // A city is another's vassal once.
    openWar(w, w.kit, SLOT.Lou, 'total');
    for (let i = 0; i < 4; i++) fight(w, w.kit, 3, w.lou, 4, 'raided', { decisive: 1 });
    breathe(w);
    w.kit.say({ t: 'tprop', id: 'v2', to: SLOT.Lou, terms: [{ k: 'vassal' }], imposed: true });
    expect(
      all(w.lou, 'tsign')
        .at(-1)!
        .terms.map((x) => x.k),
    ).toEqual(['peace', 'vassal']);
    // And a vassal holds none: Ada, a vassal, wins over Lou, who capitulates to it, and cannot take it.
    expect(last(w.kit, 'pacts')!.vassals.map((v) => [v.vassal, v.overlord])).toEqual([
      [1, 2],
      [4, 3],
    ]);
  });
});

/** What a city rejoining is told (Kit's page reloads). */
function peek(w: World) {
  w.room.closed(w.kit.conn);
  w.kit = raw(w.room);
  w.kit.say(hello('Kit', { rejoin: { slot: 3, secret: w.secrets.Kit } }));
  return last(w.kit, 'rwelcome')!.friends!;
}

describe('the seat of power in a total war', () => {
  it('starts a hold that counts a point a game hour and conquers after 48, the loser a vassal', () => {
    const w = world();
    openWar(w, w.ada, SLOT.Sam, 'total');
    fight(w, w.ada, 1, w.sam, 2, 'raided', { decisive: 1, seatDown: true });
    expect(warOf(w.ada)!.hold).toEqual({ by: 1, since: w.clock.t, scored: w.clock.t });
    expect(last(w.kit, 'history')!.event.text).toBe(
      'Adaton holds Samton’s seat of power: in 6 minutes Samton falls, unless it wins a battle',
    );
    expect(notices(w.kit).at(-1)).toBe('Adaton holds Samton’s seat of power');
    // Four game hours (thirty seconds): two points an hour, counted when the room next looks.
    wait(w, 4 * FRIENDS.hour);
    expect(peek(w).wars[0]).toMatchObject({ score: 15 + 8, state: 'open' });
    // Held to the end: the city falls to the holder, in a treaty both apply (peace and vassalage).
    wait(w, DIPLOMACY.conquestHours * FRIENDS.hour);
    expect(warOf(w.ada)!.state).toBe('ended');
    const t = all(w.sam, 'tsign').at(-1)!;
    expect(t).toMatchObject({ id: 'w1-fall', a: 1, b: 2, imposed: true });
    expect(t.terms).toEqual([{ k: 'peace' }, { k: 'vassal' }]);
    expect(last(w.kit, 'pacts')!.vassals).toMatchObject([{ vassal: 2, overlord: 1 }]);
    expect(notices(w.kit)).toContain('Samton falls to Adaton');
  });

  it('is broken by a battle the other side wins, and then nothing falls', () => {
    const w = world();
    openWar(w, w.ada, SLOT.Sam, 'total');
    fight(w, w.ada, 1, w.sam, 2, 'raided', { decisive: 1, seatDown: true });
    // Samton repels the next raid.
    fight(w, w.ada, 1, w.sam, 2, 'repelled', { decisive: 0.2 });
    expect(warOf(w.ada)!.hold).toBeUndefined();
    expect(
      all(w.kit, 'history').find((h) => h.event.text.includes('takes back its seat of power')),
    ).toBeTruthy();
    wait(w, 2 * DIPLOMACY.conquestHours * FRIENDS.hour);
    expect(warOf(w.ada)!.state).toBe('open');
    expect(last(w.kit, 'pacts')).toBeUndefined();
    // A hold's own battle: the holder wins another, and the hold carries on from the first.
    const v = world();
    openWar(v, v.ada, SLOT.Sam, 'total');
    fight(v, v.ada, 1, v.sam, 2, 'raided', { seatDown: true });
    wait(v, 100_000);
    fight(v, v.sam, 2, v.ada, 1, 'repelled', { decisive: 1 });
    expect(warOf(v.ada)!.hold).toMatchObject({ by: 1 });
    wait(v, DIPLOMACY.conquestHours * FRIENDS.hour);
    expect(warOf(v.ada)!.state).toBe('ended');
  });

  it('starts only in a total war, from an attacker’s win, with the defender here', () => {
    const w = world();
    openWar(w, w.ada, SLOT.Sam, 'war');
    fight(w, w.ada, 1, w.sam, 2, 'raided', { seatDown: true });
    expect(warOf(w.ada)!.hold).toBeUndefined();
    const v = world();
    openWar(v, v.ada, SLOT.Sam, 'total');
    fight(v, v.ada, 1, v.sam, 2, 'raided', { seatDown: true, away: true });
    fight(v, v.ada, 1, v.sam, 2, 'repelled', { seatDown: true });
    expect(warOf(v.ada)!.hold).toBeUndefined();
    // A hold settles the war; the score alone doesn't capitulate while it stands.
    fight(v, v.ada, 1, v.sam, 2, 'raided', { seatDown: true, decisive: 1 });
    fight(v, v.sam, 2, v.ada, 1, 'raided', { decisive: 1 });
    fight(v, v.ada, 1, v.sam, 2, 'raided', { seatDown: true, decisive: 1 });
    expect(warOf(v.ada)!.hold).toBeTruthy();
  });
});

describe('a vassal rising', () => {
  it('goes to war against its overlord alone, and is free when it reaches +30 in that war', () => {
    const w = world();
    // Samton takes Adaton by holding its seat of power.
    openWar(w, w.sam, SLOT.Ada, 'total');
    fight(w, w.sam, 2, w.ada, 1, 'raided', { seatDown: true });
    wait(w, DIPLOMACY.conquestHours * FRIENDS.hour);
    expect(last(w.kit, 'pacts')!.vassals).toMatchObject([{ vassal: 1, overlord: 2 }]);
    // Adaton can rise once the cooldown after that war has passed, against Samton and no one else.
    w.clock.advance(FRIENDS.cooldown);
    declare(w, w.ada, SLOT.Kit);
    expect(declined(w.ada).at(-1)).toBe('A vassal can’t go to war, except to rise against its overlord');
    declare(w, w.ada, SLOT.Sam, { scale: 'total' });
    const war = warOf(w.ada)!;
    expect(war).toMatchObject({ a: 1, b: 2, scale: 'total', rebellion: true, state: 'declared' });
    expect(last(w.kit, 'history')!.event.text).toBe(
      'Adaton rises against Samton: a total war opens in 2 minutes',
    );
    wait(w, FRIENDS.warning + 1_000);
    // Its first win is not enough; its second, at +30, sets it free, in a treaty both apply.
    fight(w, w.ada, 1, w.sam, 2, 'raided', { decisive: 1 });
    expect(last(w.kit, 'pacts')?.vassals ?? []).toHaveLength(1);
    fight(w, w.ada, 1, w.sam, 2, 'raided', { decisive: 1 });
    const t = all(w.ada, 'tsign').at(-1)!;
    expect(t).toMatchObject({
      id: `w${war.id}-free`,
      a: 1,
      b: 2,
      imposed: true,
      terms: [{ k: 'independence' }],
    });
    expect(all(w.sam, 'tsign').at(-1)!.id).toBe(t.id);
    expect(last(w.kit, 'pacts')!.vassals).toEqual([]);
    expect(all(w.kit, 'history').some((h) => h.event.text === 'Adaton is free of Samton')).toBe(true);
    // The war goes on, as any other, and Adaton is nobody's vassal any more.
    const now = warOf(w.ada)!;
    expect(now).toMatchObject({ state: 'open', score: 30 });
    expect(now.rebellion).toBeUndefined();
    declare(w, w.ada, SLOT.Kit);
    expect(warOf(w.ada)).toMatchObject({ a: 1, b: 3 });
  });

  it('can be freed by a treaty, and a failed rising leaves it a vassal', () => {
    const w = world();
    openWar(w, w.sam, SLOT.Ada, 'total');
    fight(w, w.sam, 2, w.ada, 1, 'raided', { seatDown: true });
    wait(w, DIPLOMACY.conquestHours * FRIENDS.hour);
    // Independence is a term between an overlord and its vassal only.
    sign(w, w.sam, w.kit, SLOT.Kit, [{ k: 'independence' }], 'ind0');
    expect(refusals(w.sam).at(-1)).toBe('Neither city is the other’s vassal');
    w.clock.advance(FRIENDS.cooldown);
    openWar(w, w.ada, SLOT.Sam, 'total');
    for (let i = 0; i < 4; i++) fight(w, w.sam, 2, w.ada, 1, 'raided', { decisive: 1 });
    expect(warOf(w.ada)).toMatchObject({ state: 'capitulated', capitulated: { by: 1 } });
    // The overlord ends the rising on its terms; the city stays a vassal.
    breathe(w);
    w.sam.say({
      t: 'tprop',
      id: 'win',
      to: SLOT.Ada,
      terms: [{ k: 'tribute', payer: 'them', amount: 900, months: 6 }],
      imposed: true,
    });
    expect(
      all(w.ada, 'tsign')
        .at(-1)!
        .terms.map((x) => x.k),
    ).toEqual(['peace', 'tribute']);
    expect(last(w.kit, 'pacts')!.vassals).toMatchObject([{ vassal: 1, overlord: 2 }]);
    // Then the overlord grants it, by a treaty both sign.
    sign(w, w.sam, w.ada, SLOT.Ada, [{ k: 'independence' }], 'ind1');
    expect(all(w.ada, 'tsign').at(-1)).toMatchObject({ id: 'ind1', terms: [{ k: 'independence' }] });
    expect(last(w.kit, 'pacts')!.vassals).toEqual([]);
  });

  it('lets a won rising be settled by the vassal’s terms, which include its freedom', () => {
    const w = world();
    // Adaton is Samton's vassal through a treaty imposed after a total war it lost.
    openWar(w, w.sam, SLOT.Ada, 'total');
    for (let i = 0; i < 4; i++) fight(w, w.sam, 2, w.ada, 1, 'raided', { decisive: 1 });
    breathe(w);
    w.sam.say({ t: 'tprop', id: 'v', to: SLOT.Ada, terms: [{ k: 'vassal' }], imposed: true });
    w.clock.advance(FRIENDS.cooldown);
    // Adaton's rising wins before it is freed at +30? A single big battle jumps past +30 to +60.
    openWar(w, w.ada, SLOT.Sam, 'total');
    fight(w, w.ada, 1, w.sam, 2, 'raided', { decisive: 1, worth: 1_200_000 });
    expect(last(w.kit, 'pacts')!.vassals).toEqual([]);
    expect(warOf(w.sam)).toMatchObject({ state: 'capitulated', capitulated: { by: 2 }, score: 63 });
    // Free already, Adaton may take Samton as its vassal like any winner.
    breathe(w);
    w.ada.say({ t: 'tprop', id: 'rev', to: SLOT.Sam, terms: [{ k: 'vassal' }], imposed: true });
    expect(
      all(w.sam, 'tsign')
        .at(-1)!
        .terms.map((x) => x.k),
    ).toEqual(['peace', 'vassal']);
    expect(last(w.kit, 'pacts')!.vassals).toMatchObject([{ vassal: 2, overlord: 1 }]);
  });
});

describe('raids between cities at war', () => {
  it('are not held back by a newcomer’s shield once the war is open, but the day’s raids stay', () => {
    const w = world({ shield: { Sam: 'new' }, limits: { raidsPerDay: 3 } });
    const raid = (id: string) => {
      w.ada.say({ t: 'battle', to: SLOT.Sam, id, part: 0, parts: 1, data: 'X' });
      const r = last(w.ada, 'battleRefused');
      const kept = last(w.ada, 'battleKept');
      if (kept?.id === id) w.sam.say({ t: 'battleSeen', id, from: 1 });
      return kept?.id === id ? '(kept)' : r?.id === id ? r.reason : '(nothing)';
    };
    expect(raid('r0')).toBe('Samton is too young or small to raid, unless it strikes first');
    // The newcomer declares, as it may; until the war opens a raid is still not allowed.
    declare(w, w.sam, SLOT.Ada);
    expect(raid('r1')).toBe('The war with Samton opens in 2 minutes');
    wait(w, FRIENDS.warning + 1_000);
    expect(raid('r2')).toBe('(kept)');
    expect(raid('r3')).toBe('(kept)');
    expect(raid('r4')).toBe('(kept)');
    expect(raid('r5')).toBe(
      'Samton has been raided 3 times today: the region allows no more until midnight (UTC)',
    );
    // Back at peace, the shield is back.
    sign(w, w.ada, w.sam, SLOT.Sam, PEACE, 'peace');
    w.clock.advance(DAY_MS);
    expect(raid('r6')).toBe('Samton is too young or small to raid, unless it strikes first');
  });

  it('are the region’s to decide when a city is neutral: it is at war with no one', () => {
    const w = world({ shield: { Kit: 'neutral' } });
    declare(w, w.ada, SLOT.Kit);
    expect(declined(w.ada).at(-1)).toBe('Kitton is neutral');
    w.ada.say({ t: 'battle', to: SLOT.Kit, id: 'n1', part: 0, parts: 1, data: 'X' });
    expect(last(w.ada, 'battleRefused')!.reason).toBe('Kitton is neutral');
  });
});

describe('the region’s war history', () => {
  it('writes a line for each war event, in words, and sends it to every city as it happens and on joining', () => {
    const w = world();
    openWar(w, w.ada, SLOT.Sam, 'total');
    fight(w, w.ada, 1, w.sam, 2, 'raided', { decisive: 1 });
    sign(w, w.sam, w.ada, SLOT.Ada, [{ k: 'ceasefire', hours: 12 }]);
    // A line sent again with its id (the battle's, completed by its result) replaces the first.
    const byId = new Map(all(w.lou, 'history').map((h) => [h.event.id, h.event]));
    const lines = [...byId.values()];
    expect(lines.map((e) => e.kind)).toEqual(['declared', 'opened', 'battle', 'treaty']);
    expect(lines.map((e) => e.id)).toEqual([1, 2, 3, 4]);
    expect(lines.map((e) => e.text)).toEqual([
      expect.stringMatching(/^Adaton declares a total war on Samton: “An old feud”\. It opens in 2 minutes$/),
      'The war between Adaton and Samton has begun',
      'Adaton raided Samton: the raid succeeded. War score: Adaton +15',
      'Samton and Adaton sign a treaty: a ceasefire for 12 hours',
    ]);
    // Everyone has them when joining.
    expect(peek(w).history.map((e) => e.id)).toEqual([1, 2, 3, 4]);
    // The room restarted still has them.
    const sam = raw(w.room);
    sam.say(hello('Sam', { rejoin: { slot: 2, secret: w.secrets.Sam } }));
    expect(last(sam, 'rwelcome')!.friends!.history).toHaveLength(4);
  });

  it('writes a battle once: the line made when it was kept is completed by its result', () => {
    const w = world();
    w.ada.say({ t: 'battle', to: SLOT.Sam, id: 'k1', part: 0, parts: 1, data: 'X' });
    const kept = last(w.kit, 'history')!.event;
    expect(kept).toMatchObject({
      kind: 'battle',
      a: 1,
      b: 2,
      text: 'Adaton raids Samton',
      battle: { from: 1, id: 'k1' },
    });
    expect(kept.outcome).toBeUndefined();
    w.sam.say({ t: 'battleSeen', id: 'k1', from: 1 });
    w.sam.say({ t: 'battleResult', id: 'k1', from: 1, to: 2, outcome: 'repelled' });
    const done = last(w.kit, 'history')!.event;
    expect(done).toMatchObject({
      id: kept.id,
      outcome: 'repelled',
      text: 'Adaton raided Samton: the raid was repelled',
    });
    expect(peek(w).history).toHaveLength(1);
  });

  it('writes a live battle’s end, and its result completes it', () => {
    const w = world();
    w.ada.say({ t: 'blive', to: SLOT.Sam, id: 'L1', force: { name: 'Adaton', units: [1] } });
    w.sam.say({ t: 'binput', id: 'L1', part: 0, parts: 1, data: 'INPUT' });
    w.ada.say({ t: 'bdone', id: 'L1', step: 700, hash: 'abc' });
    w.sam.say({ t: 'bdone', id: 'L1', step: 700, hash: 'abc' });
    const line = last(w.lou, 'history')!.event;
    expect(line).toMatchObject({
      kind: 'battle',
      a: 1,
      b: 2,
      text: 'Adaton and Samton fought a live battle',
      battle: { from: 1, id: 'L1', live: true },
    });
    w.sam.say({ t: 'battleResult', id: 'L1', from: 1, to: 2, outcome: 'raided', decisive: 0.3 });
    expect(last(w.lou, 'history')!.event).toMatchObject({ id: line.id, outcome: 'raided' });
    // A live battle that ended with the two pages disagreeing says so.
    w.ada.say({ t: 'blive', to: SLOT.Sam, id: 'L2', force: { name: 'Adaton', units: [1] } });
    w.sam.say({ t: 'binput', id: 'L2', part: 0, parts: 1, data: 'INPUT' });
    w.ada.say({ t: 'bdone', id: 'L2', step: 700, hash: 'abc' });
    w.sam.say({ t: 'bdone', id: 'L2', step: 700, hash: 'xyz' });
    expect(last(w.lou, 'history')!.event.text).toBe(
      'Adaton and Samton fought a live battle (the two pages saw it end differently)',
    );
  });

  it('keeps the last hundred, oldest first', () => {
    const w = world();
    for (let i = 1; i <= 105; i++) {
      const id = `h${i}`;
      w.ada.say({ t: 'battle', to: SLOT.Sam, id, part: 0, parts: 1, data: 'X' });
      w.sam.say({ t: 'battleSeen', id, from: 1 });
    }
    const f = peek(w);
    expect(f.history).toHaveLength(FRIENDS.history);
    expect(f.history[0]!.id).toBe(6);
    expect(f.history.at(-1)!.id).toBe(105);
    expect(f.history[0]!.battle!.id).toBe('h6');
    // A result for one that has been dropped is still a line, and the count holds.
    w.sam.say({ t: 'battleResult', id: 'h2', from: 1, to: 2, outcome: 'raided' });
    expect(peek(w).history).toHaveLength(FRIENDS.history);
  });
});

describe('older pages and the war switch', () => {
  it('leave protocol-5 pages out of it: they hear nothing, say nothing that counts, and can’t be warred on', () => {
    const w = world({ v: { Kit: 5 } });
    expect(last(w.kit, 'rwelcome')!.friends).toBeUndefined();
    openWar(w, w.ada, SLOT.Sam);
    sign(w, w.ada, w.sam, SLOT.Sam, PEACE, 'pc');
    fight(w, w.sam, 2, w.ada, 1, 'raided');
    const types = new Set(w.kit.got.map((m) => m.t));
    for (const t of ['war', 'tsign', 'tprop', 'trefused', 'pacts', 'history', 'wrefused'] as const)
      expect(types.has(t), t).toBe(false);
    // Raids work for it as ever; its notices are the region's, not the friends' ones.
    expect(notices(w.kit).filter((n) => /declares war|capitulates/.test(n))).toEqual([]);
    w.kit.say({ t: 'battle', to: SLOT.Lou, id: 'old', part: 0, parts: 1, data: 'X' });
    expect(last(w.kit, 'battleKept')!.id).toBe('old');
    // A treaty with it is refused, and if it is the one that is away it gets the same.
    breathe(w);
    w.ada.say({ t: 'tprop', id: 'to-old', to: SLOT.Kit, terms: [{ k: 'trade' }] });
    expect(refusals(w.ada).at(-1)).toBe(
      'Kitton’s page is an older version, which can’t sign treaties with friends',
    );
    // A page that upgrades is a friend: its version is the one it last said, even when it is away.
    w.room.closed(w.kit.conn);
    declare(w, w.ada, SLOT.Kit);
    expect(declined(w.ada).at(-1)).toMatch(/older version/);
    const kit = raw(w.room);
    kit.say(hello('Kit', { rejoin: { slot: 3, secret: w.secrets.Kit } }));
    expect(last(kit, 'rwelcome')!.friends).toBeTruthy();
    w.room.closed(kit.conn);
    declare(w, w.ada, SLOT.Kit);
    expect(warOf(w.ada)).toMatchObject({ a: 1, b: 3 });
  });

  it('turns war off for every war between friends: plain peace, and the cooldown starts', () => {
    const w = world();
    openWar(w, w.ada, SLOT.Sam);
    openWar(w, w.kit, SLOT.Lou, 'total');
    w.ada.say({ t: 'rrules', rules: { war: false, scale: 'skirmish' } });
    for (const r of [w.ada, w.sam, w.kit, w.lou]) expect(warOf(r)!.state).toBe('ended');
    expect(all(w.ada, 'tsign').at(-1)).toMatchObject({
      id: 'w1-off',
      terms: [{ k: 'peace' }],
      imposed: true,
    });
    expect(all(w.lou, 'tsign').at(-1)!.id).toBe('w2-off');
    expect(peek(w).wars).toEqual([]);
  });
});

describe('what the room keeps', () => {
  it('is rebuilt from its record: wars, pacts, proposals, treaties not yet seen, vassals and cooldowns', () => {
    const w = world();
    openWar(w, w.ada, SLOT.Sam);
    sign(w, w.sam, w.ada, SLOT.Ada, PEACE, 'pc');
    openWar(w, w.kit, SLOT.Lou, 'total');
    sign(w, w.ada, w.sam, SLOT.Sam, [{ k: 'alliance' }], 'al');
    fight(w, w.kit, 3, w.lou, 4, 'raided', { decisive: 1, worth: 500_000 });
    breathe(w);
    w.ada.say({ t: 'tprop', id: 'wait', to: SLOT.Kit, terms: [{ k: 'trade' }] });
    for (const r of [w.ada, w.sam, w.kit, w.lou]) w.room.closed(r.conn);
    // A new room on the same record.
    const room = new RegionRoom('7FRND1', 'local', w.store, { now: w.clock.now, later: w.clock.later }, BUSY);
    const kit = raw(room);
    kit.say(hello('Kit', { rejoin: { slot: 3, secret: w.secrets.Kit } }));
    const f = last(kit, 'rwelcome')!.friends!;
    expect(f.wars).toHaveLength(1);
    expect(f.wars[0]).toMatchObject({ a: 3, b: 4, scale: 'total', state: 'open', score: 35, battles: 1 });
    expect(f.pacts.map((p) => p.kind)).toEqual(['alliance']);
    expect(f.history.length).toBeGreaterThan(5);
    // The proposal Kit has to answer, and the treaties it hasn't applied, follow.
    expect(all(kit, 'tprop').map((p) => p.id)).toEqual(['wait']);
    expect(all(kit, 'tsign').map((t) => t.id)).toEqual([]);
    const sam = raw(room);
    sam.say(hello('Sam', { rejoin: { slot: 2, secret: w.secrets.Sam } }));
    expect(all(sam, 'tsign').map((t) => t.id)).toEqual(['pc', 'al']);
    // The cooldown after the first war is kept; the second war goes on where it was.
    sam.say(report('Samton'));
    const ada = raw(room);
    ada.say(hello('Ada', { rejoin: { slot: 1, secret: w.secrets.Ada } }));
    ada.say(report('Adaton'));
    ada.say({ t: 'wdeclare', to: SLOT.Sam, scale: 'war', reason: '' });
    expect(all(ada, 'wrefused').at(-1)!.why).toMatch(/^The last war with Samton ended too recently/);
  });

  it('is only the record: no timers of its own, and the region broadcast carries none of it', () => {
    const w = world();
    openWar(w, w.ada, SLOT.Sam);
    fight(w, w.ada, 1, w.sam, 2, 'raided', { decisive: 1 });
    sign(w, w.ada, w.sam, SLOT.Sam, [{ k: 'ceasefire', hours: 12 }]);
    // Saves are the room's one timer, and an idle room holds none.
    w.clock.advance(10 * 60_000);
    expect(w.clock.pending).toBe(0);
    const view = JSON.stringify(last(w.kit, 'region'));
    expect(view).not.toMatch(/ceasefire|"score"|"wars"|"pacts"|"queue"/);
    const size = JSON.stringify(w.store.meta).length;
    expect(size).toBeLessThan(200_000);
  });
});

describe('online and peer-to-peer alike', () => {
  it('runs the same in a host’s browser: a war on an away player, a proposal kept in memory for it, no raid on it', () => {
    const w = world({ kind: 'p2p' });
    w.room.closed(w.sam.conn);
    // Nothing stops a declaration, or a proposal, on a player who is away.
    declare(w, w.ada, SLOT.Sam);
    expect(warOf(w.ada)).toMatchObject({ a: 1, b: 2, state: 'declared' });
    breathe(w);
    w.ada.say({ t: 'tprop', id: 'away', to: SLOT.Sam, terms: PEACE });
    wait(w, FRIENDS.warning + 1_000);
    expect(warOf(w.ada)!.state).toBe('open');
    // But the host keeps nothing for it: a raid needs its player here, as for any raid there.
    w.ada.say({ t: 'battle', to: SLOT.Sam, id: 'p2p1', part: 0, parts: 1, data: 'X' });
    expect(last(w.ada, 'battleRefused')!.reason).toMatch(
      /player isn’t here, and this region keeps nothing for them/,
    );
    // It comes back to a war that has opened, a proposal to answer, and the history.
    const sam = raw(w.room);
    sam.say(hello('Sam', { rejoin: { slot: 2, secret: w.secrets.Sam } }));
    expect(last(sam, 'rwelcome')!.friends!.wars[0]).toMatchObject({ state: 'open' });
    expect(all(sam, 'tprop').map((p) => p.id)).toEqual(['away']);
    sam.say({ t: 'tans', id: 'away', accept: true });
    expect(all(sam, 'tsign')).toHaveLength(1);
    expect(warOf(w.ada)!.state).toBe('ended');
  });
});

describe('the free plan', () => {
  /**
   * An evening: three hours, four cities reporting every thirty seconds, two wars (Adaton and Samton
   * trade three raids each and make a ceasefire, then peace and a pact; Kitton beats Louton, who
   * capitulates, and is its overlord), an alliance and a trade agreement afterwards; every city
   * applies each treaty at once. Under the real limits (three raids a day for a city, a battle every
   * five minutes).
   */
  function evening(wars: boolean): { rows: number; world: World } {
    const real = {
      rate: 1_000,
      burst: 100_000,
      raidsPerDay: REGION_LIMITS.raidsPerDay,
      battleBurst: REGION_LIMITS.battleBurst,
      dailyRows: REGION_LIMITS.dailyRows,
    };
    const w = world({ limits: real });
    const cities: [Raw, string][] = [
      [w.ada, 'Adaton'],
      [w.sam, 'Samton'],
      [w.kit, 'Kitton'],
      [w.lou, 'Louton'],
    ];
    const agreed = (from: Raw, to: Raw, toSlot: number, terms: object[], id: string) => {
      from.say({ t: 'tprop', id, to: toSlot, terms });
      to.say({ t: 'tans', id, accept: true });
      for (const r of [from, to]) r.say({ t: 'tseen', id });
    };
    const raid = (
      a: Raw,
      aSlot: number,
      d: Raw,
      dSlot: number,
      outcome: 'raided' | 'repelled',
      worth = 0,
    ) => {
      const id = `e${++battleN}`;
      a.say({ t: 'battle', to: dSlot, id, part: 0, parts: 1, data: 'INPUT' });
      d.say({ t: 'battleSeen', id, from: aSlot });
      d.say({ t: 'battleResult', id, from: aSlot, to: dSlot, outcome, decisive: 0.6, worth });
    };
    const rows0 = w.store.rowsWritten;
    for (let minute = 0; minute < 180; minute++) {
      for (const half of [0, 1]) {
        for (const [r, name] of cities) r.say(report(name, {}));
        if (half === 0) w.clock.advance(30_000);
        else w.clock.advance(30_000);
      }
      if (!wars) continue;
      switch (minute) {
        case 2:
          w.ada.say({ t: 'wdeclare', to: 2, scale: 'war', reason: 'An old feud' });
          w.kit.say({ t: 'wdeclare', to: 4, scale: 'total', reason: 'Your border is ours' });
          break;
        case 10:
        case 24:
        case 38:
          raid(w.ada, 1, w.sam, 2, 'raided');
          raid(w.sam, 2, w.ada, 1, 'repelled');
          break;
        case 12:
        case 26:
          raid(w.kit, 3, w.lou, 4, 'raided', 800_000);
          break;
        case 50:
          // Louton has capitulated (two raids of 15 and 32 points each); Kitton sets its terms.
          w.kit.say({
            t: 'tprop',
            id: 'fall',
            to: 4,
            terms: [{ k: 'vassal' }, { k: 'tribute', payer: 'them', amount: 900, months: 24 }],
            imposed: true,
          });
          for (const r of [w.kit, w.lou]) r.say({ t: 'tseen', id: 'fall' });
          break;
        case 60:
          agreed(w.sam, w.ada, 1, [{ k: 'ceasefire', hours: 72 }], 'cf');
          break;
        case 75:
          agreed(w.ada, w.sam, 2, [{ k: 'peace' }, { k: 'nonAggression', months: 60 }], 'pe');
          break;
        case 100:
          agreed(w.ada, w.kit, 3, [{ k: 'alliance' }], 'al');
          break;
        case 120:
          agreed(w.sam, w.kit, 3, [{ k: 'trade' }, { k: 'reparations', payer: 'us', amount: 2_000 }], 'tr');
          break;
      }
    }
    return { rows: w.store.rowsWritten - rows0, world: w };
  }

  it('an evening of war between four cities (two wars, eight raids, four treaties) writes about 70 rows, 38 of them for the war: a fortieth of the day’s allowance', () => {
    const calm = evening(false);
    const war = evening(true);
    // The evening really happened.
    const f = peek(war.world);
    expect(f.wars).toEqual([]);
    expect(f.pacts.map((p) => p.kind).sort()).toEqual(['alliance', 'nonAggression', 'trade']);
    expect(f.vassals).toMatchObject([{ vassal: 4, overlord: 3 }]);
    expect(f.history.length).toBeGreaterThan(15);
    // Rows: what the same evening costs without a war, and what the war adds (battles are rows of their
    // own, kept until their city has seen them; the region's record is one row each time it is written).
    console.log(
      `evening: ${calm.rows} rows without war, ${war.rows} with it (${war.rows - calm.rows} for the war)`,
    );
    expect(war.rows - calm.rows).toBeLessThan(80);
    expect(war.rows).toBeLessThan(REGION_LIMITS.dailyRows / 20);
  });

  it('can’t be made to write more than a trickle by a script cycling proposals and declines', () => {
    const w = world({ limits: { rate: 1_000, burst: 100_000, dailyRows: REGION_LIMITS.dailyRows } });
    const rows0 = w.store.rowsWritten;
    for (let i = 0; i < 1_800; i++) {
      // Two friends at their fastest: a proposal every 5 s (the room's pace for it) and a decline.
      w.clock.advance(FRIENDS.actEvery);
      w.ada.say({ t: 'tprop', id: `s${i}`, to: SLOT.Sam, terms: [{ k: 'trade' }] });
      w.sam.say({ t: 'tans', id: `s${i}`, accept: false });
    }
    // Two and a half hours of it: proposals and declines are written along with the region's slower pace
    // of five minutes, not at every move.
    const rows = w.store.rowsWritten - rows0;
    console.log(`2.5 h of proposals and declines: ${rows} rows`);
    expect(rows).toBeLessThan(REGION_LIMITS.dailyRows / 20);
  });
});

describe('the module alone', () => {
  it('reads the room’s clock only, and makes no state until it has something to keep', () => {
    const host: { friends?: ReturnType<typeof emptyFriends> } = {};
    const cx: FwContext = {
      now: 1_000,
      rules: { war: true, scale: 'total' },
      city: () => undefined,
      struck: () => false,
      battleKnown: () => false,
    };
    const fw = new FriendsWar(host, cx);
    fw.tick();
    expect(fw.raidBlock(1, 2)).toBeNull();
    expect(fw.atWar(1, 2)).toBe(false);
    expect(fw.out).toEqual([]);
    expect(host.friends).toBeUndefined();
    fw.declare(1, { to: 2, scale: 'war', reason: '' });
    expect(fw.out[0]!.msg).toMatchObject({ t: 'wrefused', why: 'That city isn’t in the region' });
    expect(
      termsFor([{ k: 'tribute', payer: 'us', amount: 500, months: 3 }, { k: 'peace' }] as FriendTerm[], 'b'),
    ).toEqual([{ k: 'tribute', payer: 'them', amount: 500, months: 3 }, { k: 'peace' }]);
    expect(REGION_LIMITS.dailyRows).toBe(3000);
  });
});
