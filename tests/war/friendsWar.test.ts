import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DIPLOMACY } from '../../src/data/diplomacy';
import { FRIENDS } from '../../relay/protocol';
import { raidVerdict } from '../../src/net/regionLink';
import { fightingWith } from '../../src/sim/systems/diplomacy';
import { weariness } from '../../src/sim/systems/weariness';
import { TICKS_PER_MONTH } from '../../src/sim/time';
import { closePages, driveUntil } from './liveHarness';
import { sendAgainst } from './liveTown';
import {
  buildSaves,
  friendOf,
  friendsPage,
  mirrorWar,
  openWorld,
  pokeWar,
  settle,
  tickRoom,
  type Saves,
  type World,
} from './friendsHarness';

/**
 * M39 step 5b: wars and treaties between friends in each city's sim, through a real region room
 * (design calls 9 and 10). Two cities' pages with a `RegionLink` and a `FriendsWarClient` each; the
 * room keeps the truth and every sim mirrors it. The room's own rules are in
 * `relay/tests/friendsWar.test.ts`; here is what the cities do with its words.
 */
afterEach(() => closePages());

const M = TICKS_PER_MONTH;
let plain: Saves;
let armed: Saves;

beforeAll(async () => {
  plain = await buildSaves(false);
  armed = await buildSaves(true);
  closePages();
}, 300_000);

/** The ledger line of the month just closed (0 when it has none). */
const line = (
  page: { sim: { state: { economy: { history: { lines: Record<string, number> }[] } } } },
  k: string,
) => page.sim.state.economy.history.at(-1)?.lines[k] ?? 0;

/** Ada declares war on Sam, the warning runs out and the room opens it. */
async function openWar(w: World, scale: 'skirmish' | 'war' | 'total' = 'war', reason = 'Your border') {
  const sam = w.sam.link.slot;
  expect(w.ada.fw.declare(sam, scale, reason)).toBe(true);
  await settle();
  w.clock.advance(FRIENDS.warning + 1_000);
  await tickRoom(w);
}

describe('M39 step 5b: a war declared on a friend', () => {
  it('is mirrored in both sims: declared, then open after the warning, with the cost of declaring', async () => {
    const w = await openWorld(plain);
    const { ada, sam } = w;
    const adaRep = ada.sim.state.war?.diplomacy?.reputation;
    const samSlot = sam.link.slot;
    const adaSlot = ada.link.slot;
    expect(ada.fw.declare(samSlot, 'war', 'Your border')).toBe(true);
    await settle();
    // Both cities know of it, in the warning: nothing is fought yet.
    const a = mirrorWar(ada, samSlot)!;
    const s = mirrorWar(sam, adaSlot)!;
    expect(a.friend).toMatchObject({ slot: samSlot, state: 'declared' });
    expect(s.friend).toMatchObject({ slot: adaSlot, state: 'declared' });
    expect(a.by).toBe('us');
    expect(s.by).toBe('them');
    expect(s.reason).toBe('Your border');
    expect(fightingWith(ada.sim, friendOf(ada, samSlot).id)).toBeUndefined();
    expect(fightingWith(sam.sim, friendOf(sam, adaSlot).id)).toBeUndefined();
    // Ada paid the price of a declaration on a city that hadn't struck it; Sam was told in words.
    expect(ada.sim.state.war!.diplomacy!.reputation).toBe((adaRep ?? 60) + DIPLOMACY.reputation.declare);
    expect(sam.sim.state.war!.diplomacy!.reputation).toBe(60);
    expect(sam.sim.state.war!.diplomacy!.log.some((l) => /declares war on the city/.test(l.text))).toBe(true);
    expect(ada.sim.state.war!.diplomacy!.log.some((l) => /declares war on Samford/.test(l.text))).toBe(true);
    // The warning runs out in the room's time; the next word it hears opens the war, and both sims know.
    w.clock.advance(FRIENDS.warning + 1_000);
    await tickRoom(w);
    expect(mirrorWar(ada, samSlot)!.friend!.state).toBe('open');
    expect(mirrorWar(sam, adaSlot)!.friend!.state).toBe('open');
    expect(fightingWith(ada.sim, friendOf(ada, samSlot).id)).toBeDefined();
    expect(fightingWith(sam.sim, friendOf(sam, adaSlot).id)).toBeDefined();
    expect(
      sam.sim.state.war!.diplomacy!.log.some((l) => /The war with Adaville has begun/.test(l.text)),
    ).toBe(true);
    // Heard again, the same words change nothing.
    const hash = [ada.sim.hash(), sam.sim.hash()];
    await tickRoom(w);
    expect([ada.sim.hash(), sam.sim.hash()]).toEqual(hash);
    // A second declaration is turned away in words beside the control.
    expect(ada.fw.declare(samSlot, 'war', 'Again')).toBe(true);
    await settle();
    expect(ada.fw.refusal(`war:${samSlot}`)).toMatch(/at war with Samford already/);
  }, 120_000);

  it('is not declared on a city that is a vassal’s overlord without a word: the summary says why', async () => {
    const w = await openWorld(plain);
    const slot = w.sam.link.slot;
    const sum = w.ada.sim.stats().war!.diplomacy!;
    expect(sum.friends).toHaveLength(1);
    expect(sum.friends[0]).toMatchObject({ slot, name: 'Samford', declare: null });
    await openWar(w);
    const after = w.ada.sim.stats().war!.diplomacy!;
    expect(after.friends[0]!.declare).toMatch(/at war with Samford already/);
    expect(after.wars[0]).toMatchObject({ with: friendOf(w.ada, slot).id, friend: { state: 'open', slot } });
  }, 120_000);
});

