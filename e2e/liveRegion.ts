import { makeCode } from '../relay/protocol';
import { webSocketLink } from '../src/net/link';
import { S, TAG, type BattleInput } from '../src/sim/battle/types';
import { friendsPage, type FwPage } from '../tests/war/friendsHarness';
import { armAda, armSam, liveTown, sendAgainst } from '../tests/war/liveTown';

/**
 * A region with a live battle in it, made by two cities' pages that run in the test's own process
 * (the headless pages of the relay tests: a sim, a `RegionLink` and the live-battle helper each),
 * talking to the local relay over real sockets as a browser does. Adaville's force fights Samford's
 * city live with orders from both sides, so the region keeps a replay of it, and a browser page can
 * then join the region by its code and look at its history (M39 step 7's e2e).
 */
export interface LiveRegion {
  code: string;
  /** What the region keeps of the battle: who fought it, and how it ended. */
  replay: { id: string; from: number; to: number; step: number; hash: string };
  /** The pages stay in the region until this is called. */
  close(): void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const clock = { now: () => Date.now(), advance: () => undefined };

const structsOf = (input: BattleInput) => input.layout.structs.length / S.stride;
const militaryOf = (input: BattleInput): number[] => {
  const out: number[] = [];
  for (let k = 0; k < structsOf(input); k++)
    if ((input.layout.structs[k * S.stride + S.tags]! & TAG.military) !== 0) out.push(k);
  return out;
};

async function until(what: string, ok: () => boolean, ms: number, each?: () => void | Promise<void>) {
  const t0 = Date.now();
  while (!ok()) {
    if (Date.now() - t0 > ms) throw new Error(`liveRegion: ${what} didn’t happen in ${ms / 1000} s`);
    await each?.();
    await sleep(20);
  }
}

export async function fightLive(relay = 'ws://127.0.0.1:8787'): Promise<LiveRegion> {
  const code = makeCode('online');
  const adaTown = liveTown('ada-live', 'Adaville');
  const samTown = liveTown('sam-live', 'Samford');
  const open = (create: boolean) => () =>
    webSocketLink(`${relay}/region/${code}${create ? '?create=1' : ''}`);
  const ada: FwPage = await friendsPage(
    {
      connect: open(true),
      clock,
      sim: adaTown.sim,
      mayor: 'Ada',
      color: 0,
      create: { name: 'Two Rivers', rules: { war: true, scale: 'skirmish' } },
    },
    clock,
  );
  const sam: FwPage = await friendsPage(
    { connect: open(false), clock, sim: samTown.sim, mayor: 'Sam', color: 1 },
    clock,
  );
  armAda(adaTown);
  armSam(samTown);
  // Each reports itself (and its city, for the battle's picture) until the other is a neighbour.
  const knows = (p: FwPage, other: FwPage) =>
    p.sim.state.region.neighbours.some((n) => n.player?.slot === other.link.slot);
  let reported = 0;
  await until(
    'the two cities knowing each other',
    () => knows(ada, sam) && knows(sam, ada),
    60_000,
    async () => {
      if (Date.now() - reported < 1_500) return;
      reported = Date.now();
      await ada.link.reportNow(true);
      await sam.link.reportNow(true);
    },
  );
  ada.ticking = false;
  const sent = sendAgainst(ada.sim, sam.link.slot);
  let over = false;
  void ada.away.fight(sent.id).then(() => (over = true));
  let gave = false;
  await until(
    'the battle ending',
    () => over,
    180_000,
    () => {
      // Samford's city plays (the battle is hosted in it); the attacker's runner follows the room.
      sam.sim.step();
      ada.pumpRuns();
      sam.pumpRuns();
      ada.frames();
      sam.frames();
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
    },
  );
  // The battle's end crosses the room, and Samford's page tells it how its end went (the score).
  const mine = sam.live.state()?.hashes.mine;
  if (!mine) throw new Error('liveRegion: Samford’s page has no end for the battle');
  await until(
    'the region keeping the battle',
    () => ada.fw.view().history.some((e) => e.battle?.live && e.outcome),
    60_000,
    () => {
      ada.fw.pump();
      sam.fw.pump();
      sam.frames();
    },
  );
  const row = ada.fw.view().history.find((e) => e.battle?.live)!;
  return {
    code,
    replay: { id: row.battle!.id, from: row.battle!.from, to: row.b, step: mine.step, hash: mine.hash },
    close: () => {
      ada.link.leave();
      sam.link.leave();
    },
  };
}
