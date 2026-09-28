// Scenario starting cities (M18): each scenario's city, built headlessly with the balance tool's
// mayor (plus the scenario's twist). scripts/scenarios.ts writes them to public/scenarios/.
import { Sim } from '../../src/sim/sim';
import { GRID_CELL, GRID_RES, MAP_SIZE } from '../../src/data/world';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { DW, Player, type Vec2 } from './mayor';
import { twoDistricts } from '../../tests/trafficTown';
import { crossroadsTown } from '../../tests/junctionTown';

/** Let a mayor run the city for some months (four decisions a month, as the balance tool). */
export function govern(p: Player, months: number): void {
  for (let m = 0; m < months; m++)
    for (let h = 0; h < 4; h++) {
      p.play();
      p.sim.advance(TICKS_PER_HOUR * 6);
    }
}

/** Each scenario's starting city. */
export const RECIPES: Record<string, () => Sim> = {
  // A young town on clean power, before the city grows.
  cleanslate: () => {
    const p = new Player('careful', { seed: 'meadow', cityName: 'Fernlea' });
    p.avoid = ['coal', 'gas'];
    govern(p, 12);
    return p.sim;
  },
  // A town whose last mayor cut taxes to 3 %, borrowed to the limit, spent it on hospitals, schools
  // and plazas, and over-funded every department: a deficit, three loans and an empty treasury.
  brink: () => {
    const p = new Player('careful', { seed: 'ledger', cityName: 'Marlow' });
    govern(p, 40);
    const sim = p.sim;
    for (const amount of [100_000, 50_000, 25_000]) sim.dispatch({ type: 'takeLoan', amount });
    const spree = [
      'hospital',
      'highschool',
      'hospital',
      'busdepot',
      'highschool',
      'park_large',
      'park_large',
    ];
    for (let k = 0; sim.state.treasury > 15_000 && k < 40; k++) p.place(spree[k % spree.length]!);
    for (let k = 0; sim.state.treasury > 15_000 && k < 40; k++) p.place('plaza');
    p.setFunding(125);
    p.setTaxes(3);
    sim.advance(TICKS_PER_HOUR * 24);
    return sim;
  },
  // A town squeezed by high taxes and starved services, with the four-year vote coming up.
  vote: () => {
    const p = new Player('careful', { seed: 'ballot', cityName: 'Hollin' });
    govern(p, 34);
    p.setTaxes(13);
    p.setFunding(70);
    p.sim.advance(TICKS_PER_MONTH);
    return p.sim;
  },
  // A city past 20,000 that never built a big project.
  stadium: () => {
    const p = new Player('careful', { seed: 'arena', cityName: 'Castlebridge' });
    p.avoid = ['stadium', 'helioarray', 'convention', 'gardenexpo', 'launchsite'];
    govern(p, 56);
    return p.sim;
  },
  // Homes on one side, every job on the other, and one dirt track between them (the M6 jam town).
  gridlock: () => {
    const sim = Sim.create({ seed: 'crossing', preset: 'river', cityName: 'Twin Fords' });
    twoDistricts(sim, 'dirt');
    sim.advance(TICKS_PER_MONTH * 5);
    // The test town unlocks everything and starts with a grant; a scenario city does neither.
    sim.state.unlockAll = false;
    for (const m of [...sim.state.economy.history, { lines: sim.state.economy.month }])
      if (m.lines.cheats) {
        m.lines.grants = (m.lines.grants ?? 0) + m.lines.cheats;
        delete m.lines.cheats;
      }
    return sim;
  },
  // Four Ways (M19): homes north and west of one crossroads, jobs south and east, and no other way
  // across, so the whole town queues at it (the crossroads test town).
  crossroads: () => {
    const sim = Sim.create({ seed: 'cross', preset: 'river', cityName: 'Four Ways' });
    crossroadsTown(sim);
    sim.advance(TICKS_PER_MONTH * 5);
    sim.state.unlockAll = false;
    for (const m of [...sim.state.economy.history, { lines: sim.state.economy.month }])
      if (m.lines.cheats) {
        m.lines.grants = (m.lines.grants ?? 0) + m.lines.cheats;
        delete m.lines.cheats;
      }
    return sim;
  },
  // Ironbridge (M20): homes by the highway, an ironworks estate a kilometre east along one avenue, so
  // every load the works ships goes by truck through town and out along the highway link. The
  // regional railway comes in at the west edge, unused; the county has put up a grant towards rail.
  railhead: () => {
    const sim = Sim.create({ seed: 'goods', preset: 'river', cityName: 'Ironbridge' });
    const p = new Player('careful', sim);
    sim.earn(300_000, 'grants');
    const { x, z } = p.c;
    const road = (type: 'avenue' | 'street', a: Vec2, b: Vec2) =>
      sim.dispatch({ type: 'buildRoad', road: type, points: [a, b] });
    const zone = (letter: 'R' | 'C' | 'I', a: Vec2, b: Vec2, radius: number) =>
      sim.dispatch({ type: 'zone', zone: letter, area: { kind: 'brush', points: [a, b], radius } });
    road('avenue', { x, z }, { x: x + 1120, z });
    for (let k = 1; k <= 7; k++) road('street', { x: x + k * 70, z: z - 230 }, { x: x + k * 70, z: z + 230 });
    for (let k = 0; k < 5; k++)
      road('street', { x: x + 800 + k * 70, z: z - 220 }, { x: x + 800 + k * 70, z: z + 220 });
    zone('R', { x: x + 20, z: z - 125 }, { x: x + 530, z: z - 125 }, 105);
    zone('R', { x: x + 20, z: z + 125 }, { x: x + 530, z: z + 125 }, 105);
    zone('C', { x: x + 20, z }, { x: x + 560, z }, 16);
    zone('I', { x: x + 790, z: z - 120 }, { x: x + 1100, z: z - 120 }, 110);
    zone('I', { x: x + 790, z: z + 120 }, { x: x + 1100, z: z + 120 }, 110);
    for (let m = 0; m < 8; m++)
      for (let h = 0; h < 4; h++) {
        p.utilities(false);
        if (sim.state.totals.population >= 250) p.followAdvice();
        sim.advance(TICKS_PER_HOUR * 6);
      }
    sim.earn(100_000, 'grants');
    return sim;
  },
  // Cinderford: a mill town along one avenue. Homes to the north; heavy industry and coal plants to
  // the south, where the prevailing wind comes from, so the smoke rolls over the houses. No schools,
  // so the mills stay heavy.
  smokestack: () => {
    const sim = Sim.create({ seed: 'smelter', preset: 'river', cityName: 'Cinderford' });
    const p = new Player('careful', sim);
    p.avoid = ['primary', 'highschool', 'library', 'university', 'wind', 'solar', 'gas', 'recycling'];
    // The mill company paid for the town.
    sim.earn(250_000, 'grants');
    const { x, z } = p.c;
    const road = (type: 'avenue' | 'street', a: Vec2, b: Vec2) =>
      sim.dispatch({ type: 'buildRoad', road: type, points: [a, b] });
    const zone = (letter: 'R' | 'C' | 'I', a: Vec2, b: Vec2, radius: number) =>
      sim.dispatch({ type: 'zone', zone: letter, area: { kind: 'brush', points: [a, b], radius } });
    road('avenue', { x, z }, { x: x + 640, z });
    for (let k = 1; k <= 7; k++) {
      road('street', { x: x + k * 80, z: z - 210 }, { x: x + k * 80, z });
      road('street', { x: x + k * 80, z }, { x: x + k * 80, z: z + 230 });
    }
    road('street', { x: x + 80, z: z + 230 }, { x: x + 560, z: z + 230 });
    zone('R', { x: x + 20, z: z - 110 }, { x: x + 620, z: z - 110 }, 95);
    zone('C', { x: x + 20, z: z + 16 }, { x: x + 620, z: z + 16 }, 14);
    zone('I', { x: x + 20, z: z + 120 }, { x: x + 620, z: z + 120 }, 95);
    for (const k of [1.5, 3.5, 5.5]) p.placeNear('coal', { x: x + k * 80, z: z + 250 }, 90);
    for (let m = 0; m < 10; m++)
      for (let h = 0; h < 4; h++) {
        p.utilities(false);
        if (sim.state.totals.population >= 250) p.followAdvice();
        sim.advance(TICKS_PER_HOUR * 6);
      }
    return sim;
  },
  // Mereside, on the lakes map: a growing lake town the day after a flood. The water has gone down,
  // but the waterworks went with it.
  flood: () => {
    const p = new Player('careful', { seed: 'b', preset: 'lakes', cityName: 'Mereside' });
    const sim = p.sim;
    // A regional grant got the town going on this tight lake shore.
    sim.earn(150_000, 'grants');
    govern(p, 22);
    // The flood comes in from the shore nearest the highway, across the town's low south side.
    const wd = sim.waterDist();
    let best = { d: Infinity, x: 0, z: 0 };
    for (let j = 0; j < GRID_RES; j++)
      for (let i = 0; i < GRID_RES; i++) {
        if (wd[j * GRID_RES + i]! > 0) continue;
        const x = (i + 0.5) * GRID_CELL;
        const z = (j + 0.5) * GRID_CELL;
        const d = Math.hypot(x - p.c.x, z - p.c.z);
        if (d < best.d) best = { d, x, z };
      }
    const k = (best.d - 80) / best.d;
    const at = { x: p.c.x + (best.x - p.c.x) * k, z: p.c.z + (best.z - p.c.z) * k };
    const r = sim.dispatch({ type: 'disaster', kind: 'flood', at });
    if (!r.ok) throw new Error(`flood: ${r.reason}`);
    sim.advance(TICKS_PER_HOUR * 30);
    // It took the pumps, the treatment works and the outflows with it.
    for (const c of [...sim.state.civics.values()])
      if (['pump', 'riverpump', 'treatment', 'septic', 'outflow'].includes(c.def))
        sim.dispatch({ type: 'bulldoze', target: { kind: 'civic', id: c.id } });
    sim.advance(TICKS_PER_HOUR * 2);
    return sim;
  },
  // Saltmarsh, on the coast: a busy town with beaches and no reason yet for anyone to visit.
  resort: () => {
    const p = new Player('careful', { seed: 'saltmarsh', preset: 'coast', cityName: 'Saltmarsh' });
    p.avoid = [
      'hotel',
      'clocktower',
      'wheel',
      'conservatory',
      'stadium',
      'helioarray',
      'convention',
      'gardenexpo',
      'launchsite',
      'techpark',
      'university',
    ];
    const sim = p.sim;
    sim.earn(100_000, 'grants');
    govern(p, 20);
    // The avenue carries on east to the sea, with a promenade along the beach.
    const z = p.c.z;
    let shore = p.c.x + 2 * DW;
    while (shore < MAP_SIZE - 40 && sim.terrain.heightAt(shore, z) >= 0.6) shore += 8;
    const end = { x: shore - 70, z };
    p.roadAcross('avenue', { x: p.c.x + 2 * DW, z }, end);
    sim.dispatch({
      type: 'buildRoad',
      road: 'street',
      points: [
        { x: end.x, z: z - 200 },
        { x: end.x, z: z + 200 },
      ],
    });
    const zone = (letter: 'R' | 'C', a: Vec2, b: Vec2, radius: number) =>
      sim.dispatch({ type: 'zone', zone: letter, area: { kind: 'brush', points: [a, b], radius } });
    zone('C', { x: p.c.x + 2 * DW + 20, z: z + 20 }, { x: end.x - 20, z: z + 20 }, 22);
    zone('R', { x: p.c.x + 2 * DW + 20, z: z - 60 }, { x: end.x - 20, z: z - 60 }, 50);
    zone('R', { x: end.x - 40, z: z - 190 }, { x: end.x - 40, z: z + 190 }, 36);
    govern(p, 3);
    return sim;
  },
};
