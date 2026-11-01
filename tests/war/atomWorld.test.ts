import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ATOM, atomEventText, atomStageNo } from '../../src/data/atom';
import { RAIDS } from '../../src/data/battle';
import { DIPLOMACY, type Term } from '../../src/data/diplomacy';
import { SANCTION } from '../../src/data/warEconomy';
import { DOME, TIER_KEYS } from '../../src/data/research';
import { declareWarning } from '../../src/client/friendsWar';
import type { Sim } from '../../src/sim/sim';
import { atomChronicle, bombShame, homeShame } from '../../src/sim/systems/atomWorld';
import { atomDeters, atomFired, atomHour, atomStage, atomTick } from '../../src/sim/systems/atom';
import { CHRONICLE, chronicleEvent } from '../../src/sim/systems/chronicle';
import {
  diplomacyMonth,
  fightingWith,
  isPariah,
  makePariah,
  reputationChange,
  reputationOf,
  warWith,
  weigh,
} from '../../src/sim/systems/diplomacy';
import { happinessFactors } from '../../src/sim/systems/happiness';
import { raidThreat } from '../../src/sim/systems/war';
import { sanctionCause, sanctionsBetween, sanctionText } from '../../src/sim/systems/warEconomy';
import { diplomacySummary } from '../../src/sim/systems/diplomacy';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { ZONE_R } from '../../src/data/zones';
import { BState } from '../../src/sim/world/buildings';
import { clone, dip, eco, rivals, treaty, why } from './economyHelpers';
import { labTown, ok } from './researchTown';

/**
 * M40, step 6, the world reacts (docs/plans/M40-design.md, calls 14 and 15; the plan's test 8, sim
 * half): the city that fires the bomb is a pariah (a reputation of nothing for good, every
 * neighbour's sanction, its pacts ended, any neighbour's total war with no cooldown), its people
 * protest in approval and in homes, the chronicle keeps the launch, and a bomb held ready deters.
 * What the region's room does for friends is step 9.
 */

// (Most of these play months of a town; the default five seconds is for tests that don't.)
vi.setConfig({ testTimeout: 120_000 });

const H = TICKS_PER_HOUR;
const M = TICKS_PER_MONTH;
const SILO = 'atomsilo';
const PLANT = 'enrichment';
const DOME_DEF = 'domeshield';

const civic = (sim: Sim, def: string) => [...sim.state.civics.values()].find((c) => c.def === def)!;
const atom = (sim: Sim) => sim.state.war!.atom!;
const events = (sim: Sim, kind: string) => sim.events.filter((e) => e.kind === kind);
const neighbour = (sim: Sim, id: number) => rivals(sim).find((n) => n.id === id)!;
const atomLines = (sim: Sim) => sim.state.chronicle.events.filter((e) => e.kind === 'atom');

/** Everyone in the region is dark for ever: no raids or spies to spoil a run that is about something else. */
function dark(sim: Sim): void {
  for (const n of rivals(sim)) n.rival!.blackout = { from: 0, until: 1e9 };
}

/** The crews are in, the power is on: the silo works at full rate. */
function crewed(sim: Sim): void {
  for (const def of [PLANT, SILO]) {
    civic(sim, def).staff = 1;
    civic(sim, def).powered = 1;
  }
}

let base: Sim;
let ids: { rival: number; pacted: number; spare?: number };

