/**
 * Intelligence (M37, SPEC-5.md): the city's spies look round a computer neighbour's town, sabotage
 * its power or its depot, or steal its research; counter-intelligence catches spies both ways, and
 * a caught spy is a diplomatic incident (`docs/plans/M37-design.md`, key calls 11–12). Computer
 * neighbours send spies and research too, but only once the city has a weapons lab or a spy agency,
 * so M34–M36 cities are unchanged. Every time here is on the war clock (hours).
 */
import { BRANCHES, TIER, type Branch, type TierKey } from '../../data/research';
import {
  AGENT_NAMES,
  INTEL,
  SPY_OP,
  SPY_OPS,
  spyOdds,
  spyOutcome,
  type SabotageTarget,
  type SpyOp,
} from '../../data/intel';
import { CIVIC } from '../../data/civic';
import { fail, ok, type CommandResult } from '../commands';
import { formatInt } from '../dmath';
import { Rng } from '../rng';
import type { Sim } from '../sim';
import { TICKS_PER_MONTH } from '../time';
import { civicOnline, lowerName, type Civic } from '../world/civic';
import { accrue } from './economy';
import {
  bindingPacts,
  endPactsWith,
  fightingWith,
  incident,
  pactsWith,
  reputationChange,
  scoreIntel,
  strikeBreaks,
  strikeRefusal,
} from './diplomacy';
import { damageCivic } from './raids';
import type { Neighbour, RivalNeighbour } from './region';
import { bankPoints, researched, tierCounts } from './research';
import { militaryCivics, militaryOf } from './war';
import { rivalBlackedOut } from './supers';
import {
  friendArrived,
  friendMissionHour,
  friendOpsWaiting,
  friendSpyRefusal,
  friendTier,
  stolenFrom,
  type Dossier,
  type FriendOpWaiting,
} from './regionOps';

/** A mission of one of the city's agents. */
export interface Mission {
  id: number;
  /** The neighbour it goes to, its name, and a friend's place in the region (M37, step 9). */
  to: number;
  name: string;
  slot?: number;
  op: SpyOp;
  target?: SabotageTarget;
  branch?: Branch;
  agent: string;
  /** War-clock hours: left, arrives (the outcome), home again. */
  depart: number;
  arrive: number;
  home: number;
  /**
   * `arrived`: at a friend's city, waiting for the region's verdict (step 9: `regionOps.ts`), pinned
   * (`settling`) once the page has put it to the region.
   */
  state: 'out' | 'arrived' | 'back';
  settling?: true;
  outcome?: 'success' | 'failed' | 'caught';
  paid: number;
}

/** A computer neighbour's spy on its way to the city. */
export interface TheirSpy {
  id: number;
  from: number;
  op: SpyOp;
  target?: SabotageTarget;
  arrive: number;
}

/** The city's intelligence (`WarState.intel`): made by its first mission, or the first spy of theirs. */
export interface Intel {
  missions: Mission[];
  /** What the agents brought home (and what the city caught), newest last, the last 12. */
  results: { at: number; with: number; text: string; tone?: 'good' | 'bad' }[];
  /** War-clock hours at which a lost agent's replacement arrives. */
  lost?: number[];
  /** Spies of theirs on their way. */
  theirs?: TheirSpy[];
  /** A spy of the city's was caught in a neighbour's town (war-clock hour, by neighbour). */
  incidents?: Record<number, number>;
  /** A spy of theirs was caught here (war-clock hour, by neighbour): war on them costs no reputation. */
  grievance?: Record<number, number>;
  /** Friends' cities looked round (step 9), by their place in the region: the dossier, fresh until then. */
  seen?: Record<number, Dossier & { until: number }>;
  /** Tiers whose points the city's agents stole from friends (once each), by their place in the region. */
  stolen?: Record<number, TierKey[]>;
}