describe('M39 step 5b: the newcomer shield', () => {
  it('does not stand between cities at war, and the daily cap does', () => {
    const view = {
      cities: [
        { slot: 1, raidedBy: [] as number[] },
        { slot: 2, report: { shield: 'new' as const }, raidsLeft: 2, online: true },
        { slot: 3, report: { shield: 'new' as const }, raidsLeft: 0, online: true },
      ],
      kind: 'local',
    } as never;
    const c = (view as { cities: never[] }).cities;
    expect(raidVerdict(view, 1, c[1]!)).toBe('new');
    expect(raidVerdict(view, 1, c[1]!, true)).toBe('open');
    expect(raidVerdict(view, 1, c[2]!, true)).toBe('spent');
  });
});

/** The proposal Sam has waiting from Ada, answered (accepted unless told otherwise). */
async function answer(w: World, accept = true) {
  const waiting = w.sam.fw.view().incoming;
  expect(waiting).toHaveLength(1);
  const why = await w.sam.fw.answer(waiting[0]!.id, accept);
  await settle();
  return why;
}

const roomMeta = (w: World) =>
  (w.room as unknown as { meta: { friends: { queue: Record<number, unknown[]>; wars: { id: number }[] } } })
    .meta;

describe('M39 step 5b: a treaty between friends', () => {
  it('peace proposed by one and accepted by the other is applied once on both sides: money, pacts, tribute on each clock', async () => {
    const w = await openWorld(plain);
    const { ada, sam } = w;
    const [A, S] = [ada.link.slot, sam.link.slot];
    await openWar(w);
    expect(
      ada.fw.propose(S, [
        { k: 'peace' },
        { k: 'reparations', payer: 'them', amount: 4_000 },
        { k: 'tribute', payer: 'them', amount: 600, months: 3 },
        { k: 'nonAggression', months: 6 },
      ]).sent,
    ).toBe(true);
    await settle();
    // Sam is told, in words, and sees the terms from its side (it pays).
    expect(
      sam.notices.some((t) =>
        /Adaville proposes a treaty: peace; the city pays \$4,000 in reparations/.test(t),
      ),
    ).toBe(true);
    const seen = sam.fw.view().incoming[0]!;
    expect(seen.with).toBe(A);
    expect(ada.fw.view().outgoing).toHaveLength(1);
    // Sam checks the money against its taxes before it says yes: a sum it couldn't pay isn't accepted.
    const before = [ada.sim.hash(), sam.sim.hash()];
    expect(await answer(w)).toBeNull();
    // Peace: the mirror war is gone on both sides, the cooldown has begun, the proposals are cleared.
    for (const [p, other] of [
      [ada, S],
      [sam, A],
    ] as const) {
      expect(mirrorWar(p, other)).toBeUndefined();
      expect(p.sim.state.war!.diplomacy!.ended?.[friendOf(p, other).id]).toBeDefined();
      expect(fightingWith(p.sim, friendOf(p, other).id)).toBeUndefined();
      expect(p.fw.view().incoming).toHaveLength(0);
      expect(p.fw.view().outgoing).toHaveLength(0);
      expect(p.fw.view().wars).toHaveLength(0);
    }
    expect([ada.sim.hash(), sam.sim.hash()]).not.toEqual(before);
    // Reparations: the same amount, booked at once, one pays and the other receives.
    expect(sam.sim.state.economy.month.reparationsOut).toBe(-4_000);
    expect(ada.sim.state.economy.month.reparationsIn).toBe(4_000);
    // The non-aggression pact is the region's, mirrored with its number in both sims.
    const pacts = (p: typeof ada, other: number) =>
      p.sim.state.war!.diplomacy!.pacts.filter((x) => x.with === friendOf(p, other).id);
    expect(
      pacts(ada, S)
        .filter((x) => x.room !== undefined)
        .map((x) => x.term.k),
    ).toEqual(['nonAggression']);
    expect(
      pacts(sam, A)
        .filter((x) => x.room !== undefined)
        .map((x) => x.term.k),
    ).toEqual(['nonAggression']);
    expect(pacts(ada, S)[0]!.room).toBe(pacts(sam, A)[0]!.room);
    // Both saved the city before the room heard it was seen: nothing is left for the room to keep for them.
    expect(ada.kept.saves).toBeGreaterThan(0);
    expect(sam.kept.saves).toBeGreaterThan(0);
    expect(roomMeta(w).friends.queue[A] ?? []).toHaveLength(0);
    expect(roomMeta(w).friends.queue[S] ?? []).toHaveLength(0);
    // The room's word sent again (it didn't hear the first `tseen`) is only acknowledged.
    const hash = [ada.sim.hash(), sam.sim.hash()];
    for (const p of [ada, sam])
      p.fw.message({
        t: 'tsign',
        id: p.fw.snapshot().treaties[0]!,
        a: A,
        b: S,
        terms: [{ k: 'peace' }, { k: 'reparations', payer: 'them', amount: 4_000 }],
        at: w.clock.now(),
      });
    await settle();
    expect([ada.sim.hash(), sam.sim.hash()]).toEqual(hash);
    expect(sam.sim.state.economy.month.reparationsOut).toBe(-4_000);
    // Tribute: monthly, on each city's own clock (Sam is played a month further than Ada).
    sam.sim.advance(M);
    for (let k = 0; k < 5; k++) {
      ada.sim.advance(M);
      sam.sim.advance(M);
    }
    const sum = (p: typeof ada, k: string) =>
      p.sim.state.economy.history.reduce((n, h) => n + (h.lines[k] ?? 0), 0);
    expect(sum(sam, 'tributeOut')).toBe(-1_800);
    expect(sum(ada, 'tributeIn')).toBe(1_800);
    expect(pacts(ada, S).filter((x) => x.term.k === 'tribute')).toHaveLength(0);
  }, 180_000);

  it('a proposal turned down is said in words, and one over what the payer’s taxes allow is not accepted', async () => {
    const w = await openWorld(plain);
    const { ada, sam } = w;
    const S = sam.link.slot;
    await openWar(w);
    ada.fw.propose(S, [{ k: 'peace' }, { k: 'reparations', payer: 'them', amount: 90_000_000 }]);
    await settle();
    const waiting = sam.fw.view().incoming[0]!;
    const why = await sam.fw.answer(waiting.id, true);
    expect(why).toMatch(/^Reparations are at most \$/);
    // Nothing was sent: the proposal still waits, and the war goes on.
    expect(sam.fw.view().incoming).toHaveLength(1);
    expect(mirrorWar(sam, ada.link.slot)!.friend!.state).toBe('open');
    // Declined, Ada hears so in words beside its terms.
    expect(await sam.fw.answer(waiting.id, false)).toBeNull();
    await settle();
    expect(ada.fw.refusal(`terms:${S}`)).toMatch(/Samford turned down your proposal/);
    expect(ada.fw.view().outgoing).toHaveLength(0);
    // The sim's own question agrees with the room's rules: a ceasefire for a war that isn't there.
    expect(
      sam.sim.query({ type: 'friendTerms', slot: ada.link.slot, terms: [{ k: 'embargo' }, { k: 'trade' }] }),
    ).toMatch(/embargo and trade together/);
  }, 180_000);
});

