// Scenario starting cities (M18): each scenario's city, built headlessly with the balance tool's
// mayor (plus the scenario's twist). scripts/scenarios.ts writes them to public/scenarios/.
import { Sim } from '../../src/sim/sim';
import { CIVIC } from '../../src/data/civic';
import { GRID_CELL, GRID_RES, MAP_SIZE } from '../../src/data/world';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { DW, Player, type Vec2 } from './mayor';
import { twoDistricts } from '../../tests/trafficTown';
import { crossroadsTown } from '../../tests/junctionTown';
import { RIDGE, ridgeMap } from './ridgeMap';
import { placeAlong } from '../../tests/helpers';
import { militaryCivics, startWar } from '../../src/sim/systems/war';
import { objectiveSpots } from '../../src/sim/battle/layout';
import { BState } from '../../src/sim/world/buildings';
import type { Personality, UnitKind } from '../../src/data/war';

/** Let a mayor run the city for some months (four decisions a month, as the balance tool). */
export function govern(p: Player, months: number): void {
  for (let m = 0; m < months; m++)
    for (let h = 0; h < 4; h++) {
      p.play();
      p.sim.advance(TICKS_PER_HOUR * 6);
    }
}

/** Run on to 07:00 of the next morning, where the day starts. */
export function toMorning(sim: Sim): void {
  const left = TICKS_PER_MONTH - (sim.state.tick % TICKS_PER_MONTH);
  if (left < TICKS_PER_MONTH) sim.advance(left);
}

/**
 * A town for a war scenario (M39): grown by the careful mayor in peace (no raids meanwhile) to
 * `pop` residents, then given rivals: war comes to it as to a city founded with rivals, and its
 * neighbours get the characters, forces and feelings the scenario says (by their place among the
 * computer neighbours).
 */
export interface RivalSpec {
  personality: Personality;
  forces: number;
  defences: number;
  relation: number;
  /** Its population, if the scenario wants it bigger or smaller than the region's draw. */
  population?: number;
  /** Held as a subject by the computer neighbour at this place (M39). */
  subjectOf?: number;
}

/** Give the city's computer neighbours (by their place) the characters, forces and feelings of a scenario. */
export function setRivals(sim: Sim, rivals: RivalSpec[]): void {
  const found = sim.state.region.neighbours.filter((n) => n.rival && !n.player);
  found.forEach((n, k) => {
    const r = rivals[k];
    if (!r) return;
    const { population, subjectOf, ...state } = r;
    Object.assign(n.rival!, state);
    n.rival!.allies = [];
    if (population) {
      n.population = population;
      n.history = [...n.history.slice(0, -1), population];
    }
    if (subjectOf !== undefined) n.rival!.subjectOf = found[subjectOf]!.id;
  });
}

export function warScenarioTown(seed: string, cityName: string, pop: number): Player {
  const p = new Player('careful', { seed, preset: 'river', cityName });
  const sim = p.sim;
  while (sim.state.totals.population < pop) {
    p.play();
    sim.advance(TICKS_PER_HOUR * 6);
  }
  sim.state.options.rivals = true;
  startWar(sim);
  // Quiet neighbours while the town builds its garrison: no raids, no wars before the scenario.
  for (const n of sim.state.region.neighbours) if (n.rival) n.rival.forces = 0.5;
  return p;
}

/** Paint the town into districts: its homes and shops split by how far east they stand (the first name takes the west half). */
export function districts(sim: Sim, names: string[]): void {
  const blds = [...sim.state.buildings.values()].filter((b) => b.state !== BState.Rubble);
  const xs = blds.map((b) => b.x).sort((a, b) => a - b);
  names.forEach((name, k) => {
    sim.dispatch({ type: 'createDistrict', name });
    const lo = xs[Math.floor((xs.length * k) / names.length)]!;
    const hi = xs[Math.min(xs.length - 1, Math.floor((xs.length * (k + 1)) / names.length))]!;
    const zs = blds.filter((b) => b.x >= lo && b.x <= hi).map((b) => b.z);
    const z = zs.reduce((a, v) => a + v, 0) / Math.max(1, zs.length);
    sim.dispatch({
      type: 'paintDistrict',
      district: k + 1,
      area: {
        kind: 'brush',
        points: [
          { x: lo, z },
          { x: hi, z },
        ],
        radius: 240,
      },
    });
  });
}

