import { afterEach, describe, expect, it } from 'vitest';
import { RegionRoom, MemoryRegionStore, REGION_PROJECT, type RegionConn } from '../region';
import { loopbackPair, type Link } from '../../src/net/link';
import { RegionLink, type CityPort } from '../../src/net/regionLink';
import { Sim } from '../../src/sim/sim';
import { regionRates, regionReport, type RegionReport } from '../../src/sim/systems/region';
import { REGION } from '../../src/data/region';
import { TICKS_PER_MONTH } from '../../src/sim/time';
import { buildTown, placeAlong, serveTown } from '../../tests/helpers';
import { Rng } from '../../src/sim/rng';

/**
 * Shared regions (M32), headless: three players' cities side by side, each run at its own pace.
 * They trade power and commuters, keep playing on the last deals when one goes offline, settle each
 * deal the same in both cities, and pay together for the region project, which its host builds.
 */
function regionRoom(code: string): RegionRoom {
  const rng = Rng.fromSeed(code);
  return new RegionRoom(code, 'local', new MemoryRegionStore(), {
    now: () => performance.now(),
    random: () => rng.next(),
  });
}

function loopTo(room: RegionRoom): () => Promise<Link> {
  return async () => {
    const [mine, theirs] = loopbackPair();
    const conn: RegionConn = { send: (m) => theirs.send(JSON.stringify(m)), close: () => theirs.close() };
    room.open(conn);
    theirs.onmessage = (t) => room.message(conn, t);
    theirs.onclose = () => room.closed(conn);
    return mine;
  };
}

function cityPort(sim: Sim): CityPort {
  return {
    command: async (cmd) => sim.dispatch(cmd),
    report: async (): Promise<RegionReport> => regionReport(sim),
    save: async () => sim.save(),
    cityName: () => sim.state.cityName,
  };
}

function town(seed: string, name: string, services = true): Sim {
  const sim = Sim.create({ seed, preset: 'river', cityName: name });
  sim.testMode = true;
  buildTown(sim);
  serveTown(sim, services);
  sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 900_000 });
  return sim;
}

const flush = () => new Promise((r) => setTimeout(r, 20));
let links: RegionLink[] = [];
afterEach(() => {
  for (const l of links) l.leave();
  links = [];
});