beforeAll(() => {
  const { sim, place } = labTown(0, { length: 800, streets: 7 });
  dark(sim);
  place('nuclear');
  sim.advance(M);
  ok(sim, { type: 'cheat', cheat: 'research', tiers: [...TIER_KEYS] });
  ok(sim, { type: 'cheat', cheat: 'addMoney', amount: 60_000_000 });
  for (const def of [PLANT, SILO, DOME_DEF])
    ok(sim, { type: 'cheat', cheat: 'finishStages', civic: place(def) });
  sim.advance(3 * M);
  const [rival, pacted, spare] = rivals(sim);
  // Peace with the neighbours that feel fondly of the city: two pacts of friendship with one, a deal
  // with it, and a deal with the other too (the third, if there is one, has nothing at all with it).
  for (const n of rivals(sim)) {
    n.rival!.relation = 50;
    n.rival!.allies = [];
  }
  const kinds: Term[][] = [[{ k: 'nonAggression', months: 24 }], [{ k: 'defensivePact' }]];
  treaty(sim, pacted!.id, kinds[0]!);
  ok(sim, { type: 'setDeal', neighbour: pacted!.id, resource: 'power', direction: 'buy', amount: 100 });
  if (spare) treaty(sim, spare.id, kinds[1]!);
  ok(sim, { type: 'declareWar', neighbour: rival!.id, scale: 'total', reason: 'The race' });
  const war = dip(sim).wars.find((w) => w.with === rival!.id)!;
  sim.advance(Math.max(0, war.opens - sim.state.tick) + 1);
  expect(fightingWith(sim, rival!.id)?.scale).toBe('total');
  // The city is old enough to be raided, so that the neighbours may declare on it (and `lowBar` makes it
  // big enough: the test town tops out under 3,000 residents).
  while (sim.state.tick < RAIDS.minMonths * M) sim.advance(M);
  base = sim;
  ids = { rival: rival!.id, pacted: pacted!.id, spare: spare?.id };
}, 300_000);

/**
 * Runs `fn` with the bar of residents a city must have before it can be raided or declared on lowered,
 * as `raid.test.ts` does: the test town tops out under `RAIDS.minPopulation`.
 */
function lowBar<T>(fn: () => T): T {
  const bar = RAIDS.minPopulation;
  (RAIDS as { minPopulation: number }).minPopulation = 1_000;
  try {
    expect(raidThreat(base).open, 'the town is old enough').toBe(true);
    return fn();
  } finally {
    (RAIDS as { minPopulation: number }).minPopulation = bar;
  }
}

/** A copy of the base town. */
const town = (): Sim => clone(base);

/** The bomb leaves the silo for the rival at war: the real path, a launch prepared and then fired. */
function fire(sim: Sim): void {
  ok(sim, { type: 'cheat', cheat: 'atom', stage: 'preparing', to: ids.rival });
  crewed(sim);
  for (let k = 0; k < ATOM.launch.prepHours && !atom(sim).fired; k++) atomHour(sim);
  expect(atom(sim).fired, 'the bomb left').toBeDefined();
}

