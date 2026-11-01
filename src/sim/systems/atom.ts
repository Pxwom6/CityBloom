/**
 * The atom bomb (M40, SPEC-5.md): the last prize cities race for. This module is its state and its
 * gates (`docs/plans/M40-design.md`, calls 1 to 7): what a city has made so far, the stage that
 * follows from it, why the enrichment plant and the silo can or can't be put down, and the race
 * itself: fuel made hour by hour, the bomb built in instalments, a launch prepared and (against a
 * computer neighbour) fired; and (step 3, calls 8 to 10) the flight, the warning a city under a
 * bomb is given, the dome that may stop it and the blast (`atomImpact.ts`). What follows the blast
 * (fallout, winter, the world's turn on the firer) comes in later steps.
 * `WarState.atom` appears when first used, so every city that never races is exactly as before;
 * nothing here draws from a random stream.
 */
import { ATOM, atomStageNo, spanWords, type AtomStage } from '../../data/atom';
import { CIVIC } from '../../data/civic';
import { requirementStatus } from '../../data/projects';
import { TIER_KEYS } from '../../data/research';
import { WAR } from '../../data/war';
import { fail, ok, type CommandResult } from '../commands';
import { formatInt } from '../dmath';
import type { Sim } from '../sim';
import type { Edit } from '../history';
import { TICKS_PER_HOUR } from '../time';
import { civicOnline, lowerName, type Civic } from '../world/civic';
import { accrue } from './economy';
import { fightingWith, neighbourOf, scoreIntel, warWith } from './diplomacy';
import { groundZero, impactCivics, impactFires, impactOver, impactSlice } from './atomImpact';
import { abandonBattle, damageCivic, sheltersWithin } from './raids';
import type { Neighbour } from './region';
import { allTiersDone, researchCheat, researchTree } from './research';
import { requirementContext } from './projects';
import { blackedOut, bombStopped, domeTakesBomb, superWorking } from './supers';
import { civicOutput } from './utilities';
import { startWinter } from './weather';
import { materialBill, takeStock } from './war';
import { atomChronicle, worldTurns } from './atomWorld';
import { rivalAhead, rivalRaces, type RivalRace } from './atomRival';

/**
 * The city's bomb race (`WarState.atom`), made when the first fact is set. The stage is derived from
 * these and from the two buildings (`atomStage`), never stored. One bomb a city, ever: once `fired`
 * is set, no plant, silo or bomb can follow it. A bomb being built (`bomb`) and a finished one
 * (`have`, then `prep`, then `fired`) never stand together.
 */
export interface Atom {
  /** War hours of fuel made, 0 to `ATOM.fuel.hours`; a plant lost halves it. */
  fuel: number;
  /**
   * The bomb being built: war hours done, and instalments paid (of twelve, which stay spent if it is
   * called off). `waiting`: the next instalment is due and the city can't pay it yet (told once).
   */
  bomb?: { done: number; paid: number; waiting?: true };
  /** The finished bomb, in the silo. */
  have?: true;
  /**
   * A launch being prepared: war hours done of `ATOM.launch.prepHours`, and the neighbour it is aimed
   * at. A prepared bomb (all the hours done) waits as long as it likes.
   */
  prep?: { done: number; to: number };
  /**
   * The bomb has left: the tick, the neighbour it was aimed at (its id and name) and, for a friend,
   * its place in the region. It is the end of the race for this city.
   */
  fired?: { tick: number; to: number; name: string; slot?: number; landed?: true };
  /**
   * A bomb on its way to this city, who sent it, the ticks it was warned of and lands at, and
   * ground zero (fixed when it was accepted). `warned` once the city has been told; the residents
   * within the blast and the places the shelters have for them, counted at the warning.
   */
  inbound?: {
    from: number;
    name: string;
    slot?: number;
    warn: number;
    arrive: number;
    x: number;
    z: number;
    warned?: true;
    near?: number;
    sheltered?: number;
  };
  /**
   * The landing in hand (`atomImpact.ts`): hourly slices done, residents who have left the city so
   * far, ground zero. Also the tick of the first slice (the landing), the buildings levelled so far,
   * the residents near and the shelter places (from the warning), `fires` once the fires round the
   * edge are all set (from the tick after the landing, `ATOM.impact.firesPerTick` a tick: how many
   * so far in `lit`, and the last place reached, `fireAfter`, by distance and building id), `razed`
   * once every building inside is levelled, and `over` once the civic buildings inside are gone too:
   * the record of the last bomb that landed here.
   */
  impact?: {
    done: number;
    fled: number;
    x: number;
    z: number;
    at?: number;
    levelled?: number;
    near?: number;
    sheltered?: number;
    lit?: number;
    fireAfter?: { d: number; id: number };
    fires?: true;
    razed?: true;
    over?: true;
  };
  /** The city finished a bomb before every other city in its region (the achievement's fact). */
  first?: true;
  /** Bombs that have landed in this city, and bombs its dome has stopped. */
  boom: number;
  stopped: number;
}

/** The city's bomb race, made on first use (the caller is about to set a fact in it). */
export function atomOf(sim: Sim): Atom {
  const w = sim.state.war!;
  return (w.atom ??= { fuel: 0, boom: 0, stopped: 0 });
}

/**
 * May the city race for the bomb at all (M40, call 3)? In a region, only if its host's rules allow
 * it, which they can only with total war and superweapons; in a city of its own, if it has rivals.
 */
export function bombAllowed(sim: Sim): boolean {
  const s = sim.state;
  if (!s.war) return false;
  const rules = s.region.rules;
  if (rules) return rules.war && rules.scale === 'total' && rules.supers === true && rules.bomb === true;
  return !!s.options.rivals;
}

/** The city's building of a kind (a project may still be going up), if it has one. */
export function civicOfDef(sim: Sim, def: string): Civic | undefined {
  for (const c of sim.state.civics.values()) if (c.def === def) return c;
  return undefined;
}

/**
 * A nuclear power plant is running (M40): online and giving power. The enrichment plant feeds on its
 * power, so a plant that is closed, flooded, unfunded or blacked out doesn't count.
 */
export function nuclearRunning(sim: Sim): boolean {
  for (const c of sim.state.civics.values())
    if (c.def === 'nuclear' && civicOnline(c) && civicOutput(sim, c, 'power') > 0) return true;
  return false;
}

/** Does the city have a building of this kind that works now (a nuclear plant: that is giving power)? */
export function civicRunning(sim: Sim, def: string): boolean {
  if (def === 'nuclear') return nuclearRunning(sim);
  for (const c of sim.state.civics.values()) if (c.def === def && civicOnline(c)) return true;
  return false;
}