/** What the city knows of a computer neighbour from its spies, and what its spies did there. */
export interface RivalIntel {
  /** Revealed by the city's agents until this war-clock hour. */
  revealed?: number;
  /** Its power sabotaged until then: guns half-manned there, and no raids from it. */
  power?: number;
  /** Its depot sabotaged: no arming until then. */
  noArms?: number;
  /** It caught a spy of the city's at this hour (its counter-intelligence is up for a while). */
  caught?: number;
  /** Tiers whose points the city's agents stole from it (once each). */
  stolen?: TierKey[];
  /** Its own spies know the city until this hour: its raids come readier. */
  knows?: number;
}

const BRANCH_NAME = new Map(BRANCHES.map((b) => [b.id, b.name]));
const TARGET_NAME: Record<SabotageTarget, string> = { power: 'power plant', depot: 'vehicle depot' };

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function clock(sim: Sim): number {
  return sim.state.war?.clock ?? 0;
}

export function intel(sim: Sim): Intel {
  return (sim.state.war!.intel ??= { missions: [], results: [] });
}

function rivalIntel(r: RivalNeighbour): RivalIntel {
  return (r.intel ??= {});
}

export function result(sim: Sim, withId: number, text: string, tone?: 'good' | 'bad'): void {
  const i = intel(sim);
  i.results.push({ at: clock(sim), with: withId, text, ...(tone ? { tone } : {}) });
  if (i.results.length > 12) i.results.splice(0, i.results.length - 12);
  sim.events.push({ kind: 'intel', id: withId, info: { text, ...(tone ? { tone } : {}) } });
  sim.warChanged();
}

/** The city's working spy agency (online, staffed and powered enough), if it has one. */
export function spyAgency(sim: Sim): Civic | undefined {
  return militaryCivics(sim).find((c) => militaryOf(c)!.agency);
}

/** Agents the agency keeps: two, three with Stealth (none without an agency). */
export function agentsKept(sim: Sim): number {
  const c = spyAgency(sim);
  if (!c) return 0;
  return researched(sim, 'intel3') ? INTEL.agents + 1 : (militaryOf(c)!.agency?.agents ?? INTEL.agents);
}

/** Agents free to go now: those kept, less those out and those lost and not yet replaced. */
export function agentsFree(sim: Sim): number {
  const i = sim.state.war?.intel;
  const now = clock(sim);
  const out = i?.missions.length ?? 0;
  const lost = (i?.lost ?? []).filter((at) => at > now).length;
  return Math.max(0, agentsKept(sim) - out - lost);
}

/** The city's intelligence tier (0–4). */
export function intelTier(sim: Sim): number {
  return tierCounts(sim).intel;
}

/**
 * The city's counter-intelligence (‰): its agency's staff and power, its intelligence research,
 * and more against a neighbour it's at war with (`from`), 750 at most.
 */
export function counterIntel(sim: Sim, from?: number): number {
  const c = INTEL.counter;
  const agency = spyAgency(sim);
  let v = c.base;
  if (agency && civicOnline(agency))
    v += Math.floor(c.agency * Math.min(1, agency.staff ?? 0) * (agency.powered ?? 0));
  if (researched(sim, 'intel1')) v += c.intel1;
  if (researched(sim, 'intel2')) v += c.intel2;
  if (researched(sim, 'intel3')) v += c.intel3;
  if (from !== undefined && fightingWith(sim, from)) v += c.atWar;
  return Math.min(c.max, v);
}

/** A computer neighbour's counter-intelligence (‰): its character, a war, a spy caught lately, its tech. */
export function rivalCounter(sim: Sim, n: Neighbour): number {
  const r = n.rival;
  if (!r) return 0;
  if (rivalBlackedOut(sim, n)) return 0;
  const c = INTEL.counter;
  let v = c.rival[r.personality] ?? 300;
  if (fightingWith(sim, n.id)) v += c.rivalAtWar;
  const caught = r.intel?.caught;
  if (caught !== undefined && clock(sim) - caught < c.rivalCatchHours) v += c.rivalAfterCatch;
  v += c.rivalPerTech * (r.tech ?? 0);
  return Math.min(c.rivalMax, v);
}

/** The city's agents have a fresh look at this computer neighbour. */
export function revealed(sim: Sim, n: Neighbour): boolean {
  const v = n.rival?.intel?.revealed;
  return v !== undefined && clock(sim) < v;
}