/**
 * A garrison for a war scenario's town (M39): the HQ and barracks (and a vehicle depot), bunkers
 * round the HQ, squads and tanks drilled over `days` days while the mayor keeps the lights on.
 */
export function garrison(
  p: Player,
  o: { depot?: boolean; bunkers: number; infantry: number; tanks?: number; days?: number },
): void {
  const sim = p.sim;
  for (const def of o.depot ? ['militaryhq', 'barracks', 'vehicledepot'] : ['militaryhq', 'barracks'])
    if (!p.place(def, 'industry')) throw new Error(`no room for the ${def}`);
  const hq = militaryCivics(sim).find((c) => c.def === 'militaryhq')!;
  for (let k = 0; k < o.bunkers; k++)
    if (!p.placeNear('bunker', hq, 300)) throw new Error('no room for the bunkers');
  const order = (def: string, kind: UnitKind, n: number) => {
    const base = militaryCivics(sim).find((c) => c.def === def);
    for (let k = 0; base && k < n; k++) sim.dispatch({ type: 'trainUnit', base: base.id, kind });
  };
  order('barracks', 'infantry', o.infantry);
  order('vehicledepot', 'tank', o.tanks ?? 0);
  // (A base trains one order at a time, twelve hours for a squad and two days for a tank.)
  const days = o.days ?? Math.max(o.infantry * 0.5, (o.tanks ?? 0) * 2) + 1;
  for (let d = 0; d < days; d++)
    for (let h = 0; h < 4; h++) {
      p.utilities(false);
      p.followAdvice();
      sim.advance(TICKS_PER_HOUR * 6);
    }
}