describe('M40: the firer is a pariah', () => {
  it('has a reputation of nothing that no call raises, in five game years', () => {
    const sim = town();
    expect(reputationOf(sim)).toBe(DIPLOMACY.reputation.start);
    expect(isPariah(sim)).toBe(false);
    fire(sim);
    expect(isPariah(sim)).toBe(true);
    expect(dip(sim).pariah).toEqual({ tick: sim.state.tick });
    expect(reputationOf(sim)).toBe(0);
    expect(dip(sim).reputation).toBe(0);
    // A call that would raise it by thirty, and one that would lower it.
    reputationChange(sim, 30);
    expect(reputationOf(sim)).toBe(0);
    reputationChange(sim, -30);
    expect(reputationOf(sim)).toBe(0);
    // The mend that raises everyone else's by a point a month: five game years of months (a game
    // year is twelve).
    for (let k = 0; k < 5 * 12; k++) {
      diplomacyMonth(sim);
      sim.state.tick += M;
      expect(reputationOf(sim), `month ${k}`).toBe(0);
    }
    expect(dip(sim).reputation).toBe(0);
    expect(diplomacySummary(sim)!.reputation).toBe(0);
    expect(diplomacySummary(sim)!.pariah).toEqual({ since: dip(sim).pariah!.tick });
  });

  it('keeps it at nothing over real months too, with the world against it', () => {
    const sim = town();
    fire(sim);
    reputationChange(sim, 30);
    sim.advance(6 * M);
    expect(reputationOf(sim)).toBe(0);
    expect(dip(sim).reputation).toBe(0);
  });

  it('is made once: a second call changes nothing, and the mark keeps the first tick', () => {
    const sim = town();
    fire(sim);
    const since = dip(sim).pariah!.tick;
    sim.state.tick += 5 * H;
    const log = dip(sim).log.length;
    atomFired(sim);
    makePariah(sim);
    expect(dip(sim).pariah!.tick).toBe(since);
    expect(dip(sim).log.length).toBe(log);
  });

  it('does not happen to a city that never fired, or whose launch was refused', () => {
    const sim = town();
    expect(dip(sim).pariah).toBeUndefined();
    // A prepared bomb at a neighbour the city is not at war with: the launch is refused outright.
    ok(sim, { type: 'cheat', cheat: 'atom', stage: 'ready' });
    expect(why(sim, { type: 'launchBomb', to: ids.pacted })).toMatch(/total war/i);
    expect(isPariah(sim)).toBe(false);
    expect(reputationOf(sim)).toBe(DIPLOMACY.reputation.start);
    expect(atomDeters(sim)).toBe(true);
  });

  it('is the only thing that writes the reputation: nothing else in src/sim reads or adds to it', () => {
    // A grep of the sim: the figure is written in `reputationChange` and read in `reputationOf`; every
    // other reader asks the accessor. (The invariants read the raw figure to check it, as they must.)
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(join(__dirname, '../../src/sim'));
    const found: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
        .split('\n')
        .map((l) => l.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, ''))
        // The data constants (`DIPLOMACY.reputation`, `INTEL.caught.reputation`, `SANCTION.reputation`)
        // are numbers, not the city's figure.
        .map((l) => l.replace(/\b(?:DIPLOMACY|INTEL\.caught|SANCTION)\.reputation\b/g, 'DATA'))
        .join('\n');
      for (const m of text.matchAll(/\.reputation\b(\s*[-+*/]?=(?!=))?/g)) {
        const before = text.slice(0, m.index);
        const fn = [...before.matchAll(/^(?:export )?function (\w+)/gm)].pop()?.[1];
        found.push(`${file.replace(/.*src\/sim\//, '')}: ${fn}: ${m[0]}`);
      }
    }
    expect(found.sort()).toEqual([
      'invariants.ts: checkPariah: .reputation',
      'invariants.ts: checkPariah: .reputation',
      'systems/diplomacy.ts: reputationChange: .reputation',
      'systems/diplomacy.ts: reputationChange: .reputation =',
      'systems/diplomacy.ts: reputationOf: .reputation',
    ]);
  });
});

describe('M40: every neighbour sanctions the firer', () => {
  it('imposes the sanction on every computer neighbour, with or without a deal, and never lifts it', () => {
    const sim = town();
    const all = rivals(sim);
    expect(all.length).toBeGreaterThanOrEqual(2);
    // Before: nothing between the city and them, the deal with `pacted` standing.
    expect(sim.state.region.deals.some((d) => d.neighbour === ids.pacted)).toBe(true);
    expect(eco(sim).sanctionedBy ?? {}).toEqual({});
    sim.events = [];
    fire(sim);
    const by = eco(sim).sanctionedBy!;
    for (const n of all) {
      expect(by[n.id], n.name).toMatchObject({ cause: 'bomb', since: sim.state.tick });
      expect(sanctionCause(sim, n)).toBe('bomb');
      expect(sanctionsBetween(sim, n.id)).toBe(true);
    }
    // No deal left with anyone; the neighbour with none to cut sanctions all the same.
    expect(sim.state.region.deals).toEqual([]);
    const told = events(sim, 'diplomacy').filter((e) => e.info?.what === 'sanctionedUs');
    expect(told).toHaveLength(all.length);
    expect(String(told[0]!.info!.text)).toMatch(/sanctions the city for firing the atom bomb/);
    expect(sanctionText(sim, all[0]!, 'bomb')).toMatch(/will not lift it/);
    // It stays: month after month, a year on, with the war over or not, and whatever the standing.
    for (let k = 0; k < 40; k++) {
      sim.advance(M);
      for (const n of all) expect(eco(sim).sanctionedBy![n.id]?.cause, `${n.name} month ${k}`).toBe('bomb');
    }
  }, 120_000);

  it('does not sanction through a neighbour that has fallen to the city, or a friend', () => {
    const sim = town();
    const spare = ids.spare !== undefined ? neighbour(sim, ids.spare) : neighbour(sim, ids.pacted);
    spare.rival!.vassal = { since: sim.state.tick };
    fire(sim);
    expect(sanctionCause(sim, spare)).toBeNull();
    expect(eco(sim).sanctionedBy![spare.id]).toBeUndefined();
    expect(eco(sim).sanctionedBy![ids.rival]).toMatchObject({ cause: 'bomb' });
  });

  it('wins over a pact broken in the same breath (the cause is the bomb)', () => {
    const sim = town();
    const n = neighbour(sim, ids.pacted);
    n.rival!.personality = 'honourable';
    fire(sim);
    expect(eco(sim).sanctionedBy![n.id]!.cause).toBe('bomb');
    // (A breach after it is lost in the same sanction.)
    const pact = dip(sim).pacts.find((p) => p.with === n.id);
    expect(pact).toBeUndefined();
  });
});

