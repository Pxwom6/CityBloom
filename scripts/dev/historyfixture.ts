/**
 * Dev (M39 step 7): a region room with a war history in it, for `historyshot.mjs`. Three cities' pages
 * run in this process against a real region room (the test harness of the live battles): Ada's force
 * fights Sam's city live with orders from both sides, so the room keeps a real replay of it, and a war
 * is declared, opened and ended with a treaty around that battle, all by the pages' own code. Older
 * events (earlier wars, a treaty, a conquest, a broken pact) are written into the room's history by
 * hand, in the words the room itself uses, so the list has several days and every kind in it.
 *
 * The room's clock starts a quarter of an hour in the past so that the battle is "just now" when the
 * fixture is done, and then follows the real one.
 */
import { FRIENDS, type WarEvent } from '../../relay/protocol';
import type { RegionMeta, RegionRoom } from '../../relay/region';
import { friendsPage, settle, type FwPage } from '../../tests/war/friendsHarness';
import { BUSY, Clock, driveUntil, flush, openRoom, type Page } from '../../tests/war/liveHarness';
import { armAda, armSam, liveTown, sendAgainst } from '../../tests/war/liveTown';
import { S, TAG, type BattleInput } from '../../src/sim/battle/types';

export interface Fixture {
  clock: Clock;
  room: RegionRoom;
  ada: FwPage;
  sam: FwPage;
  eve: FwPage;
  /** The region's code and what the room says about the battle it keeps. */
  code: string;
  replay: { id: string; from: number; to: number; step: number; hash: string };
}

const HOUR = 3_600_000;
const money = (v: number) => `$${v.toLocaleString('en-US')}`;

const structsOf = (input: BattleInput) => input.layout.structs.length / S.stride;
const militaryOf = (input: BattleInput): number[] => {
  const out: number[] = [];
  for (let k = 0; k < structsOf(input); k++)
    if ((input.layout.structs[k * S.stride + S.tags]! & TAG.military) !== 0) out.push(k);
  return out;
};

type Poke = { meta: RegionMeta };

/** Older history written by hand: slots 1 Adaville, 2 Samford, 3 Evetown, and 5 a city that has left. */
function olderHistory(now: number): WarEvent[] {
  const A = 'Adaville';
  const S_ = 'Samford';
  const E = 'Evetown';
  const at = (hoursAgo: number) => Math.round(now - hoursAgo * HOUR);
  const list: Omit<WarEvent, 'id'>[] = [
    {
      at: at(75),
      kind: 'treaty',
      a: 3,
      b: 2,
      text: `${E} and ${S_} sign a treaty: a non-aggression pact for 3 months; a trade agreement`,
    },
    {
      at: at(52),
      kind: 'declared',
      a: 3,
      b: 2,
      war: 1,
      text: `${E} declares a total war on ${S_}: “Your harbour should have been ours”. It opens in 2 minutes`,
    },
    {
      at: at(52) + 125_000,
      kind: 'opened',
      a: 3,
      b: 2,
      war: 1,
      text: `The war between ${E} and ${S_} has begun`,
    },
    {
      at: at(51.6),
      kind: 'battle',
      a: 3,
      b: 2,
      war: 1,
      text: `${E} raided ${S_}: the raid succeeded. War score: ${E} +21`,
      battle: { from: 3, id: 'old-raid-1' },
      outcome: 'raided',
      score: 21,
    },
    {
      at: at(51.1),
      kind: 'battle',
      a: 3,
      b: 2,
      war: 1,
      text: `${E} raided ${S_}: the raid succeeded. War score: ${E} +64`,
      battle: { from: 3, id: 'old-raid-2' },
      outcome: 'raided',
      score: 64,
    },
    {
      at: at(51),
      kind: 'capitulated',
      a: 2,
      b: 3,
      war: 1,
      text: `${S_} capitulates to ${E}: ${E} may set its terms within 24 hours, and may take it as a vassal`,
    },
    {
      at: at(50.9),
      kind: 'hold',
      a: 3,
      b: 2,
      war: 1,
      text: `${E} holds ${S_}’s seat of power: in 6 minutes ${S_} falls, unless it wins a battle`,
    },
    {
      at: at(50.7),
      kind: 'vassal',
      a: 3,
      b: 2,
      text: `${S_} falls to ${E}: it is ${E}’s vassal now and pays it a fifth of its taxes`,
    },
    {
      at: at(49),
      kind: 'treaty',
      a: 3,
      b: 2,
      text: `${E} imposes terms on ${S_}: peace; ${S_} pays ${money(180_000)} in reparations`,
    },
    {
      at: at(26),
      kind: 'declared',
      a: 2,
      b: 3,
      war: 2,
      text: `${S_} rises against ${E}: a skirmish war opens in 2 minutes`,
    },
    {
      at: at(25.2),
      kind: 'battle',
      a: 2,
      b: 3,
      war: 2,
      text: `${S_} raided ${E}: the raid succeeded. War score: ${S_} +38`,
      battle: { from: 2, id: 'old-rising' },
      outcome: 'raided',
      score: 38,
    },
    { at: at(25), kind: 'freed', a: 2, b: 3, text: `${S_} is free of ${E}` },
    {
      at: at(22),
      kind: 'treaty',
      a: 1,
      b: 3,
      text: `${A} and ${E} sign a treaty: a ceasefire for 12 hours`,
    },
    {
      at: at(21.9),
      kind: 'ceasefire',
      a: 1,
      b: 3,
      text: `The ceasefire between ${A} and ${E} has run its course`,
    },
    {
      at: at(7),
      kind: 'broken',
      a: 2,
      b: 3,
      text: `${S_} ends the non-aggression pact with ${E}`,
    },
    {
      at: at(5.5),
      kind: 'ended',
      a: 5,
      b: 1,
      text: `The non-aggression pact between a city that has left and ${A} has run its course`,
    },
  ];
  return list.map((e, k) => ({ ...e, id: k + 1 }));
}