/** Train these units at the bases of the kinds that keep them, and wait for them (the forces first). */
export function trainForces(sim: Sim, units: UnitKind[]): void {
  for (const kind of units) {
    const base = militaryCivics(sim).find(
      (c) => c.def === (kind === 'infantry' ? 'barracks' : 'vehicledepot'),
    );
    if (base) sim.dispatch({ type: 'trainUnit', base: base.id, kind });
  }
  for (let m = 0; m < 12 && sim.state.war!.orders.size > 0; m++) sim.advance(TICKS_PER_MONTH);
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
  // Kingsmere (M21): the old market on the only road from the highway to the works and the estates
  // beyond, so every lorry passes through it; the council has painted it as the Old Market district.
  market: () => {
    const sim = Sim.create({ seed: 'kings', preset: 'river', cityName: 'Kingsmere' });
    const p = new Player('careful', sim);
    sim.earn(200_000, 'grants');
    const { x, z } = p.c;
    const at = (dx: number, dz: number): Vec2 => ({ x: x + dx, z: z + dz });
    const road = (type: 'avenue' | 'street', a: Vec2, b: Vec2) =>
      sim.dispatch({ type: 'buildRoad', road: type, points: [a, b] });
    const zone = (letter: 'R' | 'C' | 'I', a: Vec2, b: Vec2, radius: number) =>
      sim.dispatch({ type: 'zone', zone: letter, area: { kind: 'brush', points: [a, b], radius } });
    road('avenue', at(0, 0), at(920, 0));
    // The old town: shops on the avenue, homes up its two side streets to the north.
    for (const dx of [120, 240]) road('street', at(dx, -260), at(dx, 90));
    road('street', at(120, -260), at(240, -260));
    for (const dx of [600, 680, 760, 840, 920]) road('street', at(dx, -520), at(dx, 200));
    road('street', at(600, -520), at(920, -520));
    road('street', at(600, -300), at(920, -300));
    zone('C', at(60, 0), at(300, 0), 50);
    zone('R', at(180, -80), at(180, -250), 90);
    zone('I', at(580, 110), at(940, 110), 90);
    zone('R', at(580, -160), at(940, -160), 120);
    zone('R', at(580, -420), at(940, -420), 110);
    sim.dispatch({ type: 'createDistrict', name: 'Old Market' });
    sim.dispatch({
      type: 'paintDistrict',
      district: 1,
      area: { kind: 'brush', points: [at(60, 0), at(300, 0)], radius: 100 },
    });
    sim.dispatch({
      type: 'paintDistrict',
      district: 1,
      area: { kind: 'brush', points: [at(180, -100), at(180, -250)], radius: 100 },
    });
    for (let m = 0; m < 10; m++)
      for (let h = 0; h < 4; h++) {
        p.utilities(false);
        if (sim.state.totals.population >= 250) p.followAdvice();
        sim.advance(TICKS_PER_HOUR * 6);
      }
    sim.earn(60_000, 'grants');
    return sim;
  },
  // Frostvale (M22): an alpine town going into its first hard winter, with power for the autumn and
  // no snow ploughs. Grown from March to the end of October.
  winter: () => {
    const sim = Sim.create({ seed: 'frost', preset: 'highlands', cityName: 'Frostvale' });
    const p = new Player('careful', sim);
    p.avoid = ['works'];
    sim.earn(150_000, 'grants');
    const { x, z } = p.c;
    const at = (dx: number, dz: number): Vec2 => ({ x: x + dx, z: z + dz });
    const road = (type: 'avenue' | 'street', a: Vec2, b: Vec2) =>
      sim.dispatch({ type: 'buildRoad', road: type, points: [a, b] });
    const zone = (letter: 'R' | 'C' | 'I', a: Vec2, b: Vec2, radius: number) =>
      sim.dispatch({ type: 'zone', zone: letter, area: { kind: 'brush', points: [a, b], radius } });
    road('avenue', at(0, 0), at(900, 0));
    for (const dx of [120, 240, 360, 480, 600, 720, 840]) road('street', at(dx, -220), at(dx, 220));
    road('street', at(120, -220), at(840, -220));
    road('street', at(120, 220), at(840, 220));
    zone('C', at(100, 0), at(620, 0), 45);
    zone('R', at(100, -130), at(620, -130), 85);
    zone('R', at(100, 130), at(620, 130), 85);
    zone('I', at(700, -130), at(860, -130), 90);
    zone('R', at(700, 130), at(860, 130), 90);
    for (let m = 0; m < 8; m++)
      for (let h = 0; h < 4; h++) {
        p.utilities(false);
        if (sim.state.totals.population >= 250) p.followAdvice();
        sim.advance(TICKS_PER_HOUR * 6);
      }
    // Power for the autumn: coal and wind just over October's demand, nothing for winter's heating.
    const output = (def: string) => CIVIC.get(def)!.output?.power ?? 0;
    const target = sim.state.utilityStats.power.demand * 1.01;
    for (const c of [...sim.state.civics.values()].filter((c) => CIVIC.get(c.def)?.category === 'power'))
      sim.dispatch({ type: 'bulldoze', target: { kind: 'civic', id: c.id } });
    let supply = 0;
    while (supply + output('coal') <= target && p.place('coal', 'industry')) supply += output('coal');
    while (supply < target && p.place('wind', 'industry')) supply += output('wind');
    sim.advance(TICKS_PER_HOUR * 2);
    sim.earn(40_000, 'grants');
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
  // Harbourside (M23): a coastal town of about 11,000 whose newest coal plants have closed, with a road out
  // to the shore where a seaport could stand, and neighbours up the highway with power to sell.
  harbour: () => {
    const p = new Player('careful', { seed: 'port', preset: 'coast', cityName: 'Harbourside' });
    p.avoid = ['seaport', 'airport'];
    const sim = p.sim;
    for (let m = 0; m < 72 && sim.state.totals.population < 11_000; m++) govern(p, 1);
    // The avenue carries on east to the sea, with a street along the shore.
    const z = p.c.z;
    let shore = p.c.x + 2 * DW;
    while (shore < MAP_SIZE - 40 && sim.terrain.heightAt(shore, z) >= 0.6) shore += 8;
    const end = { x: shore - 110, z };
    p.roadAcross('avenue', { x: p.c.x + 2 * DW, z }, end);
    sim.dispatch({
      type: 'buildRoad',
      road: 'street',
      points: [
        { x: end.x, z: z - 400 },
        { x: end.x, z: z + 400 },
      ],
    });
    // The newest coal plants close: what's left gives about four-fifths of what the town needs.
    const output = (def: string) => CIVIC.get(def)!.output?.power ?? 0;
    const target = sim.state.utilityStats.power.demand * 0.8;
    const plants = [...sim.state.civics.values()]
      .filter((c) => CIVIC.get(c.def)?.category === 'power')
      .sort((a, b) => a.id - b.id);
    let supply = plants.reduce((n, c) => n + output(c.def), 0);
    for (const c of [...plants].reverse()) {
      if (c.def === 'wind' || supply - output(c.def) < target * 0.97) continue;
      supply -= output(c.def);
      sim.dispatch({ type: 'bulldoze', target: { kind: 'civic', id: c.id } });
    }
    sim.advance(TICKS_PER_HOUR * 2);
    sim.earn(150_000, 'grants');
    return sim;
  },
  // M24: a hill town on a map shaped for it (scripts/lib/ridgeMap.ts): a planned grid filling the
  // shelf of flat land by the highway, on wind power, grown until the shelf is full. The ridge and
  // its saddle stand between it and the open valley to the east.
  terraces: () => {
    const map = ridgeMap();
    const sim = Sim.create({ seed: map.seed, cityName: 'Ridgeholm', difficulty: 'normal' }, map);
    // The scenario is played without seasons (the land is the puzzle), and grown that way.
    sim.dispatch({ type: 'setWeather', seasons: false });
    sim.earn(200_000, 'grants');
    const hz = RIDGE.highwayZ;
    const east = RIDGE.shelf.x - 30;
    const reach = RIDGE.shelf.z - 30;
    const road = (type: 'street' | 'avenue', a: Vec2, b: Vec2) => {
      const r = sim.dispatch({ type: 'buildRoad', road: type, points: [a, b] });
      return r.ok ? r.created! : [];
    };
    const hw = sim.state.net.nodes.get(sim.state.highway.connect)!;
    const avenue = road('avenue', { x: hw.x, z: hz }, { x: east, z: hz });
    for (let x = 100; x <= east; x += 110) road('street', { x, z: hz - reach }, { x, z: hz + reach });
    for (const dz of [-reach, -190, 190, reach])
      road('street', { x: 40, z: hz + dz }, { x: east, z: hz + dz });
    const zone = (z: 'R' | 'C' | 'I', a: Vec2, b: Vec2, radius: number) =>
      sim.dispatch({ type: 'zone', zone: z, area: { kind: 'brush', points: [a, b], radius } });
    zone('C', { x: 40, z: hz }, { x: east, z: hz }, 40);
    zone('R', { x: 40, z: hz - 110 }, { x: east, z: hz - 110 }, 70);
    zone('R', { x: 40, z: hz - 270 }, { x: east, z: hz - 270 }, 70);
    zone('R', { x: 40, z: hz + 110 }, { x: east, z: hz + 110 }, 70);
    zone('I', { x: 40, z: hz + 270 }, { x: east, z: hz + 270 }, 70);
    // Utilities and services along the streets: wind on the shelf's southern edge.
    const segs = () =>
      [...sim.state.net.segments.values()].filter((g) => g.type === 'street').map((g) => g.id);
    const south = () => segs().sort((a, b) => sim.net.curve(b).pointAt(0).z - sim.net.curve(a).pointAt(0).z);
    const put = (def: string, order = segs()) => {
      for (const id of order)
        try {
          return placeAlong(sim, def, id);
        } catch {
          /* no room here */
        }
      return null;
    };
    for (let k = 0; k < 4; k++) put('wind', south());
    for (const def of [
      'pump',
      'pump',
      'septic',
      'septic',
      'landfill',
      'firestation',
      'police',
      'clinic',
      'park_small',
    ])
      put(def);
    for (let m = 0; m < 8; m++) {
      sim.advance(TICKS_PER_MONTH);
      // Keep the lights on and the taps running as the shelf fills.
      const u = sim.state.utilityStats;
      for (let k = 0; k < 6 && u.power.demand > u.power.supply * 0.75; k++) {
        if (!put('wind', south())) break;
        u.power.supply += CIVIC.get('wind')!.output?.power ?? 0;
      }
      if (u.water.demand > u.water.supply * 0.8) put('pump');
      if (u.sewage.demand > u.sewage.supply * 0.8) put('septic');
      if (m === 3) put('primary');
    }
    void avenue;
    // The council's development fund, for the land beyond the ridge.
    sim.earn(200_000, 'grants');
    return sim;
  },
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
  // Stonegate (M39): a compact town by the highway with a small garrison, and three neighbours that
  // mean it harm. The invasion is scripted (src/data/scenarios.ts): three waves at the factories
  // by the highway, growing.
  holdline: () => {
    const p = warScenarioTown('bastion', 'Stonegate', 2_300);
    const sim = p.sim;
    sim.earn(200_000, 'grants');
    for (const def of ['militaryhq', 'barracks', 'shelter'])
      if (!p.place(def, 'industry')) throw new Error(`no room for the ${def}`);
    // Three bunkers beside the factories by the highway, where the raiders will go.
    const factories = objectiveSpots(sim, 'industry');
    const heart = factories[Math.floor(factories.length / 2)] ?? p.c;
    for (let k = 0; k < 3; k++)
      if (!p.placeNear('bunker', heart, 400)) throw new Error('no room for the bunkers');
    // The garrison drills for a few days while the town keeps its lights on and its taps running.
    for (const kind of ['infantry', 'infantry', 'infantry', 'infantry'] as const) {
      const barracks = militaryCivics(sim).find((c) => c.def === 'barracks')!;
      sim.dispatch({ type: 'trainUnit', base: barracks.id, kind });
    }
    for (let m = 0; m < 3; m++)
      for (let h = 0; h < 4; h++) {
        p.utilities(false);
        p.followAdvice();
        sim.advance(TICKS_PER_HOUR * 6);
      }
    setRivals(sim, [
      { personality: 'aggressive', forces: 30, defences: 8, relation: -45 },
      { personality: 'treacherous', forces: 14, defences: 5, relation: -20 },
      { personality: 'honourable', forces: 10, defences: 8, relation: 10 },
    ]);
    toMorning(sim);
    return sim;
  },
  // Westmarch (M39): a town of about 5,000 with a thin garrison and two districts, and an aggressive
  // neighbour that outguns it and wants a fight. A war to win without giving up a district.
  cleanwar: () => {
    const p = warScenarioTown('arden', 'Westmarch', 5_200);
    const sim = p.sim;
    sim.earn(260_000, 'grants');
    districts(sim, ['Old Town', 'New Quarter']);
    garrison(p, { depot: true, bunkers: 3, infantry: 6, tanks: 1 });
    // The aggressor is a big town, and its strength is what its size keeps.
    setRivals(sim, [
      {
        personality: 'aggressive',
        forces: 44,
        defences: 12,
        relation: -55,
        population: 18_000,
      },
      { personality: 'cautious', forces: 6, defences: 12, relation: 5 },
      { personality: 'mercantile', forces: 5, defences: 6, relation: 15 },
    ]);
    toMorning(sim);
    return sim;
  },
  // Coldharbour (M39): a town of about 5,000 with a small garrison. Its old friend Lark Spa, to the
  // west, is held as a subject by Dunford, an aggressive neighbour with the bigger army; honourable
  // Norcombe, to the south, is a friend who might stand by the city in a war.
  liberation: () => {
    const p = warScenarioTown('tidewater', 'Coldharbour', 5_200);
    const sim = p.sim;
    sim.earn(240_000, 'grants');
    garrison(p, { depot: true, bunkers: 3, infantry: 6, tanks: 1 });
    setRivals(sim, [
      {
        personality: 'aggressive',
        forces: 44,
        defences: 12,
        relation: -50,
        population: 18_000,
      },
      { personality: 'honourable', forces: 10, defences: 12, relation: 45 },
      { personality: 'honourable', forces: 6, defences: 8, relation: 50, subjectOf: 0 },
    ]);
    toMorning(sim);
    return sim;
  },
};