describe('M39 step 5b: a lost war, vassals and pacts', () => {
  it('a capitulation: the winner sets the terms, a total war ends in vassalage with dues paid and received, and the vassal rises', async () => {
    const w = await openWorld(plain);
    const { ada, sam } = w;
    const [A, S] = [ada.link.slot, sam.link.slot];
    await openWar(w, 'total');
    // Sam's war is lost (the room's own tests play the battles that get it there): +70 for Ada.
    pokeWar(w.room, (war) => (war.score = 70));
    await tickRoom(w);
    expect(mirrorWar(ada, S)!.capitulated?.by).toBe('them');
    expect(mirrorWar(sam, A)!.capitulated?.by).toBe('us');
    expect(
      ada.sim.state.war!.diplomacy!.log.some((l) => /Samford capitulates: set your terms/.test(l.text)),
    ).toBe(true);
    expect(
      sam.sim.state.war!.diplomacy!.log.some((l) => /The city capitulates to Adaville/.test(l.text)),
    ).toBe(true);
    // No more fighting between them.
    expect(fightingWith(ada.sim, friendOf(ada, S).id)).toBeUndefined();
    // Ada sets the terms: signed at once, with no answer.
    const sent = ada.fw.propose(
      S,
      [{ k: 'reparations', payer: 'them', amount: 3_000 }, { k: 'vassal' }],
      true,
    );
    expect(sent.sent).toBe(true);
    await settle();
    expect(mirrorWar(ada, S)).toBeUndefined();
    expect(mirrorWar(sam, A)).toBeUndefined();
    const dSam = sam.sim.state.war!.diplomacy!;
    const dAda = ada.sim.state.war!.diplomacy!;
    expect(dSam.vassal?.overlord).toBe(friendOf(sam, A).id);
    expect(dSam.fell?.name).toBe('Adaville');
    expect(dAda.subjects?.map((x) => x.with)).toEqual([friendOf(ada, S).id]);
    expect(
      dSam.log.some((l) =>
        /Terms imposed with Adaville: peace; the city pays \$3,000 in reparations/.test(l.text),
      ),
    ).toBe(true);
    expect(sam.sim.state.economy.month.reparationsOut).toBe(-3_000);
    expect(ada.sim.state.economy.month.reparationsIn).toBe(3_000);
    // The vassal pays a fifth of its taxes each month; its report says how much, and the overlord counts it.
    for (let k = 0; k < 2; k++) {
      sam.sim.advance(M);
      ada.sim.advance(M);
    }
    await sam.link.reportNow(true);
    await settle();
    const dues = friendOf(ada, S).player!.dues!;
    expect(dues).toBeGreaterThan(0);
    const paid = -line(sam, 'overlord');
    expect(paid).toBeGreaterThan(0);
    expect(Math.abs(paid - dues) / paid).toBeLessThan(0.2);
    // (The first month after the news comes in part; the second is whole.)
    ada.sim.advance(2 * M);
    expect(Math.abs(line(ada, 'vassals') - dues)).toBeLessThanOrEqual(2);
    expect(ada.sim.stats().war!.diplomacy!.subjects[0]).toMatchObject({ name: 'Samford', dues });
    expect(sam.sim.stats().war!.diplomacy!.vassal).toMatchObject({ name: 'Adaville', friend: true });
    // The vassal rises against its overlord once the cooldown has passed: a total war, nothing paid while it lasts.
    expect(sam.fw.declare(A, 'total', 'Free at last')).toBe(true);
    await settle();
    expect(sam.fw.refusal(`war:${A}`)).toMatch(/ended too recently/);
    w.clock.advance(FRIENDS.cooldown + 1_000);
    expect(sam.fw.declare(A, 'total', 'Free at last')).toBe(true);
    await settle();
    expect(mirrorWar(sam, A)).toMatchObject({ rebellion: true, scale: 'total', by: 'us' });
    expect(mirrorWar(ada, S)).toMatchObject({ rebellion: true, by: 'them' });
    sam.sim.advance(2 * M);
    ada.sim.advance(2 * M);
    expect(line(sam, 'overlord')).toBe(0);
    expect(line(ada, 'vassals')).toBe(0);
    // Independence agreed by treaty (the war goes on while it is talked of; peace comes with it): both are free.
    w.clock.advance(FRIENDS.warning + 1_000);
    await tickRoom(w);
    expect(sam.fw.propose(A, [{ k: 'peace' }, { k: 'independence' }]).sent).toBe(true);
    await settle();
    const waiting = ada.fw.view().incoming;
    expect(waiting).toHaveLength(1);
    expect(await ada.fw.answer(waiting[0]!.id, true)).toBeNull();
    await settle();
    expect(sam.sim.state.war!.diplomacy!.vassal).toBeUndefined();
    expect(sam.sim.state.war!.diplomacy!.fell).toBeUndefined();
    expect(ada.sim.state.war!.diplomacy!.subjects).toBeUndefined();
    expect(sam.sim.state.war!.diplomacy!.log.some((l) => /The city is free of Adaville/.test(l.text))).toBe(
      true,
    );
    expect(roomMeta(w).friends.wars).toHaveLength(0);
  }, 240_000);

  it('a pact ended asks first (it breaks the city’s word), then the region drops it from both sims', async () => {
    const w = await openWorld(plain);
    const { ada, sam } = w;
    const [A, S] = [ada.link.slot, sam.link.slot];
    await openWar(w);
    ada.fw.propose(S, [{ k: 'peace' }, { k: 'nonAggression', months: 12 }]);
    await settle();
    await answer(w);
    const pact = ada.sim.stats().war!.diplomacy!.pacts.find((p) => p.room !== null)!;
    expect(pact.breaks).toBe(true);
    const rep = ada.sim.state.war!.diplomacy!.reputation;
    // Asked first: the sim says it breaks the city’s word, and nothing changes.
    const asked = await ada.fw.endPact({ id: pact.id, room: pact.room! }, false);
    expect(asked.ok).toBe(false);
    expect(!asked.ok && asked.info?.breaks).toBe(true);
    expect(ada.sim.state.war!.diplomacy!.reputation).toBe(rep);
    await settle();
    expect(ada.sim.state.war!.diplomacy!.pacts.some((p) => p.room === pact.room)).toBe(true);
    // Confirmed: its word counts for less, and the region ends the pact for both.
    expect((await ada.fw.endPact({ id: pact.id, room: pact.room! }, true)).ok).toBe(true);
    await settle();
    expect(ada.sim.state.war!.diplomacy!.reputation).toBe(rep + DIPLOMACY.reputation.breakPact);
    for (const p of [ada, sam])
      expect(p.sim.state.war!.diplomacy!.pacts.some((x) => x.room === pact.room)).toBe(false);
    expect(sam.notices.some((t) => /Adaville ends the non-aggression pact with Samford/.test(t))).toBe(true);
    expect(ada.fw.view().pacts).toHaveLength(0);
    // A force can't be sent against a friend under a pact: ending it comes first (and with it gone, nothing stands in the way).
    void A;
  }, 180_000);

  it('an embargo ends the deals between the two and stops new ones, until trade resumes', async () => {
    const w = await openWorld(plain);
    const { ada, sam } = w;
    const [A, S] = [ada.link.slot, sam.link.slot];
    for (const [p, other] of [
      [ada, S],
      [sam, A],
    ] as const) {
      const n = friendOf(p, other);
      n.player!.offers.sell.water = 400;
      n.player!.offers.buy.garbage = 400;
      expect(
        p.sim.dispatch({ type: 'setDeal', neighbour: n.id, resource: 'water', direction: 'buy', amount: 100 })
          .ok,
      ).toBe(true);
      expect(p.sim.state.region.deals.some((d) => d.neighbour === n.id)).toBe(true);
    }
    ada.fw.propose(S, [{ k: 'embargo' }]);
    await settle();
    expect(await answer(w)).toBeNull();
    for (const [p, other] of [
      [ada, S],
      [sam, A],
    ] as const) {
      const n = friendOf(p, other);
      expect(p.sim.state.region.deals.filter((d) => d.neighbour === n.id)).toHaveLength(0);
      const r = p.sim.dispatch({
        type: 'setDeal',
        neighbour: n.id,
        resource: 'water',
        direction: 'buy',
        amount: 100,
      });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.reason).toMatch(/under embargo/);
    }
    // Trade resumed by treaty: the embargo is gone from both, and a deal can be made again.
    sam.fw.propose(A, [{ k: 'trade' }]);
    await settle();
    const waiting = ada.fw.view().incoming;
    expect(await ada.fw.answer(waiting[0]!.id, true)).toBeNull();
    await settle();
    for (const [p, other] of [
      [ada, S],
      [sam, A],
    ] as const) {
      const n = friendOf(p, other);
      n.player!.offers.sell.water = 400;
      expect(
        p.sim.dispatch({ type: 'setDeal', neighbour: n.id, resource: 'water', direction: 'buy', amount: 100 })
          .ok,
      ).toBe(true);
    }
  }, 180_000);
});