/** Its power plant sabotaged lately: guns half-manned in battles there, and no raids from it. */
export function powerSabotaged(sim: Sim, n: Neighbour): boolean {
  const v = n.rival?.intel?.power;
  return v !== undefined && clock(sim) < v;
}

/** Its depot sabotaged lately: it arms no more for a while. */
export function depotSabotaged(sim: Sim, n: Neighbour): boolean {
  const v = n.rival?.intel?.noArms;
  return v !== undefined && clock(sim) < v;
}

/** Its own spies know the city: its raids come readier. */
export function rivalKnows(sim: Sim, n: Neighbour): boolean {
  const v = n.rival?.intel?.knows;
  return v !== undefined && clock(sim) < v;
}

/** A spy of the city's was caught there within the last day (it may answer with war). */
export function freshIncident(sim: Sim, id: number): boolean {
  const at = sim.state.war?.intel?.incidents?.[id];
  return at !== undefined && clock(sim) - at < INTEL.caught.freshHours;
}

/** A spy of theirs was caught here lately: war on them costs the city no reputation. */
export function grieved(sim: Sim, id: number): boolean {
  const at = sim.state.war?.intel?.grievance?.[id];
  return at !== undefined && clock(sim) - at < INTEL.theirsCaught.grievanceHours;
}

/** The next tier the city lacks in a branch (null when it has all four). */
function nextTier(sim: Sim, branch: Branch): TierKey | null {
  const have = tierCounts(sim)[branch];
  return have >= 4 ? null : (`${branch}${have + 1}` as TierKey);
}

/** Why a mission can't go, or null. */
function missionRefusal(
  sim: Sim,
  to: number,
  op: SpyOp,
  target: SabotageTarget | undefined,
  branch: Branch | undefined,
): string | null {
  const s = sim.state;
  const w = s.war;
  if (!w) return 'War is off in this city';
  if (!SPY_OPS.includes(op)) return 'No such mission';
  const agency = spyAgency(sim);
  if (!agency) return 'Spy missions need a spy agency';
  if (!civicOnline(agency) || (agency.staff ?? 0) < 0.25 || (agency.powered ?? 0) < 0.5)
    return 'The spy agency needs staff and power';
  const def = SPY_OP[op];
  if (!researched(sim, def.research)) return `${def.name} needs ${TIER.get(def.research)!.name} research`;
  const n = s.region.neighbours.find((x) => x.id === to);
  if (!n) return 'No such neighbour';
  // A friend's city (step 9): the region decides; these are the checks the city can make itself.
  if (n.player) {
    const why = friendSpyRefusal(sim, n, op);
    if (why) return why;
  } else if (!n.rival) return `${n.name} isn’t a rival`;
  if (s.war?.diplomacy?.neutral && op !== 'reveal') return 'A neutral city only sends spies to look';
  if (op === 'sabotage' && target !== 'power' && target !== 'depot')
    return 'Choose what to sabotage: its power or its depot';
  if (op === 'steal') {
    if (!branch || !BRANCH_NAME.has(branch)) return 'Choose the research to steal';
    const next = nextTier(sim, branch);
    if (!next) return `The city has all of ${BRANCH_NAME.get(branch)} research`;
    // A friend's tiers as its last report said (step 9); a computer neighbour's tech.
    const theirs = n.player ? friendTier(n, branch) : (n.rival!.tech ?? 0);
    if (theirs <= tierCounts(sim)[branch])
      return `${n.name} is no further than you in ${BRANCH_NAME.get(branch)} research`;
    const stolen = n.player ? stolenFrom(sim, n.player.slot) : n.rival!.intel?.stolen;
    if (stolen?.includes(next))
      return `Your agents have taken all they can of ${TIER.get(next)!.name} from ${n.name}`;
  }
  if (agentsFree(sim) <= 0) return 'Every agent is out';
  if (!s.options.sandbox && s.treasury < def.cost) return `A mission costs ${money(def.cost)}`;
  return null;
}

const money = (v: number) => `$${formatInt(Math.round(v))}`;

