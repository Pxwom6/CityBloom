/**
 * A computer neighbour's race for the atom bomb (M40 step 7, `docs/plans/M40-design.md` call 19).
 * Hard difficulty only: Easy and Normal have no lever (`WAR_DIFFICULTY.bomb`), so Normal stays the
 * war of M37 to the bit and the 20-year balance runs do not move. A neighbour that is old and big
 * enough begins in a month, by a roll of its own (`${seed}:bomb:${month}`: not `intelMonth`'s stream
 * nor any `sim.rng` stream), and then needs war hours (the war clock, so the region's fair clock holds
 * it as it holds the city's own race) for its fuel, its silo and its bomb. The city's spies and
 * expeditions set it back (`setBackRival`: its dates move), a blackout holds it hour by hour. A
 * finished bomb waits until the neighbour is desperate, then prepares for ten game days, which the
 * city is told of, and launches once, at the city, if it is still desperate; the strike is the same
 * `atomInbound` as any other (the dome stops it as it stops any bomb). Nothing here exists in a city
 * that has no such neighbour: `RivalNeighbour.bomb` appears with the first start and a city without
 * one is read exactly as before.
 */
import { atomStageNo, RIVAL_BOMB, RIVAL_STAGES, rivalNotice, type RivalStage } from '../../data/atom';
import { fail, ok, type CommandResult } from '../commands';
import { Rng } from '../rng';
import type { Sim } from '../sim';
import { TICKS_PER_MONTH, TICKS_PER_YEAR } from '../time';
import { atomInbound, bombAllowed } from './atom';
import { atomChronicle } from './atomWorld';
import { fightingWith, neighbourOf, note } from './diplomacy';
import type { Neighbour } from './region';
import { rivalBlackedOut } from './supers';
import { aggressionOf, warDifficulty } from './warEconomy';

/**
 * A computer neighbour's race (`RivalNeighbour.bomb`): the stage it is at, the war-clock hour that
 * stage began, and the war hours its end has been put back since (by spies, forces and blackouts).
 * A stage ends at `at + RIVAL_BOMB.hours[stage] + delay`; a stage that is waiting (`ready`) or
 * over (`spent`) has no date.
 */
export interface RivalBomb {
  stage: RivalStage;
  at: number;
  delay: number;
}

/** The chronicle's line for each stage a race announces. */
const CHRONICLE_AT: Partial<Record<RivalStage, 'rivalFuel' | 'rivalSilo' | 'rivalBomb' | 'rivalReady'>> = {
  enriching: 'rivalFuel',
  silo: 'rivalSilo',
  bomb: 'rivalBomb',
  ready: 'rivalReady',
};

/** A computer neighbour by id (a friend's city races on its own machine and says so in its report). */
function computerNeighbour(sim: Sim, id: number): Neighbour | undefined {
  const n = neighbourOf(sim, id);
  return n?.rival && !n.player ? n : undefined;
}

/** The computer neighbours, in id order. */
function computerNeighbours(sim: Sim): Neighbour[] {
  return sim.state.region.neighbours.filter((n) => n.rival && !n.player).sort((a, b) => a.id - b.id);
}

/** Is this neighbour racing, with something left for the city's saboteurs to slow? (Not yet begun, or used, is no.) */
export function rivalRacing(n: Neighbour): boolean {
  const b = n.rival?.bomb;
  return !!b && b.stage !== 'spent';
}

/** Some computer neighbour has finished its bomb (it is ready, being prepared for launch, or used). */
export function rivalAhead(sim: Sim): boolean {
  return computerNeighbours(sim).some((n) => {
    const stage = n.rival!.bomb?.stage;
    return stage === 'ready' || stage === 'preparing' || stage === 'spent';
  });
}

/** The war-clock hour the neighbour's current stage ends, or null when it has no date (waiting, or over). */
export function rivalBombDue(n: Neighbour): number | null {
  const b = n.rival?.bomb;
  if (!b) return null;
  if (b.stage === 'preparing') return b.at + RIVAL_BOMB.prep + b.delay;
  if (b.stage === 'enriching' || b.stage === 'silo' || b.stage === 'bomb')
    return b.at + RIVAL_BOMB.hours[b.stage] + b.delay;
  return null;
}

