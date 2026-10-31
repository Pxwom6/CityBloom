import { describe, expect, it } from 'vitest';
import {
  MemoryRegionStore,
  RegionRoom,
  parseRegionMsg,
  type RegionConn,
  type RegionLimits,
  type RegionRoomMsg,
} from '../region';
import {
  FRIENDS,
  LIVE,
  PLAYER_COLORS,
  PROTOCOL_VERSION,
  helpSideOf,
  helpTravelOf,
  helpUnitId,
  isHelpUnitId,
} from '../protocol';
import { DAY_MS } from '../limits';
import { LiveSession } from '../live';
import { helpAlliesOf } from '../../src/ui/helpView';
import { BATTLE } from '../../src/data/battle';
import { FakeClock } from './harness';

/**
 * M39, step 6: allies sending help into a live battle, as the region room keeps it (protocol 6, design
 * call 7). A city with an alliance (with either combatant) or a defensive pact (with the one attacked)
 * sends units with `bhelp`; the room checks the pact and the battle, stamps the force into the battle's
 * log at the frontier like an order (a `help` entry with its own `seq`), puts its arrival 30 seconds of
 * play on, tells every page in the battle, and makes the helper's own page a watcher.
 */

interface Raw {
  got: RegionRoomMsg[];
  conn: RegionConn;
  say(m: object): void;
}