/** Send an agent (M37): it is out for half the hours, the mission resolves there, and it comes home. */
export function spyMission(
  sim: Sim,
  to: number,
  op: SpyOp,
  target: SabotageTarget | undefined,
  branch: Branch | undefined,
  breakPact: boolean,
  dryRun: boolean,
): CommandResult {
  const why = missionRefusal(sim, to, op, target, branch);
  if (why) return fail(why);
  const s = sim.state;
  const n = s.region.neighbours.find((x) => x.id === to)!;
  // Sabotage is a strike (M36's refusals: pacts asked about first, vassals, wars not yet open); at a
  // friend's city the region decides (step 9).
  if (op === 'sabotage' && !n.player) {
    const strike = strikeRefusal(sim, to, 'power', breakPact);
    if (strike) return strike;
  }
  if (dryRun) return ok(0);
  if (op === 'sabotage' && !n.player) strikeBreaks(sim, to);
  const def = SPY_OP[op];
  const id = s.nextId++;
  const now = clock(sim);
  const half = Math.ceil(def.hours / 2);
  accrue(sim, 'spies', -def.cost);
  const m: Mission = {
    id,
    to,
    name: n.name,
    ...(n.player ? { slot: n.player.slot } : {}),
    op,
    ...(op === 'sabotage' ? { target } : {}),
    ...(op === 'steal' ? { branch } : {}),
    agent: AGENT_NAMES[id % AGENT_NAMES.length]!,
    depart: now,
    arrive: now + half,
    home: now + def.hours,
    state: 'out',
    paid: def.cost,
  };
  intel(sim).missions.push(m);
  sim.events.push({ kind: 'spyLeft', id, info: { to: n.name, op } });
  sim.warChanged();
  return ok(0, { created: [id] });
}

/** A roll (0–999) of a mission's own dice: the same whenever it's resolved. */
function roll(sim: Sim, key: string): number {
  return Math.floor(Rng.fromSeed(`${sim.state.options.seed}:${key}`).next() * 1000);
}

/** A mission arrives: its outcome, and what it does. */
function resolveMission(sim: Sim, m: Mission): void {
  const s = sim.state;
  const n = s.region.neighbours.find((x) => x.id === m.to);
  if (!n?.rival || n.player) {
    m.outcome = 'failed';
    return;
  }
  const r = n.rival;
  const odds = spyOdds(
    m.op,
    intelTier(sim),
    rivalCounter(sim, n),
    revealed(sim, n),
    researched(sim, 'intel3'),
  );
  const outcome = spyOutcome(roll(sim, `spy:${m.id}`), odds);
  m.outcome = outcome;
  const now = clock(sim);
  const agent = `Agent ${m.agent}`;
  if (outcome === 'caught') {
    // Lost, replaced in two days; an incident.
    const i = intel(sim);
    i.lost = [...(i.lost ?? []).filter((at) => at > now), now + INTEL.replaceHours];
    (i.incidents ??= {})[n.id] = now;
    rivalIntel(r).caught = now;
    const pact = bindingPacts(sim, n.id).length > 0;
    reputationChange(sim, INTEL.caught.reputation);
    incident(
      sim,
      n,
      pact ? INTEL.caught.relationPact : INTEL.caught.relation,
      INTEL.caught.allies,
      'spyCaught',
      `${agent} was caught in ${n.name}: an incident`,
      'bad',
    );
    // Honourable and cautious neighbours end their pacts of friendship (not a breach of the city's).
    if (r.personality === 'honourable' || r.personality === 'cautious')
      endPactsWith(
        sim,
        n,
        ['nonAggression', 'alliance'],
        `${n.name} ends its pacts with the city over the spy`,
      );
    // A caught saboteur is a strike: the neighbour may answer even a young city.
    if (m.op === 'sabotage') s.war!.struck = { ...(s.war!.struck ?? {}), [n.id]: s.tick };
    scoreIntel(sim, n.id, -INTEL.score);
    result(sim, n.id, `${agent} was caught in ${n.name}`, 'bad');
    return;
  }
  if (outcome === 'failed') {
    result(sim, n.id, `${agent} came away from ${n.name} with nothing`);
    return;
  }
  const ri = rivalIntel(r);
  if (m.op === 'reveal') {
    ri.revealed = now + INTEL.revealHours;
    result(
      sim,
      n.id,
      `${agent} looked round ${n.name}: forces ${formatInt(Math.round(r.forces))}, defences ${formatInt(Math.round(r.defences))}, tech ${r.tech ?? 0}`,
      'good',
    );
  } else if (m.op === 'sabotage') {
    if (m.target === 'power') {
      ri.power = now + INTEL.sabotagePowerHours;
      result(
        sim,
        n.id,
        `${agent} sabotaged ${n.name}’s power: its guns are half-manned for three days`,
        'good',
      );
    } else {
      r.forces = Math.round(r.forces * INTEL.sabotageDepotForces * 10) / 10;
      // Its months are game days.
      ri.noArms = now + INTEL.sabotageDepotMonths * 24;
      result(sim, n.id, `${agent} sabotaged ${n.name}’s depot: it arms no more for six days`, 'good');
    }
    scoreIntel(sim, n.id, INTEL.score);
  } else {
    const next = m.branch ? nextTier(sim, m.branch) : null;
    if (next && (r.tech ?? 0) > tierCounts(sim)[m.branch!] && !ri.stolen?.includes(next)) {
      const pts = Math.floor(TIER.get(next)!.points * INTEL.stealShare);
      bankPoints(sim, next, pts);
      ri.stolen = [...(ri.stolen ?? []), next];
      result(
        sim,
        n.id,
        `${agent} stole ${formatInt(pts)} points of ${TIER.get(next)!.name} from ${n.name}`,
        'good',
      );
    } else {
      m.outcome = 'failed';
      result(sim, n.id, `${agent} found nothing new in ${n.name}`);
    }
  }
}