/**
 * Is the neighbour desperate: an open total war with the city that it is losing badly (the war score,
 * from the city's side, at or above `RIVAL_BOMB.desperate`)? A ceasefire, a surrender, a peace or a
 * recovered war ends it.
 */
export function rivalDesperate(sim: Sim, n: Neighbour): boolean {
  const war = fightingWith(sim, n.id);
  return !!war && war.scale === 'total' && war.score >= RIVAL_BOMB.desperate;
}

/**
 * Set the neighbour's race back (M40, call 18): a successful sabotage, or a won expedition. The stage
 * it is in takes `hours` more war hours; a launch being prepared starts again (as the city's own does
 * when its silo is closed); a bomb waiting for its war has nothing to slow. Returns the hours it was
 * put back (0: nothing to slow).
 */
export function setBackRival(sim: Sim, n: Neighbour, hours: number): number {
  const b = n.rival?.bomb;
  if (!b) return 0;
  if (b.stage === 'enriching' || b.stage === 'silo' || b.stage === 'bomb') {
    b.delay += hours;
    sim.warChanged();
    return hours;
  }
  if (b.stage === 'preparing') {
    const was = sim.state.war!.clock - b.at;
    b.at = sim.state.war!.clock;
    b.delay = 0;
    sim.warChanged();
    return was;
  }
  return 0;
}

/** A stage is reached: the event (the region's news), the chronicle line (a city of its own) and the notice's words. */
function announce(sim: Sim, n: Neighbour, stage: RivalStage): void {
  sim.events.push({
    kind: 'rivalBomb',
    id: n.id,
    info: { name: n.name, stage: atomStageNo(stage), text: rivalNotice(stage, n.name) },
  });
  // The chronicle is the city's own record; in a region the room keeps the friends' (and `atoms`).
  const line = CHRONICLE_AT[stage];
  if (line && !sim.state.region.rules) atomChronicle(sim, line, n.name);
  sim.warChanged();
}

/**
 * Each month (a game day), after `intelMonth`: on Hard, in a city that can race at all and is old
 * enough, a neighbour that is big and advanced enough may begin. One at a time; the chance is the
 * month's `RIVAL_BOMB.chance` times its character, on dice of their own, one roll per candidate in id
 * order. Normal and Easy return at once: nothing is read, rolled or kept.
 */
export function rivalBombMonth(sim: Sim): void {
  const s = sim.state;
  const w = s.war;
  if (!w || !warDifficulty(sim).bomb || s.scenario) return;
  if (s.tick < RIVAL_BOMB.years * TICKS_PER_YEAR || !bombAllowed(sim)) return;
  const all = computerNeighbours(sim);
  if (all.some(rivalRacing)) return;
  const rng = Rng.fromSeed(`${s.options.seed}:bomb:${Math.floor(s.tick / TICKS_PER_MONTH)}`);
  for (const n of all) {
    const r = n.rival!;
    if (r.bomb || r.vassal || (r.tech ?? 0) < RIVAL_BOMB.tech || n.population < RIVAL_BOMB.population)
      continue;
    const roll = rng.next();
    if (roll >= RIVAL_BOMB.chance * (RIVAL_BOMB.character + aggressionOf(sim, r.personality))) continue;
    r.bomb = { stage: 'enriching', at: w.clock, delay: 0 };
    announce(sim, n, 'enriching');
    return;
  }
}

/**
 * The races' hour on the war clock: each stage ends at its date, a blackout holds the race an hour
 * at a time, a finished bomb waits for its war, a launch is prepared, and the bomb leaves once, at
 * the city. A race idles while the rules turn the bomb off, as the city's own does, and while its
 * town is the city's vassal.
 */