/** Make the room notice that time has passed: any message looks at the clock. */
async function tick(pages: Page[]): Promise<void> {
  for (const p of pages) await p.link.reportNow(true);
  await settle();
}

export async function historyFixture(code: string, log: (...a: unknown[]) => void): Promise<Fixture> {
  const clock = new Clock();
  clock.t = Date.now() - 16 * 60_000;
  const room = openRoom(clock, BUSY, code);
  const adaTown = liveTown('ada-live', 'Adaville');
  const samTown = liveTown('sam-live', 'Samford');
  const eveTown = liveTown('eve-live', 'Evetown');
  log('towns grown');
  const ada = await friendsPage(
    {
      room,
      clock,
      sim: adaTown.sim,
      mayor: 'Ada',
      color: 0,
      create: { name: 'Two Rivers', rules: { war: true, scale: 'total' } as never },
    },
    clock,
  );
  const sam = await friendsPage({ room, clock, sim: samTown.sim, mayor: 'Sam', color: 1 }, clock);
  const eve = await friendsPage({ room, clock, sim: eveTown.sim, mayor: 'Eve', color: 2 }, clock);
  armAda(adaTown);
  armSam(samTown);
  log('armed');
  // Older events first (their numbers come before the ones the pages make).
  (room as unknown as Poke).meta.history = olderHistory(clock.now());
  for (const p of [ada, sam, eve]) await p.link.reportNow(true);
  await settle();
  ada.ticking = false;
  eve.ticking = false;

  // 1. Ada declares a total war on Sam; the warning runs out and the room opens it.
  const samSlot = sam.link.slot;
  if (!ada.fw.declare(samSlot, 'total', 'Your border is ours by right'))
    throw new Error('declaration not sent');
  await settle();
  clock.advance(FRIENDS.warning + 1_000);
  await tick([ada, sam]);
  log('war open');

  // 2. Her force fights Sam's city live; each gives orders.
  const sent = sendAgainst(ada.sim, samSlot);
  let over = false;
  void ada.away.fight(sent.id).then(() => (over = true));
  let gave = false;
  const each = () => {
    const d = sam.live.state();
    if (gave || !d || d.step < 60) return;
    gave = true;
    const input = sam.live.input()!;
    ada.live.order({ kind: 'hold', units: [input.attacker.units[0]!.id] });
    sam.live.order({
      kind: 'guard',
      units: input.layout.defenders.slice(0, 2).map((u) => u.id),
      target: militaryOf(input)[0]!,
    });
  };
  if (!(await driveUntil([ada, sam, eve], clock, () => over, 6_000, each)))
    throw new Error('battle never ended');
  log('battle over');
  // The ends cross the room; Sam's page tells it how its end went (the score), a second at a time.
  for (let k = 0; k < 12; k++) {
    clock.advance(1_100);
    for (const p of [ada, sam, eve]) p.fw.pump();
    await flush();
    await settle();
  }
  const rep = (room as unknown as Poke).meta.replays?.at(-1);
  if (!rep) throw new Error('the room kept no replay');

  // 3. Sam offers peace with reparations; Ada accepts.
  const adaSlot = ada.link.slot;
  const sent2 = sam.fw.propose(adaSlot, [{ k: 'peace' }, { k: 'reparations', payer: 'us', amount: 120_000 }]);
  if (!sent2.sent) throw new Error('proposal not sent');
  await settle();
  const waiting = ada.fw.view().incoming[0];
  if (!waiting) throw new Error('no proposal reached Ada');
  const why = await ada.fw.answer(waiting.id, true);
  if (why) throw new Error(`Ada could not accept: ${why}`);
  await settle();
  await tick([ada, sam, eve]);
  clock.advance(5_000);
  const history = (room as unknown as Poke).meta.history ?? [];
  log(
    'history',
    history
      .slice(-6)
      .map((e) => `${e.id}:${e.kind}${e.battle?.live ? '(live)' : ''}`)
      .join(' '),
  );
  // From here the room's clock follows the real one.
  setInterval(() => clock.advance(250), 250).unref();
  return {
    clock,
    room,
    ada,
    sam,
    eve,
    code,
    replay: { id: rep.id, from: rep.from, to: rep.to, step: rep.step, hash: rep.hash },
  };
}