/**
 * Where the city stands in the race (M40, call 1), the furthest step it has reached: from nothing
 * (`none`) through the plant going up, fuel being made, the silo going up, the bomb being built and
 * ready, to a launch being prepared, the bomb in flight (a game day after it left) and used. The
 * plant counts as making fuel once it is finished with fuel in hand, whether or not damage has
 * closed it for the moment, so a stage doesn't flicker.
 */
export function atomStage(sim: Sim): AtomStage {
  const a = sim.state.war?.atom;
  const fired = a?.fired;
  if (fired) return sim.state.tick < fired.tick + ATOM.flight.hours * TICKS_PER_HOUR ? 'flying' : 'spent';
  if (a?.prep) return 'preparing';
  if (a?.have) return 'ready';
  if (a?.bomb) return 'bomb';
  if (civicOfDef(sim, 'atomsilo')) return 'silo';
  const plant = civicOfDef(sim, 'enrichment');
  if (plant && !plant.build && (a?.fuel ?? 0) > 0) return 'enriching';
  return plant ? 'plant' : 'none';
}

/** Why the rules don't let the city race or use the bomb now, in plain words, or null when they do. */
export function atomRulesWhy(sim: Sim): string | null {
  if (bombAllowed(sim)) return null;
  return sim.state.region.rules
    ? 'Your region’s rules turn the atom bomb off'
    : 'The atom bomb needs rival neighbours or a region whose rules allow it';
}

/**
 * Why the city can't put down this building for want of the bomb's conditions, or null (also for
 * every building but the enrichment plant and the silo). The first missing step, in plain words:
 * every research branch maxed, the rules, no scenario, the bomb not already used, then the plant's
 * nuclear plant or the silo's enrichment plant. The requirement lines are the buildings' own, the
 * ones the build menu shows. A hard gate, reached from `civicLock`, which sandbox cannot skip.
 */
export function atomLock(sim: Sim, defId: string): string | null {
  const def = CIVIC.get(defId);
  if (!def?.military?.atom) return null;
  const ctx = requirementContext(sim);
  const needs = (research: boolean): string | null => {
    for (const r of def.project?.requires ?? []) {
      if ((r.kind === 'researchAll') !== research) continue;
      const st = requirementStatus(r, ctx);
      if (!st.met) return `Needs ${st.label.charAt(0).toLowerCase()}${st.label.slice(1)} (${st.now})`;
    }
    return null;
  };
  if (!allTiersDone(sim)) return needs(true) ?? 'Needs every research branch maxed';
  const rules = atomRulesWhy(sim);
  if (rules) return rules;
  if (sim.state.scenario) return 'The atom bomb is not part of a scenario';
  if (sim.state.war?.atom?.fired) return 'The city has used its atom bomb: there is only ever one';
  return needs(false);
}

/** The city's race as the page shows it (M40): what the build menu and the war room need to know. */
export interface AtomSummary {
  /** The rules (or the city's rivals) allow the bomb. */
  allowed: boolean;
  stage: AtomStage;
  /** Tiers of the research tree done, in all, and the name of the first still to do. */
  research: { done: number; total: number; next: string | null };
  /** A nuclear plant is giving power; the enrichment plant is online. */
  nuclear: boolean;
  plant: boolean;
  /** Fuel made, 0 to 1. */
  fuel: number;
  /** Why fuel isn't being made now, in words; null while it is, when the load is full, or before the race has begun. */
  fuelWait: string | null;
  /**
   * The bomb being built: its share done (0 to 1), instalments paid of all, and why it waits (the
   * silo can't work, or the next instalment can't be paid); null while it goes on.
   */
  bomb: { done: number; paid: number; of: number; wait: string | null } | null;
  /** The bomb is finished and in the silo. */
  have: boolean;
  /**
   * A launch being prepared: its share done (0 to 1), who it is aimed at, `ready` once it is all
   * done and holding, why the preparation waits (null while it goes on or when it is ready), and
   * why the bomb couldn't leave for its target now (a war paused or over, a friend's city that is
   * the room's to agree to); null when sending it would fire it. A ready bomb with `held` set waits
   * for the city to send it again (`launchBomb`) or call it off.
   */
  launch: {
    done: number;
    to: number;
    name: string;
    ready: boolean;
    wait: string | null;
    held: string | null;
  } | null;
  /** The bomb has left: when, and for whom. */
  fired: { tick: number; to: number; name: string } | null;
  /**
   * A bomb on its way to this city (M40): who sent it, when it lands (a tick), ground zero, the
   * residents near it and the shelter places, and whether the dome would stop it if it landed now.
   * Null unless warned.
   */
  inbound: {
    from: string;
    arrive: number;
    x: number;
    z: number;
    near: number;
    sheltered: number;
    stops: boolean;
  } | null;
  /** The last bomb to land here: where, the residents who have left the city, buildings levelled, and whether the blast is over. */
  impact: { x: number; z: number; fled: number; levelled: number; over: boolean } | null;
  /**
   * The computer neighbours that race for the bomb (M40 step 7, Hard only): who, the stage's number
   * (`atomStageNo`) and, for a launch being prepared, the war hours until it leaves. For the region map.
   */
  rivals: RivalRace[];
}

export function atomSummary(sim: Sim): AtomSummary | null {
  const w = sim.state.war;
  if (!w) return null;
  const tree = researchTree(sim);
  const a = w.atom;
  const full = (a?.fuel ?? 0) >= ATOM.fuel.hours;
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return {
    allowed: bombAllowed(sim),
    stage: atomStage(sim),
    research: { done: tree.done, total: tree.total, next: tree.next ?? null },
    nuclear: nuclearRunning(sim),
    plant: civicRunning(sim, 'enrichment'),
    fuel: round(Math.min(1, (a?.fuel ?? 0) / ATOM.fuel.hours)),
    fuelWait: !a?.fired && !full && (a || civicOfDef(sim, 'enrichment')) ? fuelBlock(sim) : null,
    bomb: a?.bomb
      ? {
          done: round(a.bomb.done / ATOM.bomb.hours),
          paid: a.bomb.paid,
          of: INSTALMENTS,
          wait:
            siloBlock(sim) ?? (instalmentShort(sim) ? 'The treasury can’t pay the next instalment' : null),
        }
      : null,
    have: !!a?.have,
    launch: a?.prep
      ? {
          done: round(a.prep.done / ATOM.launch.prepHours),
          to: a.prep.to,
          name: neighbourOf(sim, a.prep.to)?.name ?? 'a neighbour',
          ready: a.prep.done >= ATOM.launch.prepHours,
          wait: a.prep.done >= ATOM.launch.prepHours ? null : siloBlock(sim),
          held: heldWhy(sim, a.prep.to),
        }
      : null,
    fired: a?.fired ? { tick: a.fired.tick, to: a.fired.to, name: a.fired.name } : null,
    inbound: a?.inbound?.warned
      ? {
          from: a.inbound.name,
          arrive: a.inbound.arrive,
          x: a.inbound.x,
          z: a.inbound.z,
          near: a.inbound.near ?? 0,
          sheltered: a.inbound.sheltered ?? 0,
          stops: bombStopped(sim),
        }
      : null,
    impact: a?.impact
      ? {
          x: a.impact.x,
          z: a.impact.z,
          fled: a.impact.fled,
          levelled: a.impact.levelled ?? 0,
          over: !!a.impact.over,
        }
      : null,
    rivals: rivalRaces(sim),
  };
}