describe('M40: pacts and feelings', () => {
  it('ends every pact of friendship with every computer neighbour, with no breach counted', () => {
    const sim = town();
    const before = dip(sim).pacts.filter((p) =>
      ['nonAggression', 'alliance', 'defensivePact'].includes(p.term.k),
    );
    expect(before.length).toBeGreaterThanOrEqual(1);
    expect(reputationOf(sim)).toBe(60);
    const relations = Object.fromEntries(rivals(sim).map((n) => [n.id, n.rival!.relation]));
    sim.events = [];
    fire(sim);
    expect(
      dip(sim).pacts.filter((p) => ['nonAggression', 'alliance', 'defensivePact'].includes(p.term.k)),
    ).toEqual([]);
    const ended = events(sim, 'diplomacy').filter((e) => e.info?.what === 'pactsEnded');
    // (One notice for each neighbour that had any.)
    expect(ended).toHaveLength(new Set(before.map((p) => p.with)).size);
    expect(String(ended[0]!.info!.text)).toMatch(/over the atom bomb/);
    // No breach: the city's word is not "broken" (that would be a note of its own, and a fall of 30
    // from a standing of 60 that the pariah's nothing hides: the neighbours' feelings tell).
    expect(events(sim, 'diplomacy').some((e) => e.info?.what === 'broken')).toBe(false);
    // The target's feeling is the bottom; every other neighbour's falls by the world's figure, and no
    // more (a breach would have added `declareRelation`).
    const rival = neighbour(sim, ids.rival);
    expect(rival.rival!.relation).toBe(ATOM.world.target);
    for (const n of rivals(sim)) {
      if (n.id === ids.rival) continue;
      expect(n.rival!.relation, n.name).toBe(Math.max(-100, relations[n.id]! + ATOM.world.others));
    }
  });

  it('lowers the target’s allies by their own figure', () => {
    const sim = town();
    const rival = neighbour(sim, ids.rival);
    const ally = neighbour(sim, ids.pacted);
    rival.rival!.allies = [ally.id];
    ally.rival!.relation = 10;
    const other = ids.spare !== undefined ? neighbour(sim, ids.spare) : null;
    const otherBefore = other?.rival!.relation;
    const saved = ATOM.world.allies;
    // (The allies' figure and the others' are both 40 now; the code keeps them apart, so try them apart.)
    (ATOM.world as { allies: number }).allies = -25;
    try {
      fire(sim);
    } finally {
      (ATOM.world as { allies: number }).allies = saved;
    }
    expect(ally.rival!.relation).toBe(10 - 25);
    if (other) expect(other.rival!.relation).toBe(otherBefore! + ATOM.world.others);
  });
});