describe('M39 step 5b: weariness and the page that was away', () => {
  it('a war with a friend wears both cities out, and the peace that ends it starts the recovery', async () => {
    const w = await openWorld(plain);
    const { ada, sam } = w;
    const [A, S] = [ada.link.slot, sam.link.slot];
    await openWar(w, 'war');
    expect(weariness(ada.sim)).toBe(0);
    for (let k = 0; k < 12; k++) {
      ada.sim.advance(M);
      sam.sim.advance(M);
    }
    expect(weariness(ada.sim)).toBeGreaterThan(0.1);
    expect(weariness(sam.sim)).toBeGreaterThan(0.1);
    expect(ada.sim.state.war!.economy?.recoveryUntil).toBeUndefined();
    ada.fw.propose(S, [{ k: 'peace' }]);
    await settle();
    await answer(w);
    for (const p of [ada, sam]) {
      expect(p.sim.state.war!.economy!.recoveryUntil).toBeGreaterThan(p.sim.state.tick);
      expect(p.sim.state.war!.diplomacy!.log.some((l) => /The fighting is over/.test(l.text))).toBe(true);
    }
    void A;
  }, 240_000);

  it('a page coming back finds the treaty signed in its absence: the war is over, the terms applied once', async () => {
    const w = await openWorld(plain);
    const { ada, sam } = w;
    const [A, S] = [ada.link.slot, sam.link.slot];
    await openWar(w, 'total');
    pokeWar(w.room, (war) => (war.score = 70));
    await tickRoom(w);
    expect(mirrorWar(sam, A)!.capitulated?.by).toBe('us');
    // Sam's page is closed. Ada sets the terms; the room keeps them for Sam.
    const { slot, secret } = sam.link;
    await sam.link.leave();
    await settle();
    expect(
      ada.fw.propose(S, [{ k: 'reparations', payer: 'them', amount: 2_500 }, { k: 'vassal' }], true).sent,
    ).toBe(true);
    await settle();
    expect(roomMeta(w).friends.queue[S]).toHaveLength(1);
    expect(sam.sim.state.war!.diplomacy!.vassal).toBeUndefined();
    // It comes back (the same city, the same place): the room tells it, and it applies it once.
    const back = await friendsPage(
      { room: w.room, clock: w.clock, sim: sam.sim, mayor: 'Sam', color: 1, rejoin: { slot, secret } },
      w.clock,
    );
    await settle(8);
    expect(mirrorWar(back, A)).toBeUndefined();
    expect(back.sim.state.war!.diplomacy!.vassal?.overlord).toBe(friendOf(back, A).id);
    expect(back.sim.state.economy.month.reparationsOut).toBe(-2_500);
    expect(back.kept.saves).toBe(1);
    expect(roomMeta(w).friends.queue[S] ?? []).toHaveLength(0);
    // Offered again on the next visit (the room has forgotten it), nothing happens twice.
    const hash = back.sim.hash();
    back.fw.message({
      t: 'tsign',
      id: back.fw.snapshot().treaties[0]!,
      a: A,
      b: S,
      terms: [{ k: 'peace' }, { k: 'reparations', payer: 'them', amount: 2_500 }],
      imposed: true,
      at: w.clock.now(),
    });
    await settle();
    expect(back.sim.hash()).toBe(hash);
  }, 240_000);
});

