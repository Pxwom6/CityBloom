import { describe, expect, it } from 'vitest';
import { Sim } from '../../src/sim/sim';
import { Battle } from '../../src/sim/battle/battle';
import { awayCity, awayInput, awayResult } from '../../src/sim/battle/away';
import { growRivalTown, townKey, type TownSpec } from '../../src/sim/ai/town';
import { checksum } from '../../src/sim/sync';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { militaryCivics } from '../../src/sim/systems/war';
import { buildTown, newSim, placeAlong, serveTown } from '../helpers';

/** M35: an expedition against a computer neighbour's town. */

function warCity(): Sim {
  const sim = newSim({ rivals: true, disasters: false });
  const { streets } = buildTown(sim);
  serveTown(sim);
  sim.advance(3 * TICKS_PER_MONTH);
  sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 1_000_000 });
  const segs = [...streets].reverse();
  const place = (def: string) => {
    for (const seg of segs)
      try {
        return placeAlong(sim, def, seg);
      } catch {
        /* next street */
      }
    throw new Error(`no room for ${def}`);
  };
  place('militaryhq');
  const barracks = place('barracks');
  const depot = place('vehicledepot');
  for (let k = 0; k < 4; k++) sim.dispatch({ type: 'trainUnit', base: barracks, kind: 'infantry' });
  for (const kind of ['tank', 'tank', 'transport'] as const)
    sim.dispatch({ type: 'trainUnit', base: depot, kind });
  sim.advance(6 * TICKS_PER_MONTH);
  return sim;
}

function spec(city: Sim, id: number): TownSpec {
  const n = city.state.region.neighbours.find((x) => x.id === id)!;
  return {
    citySeed: city.state.options.seed,
    neighbour: n.id,
    name: n.name,
    kind: n.kind,
    personality: n.rival!.personality,
    population: n.population,
    cap: 1_500,
  };
}

describe('expeditions (M35)', () => {
  const city = warCity();
  const w = city.state.war!;
  const rival = city.state.region.neighbours.find((n) => n.rival)!;
  const units = [...w.units.values()].map((u) => u.id);
  const land = [...w.units.values()].filter((u) => u.kind !== 'transport').map((u) => u.id);

  it('has trained a force to send', () => {
    expect(militaryCivics(city).length).toBe(3);
    expect(units.length).toBeGreaterThanOrEqual(6);
  });

  it('refuses a force that can’t go, with reasons', () => {
    const send = (over: Record<string, unknown>) =>
      city.preview({
        type: 'sendForce',
        units,
        to: rival.id,
        route: 'highway',
        target: 'military',
        stance: 'bold',
        ...over,
      } as never);
    const why = (r: ReturnType<typeof send>) => (r.ok ? '' : r.reason);
    expect(why(send({ target: 'cityhall' }))).toMatch(/declared war/);
    expect(why(send({ route: 'air' }))).toMatch(/Air routes/);
    expect(why(send({ units: [] }))).toMatch(/Choose/);
    expect(why(send({ to: 999 }))).toMatch(/No such/);
    expect(send({}).ok).toBe(true);
  });

  it('goes, arrives, fights in the town, and comes home', () => {
    const forces = rival.rival!.forces;
    const relation = rival.rival!.relation;
    const r = city.dispatch({
      type: 'sendForce',
      units: land,
      to: rival.id,
      route: 'highway',
      target: 'military',
      stance: 'bold',
    });
    expect(r.ok).toBe(true);
    const id = r.ok ? r.created![0]! : 0;
    expect(w.units.get(land[0]!)!.away).toBe(id);
    // Can't send the same units twice.
    expect(
      city.preview({
        type: 'sendForce',
        units: land,
        to: rival.id,
        route: 'highway',
        target: 'military',
        stance: 'bold',
      }).ok,
    ).toBe(false);
    const e = w.expeditions!.find((x) => x.id === id)!;
    let arrived = false;
    for (let t = 0; t < 12 * TICKS_PER_HOUR && !arrived; t++) {
      city.step();
      arrived = city.events.splice(0).some((ev) => ev.kind === 'forceArrived' && ev.id === id);
    }
    expect(arrived).toBe(true);
    expect(e.state).toBe('fighting');
    // The page's part: the town, the battle, the result.
    const town = growRivalTown(spec(city, rival.id));
    expect(town.state.totals.population).toBeGreaterThanOrEqual(1_000);
    expect(militaryCivics(town).length).toBeGreaterThan(2);
    const input = awayInput(awayCity(city, e), town);
    expect(input.attacker.units).toHaveLength(land.length);
    expect(input.layout.defenders.length).toBeGreaterThan(0);
    const battle = Battle.run(structuredClone(input));
    const result = awayResult(input, battle);
    // The same battle, fought again, ends the same.
    expect(awayResult(input, Battle.run(structuredClone(input)))).toEqual(result);
    expect(city.dispatch({ type: 'battleReport', expedition: id, result }).ok).toBe(true);
    expect(city.dispatch({ type: 'battleReport', expedition: id, result }).ok).toBe(false);
    const report = w.reports!.at(-1)!;
    expect(report.ours).toBe(true);
    expect(report.other).toBe(rival.name);
    expect(rival.rival!.relation).toBeLessThan(relation);
    expect(rival.rival!.forces).toBeLessThanOrEqual(forces);
    const out = result.units.filter((u) => u.out).map((u) => u.id);
    for (const u of out) expect(w.units.has(u)).toBe(false);
    // Home again after the journey back.
    city.advance(12 * TICKS_PER_HOUR);
    for (const u of land) if (w.units.has(u)) expect(w.units.get(u)!.away).toBeUndefined();
    expect(w.expeditions).toBeUndefined();
  });

  it('a neighbour’s town grows the same every time', () => {
    const s = spec(city, rival.id);
    const a = growRivalTown(s);
    const b = growRivalTown(s);
    expect(checksum(a)).toBe(checksum(b));
    expect(townKey(s)).toContain(String(rival.id));
  });
});
