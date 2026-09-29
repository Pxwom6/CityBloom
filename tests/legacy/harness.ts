import { readFileSync, readdirSync } from 'node:fs';
import { expect } from 'vitest';
import { decodeSave } from '../../src/client/saves';
import { PRESET_CLIMATE } from '../../src/data/climate';
import { Sim } from '../../src/sim/sim';
import { checkInvariants } from '../../src/sim/invariants';
import { dateOf, TICKS_PER_HOUR } from '../../src/sim/time';
import { BState } from '../../src/sim/world/buildings';
import { Player } from '../../scripts/lib/mayor';
import { buildTown, serveTown } from '../helpers';
import { missingFields } from './shape';

/**
 * The legacy save corpus (Phase 2 review): small towns grown by each milestone's own balance mayor
 * on every map preset (`scripts/dev/legacy-corpus.mjs`), with the playtest city Ashton and the
 * user's save. Each is loaded, checked for what a new city has, and played for two years with the
 * invariants checked every game hour.
 */
export const CORPUS = [
  'Saves/Ashton.citybloom',
  'Saves/Legacy-no-rail.citybloom',
  ...readdirSync('Saves/legacy')
    .filter((f) => f.endsWith('.citybloom'))
    .sort()
    .map((f) => `Saves/legacy/${f}`),
];

/** The version a corpus file was saved at. */
export function versionOf(file: string): number {
  return decodeSave(readFileSync(file)).version;
}

/** Fields a city may or may not have (per building, per civic, per road), and ledger lines. */
const OPTIONAL = new Set([
  'state.buildings[].toRegion',
  'state.buildings[].fromRegion',
  'state.civics[].build',
  'state.economy.carry',
  'state.economy.month',
  'state.economy.history[].lines',
  // Achievements the city has earned (by id).
  'state.progress.achievements',
]);

let reference: Sim | null = null;
/** A city grown from scratch today: what every loaded city should have too. */
function fresh(): Sim {
  if (reference) return reference;
  const sim = Sim.create({ seed: 'legacy-reference', preset: 'river' });
  buildTown(sim);
  serveTown(sim);
  sim.advance(2 * 1440);
  reference = sim;
  return sim;
}

export interface Month {
  population: number;
  approval: number;
  /** The treasury, with what the harness's keeper spent (or borrowed) added back. */
  treasury: number;
  /** Active buildings, and those without power or water. */
  active: number;
  dark: number;
}

export interface Played {
  sim: Sim;
  version: number;
  loadedAt: ReturnType<typeof dateOf>;
  months: Month[];
}

const monthOf = (sim: Sim): Month => {
  let dark = 0;
  let active = 0;
  for (const b of sim.state.buildings.values()) {
    if (b.state !== BState.Active) continue;
    active++;
    if (b.power <= 0 || b.water <= 0) dark++;
  }
  const t = sim.state.totals;
  return { population: t.population, approval: t.approval, treasury: sim.state.treasury, active, dark };
};

/** Load a corpus save, check it's whole, and play it for `months` months with invariants on. */
export function playLegacy(file: string, months = 24): Played {
  const save = decodeSave(readFileSync(file));
  const sim = Sim.fromSave(save);
  const s = sim.state;
  const loadedAt = dateOf(s.tick);
  // Everything a new city has, right after loading.
  expect(missingFields(fresh().state, s, OPTIONAL), `${file}: fields a new city has`).toEqual([]);
  // The rail link, or the building to lay one on offer.
  if (s.railway) {
    expect(s.net.segments.get(s.railway.segment)?.type).toBe('mainline');
    expect(s.net.nodes.get(s.railway.connect)).toBeDefined();
  } else expect(sim.stats().railLinkOffered, `${file}: no link and none on offer`).toBe(true);
  // Elections at a four-year mark to come, sensible weather, three neighbours.
  const month = loadedAt.totalMonths;
  if (!s.options.sandbox && s.options.elections !== false) {
    expect(s.election.nextMonth).toBeGreaterThan(month);
    expect(s.election.nextMonth).toBeLessThanOrEqual(month + 48);
    expect(s.election.nextMonth % 48).toBe(0);
  }
  if (!s.map) expect(s.weather.climate).toBe(PRESET_CLIMATE[s.options.preset]);
  expect(Number.isFinite(s.weather.temp)).toBe(true);
  expect(s.weather.seasons).toBe(true);
  // A city from before seasons eases into them (see the heating test).
  if (save.version < 20) expect(s.weather.grace?.from).toBe(s.tick);
  else expect(s.weather.grace).toBeUndefined();
  if (!s.scenario) {
    expect(s.region.neighbours).toHaveLength(3);
    for (const n of s.region.neighbours) expect(n.population).toBeGreaterThan(0);
  }
  // Two years, disasters off (they're the city's luck, not the save's), invariants every hour. It's
  // played as a player would at the least: power, water and sewage kept ahead of demand (the
  // careful mayor's utilities), everything else left to the city. Left wholly alone, a neglected
  // town (the old mayors' highland ones) regrows past its power, goes dark and empties, over and
  // over, which says nothing about its save.
  sim.testMode = true;
  sim.dispatch({ type: 'setDisasters', on: false });
  const keeper = new Player('careful', sim);
  // What the keeper spends and borrows, so the money check sees only what the city lost itself.
  let spent = 0;
  const out: Month[] = [monthOf(sim)];
  for (let m = 0; m < months; m++) {
    for (let h = 0; h < 24; h++) {
      if (h % 6 === 0) {
        const before = s.treasury;
        const u = s.utilityStats;
        // Short of power and of money for a plant: borrow, as a player would.
        if (u.power.supply < u.power.demand * 1.1 && s.treasury < 20_000 && !s.economy.loans.length)
          sim.dispatch({ type: 'takeLoan', amount: 50_000 });
        // A few plants a round if the city is racing ahead of them (while the money lasts).
        for (let k = 0; k < 4; k++) keeper.utilities(false);
        spent += before - s.treasury;
      }
      sim.advance(TICKS_PER_HOUR);
      checkInvariants(sim);
    }
    out.push({ ...monthOf(sim), treasury: s.treasury + spent });
  }
  return { sim, version: save.version, loadedAt, months: out };
}

/**
 * Month-on-month falls bigger than a quarter of the population, 15 points of approval, or a third of
 * the money. A fall in population after a month with a tenth or more of the buildings without power
 * or water is the city outgrowing its utilities (the advisors say so), not something the save did:
 * the corpus's highland towns from v10 to v14 were left half abandoned by the old mayor and regrow
 * faster than a player's plants go up.
 */
export function suddenDrops(months: Month[]): string[] {
  const out: string[] = [];
  for (let k = 1; k < months.length; k++) {
    const a = months[k - 1]!;
    const b = months[k]!;
    const short = a.dark > a.active * 0.1;
    if (b.population < a.population * 0.75 && a.population - b.population > 60 && !short)
      out.push(`month ${k}: population ${a.population} → ${b.population}`);
    if (a.approval - b.approval > 0.15)
      out.push(`month ${k}: approval ${Math.round(a.approval * 100)} → ${Math.round(b.approval * 100)} %`);
    if (b.treasury < a.treasury - Math.max(20_000, Math.abs(a.treasury) / 3))
      out.push(`month ${k}: treasury ${Math.round(a.treasury)} → ${Math.round(b.treasury)}`);
  }
  return out;
}