/**
 * What the race costs from the first stone, from the data alone (no city): the money for each step
 * and the war hours it takes, the sums that matter (the silo and the bomb; the whole race, with and
 * without the two buildings' upkeep) and the critical path. The price probe (`atomprice.ts`) prints
 * it against a city's taxes; a test holds it in the band `ATOM.priceCity` was sized for.
 */
export function atomPrices() {
  const stages = (id: string) => CIVIC.get(id)!.project!.stages;
  const money = (id: string) => stages(id).reduce((a, s) => a + s.cost, 0);
  // A stage month is a game day: 24 war hours.
  const hours = (id: string) => stages(id).reduce((a, s) => a + s.months, 0) * 24;
  const instalments = ATOM.bomb.hours / ATOM.bomb.every;
  const mat = WAR.materials.importPrice;
  const inst = ATOM.bomb.instalment;
  const plant = { price: money('enrichment'), hours: hours('enrichment') };
  const fuel = { price: ATOM.fuel.hours * ATOM.fuel.cost, hours: ATOM.fuel.hours };
  const silo = { price: money('atomsilo'), hours: hours('atomsilo') };
  const bomb = { price: instalments * inst.money, hours: ATOM.bomb.hours };
  // The materials bought outright at the import price (the war stores, mines and wells cover part).
  const materials = instalments * (inst.goods * mat.goods + inst.ore * mat.ore + inst.oil * mat.oil);
  const launch = { price: ATOM.launch.cost, hours: ATOM.launch.prepHours };
  const siloBomb = silo.price + bomb.price;
  const race = plant.price + fuel.price + silo.price + bomb.price + materials + launch.price;
  // Upkeep while it is built: the plant from its completion to the launch, the silo from its own.
  const plantDone = plant.hours;
  const siloDone = plantDone + silo.hours;
  const end = plantDone + fuel.hours + bomb.hours + launch.hours;
  const upkeep =
    (CIVIC.get('enrichment')!.upkeep * (end - plantDone)) / 24 +
    (CIVIC.get('atomsilo')!.upkeep * (end - siloDone)) / 24;
  return { plant, fuel, silo, bomb, materials, launch, siloBomb, race, upkeep, plantDone, siloDone, end };
}

// ---------------------------------------------------------------------------------------------
// The race itself (M40 step 2, plan calls 1 and 5 to 7): fuel, the bomb's build, a launch's
// preparation. All of it runs on the war clock (`atomHour`, from `warClockHour`), so the region's
// fair clock holds it as it holds research.
// ---------------------------------------------------------------------------------------------

/** The bomb is paid in this many instalments, the first when it starts. */
const INSTALMENTS = ATOM.bomb.hours / ATOM.bomb.every;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const dollars = (v: number) => `$${formatInt(Math.round(v))}`;

/** Where a finished building of the race can't yet work: the staff and power `superWorking` asks. */
function crewWhy(c: Civic, name: string): string | null {
  if ((c.staff ?? 0) < 0.25) return `The ${name} needs workers`;
  if ((c.powered ?? 0) < 0.5) return `The ${name} needs power`;
  return null;
}

/**
 * Why a building of the race (`def`, called `name` in words) isn't working now, or null: missing,
 * still going up, the rules turned the bomb off, closed by damage or flood, a blackout, no crew or
 * no power. A closed building is the one thing that sets a preparation back (`prepHour`).
 */
function siteBlock(sim: Sim, def: string, name: string): string | null {
  const c = civicOfDef(sim, def);
  if (!c) return `The city has no ${name}`;
  if (c.build) return `The ${name} is still going up`;
  const rules = atomRulesWhy(sim);
  if (rules) return rules;
  if (c.flooded) return `The ${name} is flooded`;
  if (c.damage > 0) return `The ${name} is closed for repairs`;
  if (blackedOut(sim)) return `A blackout has the ${name} dark`;
  return crewWhy(c, name) ?? (superWorking(c) ? null : `The ${name} isn’t working`);
}

/** A working building of the race can't be run on no defence funding: it makes no progress, so it says so. */
function fundingWhy(sim: Sim, c: Civic, name: string): string | null {
  return workRate(sim, c) <= 0 ? `Defence funding is too low to run the ${name}` : null;
}

/**
 * The silo isn't working now (and so the bomb's build and a preparation wait), in words, or null:
 * what the plant waits for too, bar the nuclear plant, so a silo on no funding says so and no
 * instalment is paid for hours that cannot go by.
 */
export function siloBlock(sim: Sim): string | null {
  const why = siteBlock(sim, 'atomsilo', 'atom silo');
  return why ?? fundingWhy(sim, civicOfDef(sim, 'atomsilo')!, 'silo');
}

/** Per war hour, how fast a working building of the race goes: crew, power and defence funding (to 125 %). */
function workRate(sim: Sim, c: Civic): number {
  return (
    Math.min(1, c.staff ?? 0) * (c.powered ?? 0) * Math.min(ATOM.fuel.fundingMax, sim.fundingEff('defence'))
  );
}

/**
 * Why fuel isn't being made this hour, in words, or null when it is: no plant, one still going up,
 * the rules, damage, a blackout, no running nuclear plant to feed on, no crew or power, no money.
 * A full load, or a bomb already used, is not a wait (the caller asks). Reads only.
 */
export function fuelBlock(sim: Sim): string | null {
  const why = siteBlock(sim, 'enrichment', 'enrichment plant');
  if (why) return why;
  if (!nuclearRunning(sim)) return 'No nuclear power plant is running';
  const plant = civicOfDef(sim, 'enrichment')!;
  const funding = fundingWhy(sim, plant, 'plant');
  if (funding) return funding;
  const s = sim.state;
  if (!s.options.sandbox && s.treasury < workRate(sim, plant) * ATOM.fuel.cost)
    return 'The treasury can’t pay for the fuel';
  return null;
}

/** What the next instalment of the bomb costs now: the money, and the materials bought in. */
function instalmentBill(sim: Sim) {
  const inst = ATOM.bomb.instalment;
  const bill = materialBill(sim, inst);
  return { bill, money: inst.money, total: inst.money + bill.imports };
}