/** A computer neighbour's spy arrives in the city. */
function resolveTheirs(sim: Sim, spy: TheirSpy): void {
  const s = sim.state;
  const n = s.region.neighbours.find((x) => x.id === spy.from);
  if (!n?.rival || n.player) return;
  const r = n.rival;
  const counter = counterIntel(sim, n.id);
  const tier = clamp(r.tech ?? 0, 0, 4);
  const outcome = spyOutcome(roll(sim, `theirs:${spy.id}`), spyOdds(spy.op, tier, counter, false, false));
  const now = clock(sim);
  if (outcome === 'caught') {
    const where = spy.op === 'sabotage' && spy.target ? ` at the ${TARGET_NAME[spy.target]}` : '';
    r.relation = clamp(r.relation + INTEL.theirsCaught.relation, -100, 100);
    (intel(sim).grievance ??= {})[n.id] = now;
    scoreIntel(sim, n.id, INTEL.score);
    result(sim, n.id, `Your agents caught a spy from ${n.name}${where}`, 'good');
    sim.events.push({ kind: 'enemySpyCaught', id: n.id, info: { from: n.name } });
    return;
  }
  if (outcome === 'failed') return;
  const ri = rivalIntel(r);
  if (spy.op === 'sabotage') {
    const c = sabotageTarget(sim, spy.target ?? 'power');
    if (c) {
      damageCivic(sim, c.id, INTEL.sabotageClosed, false);
      result(
        sim,
        n.id,
        `Saboteurs from ${n.name} closed the ${lowerName(CIVIC.get(c.def)!.name)} for a day`,
        'bad',
      );
      sim.events.push({ kind: 'sabotaged', id: c.id, info: { from: n.name } });
      scoreIntel(sim, n.id, -INTEL.score);
    }
    return;
  }
  // A quiet look or theft: the city hears of it only with good counter-intelligence.
  const heard = counter >= INTEL.noticeCounter;
  if (spy.op === 'reveal') {
    ri.knows = now + INTEL.revealHours;
    if (heard) result(sim, n.id, `Spies from ${n.name} have been looking round the city`, 'bad');
  } else {
    // Its next tech step comes sooner.
    if (r.techAt !== undefined) r.techAt -= INTEL.theirStealSooner;
    if (heard) result(sim, n.id, `Spies from ${n.name} got away with some of the city’s research`, 'bad');
  }
}