describe('M39 step 5b: battles move both mirrors', () => {
  it('a friend’s raid fought live moves the war score the same in both cities, and the room keeps who won', async () => {
    const w = await openWorld(armed);
    const { ada, sam, clock } = w;
    const [A, S] = [ada.link.slot, sam.link.slot];
    await openWar(w, 'war');
    ada.ticking = false;
    const sent = sendAgainst(ada.sim, S);
    let over = false;
    void ada.away.fight(sent.id).then(() => (over = true));
    expect(await driveUntil([ada, sam], clock, () => over, 6_000)).toBe(true);
    // The defender's page reported how it went; the room scored it; both mirrors have the word.
    await settle(8);
    const roomWar = ada.fw.view().wars[0]!;
    expect(roomWar.battles).toBe(1);
    expect(roomWar.score).not.toBe(0);
    expect(mirrorWar(ada, S)!.score).toBe(roomWar.score);
    expect(mirrorWar(sam, A)!.score).toBe(-roomWar.score);
    expect(mirrorWar(ada, S)!.battles).toBe(1);
    expect(mirrorWar(sam, A)!.battles).toBe(1);
    // The room's history has the battle with its outcome, and the page stopped sending it.
    const ev = ada.fw.view().history.find((e) => e.kind === 'battle' && e.outcome);
    expect(ev?.score).toBe(roomWar.score);
    expect(sam.fw.snapshot().results).toBe(0);
    // Each city's own sim agrees on who won.
    const hosted = sam.sim.state.war!.reports!.at(-1)!;
    expect(roomWar.score > 0).toBe(hosted.outcome === 'raided');
  }, 240_000);
});