describe('M40: any neighbour may declare a total war on the pariah', () => {
  /**
   * The neighbour is made a keen enemy (or not) and its war with the city "just ended"; the month's
   * diplomacy runs again and again, the war that ended refreshed each time, until it declares or the
   * days run out. Returns the war it declared, if it did.
   */
  function tries(
    sim: Sim,
    id: number,
    opts: {
      personality?: 'aggressive' | 'cautious';
      forces?: number;
      days?: number;
      /** Its feeling for the city (the default is a keen -60; `keep` leaves what the world made of it). */
      relation?: number | 'keep';
    } = {},
  ) {
    const n = neighbour(sim, id);
    n.rival!.personality = opts.personality ?? 'aggressive';
    n.rival!.forces = opts.forces ?? 50;
    if (opts.relation !== 'keep') n.rival!.relation = opts.relation ?? -60;
    // (A pact in the way would hold a control back for a reason that is not the one tried.)
    dip(sim).pacts = dip(sim).pacts.filter((p) => p.with !== id);
    return lowBar(() => {
      for (let k = 0; k < (opts.days ?? 80); k++) {
        (dip(sim).ended ??= {})[id] = sim.state.tick;
        diplomacyMonth(sim);
        sim.state.tick += M;
        const war = warWith(sim, id);
        if (war) return war;
      }
      return undefined;
    });
  }

  it('declares at once of its own accord, with no cooldown after a war that ended', () => {
    const control = town();
    expect(tries(control, ids.pacted)).toBeUndefined();
    const sim = town();
    fire(sim);
    const war = tries(sim, ids.pacted);
    expect(war, 'the pariah is declared on').toBeDefined();
    expect(war).toMatchObject({ by: 'them', scale: 'total' });
    expect(war!.reason).toMatch(/atom bomb/);
    expect(sim.state.tick - dip(sim).ended![ids.pacted]!).toBeLessThan(DIPLOMACY.cooldownMonths * M);
  }, 120_000);

  it('declares against a city half as strong as itself, which a city that has not fired is safe from', () => {
    const control = town();
    const strength = Math.max(1, 1);
    expect(tries(control, ids.pacted, { forces: strength * 0.7 })).toBeUndefined();
    const sim = town();
    fire(sim);
    expect(tries(sim, ids.pacted, { forces: strength * 0.7 })).toMatchObject({ scale: 'total' });
    // Below the half it still holds back.
    const weak = town();
    fire(weak);
    expect(tries(weak, ids.pacted, { forces: strength * 0.3, days: 60 })).toBeUndefined();
  }, 180_000);

  it('declares whatever its character: a cautious neighbour too, on the feeling the bomb gave it', () => {
    // Even at war-hungry odds a cautious neighbour (aggression 0.15) is never the one to start one.
    const control = town();
    expect(tries(control, ids.pacted, { personality: 'cautious', days: 150 })).toBeUndefined();
    // A neighbour the city never wronged (a feeling of 0): the bomb alone turns it hostile.
    const sim = town();
    neighbour(sim, ids.pacted).rival!.relation = 0;
    fire(sim);
    expect(neighbour(sim, ids.pacted).rival!.relation).toBe(ATOM.world.others);
    expect(tries(sim, ids.pacted, { personality: 'cautious', relation: 'keep', days: 200 })).toMatchObject({
      by: 'them',
      scale: 'total',
    });
  }, 180_000);
});