/** What a saboteur goes for: the largest working power plant, or the vehicle depot. */
export function sabotageTarget(sim: Sim, target: SabotageTarget): Civic | undefined {
  const s = sim.state;
  let best: Civic | undefined;
  for (const c of [...s.civics.values()].sort((a, b) => a.id - b.id)) {
    if (!civicOnline(c)) continue;
    const def = CIVIC.get(c.def);
    if (target === 'depot') {
      if (c.def === 'vehicledepot') return c;
      continue;
    }
    const mw = def?.output?.power ?? 0;
    if (mw > 0 && (!best || mw > (CIVIC.get(best.def)?.output?.power ?? 0))) best = c;
  }
  return best;
}

/** Intelligence's hour on the war clock: missions arrive and come home, spies of theirs arrive. */
export function intelHour(sim: Sim): void {
  const w = sim.state.war;
  const i = w?.intel;
  if (!w || !i) return;
  const now = w.clock;
  for (const m of [...i.missions]) {
    // At a friend's city (step 9): the agent waits for the region's verdict, which the page asks for.
    if (m.state === 'out' && now >= m.arrive && m.slot !== undefined) friendArrived(sim, m);
    else if (m.state === 'arrived') friendMissionHour(sim, m);
    else if (m.state === 'out' && now >= m.arrive) {
      resolveMission(sim, m);
      if (m.outcome === 'caught') i.missions = i.missions.filter((x) => x !== m);
      else m.state = 'back';
      sim.warChanged();
    } else if (m.state === 'back' && now >= m.home) {
      i.missions = i.missions.filter((x) => x !== m);
      sim.events.push({ kind: 'spyHome', id: m.id, info: { agent: m.agent } });
      sim.warChanged();
    }
  }
  if (i.theirs?.length) {
    for (const spy of i.theirs.filter((x) => now >= x.arrive)) resolveTheirs(sim, spy);
    i.theirs = i.theirs.filter((x) => now < x.arrive);
    if (!i.theirs.length) delete i.theirs;
  }
  if (i.lost?.length) {
    i.lost = i.lost.filter((at) => at > now);
    if (!i.lost.length) delete i.lost;
  }
}

/** The city has a weapons lab or a spy agency: computer neighbours take an interest. */
export function worthSpyingOn(sim: Sim): boolean {
  return militaryCivics(sim).some((c) => {
    const m = militaryOf(c)!;
    return !!m.lab || !!m.agency;
  });
}

/** Each month (a game day): computer neighbours' tech moves on, and perhaps one sends a spy. */
export function intelMonth(sim: Sim): void {
  const s = sim.state;
  const w = s.war;
  if (!w) return;
  const month = Math.floor(s.tick / TICKS_PER_MONTH);
  // Their tech: only once the city researches (its weapons lab has them worried).
  if (w.research) {
    const rng = Rng.fromSeed(`${s.options.seed}:tech:${month}`);
    for (const n of s.region.neighbours) {
      const r = n.rival;
      if (!r || n.player) continue;
      const roll = rng.next();
      if ((r.tech ?? 0) >= 4) continue;
      if (r.techAt !== undefined && w.clock < r.techAt) continue;
      const character = TECH_CHARACTER[r.personality] ?? 1;
      const chance = INTEL_TECH.chance * character * Math.min(1.5, n.population / 10_000);
      if (roll >= chance) continue;
      r.tech = (r.tech ?? 0) + 1;
      r.techAt = w.clock + INTEL_TECH.gapHours;
      sim.events.push({ kind: 'rivalTech', id: n.id, info: { name: n.name, tech: r.tech } });
      sim.warChanged();
    }
  }
  // Their spies: only for a city with something to spy on, one a month at most.
  if (!worthSpyingOn(sim)) return;
  const rng = Rng.fromSeed(`${s.options.seed}:spies:${month}`);
  const neutral = !!w.diplomacy?.neutral;
  const best = Math.max(...Object.values(tierCounts(sim)));
  for (const n of s.region.neighbours) {
    const r = n.rival;
    if (!r || n.player) continue;
    const roll = rng.next();
    if (r.vassal || rivalBlackedOut(sim, n) || powerSabotaged(sim, n)) continue;
    const rs = INTEL.rivalSpies;
    const eager = r.personality === 'aggressive' || r.personality === 'treacherous';
    let chance = eager ? rs.eager : rs.chance;
    const war = !!fightingWith(sim, n.id);
    if (war) chance *= rs.atWar;
    if (pactsWith(sim, n.id).length && r.personality !== 'treacherous') chance *= rs.pact;
    if (neutral) chance *= rs.neutral;
    if (roll >= chance) continue;
    const op: SpyOp = war ? 'sabotage' : best > (r.tech ?? 0) ? 'steal' : 'reveal';
    const id = s.nextId++;
    const wait = rs.arriveMin + rng.int(rs.arriveMax - rs.arriveMin + 1);
    const i = intel(sim);
    i.theirs = [
      ...(i.theirs ?? []),
      {
        id,
        from: n.id,
        op,
        ...(op === 'sabotage' ? { target: rng.chance(0.5) ? ('power' as const) : ('depot' as const) } : {}),
        arrive: w.clock + wait,
      },
    ];
    sim.warChanged();
    break;
  }
}

