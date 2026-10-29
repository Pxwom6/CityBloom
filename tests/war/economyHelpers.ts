import { expect } from 'vitest';
import type { Term } from '../../src/data/diplomacy';
import { INVEST } from '../../src/data/warEconomy';
import type { UnitKind } from '../../src/data/war';
import type { Command } from '../../src/sim/commands';
import { Sim } from '../../src/sim/sim';
import { isMonthStart } from '../../src/sim/time';
import { monthlyRates } from '../../src/sim/systems/economy';
import type { Neighbour } from '../../src/sim/systems/region';
import { newSim } from '../helpers';

/**
 * What the war economy's tests share (M38 steps 4 and 5): a war city with rival neighbours that like
 * it and have no alliances among themselves, treaties made through the proposal cheat, units planted
 * at a base that needn't exist, and the ledger read month by month.
 */

export const rivals = (sim: Sim): Neighbour[] =>
  sim.state.region.neighbours.filter((n) => n.rival && !n.player);

/** Run a command that must work. */
export const ok = (sim: Sim, cmd: Command) => {
  const r = sim.dispatch(cmd);
  if (!r.ok) throw new Error(`${cmd.type}: ${r.reason}`);
  return r;
};

/** Run a command; null when it was done, else the reason it wasn't. */
export const why = (sim: Sim, cmd: Command): string | null => {
  const r = sim.dispatch(cmd);
  return r.ok ? null : r.reason;
};

export const dip = (sim: Sim) => sim.state.war!.diplomacy!;
export const eco = (sim: Sim) => sim.state.war!.economy!;

/** A war city with rival neighbours that like it (no premium), no alliances among them, and money. */
export function warCity(): Sim {
  const sim = newSim({ rivals: true, disasters: false });
  sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 5_000_000 });
  for (const n of rivals(sim)) {
    n.rival!.relation = INVEST.premium.to;
    n.rival!.allies = [];
  }
  return sim;
}

/** Set the treasury, keeping the money invariant (the month's start moves with it). */
export function setTreasury(sim: Sim, v: number): void {
  const e = sim.state.economy;
  e.monthStartTreasury += v - sim.state.treasury;
  sim.state.treasury = v;
}

/** A copy of the city as it stands, which plays on from the same dice. */
export function clone(sim: Sim): Sim {
  const copy = Sim.fromSave(sim.save('2026-10-29'));
  copy.testMode = true;
  return copy;
}

/** Step to the next month's start (the tick whose month block has just run). */
export function toMonthStart(sim: Sim): void {
  do sim.step();
  while (!isMonthStart(sim.state.tick));
}

/** A line's total over the months closed (the last 24) and the month so far. */
export function total(sim: Sim, key: string): number {
  const e = sim.state.economy;
  return e.history.reduce((a, h) => a + (h.lines[key] ?? 0), 0) + (e.month[key] ?? 0);
}

/** The line in the last month closed. */
export const lastMonth = (sim: Sim, key: string): number => sim.state.economy.history.at(-1)?.lines[key] ?? 0;

/** The line's rate a month, at current conditions. */
export const rate = (sim: Sim, key: string): number => monthlyRates(sim)[key] ?? 0;

/** The neighbour puts these terms to the city and the city accepts. */
export function treaty(sim: Sim, id: number, terms: Term[]): void {
  ok(sim, { type: 'cheat', cheat: 'proposal', neighbour: id, terms });
  const p = dip(sim).proposals.find((x) => x.from === 'them' && x.with === id)!;
  ok(sim, { type: 'answerProposal', proposal: p.id, accept: true });
}

/** The first rival of this kind. */
export function ofKind(sim: Sim, kind: Neighbour['kind']): Neighbour {
  const n = rivals(sim).find((x) => x.kind === kind);
  expect(n, `a ${kind} neighbour`).toBeDefined();
  return n!;
}

/** A unit of this kind and health at home, planted at a base that needn't exist; returns its id. */
export function addUnit(sim: Sim, kind: UnitKind, hp = 1): number {
  const w = sim.state.war!;
  const id = sim.state.nextId++;
  w.units.set(id, { id, kind, base: 0, hp, born: sim.state.tick });
  return id;
}

/** Put munitions in the war stores. */
export function stockUp(sim: Sim, crates: number): void {
  sim.state.war!.stock.munitions = crates;
}

/** A friend's city in the place of the first computer neighbour, as a shared region's news brings it. */
export function friendTakesPlace(sim: Sim): void {
  const none = { power: 0, water: 0, garbage: 0 };
  ok(sim, {
    type: 'regionUpdate',
    update: {
      cities: [
        {
          slot: 2,
          name: 'Samton',
          mayor: 'Sam',
          color: 1,
          population: 5_000,
          kind: 'suburb',
          offers: { buy: { ...none }, sell: { ...none } },
          workers: 0,
          jobs: 0,
          shoppers: 0,
          online: true,
        },
      ],
      contracts: [],
      project: null,
    },
  });
}