describe('M40: the protest at home', () => {
  /** Two copies of the town, one of them a pariah (the mark and nothing else) for `months`. */
  function twins(months: number) {
    const control = town();
    const ashamed = town();
    makePariah(ashamed);
    control.advance(months * M);
    ashamed.advance(months * M);
    return { control, ashamed };
  }

  it('is exactly nothing in a city that never fired', () => {
    const sim = town();
    expect(Object.is(bombShame(sim), 0)).toBe(true);
    expect(Object.is(homeShame(sim), 0)).toBe(true);
    const homes = [...sim.state.buildings.values()].filter(
      (b) => b.zone === ZONE_R && b.state === BState.Active,
    );
    expect(homes.length).toBeGreaterThan(5);
    for (const b of homes) expect(happinessFactors(sim, b).some((f) => /Ashamed/.test(f.label))).toBe(false);
  });

  it('eases in a straight line from the first figure to the lasting one', () => {
    const sim = town();
    makePariah(sim);
    const t0 = sim.state.tick;
    expect(bombShame(sim)).toBe(ATOM.shame.approval.start);
    expect(homeShame(sim)).toBe(ATOM.shame.home.start);
    const span = ATOM.shame.hours * H;
    sim.state.tick = t0 + span / 2;
    expect(bombShame(sim)).toBeCloseTo((ATOM.shame.approval.start + ATOM.shame.approval.end) / 2, 12);
    expect(homeShame(sim)).toBeCloseTo((ATOM.shame.home.start + ATOM.shame.home.end) / 2, 12);
    sim.state.tick = t0 + span;
    expect(bombShame(sim)).toBe(ATOM.shame.approval.end);
    expect(homeShame(sim)).toBe(ATOM.shame.home.end);
    // And it stays: shame fades but never goes.
    sim.state.tick = t0 + 100 * span;
    expect(bombShame(sim)).toBe(ATOM.shame.approval.end);
    expect(homeShame(sim)).toBe(ATOM.shame.home.end);
    expect(ATOM.shame.approval.start).toBe(-0.3);
    expect(ATOM.shame.home.start).toBe(-0.25);
  });

  it('names the factor in every home', () => {
    const sim = town();
    makePariah(sim);
    const homes = [...sim.state.buildings.values()].filter(
      (b) => b.zone === ZONE_R && b.state === BState.Active,
    );
    for (const b of homes) {
      const f = happinessFactors(sim, b).find((x) => x.label === 'Ashamed of the bomb');
      expect(f?.value, `home ${b.id}`).toBe(homeShame(sim));
    }
  });

  it('costs approval by 25 points or more and empties homes by 8 % or more in three game months', () => {
    const { control, ashamed } = twins(3);
    const a0 = control.state.totals.approval;
    const a1 = ashamed.state.totals.approval;
    const p0 = control.state.totals.population;
    const p1 = ashamed.state.totals.population;
    // (Both are pure: the same dice for both towns, only the mark differs.)
    expect(a0 - a1, `approval ${a0.toFixed(3)} → ${a1.toFixed(3)}`).toBeGreaterThanOrEqual(0.25);
    expect(p1, `population ${p0} → ${p1}`).toBeLessThanOrEqual(p0 * 0.92);
  }, 180_000);
});