/** The bomb's next instalment is due and the treasury can't pay it. */
function instalmentShort(sim: Sim): boolean {
  const b = sim.state.war?.atom?.bomb;
  if (!b || b.paid >= INSTALMENTS || b.done < b.paid * ATOM.bomb.every) return false;
  return !sim.state.options.sandbox && sim.state.treasury < instalmentBill(sim).total;
}

/** Pay an instalment: the money, and the materials from the war stores first, the rest bought in. */
function payInstalment(sim: Sim): void {
  const { bill, money } = instalmentBill(sim);
  takeStock(sim, bill.take);
  sim.spend(money, 'atomBomb');
  if (bill.imports > 0) sim.spend(bill.imports, 'warImports');
}

/**
 * The race's hour on the war clock (M40, calls 1 and 5 to 7). Fuel grows while the plant works;
 * the bomb is built a silo-hour at a time, an instalment due every 60; a prepared launch counts its
 * hours, starts over if damage closes the silo, and at the end fires. A city that has not begun
 * (no `war.atom`) and has no enrichment plant is left entirely alone: no state made, nothing
 * booked, nothing read that changes anything.
 */
export function atomHour(sim: Sim): void {
  const w = sim.state.war;
  if (!w) return;
  if (!w.atom && !civicOfDef(sim, 'enrichment')) return;
  fuelHour(sim);
  bombHour(sim);
  prepHour(sim);
}

function fuelHour(sim: Sim): void {
  const had = sim.state.war!.atom;
  if (had?.fired || (had && had.fuel >= ATOM.fuel.hours)) return;
  if (fuelBlock(sim)) return;
  const a = atomOf(sim);
  const before = a.fuel;
  const made = Math.min(workRate(sim, civicOfDef(sim, 'enrichment')!), ATOM.fuel.hours - a.fuel);
  a.fuel = round3(a.fuel + made);
  const full = a.fuel >= ATOM.fuel.hours - 1e-9;
  if (full) a.fuel = ATOM.fuel.hours;
  // The load costs the same however fast it is made: so much a unit of fuel, only while the plant
  // works, charged on the fuel actually gained (whole thousandths, so the sum is exact and a full
  // load is $2.304M whatever the crew or funding).
  accrue(
    sim,
    'enrichment',
    (-(Math.round(a.fuel * 1000) - Math.round(before * 1000)) * ATOM.fuel.cost) / 1000,
  );
  if (full) sim.events.push({ kind: 'fuelFull', id: civicOfDef(sim, 'enrichment')!.id });
  sim.warChanged();
}

function bombHour(sim: Sim): void {
  const a = sim.state.war!.atom;
  const b = a?.bomb;
  if (!a || !b || siloBlock(sim)) return;
  const silo = civicOfDef(sim, 'atomsilo')!;
  // The hours go up to the boundary the instalments paid so far cover, and no further. An
  // instalment falls due the moment the boundary is reached (the first was paid when the build
  // began) and is paid then, the rest of the hour going on past it; one the city can't pay waits
  // like a project's stage, with the hours so far kept, and the rest of the hour is not lost to it
  // but left unworked, as any hour a silo spends waiting.
  let work = workRate(sim, silo);
  while (work > 0) {
    const cap = b.paid * ATOM.bomb.every;
    if (b.done >= cap) {
      if (b.paid >= INSTALMENTS) break;
      if (instalmentShort(sim)) {
        if (!b.waiting) {
          b.waiting = true;
          sim.events.push({ kind: 'bombWaiting', id: silo.id });
          sim.warChanged();
        }
        return;
      }
      payInstalment(sim);
      b.paid++;
      delete b.waiting;
      sim.warChanged();
      continue;
    }
    const room = cap - b.done;
    if (work >= room) {
      b.done = cap;
      work = round3(work - room);
    } else {
      b.done = round3(b.done + work);
      work = 0;
    }
    sim.warChanged();
    if (b.done >= ATOM.bomb.hours) {
      delete a.bomb;
      a.have = true;
      // First in the race: in a city of its own there is no one to beat but a computer neighbour that
      // has finished its own bomb already (M40 step 7: Hard only); in a region the room says who
      // was first (step 10).
      if (!sim.state.region.rules && !rivalAhead(sim)) a.first = true;
      sim.events.push({ kind: 'bombReady', id: silo.id });
      atomChronicle(sim, 'ready');
      return;
    }
  }
}