describe('a shared region (M32)', () => {
  it('three cities trade power and commuters, settle deals alike, play on when one leaves, and build the region project together', async () => {
    const room = regionRoom('RGNABC');
    const ada = town('ada', 'Adaville');
    const sam = town('sam', 'Samford', false);
    const kit = town('kit', 'Kitbury');
    const join = async (sim: Sim, mayor: string, color: number, create = false) => {
      const l = new RegionLink(cityPort(sim), loopTo(room), {
        mayor,
        color,
        ...(create ? { create: { name: 'Three Rivers' } } : {}),
      });
      links.push(l);
      await l.start();
      return l;
    };
    const la = await join(ada, 'Ada', 0, true);
    const ls = await join(sam, 'Sam', 1);
    const lk = await join(kit, 'Kit', 2);
    // Each city runs at its own pace: Ada at a month, Sam a week, Kit two weeks.
    ada.advance(TICKS_PER_MONTH);
    sam.advance(TICKS_PER_MONTH / 4);
    kit.advance(TICKS_PER_MONTH / 2);
    for (const l of [la, ls, lk]) await l.reportNow(true);
    await flush();
    // In Sam's city, Ada and Kit stand where two of the simulated towns stood.
    const players = sam.state.region.neighbours.filter((n) => n.player);
    expect(players.map((n) => n.name).sort()).toEqual(['Adaville', 'Kitbury']);
    expect(sam.state.region.neighbours.filter((n) => !n.player)).toHaveLength(1);
    const adaInSam = players.find((n) => n.name === 'Adaville')!;
    expect(adaInSam.player!.offers.sell.power).toBeGreaterThan(50);

    // Sam buys power from Ada; Ada's city sees it as a sale.
    expect(
      sam.dispatch({
        type: 'setDeal',
        neighbour: adaInSam.id,
        resource: 'power',
        direction: 'buy',
        amount: 50,
      }).ok,
    ).toBe(true);
    await ls.reportNow(true);
    await flush();
    const sale = ada.state.region.deals.find((d) => d.remote && d.resource === 'power');
    expect(sale).toMatchObject({ direction: 'sell', amount: 50 });

    // A month on in each city (Sam's slower): the deal settles the same on both sides.
    ada.advance(TICKS_PER_MONTH);
    sam.advance(TICKS_PER_MONTH);
    kit.advance(TICKS_PER_MONTH);
    const bought = sam.state.region.deals.find((d) => d.resource === 'power')!;
    const sold = ada.state.region.deals.find((d) => d.remote && d.resource === 'power')!;
    expect(bought.delivered).toBe(50);
    expect(sold.delivered).toBe(50);
    // What Sam's city pays each month is what Ada's earns.
    expect(-regionRates(sam).imports).toBe(50 * REGION.playerPrice.power);
    expect(regionRates(ada).exports).toBe(50 * REGION.playerPrice.power);

    // Commuters: Kit's and Ada's workers and jobs along the highway show in Sam's flows.
    const k = sam.state.region.neighbours.find((n) => n.name === 'Kitbury')!;
    expect(k.player!.workers + k.player!.jobs).toBeGreaterThan(0);

    // Kit leaves: Sam keeps playing on Kit's last offer.
    // Kit leaves (its last report goes first); the region goes on without it.
    lk.leave();
    await flush();
    const kitOffer = sam.state.region.neighbours.find((n) => n.name === 'Kitbury')!.player!.offers.sell.power;
    ada.advance(TICKS_PER_MONTH / 2);
    await la.reportNow(true);
    await ls.reportNow(true);
    await flush();
    const kitNow = sam.state.region.neighbours.find((n) => n.name === 'Kitbury')!;
    expect(kitNow.player!.online).toBe(false);
    expect(kitNow.player!.offers.sell.power).toBe(kitOffer);
    sam.advance(TICKS_PER_MONTH / 2);

    // The region project: all three pay in; the biggest giver hosts and builds it; all share its power.
    expect((await la.contribute(300_000)).ok).toBe(true);
    expect((await ls.contribute(100_000)).ok).toBe(true);
    const lk2 = new RegionLink(cityPort(kit), loopTo(room), {
      mayor: 'Kit',
      color: 2,
      rejoin: { slot: lk.slot, secret: lk.secret },
    });
    links.push(lk2);
    await lk2.start();
    expect((await lk2.contribute(200_000)).ok).toBe(true);
    await flush();
    expect(room.view().project).toMatchObject({ total: REGION_PROJECT.goal, funded: true, host: la.slot });
    expect(ada.state.region.project).toMatchObject({ funded: true, host: true, mine: 300_000 });
    expect(sam.state.region.project).toMatchObject({ funded: true, host: false });
    // Only the host can build it.
    const avenue = [...sam.state.net.segments.values()].find((s) => s.type === 'avenue')!.id;
    expect(() => placeAlong(sam, 'sunfield', avenue)).toThrow();
    const adaAvenue = [...ada.state.net.segments.values()]
      .filter((s) => s.type !== 'highway')
      .map((s) => s.id);
    let built = false;
    for (const seg of adaAvenue) {
      try {
        placeAlong(ada, 'sunfield', seg);
        built = true;
        break;
      } catch {
        /* the next road */
      }
    }
    expect(built).toBe(true);
    await la.reportNow(true);
    await flush();
    expect(room.view().project.built).toBe(true);
    for (const l of [ls, lk2]) await l.reportNow(true);
    await flush();
    const share = (c: number) => Math.round((REGION_PROJECT.power * c) / REGION_PROJECT.goal);
    expect(sam.state.region.project!.power).toBe(share(100_000));
    expect(kit.state.region.project!.power).toBe(share(200_000));
    expect(ada.state.region.project!.power).toBe(share(300_000));
    // Sam's city gets it as power coming in.
    sam.advance(120);
    expect(sam.state.utilityStats.power.supply).toBeGreaterThanOrEqual(share(100_000));
  }, 120_000);
});