/** Computer neighbours' tech (M37, design call 12): the chance a month by character, and the gap. */
const INTEL_TECH = { chance: 0.06, gapHours: 12 * 24 };
const TECH_CHARACTER: Record<string, number> = {
  aggressive: 1.3,
  treacherous: 1.2,
  cautious: 1,
  honourable: 1,
  mercantile: 0.8,
};

/** Test mode (M37): a computer neighbour's spy arrives now. */
export function spyInCheat(
  sim: Sim,
  from: number,
  op: SpyOp,
  target: SabotageTarget | undefined,
  dryRun: boolean,
): CommandResult {
  const w = sim.state.war;
  if (!w) return fail('War is off in this city');
  const n = sim.state.region.neighbours.find((x) => x.id === from);
  if (!n?.rival || n.player) return fail('No such rival');
  if (!SPY_OPS.includes(op)) return fail('No such mission');
  if (dryRun) return ok(0);
  const spy: TheirSpy = {
    id: sim.state.nextId++,
    from,
    op,
    ...(op === 'sabotage' ? { target: target ?? 'power' } : {}),
    arrive: w.clock,
  };
  resolveTheirs(sim, spy);
  return ok(0);
}

/** Test mode (M37): a computer neighbour's tech set. */
export function rivalTechCheat(sim: Sim, id: number, tech: number, dryRun: boolean): CommandResult {
  const n = sim.state.region.neighbours.find((x) => x.id === id);
  if (!n?.rival || n.player) return fail('No such rival');
  if (!Number.isInteger(tech) || tech < 0 || tech > 4) return fail('Tech runs from 0 to 4');
  if (dryRun) return ok(0);
  n.rival.tech = tech;
  sim.warChanged();
  return ok(0);
}

/** The war room's intelligence (M37). */
export interface IntelSummary {
  agents: number;
  free: number;
  counter: number;
  tier: number;
  missions: Mission[];
  results: Intel['results'];
  /** Neighbours the city's agents have a fresh look at (ids). */
  revealed: number[];
  /** Operations waiting for the region's verdict (step 9): the page puts them to it. */
  regionOps: FriendOpWaiting[];
  /** Friends' cities looked round, by their place in the region, while fresh (step 9). */
  seen: Record<number, Dossier & { until: number }>;
}

export function intelSummary(sim: Sim): IntelSummary | null {
  const w = sim.state.war;
  if (!w) return null;
  const i = w.intel;
  return {
    agents: agentsKept(sim),
    free: agentsFree(sim),
    counter: counterIntel(sim),
    tier: intelTier(sim),
    missions: i ? i.missions.map((m) => ({ ...m })) : [],
    results: i ? i.results.map((r) => ({ ...r })) : [],
    revealed: sim.state.region.neighbours.filter((n) => revealed(sim, n)).map((n) => n.id),
    regionOps: friendOpsWaiting(sim),
    seen: Object.fromEntries(
      Object.entries(i?.seen ?? {}).filter(([, d]) => w.clock < d.until),
    ) as IntelSummary['seen'],
  };
}