function prepHour(sim: Sim): void {
  const a = sim.state.war!.atom;
  const p = a?.prep;
  if (!a || !p) return;
  const silo = civicOfDef(sim, 'atomsilo');
  // Damage that closes the silo undoes the preparation, however far along (or complete) it was.
  if (silo && !silo.build && !civicOnline(silo)) {
    if (p.done > 0) {
      p.done = 0;
      sim.warChanged();
    }
    return;
  }
  // A prepared bomb waits as long as it likes; otherwise any other wait just holds the count.
  if (p.done >= ATOM.launch.prepHours || siloBlock(sim)) return;
  p.done = Math.min(ATOM.launch.prepHours, round3(p.done + workRate(sim, silo!)));
  sim.warChanged();
  // Prepared. If the bomb can't leave (the war is paused or over, or the target is a friend's city)
  // the city is told it is held and why: it waits to be sent again or called off.
  if (p.done >= ATOM.launch.prepHours && !fireIfAble(sim)) {
    const n = neighbourOf(sim, p.to);
    sim.events.push({
      kind: 'launchHeld',
      id: p.to,
      info: { to: n?.name ?? 'a neighbour', why: heldWhy(sim, p.to) ?? '' },
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Commands (calls 6 and 7)
// ---------------------------------------------------------------------------------------------

/** What every command of the race asks first: war on, the bomb not used. */
function raceRefusal(sim: Sim): string | null {
  const w = sim.state.war;
  if (!w) return 'War is off in this city';
  if (w.atom?.fired) return 'The city has used its atom bomb: there is only ever one';
  return null;
}

/** Why the bomb can't be started now, or null. */
function buildRefusal(sim: Sim): string | null {
  const refused = raceRefusal(sim);
  if (refused) return refused;
  const a = sim.state.war!.atom;
  if (a?.have) return 'The city has an atom bomb already';
  if (a?.bomb) return 'The bomb is already being built';
  const rules = atomRulesWhy(sim);
  if (rules) return rules;
  if (sim.state.scenario) return 'The atom bomb is not part of a scenario';
  const fuel = a?.fuel ?? 0;
  if (fuel < ATOM.fuel.hours)
    return `The bomb needs a full load of fuel (${Math.floor((fuel / ATOM.fuel.hours) * 100)} % made)`;
  return siloBlock(sim);
}

/** Start building the bomb (M40, call 6): the first of twelve instalments is paid now. */
export function buildBomb(sim: Sim, dryRun: boolean): CommandResult {
  const refused = buildRefusal(sim);
  if (refused) return fail(refused);
  const { total, money } = instalmentBill(sim);
  const s = sim.state;
  if (!s.options.sandbox && s.treasury < total)
    return fail(`Not enough money for the first instalment: ${dollars(total)} with the materials bought in`);
  if (dryRun) return ok(total, { info: { instalment: money, imports: total - money, of: INSTALMENTS } });
  payInstalment(sim);
  atomOf(sim).bomb = { done: 0, paid: 1 };
  sim.warChanged();
  return ok(total, { info: { instalment: money, imports: total - money, of: INSTALMENTS } });
}

/** Stop building the bomb: the instalments paid stay spent, and so do the materials. */
export function cancelBomb(sim: Sim, dryRun: boolean): CommandResult {
  const a = sim.state.war?.atom;
  if (!a?.bomb) return fail('No bomb is being built');
  if (dryRun) return ok(0);
  delete a.bomb;
  sim.warChanged();
  return ok(0);
}

/**
 * Why a bomb can't be aimed at this neighbour now, or null: it must be a rival or a friend's city
 * the city is fighting a total war with that is open (a ceasefire, a surrender or a warning still
 * running pauses it), and the city can be neither neutral nor a vassal, nor the neighbour its vassal.
 */
function targetWhy(sim: Sim, to: number): string | null {
  const s = sim.state;
  const d = s.war?.diplomacy;
  const n = neighbourOf(sim, to);
  if (!n) return 'No such neighbour';
  if (!n.player && !n.rival) return `${n.name} isn’t a rival`;
  if (d?.neutral) return 'A neutral city doesn’t launch bombs';
  if (d?.vassal) return 'A vassal can’t launch the bomb';
  if (n.rival?.vassal || d?.subjects?.some((x) => x.with === to)) return `${n.name} is your vassal`;
  const war = warWith(sim, to);
  if (!war) return `The bomb needs a total war with ${n.name}: you are not at war`;
  if (!fightingWith(sim, to)) {
    if (s.tick < war.opens || war.friend?.state === 'declared')
      return `The war with ${n.name} hasn’t opened yet`;
    return `The war with ${n.name} is paused (a ceasefire or a surrender): the bomb waits`;
  }
  if (war.scale !== 'total')
    return `Only a total war can use the bomb: your war with ${n.name} is not a total war`;
  return null;
}

/** A strike on a friend's city is the region's room to agree to (steps 9 and 10), not the sim's. */
function roomWhy(n: Neighbour): string {
  return `A strike on ${n.name}’s city goes through the region’s room, which has to agree`;
}

/**
 * Why a prepared bomb can't leave for this neighbour now, or null when sending it would fire it:
 * `targetWhy`, and for a friend's city the room's say.
 */
function heldWhy(sim: Sim, to: number): string | null {
  const why = targetWhy(sim, to);
  if (why) return why;
  const n = neighbourOf(sim, to);
  return n?.player ? roomWhy(n) : null;
}

/**
 * Prepare a launch at a neighbour (M40, call 7): $1.2M, then 288 war hours at the silo's rate
 * (starting over if damage closes the silo). Needs the finished bomb, a working silo, the rules and
 * a total war open with the target. On a bomb already prepared it sends it again: against a computer
 * neighbour it fires if the war is open, at a friend's city it waits for the region (step 9).
 */
export function launchBomb(sim: Sim, to: number, dryRun: boolean): CommandResult {
  const refused = raceRefusal(sim);
  if (refused) return fail(refused);
  const a = sim.state.war!.atom;
  if (!a?.have)
    return fail(a?.bomb ? 'The bomb isn’t finished yet' : 'The city has no atom bomb: build one first');
  const rules = atomRulesWhy(sim);
  if (rules) return fail(rules);
  if (sim.state.scenario) return fail('The atom bomb is not part of a scenario');
  const silo = siloBlock(sim);
  if (silo) return fail(silo);
  const target = targetWhy(sim, to);
  if (target) return fail(target);
  const n = neighbourOf(sim, to)!;
  if (a.prep) {
    // Sending a prepared bomb again, at the same neighbour or another.
    if (a.prep.done < ATOM.launch.prepHours) return fail('A launch is already being prepared');
    if (n.player) return fail(roomWhy(n));
    if (dryRun) return ok(0);
    a.prep.to = to;
    fireIfAble(sim);
    return ok(0);
  }
  const s = sim.state;
  if (!s.options.sandbox && s.treasury < ATOM.launch.cost)
    return fail(`Not enough money: ${dollars(ATOM.launch.cost)} to prepare a launch`);
  if (dryRun) return ok(ATOM.launch.cost);
  sim.spend(ATOM.launch.cost, 'atomLaunch');
  atomOf(sim).prep = { done: 0, to };
  sim.warChanged();
  return ok(ATOM.launch.cost);
}

/** Call off a launch: half the price comes back, and the bomb stays in the silo. */
export function cancelLaunch(sim: Sim, dryRun: boolean): CommandResult {
  const a = sim.state.war?.atom;
  if (!a?.prep) return fail('No launch is being prepared');
  const refund = Math.round(ATOM.launch.cost * ATOM.launch.refund);
  if (dryRun) return ok(-refund);
  delete a.prep;
  sim.earn(refund, 'refunds');
  sim.warChanged();
  return ok(-refund);
}

/**
 * A prepared bomb leaves if it can (M40, call 7): the target is a computer neighbour the city is
 * fighting a total war with that is open now. A friend's city is the region's to agree to (step 9
 * fills that in): nothing leaves for it here, and the bomb stays prepared. A war that is not open
 * when the preparation ends leaves it prepared too; the city sends it again with `launchBomb`.
 * Says whether it left; the caller tells the city when it did not (event `launchHeld`).
 */
function fireIfAble(sim: Sim): boolean {
  const a = sim.state.war!.atom!;
  const p = a.prep;
  if (!p || heldWhy(sim, p.to)) return false;
  const n = neighbourOf(sim, p.to)!;
  a.fired = { tick: sim.state.tick, to: n.id, name: n.name };
  delete a.have;
  delete a.prep;
  sim.events.push({ kind: 'bombFired', id: n.id, info: { to: n.name } });
  sim.warChanged();
  startFlight(sim);
  return true;
}

/**
 * The bomb has left the silo for a computer neighbour (`fired` is set). The flight needs no state of
 * its own: it lands `ATOM.flight.hours` after `fired.tick`, on this city's own clock (`atomTick`).
 * What the world makes of the firer is `atomFired`.
 */
function startFlight(sim: Sim): void {
  atomFired(sim);
}

/**
 * The world turns on the firer (M40 step 6, plan call 14): called once, the moment the bomb leaves
 * for any target, stopped or not (a refusal never reaches it). The firer's reputation falls to
 * nothing for good, every neighbour embargoes it, its pacts end, anyone may declare a total war on
 * it, its people protest and the chronicle keeps the launch. All of it is `atomWorld.ts`; the room's
 * half for friends (the pariah flag in `FriendsState`, from the report's `fired`) is step 9.
 */
export function atomFired(sim: Sim): void {
  worldTurns(sim);
}

/**
 * The city holds the bomb ready or is preparing to use it (M40, call 15): a computer neighbour thinks
 * twice, liking peace and pacts more and fighting it a limited war only. The same as the stage being
 * `ready` or `preparing`, from the facts (no building to look for).
 */
export function atomDeters(sim: Sim): boolean {
  const a = sim.state.war?.atom;
  return !!a && !a.fired && !!(a.prep || a.have);
}

// ---------------------------------------------------------------------------------------------
// Flight, warning and landing (M40 step 3, plan calls 8 to 10). Every clock here is the city's own,
// not the war clock: the fair clock holds research and the race, never a missile in the air.
// ---------------------------------------------------------------------------------------------

/** The minute of the hour the blast's later slices are dealt in (a quiet one). */
const SLICE_MINUTE = 1;

/** Who sent a bomb at the city. */
export interface BombSender {
  id: number;
  name: string;
  /** Another player's city in the region. */
  slot?: number;
}

/**
 * A bomb is on its way to this city (plan call 8). The senders are a Hard computer neighbour
 * (step 7) and the region's room for a friend (step 10); the test cheat `bombIn` is a third. This
 * city's own sim takes it: ground zero is fixed now, from this city as it stands, never from a
 * message, and the warning is given on the next tick (`atomTick`). One bomb is in the air at a time:
 * a second is refused (the sender is told, and may send it again). Returns why not, or null.
 */
export function atomInbound(sim: Sim, from: BombSender, hours: number = ATOM.flight.hours): string | null {
  const w = sim.state.war;
  if (!w) return 'War is off in this city';
  const a = atomOf(sim);
  if (a.inbound) return 'A bomb is already on its way to the city';
  const at = groundZero(sim);
  const tick = sim.state.tick;
  let arrive = tick + Math.max(0, Math.round(hours * TICKS_PER_HOUR));
  // A flight never lands on the top of an hour (hours 0 lands at once): that tick is the day's heaviest
  // (a month closes and the utilities run) and the blast's first slice would be added to it.
  if (hours > 0 && arrive % TICKS_PER_HOUR === 0) arrive++;
  a.inbound = {
    from: from.id,
    name: from.name,
    ...(from.slot !== undefined ? { slot: from.slot } : {}),
    warn: tick,
    arrive,
    x: at.x,
    z: at.z,
  };
  sim.warChanged();
  return null;
}

/**
 * Test mode: a computer neighbour (the first rival, or `from`) fires at the city now, to land in
 * `hours` (default `ATOM.flight.hours`; 0: it lands at once). Sets only what a real sender sets.
 */
export function bombInCheat(
  sim: Sim,
  hours: number | undefined,
  from: number | undefined,
  dryRun: boolean,
): CommandResult {
  const w = sim.state.war;
  if (!w) return fail('War is off in this city');
  if (w.atom?.inbound) return fail('A bomb is already on its way to the city');
  const n = sim.state.region.neighbours.find(
    (x) => !!x.rival && !x.player && (from === undefined || x.id === from),
  );
  if (!n) return fail('No rival neighbour');
  const h = hours ?? ATOM.flight.hours;
  if (!Number.isFinite(h) || h < 0) return fail('Invalid hours');
  if (dryRun) return ok(0);
  const why = atomInbound(sim, { id: n.id, name: n.name }, h);
  return why ? fail(why) : ok(0);
}

/**
 * Every tick while something of the bomb is in the air or being dealt out (plan calls 8 to 10): the
 * warning to a city a bomb is aimed at, its landing, the blast's hourly slices, and the landing of a
 * bomb this city fired at a computer neighbour. A city with none of these costs a lookup.
 */
export function atomTick(sim: Sim): void {
  const a = sim.state.war?.atom;
  if (!a) return;
  if (a.inbound) inboundTick(sim, a, a.inbound);
  const im = a.impact;
  if (im && !im.over) {
    // The hourly slices level the buildings; the civic buildings inside come down a few every tick.
    const t = sim.state.tick;
    const at = im.at ?? -1;
    // (A later *hour*, not a later tick: a bomb landing on the top of an hour has its next slice in the
    // next hour's quiet minute, not on the tick after, where the fires are.)
    const nextHour = Math.floor(t / TICKS_PER_HOUR) > Math.floor(at / TICKS_PER_HOUR);
    if (!im.razed && t % TICKS_PER_HOUR === SLICE_MINUTE && nextHour && impactSlice(sim, im)) im.razed = true;
    // One heavy thing a tick after the landing: the fires first (a hundred or so a tick), then the
    // civic buildings a few at a time.
    if (!im.fires) {
      if (t > at && impactFires(sim, im)) im.fires = true;
    } else if (impactCivics(sim, im) && im.razed) impactOver(sim, a, im);
  }
  const f = a.fired;
  if (f && !f.landed && sim.state.tick >= f.tick + ATOM.flight.hours * TICKS_PER_HOUR) landFlight(sim, f);
}

type Inbound = NonNullable<Atom['inbound']>;

function inboundTick(sim: Sim, a: Atom, hit: Inbound): void {
  const s = sim.state;
  if (!hit.warned) {
    // The people are told at once: the siren, how many live in the blast and how many the shelters
    // can take (the page drops the game to 1x once, and the dome says what it will do).
    const { near, sheltered } = sheltersWithin(sim, hit.x, hit.z, ATOM.impact.level);
    hit.warned = true;
    hit.near = near;
    hit.sheltered = sheltered;
    sim.events.push({
      kind: 'bombWarning',
      id: hit.from,
      info: {
        from: hit.name,
        hours: Math.max(0, Math.round((hit.arrive - s.tick) / TICKS_PER_HOUR)),
        near,
        sheltered,
        stops: bombStopped(sim) ? 1 : 0,
      },
    });
    sim.warChanged();
  }
  if (s.tick < hit.arrive) return;
  // It lands. A dome that is up stops it whole (checked first, so a dome raised over a battle does).
  if (bombStopped(sim)) {
    domeTakesBomb(sim);
    delete a.inbound;
    a.stopped++;
    sim.events.push({
      kind: 'bombStopped',
      id: hit.from,
      info: { from: hit.name, down: ATOM.dome.down },
    });
    atomChronicle(sim, 'stopped', hit.name);
    sim.warChanged();
    return;
  }
  // A blast still being dealt out holds the next one back until it is over.
  if (a.impact && !a.impact.over) return;
  // A battle in the city holds it back too, for at most `battleWait` hours: then the battle is ended
  // (as withdrawn; a live one's page takes its usual road for a battle that is gone) and the bomb falls.
  const w = s.war!;
  if (w.battle) {
    if (s.tick - hit.arrive < ATOM.impact.battleWait * TICKS_PER_HOUR) return;
    abandonBattle(sim);
  }
  delete a.inbound;
  const im: NonNullable<Atom['impact']> = {
    done: 0,
    fled: 0,
    x: hit.x,
    z: hit.z,
    at: s.tick,
    levelled: 0,
    near: hit.near ?? 0,
    sheltered: hit.sheltered ?? 0,
  };
  a.impact = im;
  sim.events.push({ kind: 'bombLanded', id: hit.from, info: { from: hit.name, x: hit.x, z: hit.z } });
  atomChronicle(sim, 'hit', hit.name);
  if (impactSlice(sim, im)) im.razed = true;
  sim.warChanged();
}

/**
 * The bomb this city fired lands (a game day after it left, this city's clock). At a computer
 * neighbour the landing is a change to its record (plan call 10): most of its people, forces and
 * defences gone, its feeling for the city at the bottom, fallout on its ground (step 4 uses the
 * level), the war score swung hard in the city's favour through the war's own scoring, and an
 * event the region map draws; and the nuclear winter falls on the firing city too (`self:0`: its one
 * bomb, as `self:n` is the nth to land in a city). At a friend's city (step 10) the friend's own sim
 * does the landing: nothing is done here (the region room's winters reach every city then).
 */
function landFlight(sim: Sim, f: NonNullable<Atom['fired']>): void {
  f.landed = true;
  sim.warChanged();
  if (f.slot !== undefined) return;
  const n = neighbourOf(sim, f.to);
  const r = n?.rival;
  if (!n || !r || n.player) return;
  const keep = ATOM.record.keep;
  const before = n.population;
  n.population = Math.round(n.population * keep);
  r.forces = Math.round(r.forces * keep * 1000) / 1000;
  r.defences = Math.round(r.defences * keep * 1000) / 1000;
  r.relation = ATOM.record.relation;
  r.fallout = ATOM.record.fallout;
  scoreIntel(sim, n.id, ATOM.record.score);
  startWinter(sim, 'self:0');
  sim.events.push({
    kind: 'atomImpact',
    id: n.id,
    info: { to: n.name, side: n.side, lost: before - n.population },
  });
  atomChronicle(sim, 'landed', n.name);
}

/**
 * What a bomb on its way, or lately landed, does to approval (M40, plan call 8): the raid dip's
 * formula (the share of nearby residents the shelters can't take) at the bomb's own weight, in
 * full while the bomb is in the air and fading over `ATOM.warning.days` after it lands. A bomb the
 * dome stopped leaves nothing behind. 0 without one.
 */
export function bombMood(sim: Sim): number {
  const a = sim.state.war?.atom;
  if (!a) return 0;
  const span = ATOM.warning.days * 24 * TICKS_PER_HOUR;
  let near = 0;
  let sheltered = 0;
  let ease = 1;
  if (a.inbound?.warned) {
    near = a.inbound.near ?? 0;
    sheltered = a.inbound.sheltered ?? 0;
  } else if (a.impact && a.impact.at !== undefined) {
    near = a.impact.near ?? 0;
    sheltered = a.impact.sheltered ?? 0;
    ease = 1 - (sim.state.tick - a.impact.at) / span;
  } else return 0;
  if (near <= 0 || ease <= 0) return 0;
  return -ATOM.warning.mood * (1 - sheltered / near) * ease;
}

// ---------------------------------------------------------------------------------------------
// Spies (M40 step 7, plan call 18): the saboteur's target of its own
// ---------------------------------------------------------------------------------------------

/**
 * What a saboteur strikes in the race, if the city has anything to strike (target `plant`): the silo
 * while a bomb is being built or waits in it (closing it sets a launch back to the start), else the
 * enrichment plant, else a silo with no plant. Nothing once the bomb has left: the race is over.
 */
export function plantTarget(sim: Sim): Civic | undefined {
  const a = sim.state.war?.atom;
  if (a?.fired) return undefined;
  const silo = civicOfDef(sim, 'atomsilo');
  if (silo && (a?.bomb || a?.have)) return silo;
  return civicOfDef(sim, 'enrichment') ?? silo;
}

/** The city has a plant or a silo for saboteurs to find (an unfinished one included). */
export function inTheRace(sim: Sim): boolean {
  return plantTarget(sim) !== undefined;
}

/** What a saboteur's strike did: a building going up set back, fuel or the bomb's work taken, or only a closure. */
export interface PlantStrike {
  what: 'build' | 'fuel' | 'bomb' | 'closed';
  /** War hours of work or of the stage clock lost. */
  hours: number;
  civic: Civic;
}

/**
 * A saboteur gets through (plan call 18): a plant or silo still going up has its stage clock put back
 * `ATOM.spy.setBack` war hours; a finished plant loses that many hours of fuel and a finished silo
 * that many hours of the bomb's build, never going below nothing and never taking back an instalment
 * already paid (the hours are done again without paying twice, so the loss is time, not money); a
 * finished one is closed `ATOM.spy.closed` hours besides (and a closed silo starts a launch's
 * preparation again). The caller says what happened (`plantSabotageText`). Null: nothing to strike.
 */
export function sabotagePlant(sim: Sim): PlantStrike | null {
  const c = plantTarget(sim);
  if (!c) return null;
  const a = sim.state.war!.atom;
  const back = ATOM.spy.setBack;
  let strike: PlantStrike;
  if (c.build) {
    // (Both buildings are war projects, so a stage also waits for the war clock: its start moves on.)
    if (c.build.clock !== undefined) c.build.clock += back;
    strike = { what: 'build', hours: back, civic: c };
  } else if (c.def === 'atomsilo' && a?.bomb) {
    const b = a.bomb;
    const lost = Math.min(b.done, back);
    b.done = round3(b.done - lost);
    // Back inside the instalments already paid for, the next one is not due yet: no longer waiting.
    if (b.done < b.paid * ATOM.bomb.every) delete b.waiting;
    strike = { what: 'bomb', hours: lost, civic: c };
  } else if (c.def === 'enrichment' && a) {
    const lost = Math.min(a.fuel, back);
    a.fuel = round3(a.fuel - lost);
    strike = { what: 'fuel', hours: lost, civic: c };
  } else strike = { what: 'closed', hours: 0, civic: c };
  if (!c.build) damageCivic(sim, c.id, ATOM.spy.closed, false);
  sim.warChanged();
  return strike;
}

/** What saboteurs from `by` did to the race's works here, in plain words (for the city's log and notices). */
export function plantSabotageText(strike: PlantStrike, by: string): string {
  const name = lowerName(CIVIC.get(strike.civic.def)?.name ?? strike.civic.def);
  const shut = `closed the ${name} for ${spanWords(ATOM.spy.closed)}`;
  const lost = spanWords(strike.hours);
  switch (strike.what) {
    case 'build':
      return `Saboteurs from ${by} put the ${name} back ${lost}`;
    case 'fuel':
      return `Saboteurs from ${by} ${strike.hours > 0 ? `spoiled ${lost} of fuel and ` : ''}${shut}`;
    case 'bomb':
      return `Saboteurs from ${by} ${strike.hours > 0 ? `undid ${lost} of work on the bomb and ` : ''}${shut}`;
    default:
      return `Saboteurs from ${by} ${shut}`;
  }
}

// ---------------------------------------------------------------------------------------------
// Losses (call 1) and what holds the buildings up
// ---------------------------------------------------------------------------------------------

/**
 * A civic building of the city was destroyed (`Sim.removeCivic`; bulldozing a plant that holds fuel,
 * or a silo that holds a bomb or a build, is refused, so this is damage, a disaster or the blast):
 * a finished plant lost halves the fuel, a silo lost loses the bomb, the build and the preparation.
 */
export function atomCivicRemoved(sim: Sim, c: Civic): void {
  const a = sim.state.war?.atom;
  if (!a) return;
  if (c.def === 'enrichment' && !c.build && a.fuel > 0 && !a.fired) {
    a.fuel = round3(a.fuel / 2);
    sim.events.push({ kind: 'atomLost', id: c.id, info: { what: 'fuel' } });
    sim.warChanged();
  }
  if (c.def === 'atomsilo' && (a.bomb || a.have || a.prep)) {
    delete a.bomb;
    delete a.have;
    delete a.prep;
    sim.events.push({ kind: 'atomLost', id: c.id, info: { what: 'bomb' } });
    sim.warChanged();
  }
}

/**
 * Why a plant or silo can't be bulldozed, or null: a plant holding fuel, a silo holding a bomb, a
 * build or a launch being prepared (as a base keeping a superweapon, `baseKeepsSuper`). Once the
 * bomb has left there is nothing left to hold.
 */
export function atomKeeps(sim: Sim, c: Civic): string | null {
  const a = sim.state.war?.atom;
  if (!a || a.fired) return null;
  const name = lowerName(CIVIC.get(c.def)?.name ?? c.def);
  if (c.def === 'enrichment' && a.fuel > 0)
    return `The ${name} holds the city’s fuel: it can’t be knocked down`;
  if (c.def === 'atomsilo') {
    if (a.prep) return `The ${name} is preparing a launch: call it off first`;
    if (a.have) return `The ${name} holds an atom bomb: it can’t be knocked down`;
    if (a.bomb) return `The ${name} is building the bomb: call it off first`;
  }
  return null;
}

/**
 * Why an undo or redo can't be done, or null: it would take away a plant or a silo that holds the
 * race (an undone placement, a redone bulldozing), which bulldozing refuses (`atomKeeps`) and which
 * would otherwise go round `removeCivic`'s losses and leave a bomb with no silo. The check is made
 * before anything changes.
 */
export function atomUndoRefusal(sim: Sim, edit: Edit, dir: 'undo' | 'redo'): string | null {
  for (const ch of edit.changes) {
    // A whole building going: the entity's value after the edit is nothing.
    if (ch.c !== 'civics' || ch.f !== undefined || (dir === 'undo' ? ch.b : ch.a) !== null) continue;
    const c = sim.state.civics.get(ch.id!);
    const held = c ? atomKeeps(sim, c) : null;
    if (held) return held;
  }
  return null;
}

/**
 * Test mode: the race standing at a stage, its waits skipped (the plan's tests and the e2e). It sets
 * only facts: every research tier done (from the plant stage on, which the gate lets in only with
 * the whole tree done; `none` leaves the research alone), the plant and silo the stage needs
 * finished (they must already be placed: a cheat chooses no ground), the fuel, the bomb's build
 * half paid and done, `have`, a launch half prepared at `to` (or the first rival), `fired`. It
 * never touches the money, the rules, the war or the neighbours; stage `none` forgets the race.
 */
export function atomCheat(
  sim: Sim,
  stage: AtomStage,
  to: number | undefined,
  dryRun: boolean,
): CommandResult {
  const w = sim.state.war;
  if (!w) return fail('War is off in this city');
  const no = atomStageNo(stage);
  if (no < 0) return fail('No such stage');
  const plant = civicOfDef(sim, 'enrichment');
  const silo = civicOfDef(sim, 'atomsilo');
  if (no >= 1 && !plant) return fail('Place the enrichment plant first');
  if (no >= 3 && !silo) return fail('Place the atom silo first');
  let aim: Neighbour | undefined;
  if (no >= 6) {
    aim =
      to === undefined
        ? sim.state.region.neighbours.find((n) => !!n.rival && !n.player)
        : neighbourOf(sim, to);
    if (!aim) return fail('No neighbour to aim at');
  }
  if (dryRun) return ok(0);
  if (no === 0) {
    delete w.atom;
    sim.warChanged();
    return ok(0);
  }
  researchCheat(sim, [...TIER_KEYS], false);
  const finish = (c: Civic | undefined) => {
    if (!c?.build) return;
    delete c.build;
    sim.civicStatusChanged(c.id);
    sim.events.push({ kind: 'projectDone', id: c.id });
  };
  if (no >= 2) finish(plant);
  if (no >= 4) finish(silo);
  const a = atomOf(sim);
  delete a.bomb;
  delete a.have;
  delete a.prep;
  delete a.fired;
  delete a.inbound;
  delete a.impact;
  a.fuel = no >= 3 ? ATOM.fuel.hours : no === 2 ? ATOM.fuel.hours / 2 : 0;
  if (no === 4) {
    const done = ATOM.bomb.hours / 2;
    a.bomb = { done, paid: Math.floor(done / ATOM.bomb.every) + 1 };
  }
  if (no === 5 || no === 6) a.have = true;
  if (no === 6) a.prep = { done: ATOM.launch.prepHours / 2, to: aim!.id };
  if (no >= 7) {
    // (Used, a day ago: it has landed already, and the neighbour was not hit by this cheat.)
    const ago = no === 8 ? ATOM.flight.hours * TICKS_PER_HOUR : 0;
    a.fired = {
      tick: sim.state.tick - ago,
      to: aim!.id,
      name: aim!.name,
      ...(no === 8 ? { landed: true } : {}),
    };
  }
  sim.warChanged();
  return ok(0);
}