describe('M40: the record forever', () => {
  it('keeps the launch after 400 other events, and drops the oldest of the others instead', () => {
    const sim = town();
    fire(sim);
    expect(atomLines(sim).map((e) => e.ref)).toEqual([`fired:${neighbour(sim, ids.rival).name}`]);
    for (let k = 0; k < 400; k++) chronicleEvent(sim, 'milestone', k);
    expect(sim.state.chronicle.events).toHaveLength(CHRONICLE.maxEvents);
    expect(atomLines(sim)).toHaveLength(1);
    // The others are the newest 299, in order.
    const rest = sim.state.chronicle.events.filter((e) => e.kind !== 'atom');
    expect(rest.map((e) => e.ref)).toEqual(Array.from({ length: 299 }, (_, k) => 101 + k));
    // More atom events don't push each other out while there is anything else to drop.
    for (let k = 0; k < 10; k++) atomChronicle(sim, 'stopped', 'Nowhere');
    expect(atomLines(sim)).toHaveLength(11);
    expect(sim.state.chronicle.events).toHaveLength(CHRONICLE.maxEvents);
  });

  it('is the plain ring in a city with no atom events: the oldest go first, in order', () => {
    const sim = town();
    const keep = sim.state.chronicle.events.length;
    for (let k = 0; k < 400; k++) chronicleEvent(sim, 'milestone', 1000 + k);
    const ev = sim.state.chronicle.events;
    expect(ev).toHaveLength(CHRONICLE.maxEvents);
    expect(ev.map((e) => e.ref)).toEqual(Array.from({ length: CHRONICLE.maxEvents }, (_, k) => 1100 + k));
    expect(keep).toBeLessThan(CHRONICLE.maxEvents);
  });

  it('keeps the bomb being ready, the launch, a strike on the city, a strike stopped and one on a neighbour', () => {
    // Ready: the last hours of a bomb's build.
    const made = town();
    ok(made, { type: 'cheat', cheat: 'atom', stage: 'bomb' });
    crewed(made);
    for (let k = 0; k < ATOM.bomb.hours && !atom(made).have; k++) atomHour(made);
    expect(atom(made).have).toBe(true);
    expect(atomLines(made).map((e) => e.ref)).toEqual(['ready']);
    // Launch, and the landing on the neighbour a game day on.
    const sim = town();
    fire(sim);
    const name = neighbour(sim, ids.rival).name;
    expect(atomLines(sim).map((e) => e.ref)).toEqual([`fired:${name}`]);
    sim.advance(ATOM.flight.hours * H);
    expect(atom(sim).fired!.landed).toBe(true);
    expect(atomLines(sim).map((e) => e.ref)).toEqual([`fired:${name}`, `landed:${name}`]);
    // A strike on the city that lands, and one the dome stops.
    const hit = town();
    ok(hit, { type: 'cheat', cheat: 'bombIn', hours: 0 });
    atomTick(hit);
    expect(atomLines(hit).map((e) => e.ref)).toEqual([`hit:${neighbour(hit, ids.rival).name}`]);
    const stopped = town();
    const c = civic(stopped, DOME_DEF);
    c.staff = 1;
    c.powered = 1;
    const d = stopped.state.war!.supers!.dome!;
    d.hours = DOME.chargeHours;
    d.mode = 'all';
    delete d.down;
    ok(stopped, { type: 'cheat', cheat: 'bombIn', hours: 0 });
    atomTick(stopped);
    expect(atom(stopped).stopped).toBe(1);
    expect(atomLines(stopped).map((e) => e.ref)).toEqual([`stopped:${neighbour(stopped, ids.rival).name}`]);
  }, 120_000);

  it('says each line in plain words', () => {
    expect(atomEventText('ready')).toBe('Finished the atom bomb');
    expect(atomEventText('fired:Brookline')).toBe('Fired the atom bomb at Brookline');
    expect(atomEventText('landed:Brookline')).toBe('The atom bomb fell on Brookline');
    expect(atomEventText('hit:Brookline')).toBe('An atom bomb from Brookline fell on the city');
    expect(atomEventText('stopped:Brookline')).toBe('The dome stopped an atom bomb from Brookline');
    expect(atomEventText(7)).toBe('The atom bomb');
    for (const ref of ['ready', 'fired:A', 'landed:A', 'hit:A', 'stopped:A'])
      expect(atomEventText(ref)).not.toMatch(/casualt|killed|dead|victim/i);
  });
});