export function rivalBombHour(sim: Sim): void {
  const w = sim.state.war;
  if (!w) return;
  for (const n of computerNeighbours(sim)) {
    const r = n.rival!;
    const b = r.bomb;
    if (!b || b.stage === 'spent' || r.vassal || !bombAllowed(sim)) continue;
    const due = rivalBombDue(n);
    if (due !== null && rivalBlackedOut(sim, n)) {
      b.delay++;
      continue;
    }
    if (b.stage === 'ready') {
      if (rivalDesperate(sim, n)) {
        b.stage = 'preparing';
        b.at = w.clock;
        b.delay = 0;
        note(sim, n.id, 'rivalDesperate', `${n.name} is desperate and has the bomb. Offer peace.`, 'bad');
        sim.warChanged();
      }
      continue;
    }
    if (b.stage === 'preparing') {
      // Peace, a ceasefire, a surrender or a war turned round: the launch is called off for now.
      if (!rivalDesperate(sim, n)) {
        b.stage = 'ready';
        b.at = w.clock;
        b.delay = 0;
        note(sim, n.id, 'rivalStandDown', `${n.name} has called off its launch, for now`, 'good');
        sim.warChanged();
        continue;
      }
      if (w.clock >= due!) launch(sim, n, b);
      continue;
    }
    if (w.clock < due!) continue;
    const next = RIVAL_STAGES[RIVAL_STAGES.indexOf(b.stage) + 1]!;
    b.stage = next;
    b.at = w.clock;
    b.delay = 0;
    announce(sim, n, next);
  }
}

/**
 * The bomb leaves for the city. One bomb is in the air at a time: if another is on its way (or the
 * city's war is off) it waits and tries again the next hour. A neighbour that has fired is shunned:
 * its alliances with the other computer neighbours end (a neighbour's only standing with another is
 * its alliance, `RivalNeighbour.allies`; the city's own firing makes it a pariah, this does not).
 */
function launch(sim: Sim, n: Neighbour, b: RivalBomb): void {
  if (atomInbound(sim, { id: n.id, name: n.name })) return;
  b.stage = 'spent';
  b.at = sim.state.war!.clock;
  b.delay = 0;
  const r = n.rival!;
  const had = (r.allies ?? []).length > 0;
  for (const other of computerNeighbours(sim)) {
    const o = other.rival!;
    if (o.allies?.includes(n.id)) o.allies = o.allies.filter((x) => x !== n.id);
  }
  if (had) {
    r.allies = [];
    note(sim, n.id, 'rivalShunned', `${n.name}’s allies turn from it over the atom bomb`, 'good');
  }
  sim.warChanged();
}

/**
 * Test mode: a computer neighbour is at a stage of the race (`none` takes the race away; `enriching`,
 * `silo`, `bomb`, `ready`, `preparing` or `spent`), `hours` war hours into it (default 0). Sets only
 * facts: no event, no chronicle line, nothing about the war. At most one neighbour races at a time,
 * as in play.
 */
export function rivalBombCheat(
  sim: Sim,
  id: number,
  stage: RivalStage | 'none',
  hours: number | undefined,
  dryRun: boolean,
): CommandResult {
  const w = sim.state.war;
  if (!w) return fail('War is off in this city');
  const n = computerNeighbour(sim, id);
  if (!n) return fail('No such rival');
  if (stage !== 'none' && !RIVAL_STAGES.includes(stage)) return fail('No such stage');
  const into = hours ?? 0;
  if (!Number.isFinite(into) || into < 0) return fail('Invalid hours');
  const other = computerNeighbours(sim).find((x) => x !== n && rivalRacing(x));
  if (stage !== 'none' && stage !== 'spent' && other) return fail(`${other.name} is racing already`);
  if (dryRun) return ok(0);
  if (stage === 'none') delete n.rival!.bomb;
  else n.rival!.bomb = { stage, at: w.clock - into, delay: 0 };
  sim.warChanged();
  return ok(0);
}

/** What the page shows of the neighbours' races (M40): who is racing, at which stage (`atomStageNo`), and a launch's countdown. */
export interface RivalRace {
  id: number;
  name: string;
  stage: number;
  /** War hours until a launch being prepared leaves (only then). */
  launchIn: number | null;
}

export function rivalRaces(sim: Sim): RivalRace[] {
  const clock = sim.state.war?.clock ?? 0;
  return computerNeighbours(sim)
    .filter((n) => n.rival!.bomb)
    .map((n) => {
      const b = n.rival!.bomb!;
      return {
        id: n.id,
        name: n.name,
        stage: atomStageNo(b.stage),
        launchIn: b.stage === 'preparing' ? Math.max(0, rivalBombDue(n)! - clock) : null,
      };
    });
}
