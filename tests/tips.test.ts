import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TIPS, pickTip } from '../src/client/tutorial';
import { newcomerNote, raidNote } from '../src/client/friendsWar';
import { raidVerdict } from '../src/net/regionLink';
import { LONG_COMMUTE } from '../src/data/balance';
import { RAIDS } from '../src/data/battle';
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

  it('describes the newcomer shield as the region applies it: Declare war… is greyed out, not lifted by a war', () => {
    const t = tip('friendsAtWar');
    // A newcomer is one under RAIDS' size or age (in the tip's words), and the button stays greyed out with the reason.
    expect(t.text).toContain(`${RAIDS.minPopulation.toLocaleString('en-US')} residents`);
    expect(t.text).toMatch(/greyed out/);
    // ...which only the newcomer's own raid on the declaring city lifts, for a day: not "a war between you".
    expect(t.text).toMatch(/after it has raided you/);
    expect(t.text).not.toMatch(/war between you lifts/);
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

describe('the Send tab’s note on a raid on a friend’s city', () => {
  it('promises a live battle or a saved copy only where the region would take the raid', () => {
    const live = raidNote('Samford', { online: true, raid: 'open' });
    expect(live.kind).toBe('live');
    expect(live.text).toMatch(/player is here, so the battle is live/);
    const saved = raidNote('Samford', { online: false, raid: 'open' });
    expect(saved.kind).toBe('saved');
    expect(saved.text).toMatch(/player is away.*region last saw it.*half the usual damage/);
    // A region at peace gives no verdict: whether the player is here is all there is to say.
    expect(raidNote('Samford', { online: true }).kind).toBe('live');
    expect(raidNote('Samford', { online: false }).kind).toBe('saved');
  });

  it('says why instead, for every verdict that is not open (the words the sim refuses a force by)', () => {
    for (const online of [true, false]) {
      expect(raidNote('Samford', { online, raid: 'neutral' })).toEqual({
        kind: 'refused',
        text: 'Samford is neutral.',
      });
      const young = raidNote('Samford', { online, raid: 'new' });
      expect(young.kind).toBe('refused');
      expect(young.text).toMatch(/^Samford is too young or small to raid, unless it strikes first\./);
      // ...and how long a newcomer stays one.
      expect(young.text).toContain('3,000 residents');
      expect(raidNote('Samford', { online, raid: 'spent' }).text).toMatch(/three raids for today/);
      expect(raidNote('Samford', { online, raid: 'absent' }).text).toBe(
        'Samford’s player isn’t here, and this region keeps nothing for them.',
      );
    }
  });

  it('in a peer-to-peer region a friend who is away is refused, not promised a saved-copy battle', () => {
    const city = (online: boolean) => ({ slot: 2, report: { shield: undefined }, online, raidsLeft: 3 });
    const view = (kind: 'local' | 'p2p', online: boolean) =>
      ({ kind, cities: [{ slot: 1, raidedBy: [] }, city(online)] }) as never;
    const verdict = (kind: 'local' | 'p2p', online: boolean) => {
      const v = view(kind, online);
      return raidVerdict(v, 1, (v as { cities: never[] }).cities[1]!);
    };
    // The same friend, away: a hosted region keeps a copy and takes the raid; a peer-to-peer one doesn't.
    expect(verdict('local', false)).toBe('open');
    expect(raidNote('Samford', { online: false, raid: verdict('local', false) }).kind).toBe('saved');
    expect(verdict('p2p', false)).toBe('absent');
    expect(raidNote('Samford', { online: false, raid: verdict('p2p', false) }).kind).toBe('refused');
    expect(verdict('p2p', true)).toBe('open');
    expect(raidNote('Samford', { online: true, raid: verdict('p2p', true) }).kind).toBe('live');
  });
});

describe('the README on what the region refuses a friend’s raid for', () => {
  // The README is what a player reads before the game does the refusing: it must agree with the room.
  const readme = readFileSync('README.md', 'utf8').replace(/\s+/g, ' ');

  it('gives no way round the newcomer shield that Declare war… refuses', () => {
    const limits = readme.slice(readme.indexOf('**The limits.**'));
    expect(limits).toMatch(/neither raid it nor declare war on it/);
    // ...except for a day after the newcomer's own raid (the room's RAID_ANSWER_MS), which it says.
    expect(limits).toMatch(/for a day after it has raided them/);
    expect(limits).not.toMatch(/or when a war between you has opened/);
    expect(limits).toMatch(/greyed out/);
  });

  it('says a peer-to-peer region refuses the saved-copy battle against an absent friend', () => {
    const live = readme.slice(
      readme.indexOf('**Raids and live battles.**'),
      readme.indexOf("**Allies' help.**"),
    );
    const saved = live.slice(live.indexOf('saved copy'));
    expect(saved).toMatch(/Not in a peer-to-peer region/);
  });
});