function raw(room: RegionRoom): Raw {
  const r: Raw = {
    got: [],
    conn: null as unknown as RegionConn,
    say: (m) => room.message(r.conn, JSON.stringify(m)),
  };
  r.conn = { send: (m) => r.got.push(m), close: () => undefined };
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

const BUSY: Partial<RegionLimits> = { rate: 1_000, burst: 100_000, raidsPerDay: 1_000, battleBurst: 1_000 };
const SLOT = { Ada: 1, Sam: 2, Kit: 3, Lou: 4 } as const;
type Who = keyof typeof SLOT;

interface World {
  clock: FakeClock;
  room: RegionRoom;
  ada: Raw;
  sam: Raw;
  kit: Raw;
  lou: Raw;
}

/** Ada, Sam, Kit and Lou (slots 1 to 4), each reported, at war on (a region's rules) unless said. */
function world(opts: { war?: boolean; shield?: Partial<Record<Who, 'new' | 'neutral'>> } = {}): World {
  const clock = new FakeClock();
  clock.advance(((Math.ceil(clock.t / DAY_MS) * DAY_MS - clock.t) % DAY_MS) + 12 * 3600_000);
  const room = new RegionRoom(
    '7HELP1',
    'local',
    new MemoryRegionStore(),
    { now: clock.now, later: clock.later },
    BUSY,
  );
  const out: Partial<Record<Who, Raw>> = {};
  for (const who of ['Ada', 'Sam', 'Kit', 'Lou'] as const) {
    const r = raw(room);
    r.say(
      hello(who, {
        color: SLOT[who] - 1,
        ...(who === 'Ada'
          ? { create: { name: 'Vale', rules: { war: opts.war ?? true, scale: 'total', supers: true } } }
          : {}),
      }),
    );
    const shield = opts.shield?.[who];
    r.say(report(`${who}ton`, shield ? { shield } : {}));
    out[who] = r;
  }
  return { clock, room, ada: out.Ada!, sam: out.Sam!, kit: out.Kit!, lou: out.Lou! };
}

const breathe = (w: World) => w.clock.advance(FRIENDS.actEvery);
let n = 0;
/** `from` proposes `terms` to `to`, who accepts. */
function sign(w: World, from: Raw, to: Raw, toSlot: number, terms: object[]): void {
  breathe(w);
  const id = `t${++n}`;
  from.say({ t: 'tprop', id, to: toSlot, terms });
  to.say({ t: 'tans', id, accept: true });
}

const FORCE = { name: 'Adaton', units: [1, 2, 3], stance: 'bold' };
/** Ada attacks Sam live, and Sam answers: both are in it, the frontier at the lead. */
function fight(w: World, id = 'L1'): void {
  w.ada.say({ t: 'blive', to: SLOT.Sam, id, force: FORCE });
  w.sam.say({ t: 'binput', id, part: 0, parts: 1, data: 'INPUT-A' });
}
const step = (id: string, k: number, orders?: object[]) => ({
  t: 'bstep',
  id,
  step: k,
  ...(orders ? { orders } : {}),
});

/** Both combatants report `k` steps (the frontier follows by the lead). */
function reach(w: World, id: string, k: number): void {
  w.clock.advance(500);
  w.ada.say(step(id, k));
  w.sam.say(step(id, k));
}

/** The frontier as the combatants last heard it. */
const frontier = (w: World): number => last(w.ada, 'ballow')?.allow ?? LIVE.lead;

/** Both pages run to step `k` (a page may run only to the frontier, so this takes several rounds). */
function runTo(w: World, id: string, k: number): void {
  for (let guard = 0; guard < 400 && frontier(w) < k + LIVE.lead; guard++) reach(w, id, k);
}

/** An ally's units: ids `helpUnitId(slot, k)`. */
const units = (slot: number, count = 3, kind = 'tank') =>
  Array.from({ length: count }, (_, k) => ({ id: helpUnitId(slot, k), kind, hp: 1 }));
const help = (slot: number, id = 'L1', extra: Record<string, unknown> = {}) => ({
  t: 'bhelp',
  id,
  units: units(slot),
  ...extra,
});

describe('M39 step 6: allies sending help into a live battle', () => {
  it('reads only sensible help messages', () => {
    const ok = [
      { t: 'bhelp', id: 'L1', units: units(3) },
      { t: 'bhelp', id: 'L1', from: 1, units: units(3, 24, 'infantry'), route: 'sea' },
      { t: 'bhelp', id: 'L1', units: units(3, 1), route: 'air', mods: { land: { hp: 1.1 } } },
    ];
    for (const m of ok) expect(parseRegionMsg(JSON.stringify(m)), JSON.stringify(m).slice(0, 80)).toEqual(m);
    // A name and a colour are the room's to say, not the page's: dropped, not passed on.
    expect(
      parseRegionMsg(JSON.stringify({ t: 'bhelp', id: 'L1', units: units(3, 1), name: 'Bob', color: 5 })),
    ).toEqual({ t: 'bhelp', id: 'L1', units: units(3, 1) });
    // Health is kept to three places.
    expect(
      parseRegionMsg(
        JSON.stringify({
          t: 'bhelp',
          id: 'L1',
          units: [{ id: helpUnitId(3, 0), kind: 'tank', hp: 0.123456 }],
        }),
      ),
    ).toMatchObject({ units: [{ id: helpUnitId(3, 0), kind: 'tank', hp: 0.123 }] });
    const u = units(3, 1);
    const bad: object[] = [
      { t: 'bhelp', id: 'has spaces', units: u },
      { t: 'bhelp', id: 'L1' },
      { t: 'bhelp', id: 'L1', units: [] },
      { t: 'bhelp', id: 'L1', units: 'tank' },
      { t: 'bhelp', id: 'L1', units: units(3, LIVE.helpUnits + 1) },
      { t: 'bhelp', id: 'L1', from: 0, units: u },
      { t: 'bhelp', id: 'L1', units: [{ id: helpUnitId(3, 0), kind: 'dragon', hp: 1 }] },
      // A superweapon never goes.
      { t: 'bhelp', id: 'L1', units: [{ id: helpUnitId(3, 0), kind: 'skyfortress', hp: 1 }] },
      { t: 'bhelp', id: 'L1', units: [{ id: helpUnitId(3, 0), kind: 'tank', hp: 1.5 }] },
      { t: 'bhelp', id: 'L1', units: [{ id: 0.5, kind: 'tank', hp: 1 }] },
      { t: 'bhelp', id: 'L1', units: [{ id: 2e6, kind: 'tank', hp: 1 }] },
      // The old numbering (`slot × 10,000 + k`) is a city's own range now: a helper's ids are above any it mints.
      { t: 'bhelp', id: 'L1', units: [{ id: 30_000, kind: 'tank', hp: 1 }] },
      { t: 'bhelp', id: 'L1', units: [{ id: helpUnitId(65, 0), kind: 'tank', hp: 1 }] },
      // A route is one of the table's own names, not whatever an object answers to.
      ...['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'].map((route) => ({
        t: 'bhelp',
        id: 'L1',
        units: u,
        route,
      })),
      { t: 'bhelp', id: 'L1', units: [{ id: helpUnitId(3, 0), hp: 1 }] },
      { t: 'bhelp', id: 'L1', units: [7] },
      { t: 'bhelp', id: 'L1', units: u, route: 'teleport' },
      { t: 'bhelp', id: 'L1', units: u, mods: [] },
      { t: 'bhelp', id: 'L1', units: u, mods: { pad: 'x'.repeat(2_000) } },
    ];
    for (const m of bad) expect(parseRegionMsg(JSON.stringify(m)), JSON.stringify(m).slice(0, 80)).toBeNull();
  });

  it('an ally of the defender sends help: stamped at the frontier after the orders, sent to every page, arriving 30 s on', () => {
    const w = world();
    sign(w, w.sam, w.kit, SLOT.Kit, [{ k: 'alliance' }]);
    fight(w);
    // An order from the attacker first: the log's numbers are one sequence for orders and help.
    reach(w, 'L1', 10);
    w.ada.say(step('L1', 10, [{ kind: 'hold' }]));
    const frontier = last(w.ada, 'ballow')!.allow;
    expect(frontier).toBe(10 + LIVE.lead);
    w.kit.say(help(SLOT.Kit));
    // Kit's page is made a watcher: it gets the battle as it stands, the help in its log.
    const start = last(w.kit, 'bstart')!;
    expect(start).toMatchObject({ id: 'L1', role: 'watcher', attacker: 1, defender: 2, input: ['INPUT-A'] });
    expect(start.allow).toBe(frontier);
    expect(start.orders.map((o) => [o.seq, o.kind])).toEqual([
      [1, 'hold'],
      [2, 'help'],
    ]);
    const entry = start.orders[1]!;
    expect(entry).toMatchObject({
      seq: 2,
      step: frontier,
      side: 1,
      kind: 'help',
      helper: {
        owner: SLOT.Kit,
        name: 'Kitton',
        color: Number.parseInt(PLAYER_COLORS[SLOT.Kit - 1]!.slice(1), 16),
        side: 1,
        arrive: frontier + LIVE.helpTravel.highway,
      },
    });
    expect(entry.helper!.units).toEqual(units(SLOT.Kit));
    expect(LIVE.helpTravel.highway).toBe(480);
    // Both combatants hear it, and so does the helper's page; each with the same entry.
    for (const r of [w.ada, w.sam, w.kit]) {
      const heard = all(r, 'ballow')
        .flatMap((b) => b.ords ?? [])
        .filter((o) => o.kind === 'help');
      expect(heard, 'a help entry').toEqual([entry]);
    }
    // And a notice saying who, how many and when.
    for (const r of [w.ada, w.sam, w.kit])
      expect(notices(r)).toContain('Kitton sends 3 units to help Samton: they arrive in about 30 seconds');
    // A page coming back to the battle is given the log with the help in it.
    w.sam.say({ t: 'bjoin', id: 'L1' });
    expect(last(w.sam, 'bstart')!.orders.map((o) => o.kind)).toEqual(['hold', 'help']);
    // Lou, not watching, is not in the battle's messages.
    expect(all(w.lou, 'bstart')).toHaveLength(0);
  });

  it('an alliance with the attacker sends help to the attacker, by sea it takes 45 s, and a page already watching is not sent the battle twice', () => {
    const w = world();
    sign(w, w.ada, w.lou, SLOT.Lou, [{ k: 'alliance' }]);
    fight(w);
    w.lou.say({ t: 'bwatch', id: 'L1' });
    expect(all(w.lou, 'bstart')).toHaveLength(1);
    reach(w, 'L1', 64);
    w.lou.say(help(SLOT.Lou, 'L1', { route: 'sea' }));
    expect(all(w.lou, 'bstart')).toHaveLength(1);
    const entry = all(w.lou, 'ballow').flatMap((b) => b.ords ?? [])[0]!;
    expect(entry).toMatchObject({ side: 0, helper: { owner: SLOT.Lou, side: 0, route: 'sea' } });
    expect(entry.helper!.arrive - entry.step).toBe(LIVE.helpTravel.sea);
    expect(notices(w.sam).at(-1)).toBe(
      'Louton sends 3 units to help Adaton: they arrive in about 45 seconds',
    );
  });

  it('a defensive pact is for the friend attacked, not the one attacking', () => {
    const w = world();
    sign(w, w.sam, w.kit, SLOT.Kit, [{ k: 'defensivePact' }]);
    sign(w, w.ada, w.lou, SLOT.Lou, [{ k: 'defensivePact' }]);
    fight(w);
    w.lou.say(help(SLOT.Lou));
    expect(last(w.lou, 'bhelpoff')!.why).toBe(
      'A defensive pact is for a friend who is attacked: Adaton is the one attacking',
    );
    w.kit.say(help(SLOT.Kit));
    expect(all(w.kit, 'bhelpoff')).toHaveLength(0);
    expect(
      all(w.sam, 'ballow')
        .flatMap((b) => b.ords ?? [])
        .map((o) => [o.kind, o.side]),
    ).toEqual([['help', 1]]);
  });

  it('turns help down, with a reason', () => {
    const w = world();
    sign(w, w.sam, w.kit, SLOT.Kit, [{ k: 'alliance' }]);
    // No such battle, and a call not answered yet.
    w.kit.say(help(SLOT.Kit, 'nope'));
    expect(last(w.kit, 'bhelpoff')).toEqual({
      t: 'bhelpoff',
      id: 'nope',
      why: 'That battle isn’t on any more',
    });
    w.ada.say({ t: 'blive', to: SLOT.Sam, id: 'L1', force: FORCE });
    w.kit.say(help(SLOT.Kit));
    expect(last(w.kit, 'bhelpoff')!.why).toBe('That battle hasn’t started yet');
    w.sam.say({ t: 'binput', id: 'L1', part: 0, parts: 1, data: 'INPUT-A' });
    reach(w, 'L1', 10);
    const refused = (r: Raw, m: object) => {
      const before = all(r, 'bhelpoff').length;
      r.say(m);
      const got = all(r, 'bhelpoff');
      return got.length > before ? got.at(-1)!.why : null;
    };
    // A combatant can't send help to its own battle; a city with no pact can't either.
    expect(refused(w.sam, help(SLOT.Sam))).toBe('Your own forces are in that battle: they can’t help it');
    expect(refused(w.lou, help(SLOT.Lou))).toBe(
      'Only an ally can send help: you have no alliance or defensive pact with Adaton or Samton',
    );
    // Units that aren't this city's, or repeat.
    expect(refused(w.kit, help(SLOT.Lou))).toBe('Those units could not be read');
    expect(
      refused(w.kit, { t: 'bhelp', id: 'L1', units: [...units(SLOT.Kit, 2), ...units(SLOT.Kit, 1)] }),
    ).toBe('Those units could not be read');
    // A pact with the other side stands in the way: Kit's non-aggression pact with Ada.
    sign(w, w.kit, w.ada, SLOT.Ada, [{ k: 'nonAggression', months: 6 }]);
    expect(refused(w.kit, help(SLOT.Kit))).toBe(
      'That breaks your non-aggression pact with Adaton: end it first',
    );
    // Allied to both: neither.
    const b = world();
    sign(b, b.sam, b.kit, SLOT.Kit, [{ k: 'alliance' }]);
    sign(b, b.ada, b.kit, SLOT.Kit, [{ k: 'alliance' }]);
    fight(b);
    expect(refused(b.kit, help(SLOT.Kit))).toBe(
      'You have pacts with both Adaton and Samton: you can’t take sides',
    );
    // A neutral city sends no forces.
    const nw = world({ shield: { Kit: 'neutral' } });
    sign(nw, nw.sam, nw.kit, SLOT.Kit, [{ k: 'alliance' }]);
    fight(nw);
    expect(refused(nw.kit, help(SLOT.Kit))).toBe('A neutral city sends no forces');
    // War off in the region.
    const off = world({ war: false });
    off.kit.say(help(SLOT.Kit));
    expect(last(off.kit, 'bhelpoff')!.why).toBe('War is off in this region');
  });

  it('one force from a city, and none from a city in a battle of its own', () => {
    const w = world();
    sign(w, w.sam, w.kit, SLOT.Kit, [{ k: 'alliance' }]);
    sign(w, w.sam, w.lou, SLOT.Lou, [{ k: 'alliance' }]);
    fight(w);
    w.kit.say(help(SLOT.Kit));
    expect(all(w.kit, 'bhelpoff')).toHaveLength(0);
    w.kit.say(help(SLOT.Kit));
    expect(last(w.kit, 'bhelpoff')!.why).toBe('Your force is helping in that battle already');
    // Lou has a battle of its own, against Kit: it can't send its force into this one.
    w.lou.say({ t: 'blive', to: SLOT.Kit, id: 'L2', force: FORCE });
    expect(last(w.lou, 'bliveoff')).toBeUndefined();
    w.kit.say({ t: 'binput', id: 'L2', part: 0, parts: 1, data: 'INPUT-B' });
    w.lou.say(help(SLOT.Lou));
    expect(last(w.lou, 'bhelpoff')!.why).toBe('Louton is in a live battle already');
  });

  it('refuses help that could not arrive before the battle ends', () => {
    const late = LIVE.lastStep - LIVE.helpTravel.highway;
    // At the last frontier it can still make (arriving on the battle's last step) it is taken ...
    const a = world();
    sign(a, a.sam, a.kit, SLOT.Kit, [{ k: 'alliance' }]);
    fight(a);
    runTo(a, 'L1', late - LIVE.lead);
    expect(frontier(a)).toBe(late);
    a.kit.say(help(SLOT.Kit));
    expect(all(a.kit, 'bhelpoff')).toHaveLength(0);
    expect(a.sam.got.flatMap((m) => (m.t === 'ballow' ? (m.ords ?? []) : []))[0]!.helper!.arrive).toBe(
      LIVE.lastStep,
    );
    // ... a frontier on, it is turned back.
    const b = world();
    sign(b, b.sam, b.kit, SLOT.Kit, [{ k: 'alliance' }]);
    fight(b);
    runTo(b, 'L1', late);
    expect(frontier(b)).toBeGreaterThan(late);
    b.kit.say(help(SLOT.Kit));
    expect(last(b.kit, 'bhelpoff')!.why).toBe(
      'The battle will be over before help could get there: send it earlier',
    );
    expect(LIVE.lastStep).toBe(BATTLE.maxSteps);
  });

  it('tells both combatants when the force has arrived', () => {
    const w = world();
    sign(w, w.sam, w.kit, SLOT.Kit, [{ k: 'alliance' }]);
    fight(w);
    reach(w, 'L1', 20);
    w.kit.say(help(SLOT.Kit));
    const arrive = all(w.sam, 'ballow')
      .flatMap((b) => b.ords ?? [])
      .find((o) => o.kind === 'help')!.helper!.arrive;
    const arrived = (r: Raw) => notices(r).filter((t) => t.includes('has arrived'));
    // The pages run on; not there until the slower has got to the step.
    runTo(w, 'L1', arrive - 1);
    expect(arrived(w.ada)).toHaveLength(0);
    w.clock.advance(500);
    w.ada.say(step('L1', arrive));
    expect(arrived(w.ada)).toHaveLength(0);
    w.sam.say(step('L1', arrive));
    for (const r of [w.ada, w.sam, w.kit])
      expect(arrived(r)).toEqual(['Kitton’s force has arrived to fight for Samton']);
    // Once.
    runTo(w, 'L1', arrive + 40);
    expect(arrived(w.ada)).toHaveLength(1);
  });

  it('the record kept for replays has the help in its log, and every page that speaks live hears the end', () => {
    const w = world();
    sign(w, w.sam, w.kit, SLOT.Kit, [{ k: 'alliance' }]);
    fight(w);
    reach(w, 'L1', 20);
    w.kit.say(help(SLOT.Kit));
    reach(w, 'L1', 90);
    w.ada.say({ t: 'bdone', id: 'L1', step: 700, hash: 'cafe0123cafe0123' });
    w.sam.say({ t: 'bdone', id: 'L1', step: 700, hash: 'cafe0123cafe0123' });
    expect(all(w.kit, 'bend')).toHaveLength(1);
    w.lou.say({ t: 'breplay', id: 'L1' });
    const rec = last(w.lou, 'breplaydata')!.record;
    expect(rec.orders.map((o) => [o.seq, o.kind, o.helper?.owner])).toEqual([[1, 'help', SLOT.Kit]]);
    // Once it's over there's nothing to send help to.
    w.kit.say(help(SLOT.Kit));
    expect(last(w.kit, 'bhelpoff')!.why).toBe('That battle isn’t on any more');
  });
});

describe('M39 step 6 review: ids, routes, watching', () => {
  it('numbers a helper’s units above any id a city’s sim mints, so none repeats a combatant’s', () => {
    // A city's units, buildings and the rest share one counter: a grown town has passed 10,000 many times
    // over (the menu's demo town stands at 10,658), so the old `slot × 10,000 + k` could be a combatant's.
    expect(helpUnitId(3, 0)).toBeGreaterThan(1_000_000);
    expect(helpUnitId(64, LIVE.helpIds - 1)).toBeLessThan(0x7fff_ffff);
    expect(helpUnitId(2, 23)).toBe(LIVE.helpBase + 2 * LIVE.helpIds + 23);
    for (const old of [10_000, 20_000, 30_003, 650_000]) expect(isHelpUnitId(3, old)).toBe(false);
    // Each city has a window of its own, and only whole numbers are in it.
    expect(isHelpUnitId(3, helpUnitId(3, 23))).toBe(true);
    expect(isHelpUnitId(3, helpUnitId(3, 0) - 1)).toBe(false);
    expect(isHelpUnitId(3, helpUnitId(4, 0))).toBe(false);
    expect(isHelpUnitId(3, helpUnitId(3, 0) + 0.5)).toBe(false);
    expect(isHelpUnitId(3, '1073741824')).toBe(false);
  });

  it('an order may name a helping unit, and still not any number', () => {
    const named = (units: number[]) =>
      parseRegionMsg(JSON.stringify({ t: 'bstep', id: 'x', step: 1, orders: [{ kind: 'hold', units }] }));
    expect(named([5, helpUnitId(3, 0), helpUnitId(4, 2)])).not.toBeNull();
    expect(named([helpUnitId(65, 0)])).toBeNull();
    expect(named([2e6])).toBeNull();
    expect(named([helpUnitId(3, 0) + 0.5])).toBeNull();
    // A defender may focus an attacking helper.
    const focus = parseRegionMsg(
      JSON.stringify({ t: 'bstep', id: 'x', step: 1, orders: [{ kind: 'focus', target: helpUnitId(3, 1) }] }),
    );
    expect(focus).toMatchObject({ orders: [{ kind: 'focus', target: helpUnitId(3, 1) }] });
  });

  it('reads a route as one of the table’s own names, never what an object answers to', () => {
    for (const route of ['highway', 'rail', 'air', 'sea'])
      expect(helpTravelOf(route)).toBe(LIVE.helpTravel[route as 'sea']);
    for (const route of [
      'constructor',
      '__proto__',
      'toString',
      'hasOwnProperty',
      'valueOf',
      'teleport',
      '',
      3,
      null,
      {},
    ])
      expect(helpTravelOf(route), String(route)).toBeNull();
  });

  it('stamps no arrival that is not a whole number of steps', () => {
    const s = new LiveSession('L1', 1, 2, {}, false, 0);
    s.start(['x'], 0);
    const from = { slot: 3, name: 'Kitton', color: 3 };
    const force = { units: [{ id: helpUnitId(3, 0), kind: 'tank', hp: 1 }] };
    for (const travel of [Number.NaN, 480.5, -1, Number.POSITIVE_INFINITY]) {
      const put = s.help(1, from, force, travel);
      expect(put.entry, String(travel)).toBeNull();
      expect(put.refused).toBe('That way in could not be read');
    }
    expect(s.helpers()).toHaveLength(0);
    expect(s.help(1, from, force, 480).entry).not.toBeNull();
  });

  it('decides which side help fights for by one rule, shared with the page that offers the button', () => {
    const none = (n: 'both' | 'attacking' | 'nopact') => ({ none: n });
    const cases: [Parameters<typeof helpSideOf>, ReturnType<typeof helpSideOf>][] = [
      [['alliance', null], { side: 0 }],
      [[null, 'alliance'], { side: 1 }],
      [[null, 'defensivePact'], { side: 1 }],
      [['defensivePact', null], none('attacking')],
      [[null, null], none('nopact')],
      [['alliance', 'alliance'], none('both')],
      [['alliance', 'defensivePact'], none('both')],
      // A defensive pact with the attacker doesn't take it, so the one with the defender stands.
      [['defensivePact', 'defensivePact'], { side: 1 }],
      [['defensivePact', 'alliance'], { side: 1 }],
    ];
    for (const [args, want] of cases) expect(helpSideOf(...args), JSON.stringify(args)).toEqual(want);
  });

  it('offers help in exactly the cases the room takes it: the page’s rule and the room’s agree on every pair of pacts', () => {
    const kinds = [null, 'alliance', 'defensivePact'] as const;
    for (const withAttacker of kinds)
      for (const withDefender of kinds) {
        const w = world();
        const pacts: { room: number; with: number; term: { k: string } }[] = [];
        if (withAttacker) {
          sign(w, w.kit, w.ada, SLOT.Ada, [{ k: withAttacker }]);
          pacts.push({ room: pacts.length + 1, with: 11, term: { k: withAttacker } });
        }
        if (withDefender) {
          sign(w, w.kit, w.sam, SLOT.Sam, [{ k: withDefender }]);
          pacts.push({ room: pacts.length + 1, with: 12, term: { k: withDefender } });
        }
        fight(w);
        w.kit.say(help(SLOT.Kit));
        const took = all(w.sam, 'ballow')
          .flatMap((b) => b.ords ?? [])
          .find((o) => o.kind === 'help');
        const page = helpAlliesOf(
          {
            pacts,
            neighbours: [
              { id: 11, name: 'Adaton', player: { slot: SLOT.Ada } },
              { id: 12, name: 'Samton', player: { slot: SLOT.Sam } },
            ],
          },
          { from: SLOT.Ada, to: SLOT.Sam },
        );
        const label = `${withAttacker} with the attacker, ${withDefender} with the defender`;
        if (took) {
          expect(all(w.kit, 'bhelpoff'), label).toHaveLength(0);
          expect(
            page.map((a) => a.side),
            label,
          ).toEqual([took.side]);
        } else {
          expect(all(w.kit, 'bhelpoff'), label).toHaveLength(1);
          expect(page, label).toEqual([]);
        }
      }
  });

  it('answers a watch for a battle it does not have with a bliveoff, so a page following it can let go', () => {
    const w = world();
    sign(w, w.sam, w.kit, SLOT.Kit, [{ k: 'alliance' }]);
    fight(w);
    w.kit.say({ t: 'bwatch', id: 'L-nope' });
    expect(last(w.kit, 'bliveoff')).toEqual({
      t: 'bliveoff',
      id: 'L-nope',
      why: 'That battle isn’t on any more',
      gone: true,
    });
    expect(notices(w.kit)).not.toContain('That battle isn’t on any more');
  });

  it('keeps a city with a force in the battle among its watchers, whoever else has crowded them', () => {
    const w = world();
    sign(w, w.sam, w.kit, SLOT.Kit, [{ k: 'alliance' }]);
    fight(w);
    w.kit.say(help(SLOT.Kit));
    expect(all(w.kit, 'bhelpoff')).toHaveLength(0);
    // Lou's pages fill the battle's watchers (Kit's own page is one of the eight).
    const secret = last(w.lou, 'rwelcome')!.secret;
    const crowd: Raw[] = [];
    for (let k = 0; k < LIVE.watchers; k++) {
      const c = raw(w.room);
      c.say(hello('Lou', { rejoin: { slot: SLOT.Lou, secret } }));
      c.say({ t: 'bwatch', id: 'L1' });
      crowd.push(c);
    }
    const seated = crowd.filter((c) => all(c, 'bstart').length > 0);
    expect(seated).toHaveLength(LIVE.watchers - 1);
    const turned = crowd.find((c) => all(c, 'bstart').length === 0)!;
    expect(last(turned, 'bliveoff')).toEqual({
      t: 'bliveoff',
      id: 'L1',
      why: 'That battle has all the watchers it takes',
      refused: true,
    });
    // Kit's page comes back after a dropped link: its force is in the battle, so the room seats it.
    const back = raw(w.room);
    back.say(hello('Kit', { rejoin: { slot: SLOT.Kit, secret: last(w.kit, 'rwelcome')!.secret } }));
    back.say({ t: 'bwatch', id: 'L1' });
    expect(all(back, 'bstart')).toHaveLength(1);
    expect(all(back, 'bliveoff')).toHaveLength(0);
    expect(last(back, 'bstart')!.orders.map((o) => o.kind)).toEqual(['help']);
  });
});

describe('M39 step 6: the session’s own rules for help', () => {
  const session = () => {
    const s = new LiveSession('L1', 1, 2, {}, false, 0);
    s.start(['x'], 0);
    return s;
  };
  const from = (slot: number) => ({ slot, name: `City ${slot}`, color: slot });
  const force = (slot: number) => ({ units: [{ id: helpUnitId(slot, 0), kind: 'tank', hp: 1 }] });

  it('takes three forces at most, one from a city, and numbers them with the orders', () => {
    const s = session();
    expect(s.stamp(0, [{ kind: 'hold' }]).stamped).toHaveLength(1);
    const put = (slot: number) => s.help(1, from(slot), force(slot), 480);
    const a = put(3);
    expect(a.entry).toMatchObject({ kind: 'help', seq: 2, step: s.allow, side: 1 });
    expect(a.entry!.helper!.arrive).toBe(s.allow + 480);
    expect(put(3).refused).toBe('Your force is helping in that battle already');
    expect(put(4).entry!.seq).toBe(3);
    expect(put(5).entry!.seq).toBe(4);
    expect(put(6).refused).toBe(`That battle has all the help it takes (${LIVE.helpers} forces)`);
    expect(s.helpers().map((o) => o.helper!.owner)).toEqual([3, 4, 5]);
    // Help doesn't count against a side's orders at a step.
    for (let k = 0; k < LIVE.perStep - 1; k++) expect(s.stamp(1, [{ kind: 'hold' }]).refused).toBeNull();
    expect(s.stamp(1, [{ kind: 'hold' }]).refused).toBeNull();
    expect(s.stamp(1, [{ kind: 'hold' }]).refused).toMatch(/Too many orders/);
  });

  it('is refused before the battle has begun or after a page has finished', () => {
    const calling = new LiveSession('L1', 1, 2, {}, false, 0);
    expect(calling.help(1, from(3), force(3), 480).refused).toBe('That battle hasn’t started');
    const s = session();
    s.finish(0, 700, 'aa', 1);
    expect(s.help(1, from(3), force(3), 480).refused).toBe('That battle is over');
  });
});
