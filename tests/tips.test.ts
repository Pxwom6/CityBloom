import { describe, expect, it } from 'vitest';
import { TIPS, pickTip } from '../src/client/tutorial';
import { newcomerNote } from '../src/client/friendsWar';
import { LONG_COMMUTE } from '../src/data/balance';
import { advise } from '../src/sim/systems/advisors';
import type { Game } from '../src/game';
import type { CityStats } from '../src/sim/protocol';
import { buildTown, newSim, serveTown } from './helpers';
import { TICKS_PER_MONTH } from '../src/sim/time';

/** A stand-in for the game, as far as tips look at it: a new city's stats, with some changed. */
const base = newSim().stats();
const gameWith = (stats: Partial<CityStats>) =>
  ({
    world: {
      stats: { ...base, population: 1_000, ...stats },
      civics: new Map(),
      netState: { segments: new Map(), blocks: new Map() },
      worstJunctionVC: () => 0,
    },
    tools: { activeId: 'select' },
  }) as unknown as Game;

const tip = (id: string) => TIPS.find((t) => t.id === id)!;

describe('tips agree with the numbers (P15)', () => {
  it('drop the money tip if the city earns again before a panel closes', () => {
    const spending = gameWith({ netMonthly: -1_200, population: 900 });
    const earning = gameWith({ netMonthly: 26_018, population: 900 });
    // Chosen only when it can be seen.
    expect(pickTip(spending, null, true, new Set())).toBeNull();
    const t = pickTip(spending, null, false, new Set());
    expect(t?.id).toBe('money');
    // Waiting behind the budget panel while the player raises taxes: gone once the books balance.
    expect(pickTip(earning, t, true, new Set(['money']))).toBeNull();
    expect(pickTip(spending, t, true, new Set(['money']))).toBe(t);
    // On screen, it stays until dismissed.
    expect(pickTip(earning, t, false, new Set(['money']))).toBe(t);
  });

  it('call commutes long where the transport advisor does', () => {
    const traffic = tip('traffic');
    // avgCommute is in seconds: a 1-minute average isn't long, a 25-minute one is.
    expect(traffic.when(gameWith({ avgCommute: 60 }))).toBe(false);
    expect(traffic.when(gameWith({ avgCommute: 25 * 60 }))).toBe(true);
    expect(traffic.when(gameWith({ avgCommute: LONG_COMMUTE }))).toBe(false);
    expect(traffic.when(gameWith({ avgCommute: LONG_COMMUTE + 1 }))).toBe(true);
    // And in a real town, the tip and the advisor's "Commutes average N minutes" agree.
    const sim = newSim();
    buildTown(sim);
    serveTown(sim);
    sim.advance(TICKS_PER_MONTH);
    const stats = sim.stats();
    const advisorSaysLong = advise(sim).some((a) => /^Commutes average/.test(a.title));
    expect(traffic.when(gameWith({ avgCommute: stats.avgCommute, population: 1_000 }))).toBe(advisorSaysLong);
  });
});