describe('M40: the deterrent', () => {
  it('is on while the bomb is ready or being prepared, and off before, after and with none', () => {
    const sim = town();
    expect(atomDeters(sim)).toBe(false);
    const stages: [string, boolean][] = [
      ['bomb', false],
      ['ready', true],
      ['preparing', true],
      ['flying', false],
      ['spent', false],
    ];
    for (const [stage, on] of stages) {
      ok(sim, { type: 'cheat', cheat: 'atom', stage: stage as 'bomb', to: ids.rival });
      expect(atomDeters(sim), stage).toBe(on);
      if (stage === 'ready' || stage === 'preparing')
        expect(['ready', 'preparing']).toContain(atomStage(sim));
    }
  });

  it('adds its figure to peace and the pacts a computer neighbour weighs, and to nothing else', () => {
    const plain = town();
    const held = town();
    ok(held, { type: 'cheat', cheat: 'atom', stage: 'ready' });
    const n = neighbour(plain, ids.pacted);
    const m = neighbour(held, ids.pacted);
    const terms: Term[] = [
      { k: 'peace' },
      { k: 'ceasefire', hours: 72 },
      { k: 'nonAggression', months: 12 },
      { k: 'alliance' },
      { k: 'defensivePact' },
    ];
    for (const t of terms) expect(weigh(held, m, [t]) - weigh(plain, n, [t]), t.k).toBeCloseTo(ATOM.deter, 9);
    // Two such terms in one offer count twice; a term of another kind not at all.
    expect(weigh(held, m, terms.slice(0, 2)) - weigh(plain, n, terms.slice(0, 2))).toBeCloseTo(
      2 * ATOM.deter,
      9,
    );
    for (const t of [{ k: 'embargo' }, { k: 'trade' }] as Term[])
      expect(weigh(held, m, [t]), t.k).toBe(weigh(plain, n, [t]));
  });

  it('has a neighbour fight a limited war, never a total one, against a city holding the bomb', () => {
    const declare = (sim: Sim) => {
      const n = neighbour(sim, ids.pacted);
      n.rival!.personality = 'aggressive';
      n.rival!.forces = 500;
      n.rival!.relation = -60;
      n.rival!.allies = [];
      // (No pact in the way: the control must be held back by the war's scale alone.)
      dip(sim).pacts = dip(sim).pacts.filter((p) => p.with !== n.id);
      return lowBar(() => {
        for (let k = 0; k < 200; k++) {
          diplomacyMonth(sim);
          sim.state.tick += M;
          const war = warWith(sim, n.id);
          if (war) return war;
        }
        return undefined;
      });
    };
    const control = town();
    expect(declare(control)).toMatchObject({ by: 'them', scale: 'total' });
    const held = town();
    ok(held, { type: 'cheat', cheat: 'atom', stage: 'ready' });
    expect(declare(held)).toMatchObject({ by: 'them', scale: 'war' });
    const preparing = town();
    ok(preparing, { type: 'cheat', cheat: 'atom', stage: 'preparing', to: ids.rival });
    expect(declare(preparing)).toMatchObject({ by: 'them', scale: 'war' });
  }, 180_000);

  it('asks a friend’s declaration with a warning when its bomb is ready or being prepared', () => {
    const friend = (stage?: number) => ({
      name: 'Brookline',
      player: stage === undefined ? {} : { atom: { stage } },
    });
    const text = 'Brookline has the atom bomb ready. In a total war it may use it. Declare anyway?';
    expect(declareWarning(friend(atomStageNo('ready')))).toBe(text);
    expect(declareWarning(friend(atomStageNo('preparing')))).toBe(text);
    for (const stage of ['plant', 'enriching', 'silo', 'bomb', 'flying', 'spent'] as const)
      expect(declareWarning(friend(atomStageNo(stage))), stage).toBeNull();
    expect(declareWarning(friend())).toBeNull();
    expect(declareWarning({ name: 'Computertown' })).toBeNull();
  });
});

describe('M40: a city that never fired is as it always was', () => {
  it('has the sanction causes, reputation and approval it had', () => {
    const sim = town();
    const before = sim.state.totals.approval;
    for (const n of rivals(sim)) expect(sanctionCause(sim, n)).toBeNull();
    dip(sim).reputation = SANCTION.reputation - 1;
    for (const n of rivals(sim)) expect(sanctionCause(sim, n)).toBe('reputation');
    expect(reputationOf(sim)).toBe(SANCTION.reputation - 1);
    reputationChange(sim, 5);
    expect(dip(sim).reputation).toBe(SANCTION.reputation + 4);
    expect(sim.state.totals.approval).toBe(before);
  });

  it('moves the mend up to where it started and no further', () => {
    const sim = town();
    dip(sim).reputation = DIPLOMACY.reputation.start - 1;
    diplomacyMonth(sim);
    expect(dip(sim).reputation).toBe(DIPLOMACY.reputation.start);
    diplomacyMonth(sim);
    expect(dip(sim).reputation).toBe(DIPLOMACY.reputation.start);
  });
});