/** The tips for war with friends (M39): when each comes up, in a stand-in for a game at war. */
describe('tips for war with friends', () => {
  type War = NonNullable<CityStats['war']>;
  const friend = { slot: 2, name: 'Samford' };
  const friendWar = (extra: object = {}, state = 'open') => ({
    id: 1,
    with: 7,
    name: 'Samford',
    scale: 'war',
    by: 'us',
    reason: 'The river is ours',
    declared: 0,
    opens: 0,
    score: 0,
    battles: 0,
    hold: null,
    capitulated: null,
    rebellion: false,
    ceasefire: null,
    helpers: [],
    friend: { room: 1, slot: 2, state },
    ...extra,
  });
  const atWar = (diplomacy: object | null, hq: number | null = 5) =>
    gameWith({ war: { hq, diplomacy } as unknown as War });
  const dip = (wars: object[] = [], friends: object[] = [friend]) => ({
    friends,
    wars,
    proposals: [],
    pacts: [],
    subjects: [],
    vassal: null,
  });

  it('says how to declare war once a friend’s city is in a region at war and the war room is open', () => {
    const t = tip('friendsAtWar');
    expect(t.when(atWar(dip()))).toBe(true);
    // Not before there is a friend, nor a war room to do it from, nor once a war with a friend is on.
    expect(t.when(atWar(dip([], [])))).toBe(false);
    expect(t.when(atWar(dip(), null))).toBe(false);
    expect(t.when(atWar(dip([friendWar()])))).toBe(false);
    // A war with a computer neighbour is no war with a friend.
    expect(t.when(atWar(dip([friendWar({ friend: null })])))).toBe(true);
    expect(t.when(gameWith({}))).toBe(false);
    // It names the way: the war room, the Diplomacy tab, Declare war.
    expect(t.text).toMatch(/Shift\+M/);
    expect(t.text).toMatch(/Diplomacy/);
    expect(t.text).toMatch(/Declare war/);
  });

  it('tells a region’s host that war is off, only when there is someone to fight', () => {
    const t = tip('regionWarOff');
    const region = (host: boolean, war: boolean, cities: number) =>
      ({
        ...gameWith({}),
        region: { state: 'in', isHost: host, view: { rules: { war }, cities: new Array(cities).fill({}) } },
      }) as unknown as Game;
    expect(t.when(region(true, false, 2))).toBe(true);
    expect(t.when(region(true, false, 1))).toBe(false);
    expect(t.when(region(true, true, 2))).toBe(false);
    expect(t.when(region(false, false, 2))).toBe(false);
    expect(t.when(gameWith({}))).toBe(false);
  });

  it('points a player in a live battle at the battle map, and not a watcher or after it ends', () => {
    const t = tip('liveBattle');
    const live = (view: object | null) =>
      ({ ...gameWith({}), live: { view: () => view } }) as unknown as Game;
    expect(t.when(live({ role: 'attacker', over: false }))).toBe(true);
    expect(t.when(live({ role: 'defender', over: false }))).toBe(true);
    expect(t.when(live({ role: 'watcher', over: false }))).toBe(false);
    expect(t.when(live({ role: 'defender', over: true }))).toBe(false);
    expect(t.when(live(null))).toBe(false);
    expect(t.when(gameWith({}))).toBe(false);
    expect(t.text).toMatch(/\bO\b/);
    expect(t.text).toMatch(/Focus/);
    expect(t.text).toMatch(/Guard/);
    expect(t.text).toMatch(/Withdraw/);
  });

  it('says how to stop a war with a friend once a battle was fought or it is going badly', () => {
    const t = tip('friendPeace');
    expect(t.when(atWar(dip([friendWar({ battles: 1 })])))).toBe(true);
    expect(t.when(atWar(dip([friendWar({ score: -25 })])))).toBe(true);
    // A war that has just opened, with nothing yet to stop, is not the moment; nor a war not yet open,
    // a computer neighbour's war, or a ceasefire.
    expect(t.when(atWar(dip([friendWar()])))).toBe(false);
    expect(t.when(atWar(dip([friendWar({ battles: 2 }, 'declared')])))).toBe(false);
    expect(t.when(atWar(dip([friendWar({ battles: 2 }, 'ceasefire')])))).toBe(false);
    expect(t.when(atWar(dip([friendWar({ battles: 2, friend: null })])))).toBe(false);
    expect(t.when(gameWith({}))).toBe(false);
    expect(t.text).toMatch(/Offer terms/);
  });

  it('are the first of their kind shown, and each once (the order a friendship goes in)', () => {
    const ids = TIPS.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [a, b] of [
      ['regionWarOff', 'friendsAtWar'],
      ['friendsAtWar', 'friendWar'],
      ['friendWar', 'liveBattle'],
      ['liveBattle', 'friendPeace'],
      ['friendPeace', 'friendTreaty'],
    ] as const)
      expect(ids.indexOf(a), `${a} before ${b}`).toBeLessThan(ids.indexOf(b));
  });
});

describe('the newcomer note on a friend’s refusal', () => {
  it('adds when a newcomer is no longer one, to the refusal that says it is', () => {
    expect(newcomerNote('Samford is too young or small to go to war with, unless it strikes first')).toBe(
      ' A city is protected as a newcomer until it has 3,000 residents and has been going for a year.',
    );
    expect(newcomerNote('Samford is too young or small to raid, unless it strikes first')).toContain('3,000');
    expect(newcomerNote('Samford is neutral')).toBe('');
    expect(newcomerNote(null)).toBe('');
    expect(newcomerNote(undefined)).toBe('');
  });
});
