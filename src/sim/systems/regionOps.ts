/**
 * Operations between friends' cities in a shared region (M37, `docs/plans/M37-design.md`, key calls
 * 10, 14 and 15). The region room decides them, as it decides friends' raids (M36): each city's sim
 * takes the verdict as a page-only command to itself.
 *
 * - The sender: an agent sent to a friend's city arrives and waits there (`spyArrived`, pinned by
 *   `spySettling` while the page puts it to the region); the region's verdict comes back as
 *   `missionResult` (a refusal sends the agent home and refunds the mission in full). The blackout
 *   tower aimed at a friend charges as at a computer neighbour, and its recharge starts only once
 *   the region keeps the blackout (`missionResult` again, by the tower's operation's number).
 * - The target: `opResolve` takes each operation once (`w.taken`): a saboteur closes the city's own
 *   largest working power plant or its vehicle depot for a day, a blackout darkens the city for 12
 *   hours after an hour's warning; one that came while its player was away brings only a notice.
 *
 * Every time here is on the war clock (hours), as the rest of intelligence.
 */
import { CIVIC } from '../../data/civic';
import { BLACKOUT, BRANCH_IDS, DOME, TIER, type Branch, type TierKey } from '../../data/research';
import { INTEL, SPY_OPS, type SabotageTarget, type SpyOp } from '../../data/intel';
import { FIGHT_TIMEOUT_HOURS, SETTLE_TIMEOUT_HOURS } from '../../data/battle';
import { UNIT, type UnitKind } from '../../data/war';
import type { BattleInput } from '../battle/types';
import { fail, ok, type CommandResult } from '../commands';
import { formatInt } from '../dmath';
import { fnv1a } from '../hash';
import type { SimState } from '../state';
import type { Sim } from '../sim';
import { lowerName } from '../world/civic';
import { accrue } from './economy';
import { strikeRefusal } from './diplomacy';
import { counterIntel, intel as intelOf, result as intelResult, sabotageTarget, type Mission } from './intel';
import { BATTLE_TAKEN_KEEP, damageCivic } from './raids';
import type { Neighbour } from './region';
import { bankPoints, tierCounts } from './research';

/** An operation between friends (the region room's word for it). */
export type FriendOp = SpyOp | 'blackout';
export const FRIEND_OPS: readonly FriendOp[] = [...SPY_OPS, 'blackout'];
export type FriendOutcome = 'success' | 'failed' | 'caught';

/** Why the city turns an operation away: it took it already (the page then only acknowledges it). */
export const OP_TAKEN = 'The city has taken that operation already';
/** Why a friend's battle bringing a superweapon the region didn't flag does nothing here. */
export const SUPER_UNCOUNTED = 'That battle brought a superweapon the region didn’t count';

/** Does a battle bring a superweapon (M37)? The honest page flags such a battle to the region. */
export function battleHasSuper(input: BattleInput): boolean {
  const units = input?.attacker?.units;
  return Array.isArray(units) && units.some((u) => !!UNIT.get(u?.kind)?.super);
}

/**
 * What a look round a friend's city brought home (M37): made by the page from the friend's latest
 * save in the region (`dossierOf`), checked by the sim (`checkDossier`).
 */
export interface Dossier {
  /** The tick of the save it was made from. */
  tick: number;
  /** Its units by kind, and its defences (military buildings that fight) by kind. */
  forces: Partial<Record<UnitKind, number>>;
  defences: Record<string, number>;
  /** Research tiers per branch (`BRANCHES` order). */
  tiers: number[];
  /** Its superweapons: units, and the buildings finished ('dome', 'tower', 'gate'). */
  supers: string[];
  /** The dome's charge (0–1), with a dome. */
  dome?: number;
}

const SUPER_BUILDINGS = ['dome', 'tower', 'gate'] as const;

/** A friend's city as a dossier: what a look round it shows (pure: the page runs it on a save). */
export function dossierOf(state: SimState): Dossier | null {
  const w = state.war;
  if (!w) return null;
  const forces: Partial<Record<UnitKind, number>> = {};
  const supers: string[] = [];
  for (const u of [...w.units.values()].sort((a, b) => a.id - b.id)) {
    const def = UNIT.get(u.kind);
    if (!def) continue;
    forces[u.kind] = (forces[u.kind] ?? 0) + 1;
    if (def.super && !supers.includes(u.kind)) supers.push(u.kind);
  }
  const defences: Record<string, number> = {};
  for (const c of [...state.civics.values()].sort((a, b) => a.id - b.id)) {
    const m = CIVIC.get(c.def)?.military;
    if (!m || c.build) continue;
    if (m.superweapon && !supers.includes(m.superweapon)) supers.push(m.superweapon);
    if (m.defends) defences[c.def] = (defences[c.def] ?? 0) + 1;
  }
  const tiers = BRANCH_IDS.map(() => 0);
  for (const k of w.research?.done ?? []) {
    const t = TIER.get(k);
    if (t) {
      const b = BRANCH_IDS.indexOf(t.branch);
      tiers[b] = Math.max(tiers[b]!, t.tier);
    }
  }
  const dome = w.supers?.dome;
  return {
    tick: state.tick,
    forces,
    defences,
    tiers,
    supers: supers.slice(0, 6),
    ...(dome ? { dome: Math.round((dome.hours / DOME.chargeHours) * 100) / 100 } : {}),
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** A dossier as the page hands it over, checked: a clean copy, or null if it isn't one. */
export function checkDossier(d: unknown): Dossier | null {
  if (!isObj(d) || !isInt(d.tick, 0, 1e12) || !isObj(d.forces) || !isObj(d.defences)) return null;
  const forces: Partial<Record<UnitKind, number>> = {};
  const fk = Object.keys(d.forces);
  if (fk.length > 40) return null;
  for (const k of fk) {
    const v = d.forces[k];
    if (!UNIT.has(k as UnitKind) || !isInt(v, 0, 999)) return null;
    forces[k as UnitKind] = v;
  }
  const defences: Record<string, number> = {};
  const dk = Object.keys(d.defences);
  if (dk.length > 40) return null;
  for (const k of dk) {
    const v = d.defences[k];
    if (!CIVIC.get(k)?.military || !isInt(v, 0, 999)) return null;
    defences[k] = v;
  }
  const tiers = d.tiers;
  if (!Array.isArray(tiers) || tiers.length !== BRANCH_IDS.length || !tiers.every((t) => isInt(t, 0, 4)))
    return null;
  const supers = d.supers;
  if (!Array.isArray(supers) || supers.length > 6) return null;
  for (const x of supers)
    if (
      typeof x !== 'string' ||
      !(UNIT.get(x as UnitKind)?.super || (SUPER_BUILDINGS as readonly string[]).includes(x))
    )
      return null;
  if (new Set(supers).size !== supers.length) return null;
  if (d.dome !== undefined && !(typeof d.dome === 'number' && d.dome >= 0 && d.dome <= 1)) return null;
  return {
    tick: d.tick,
    forces,
    defences,
    tiers: [...(tiers as number[])],
    supers: [...(supers as string[])],
    ...(d.dome !== undefined ? { dome: d.dome as number } : {}),
  };
}

/** The id the region knows an operation by: the city's seed (hashed) and the mission's or tower's number. */
export function opKey(sim: Sim, kind: 'spy' | 'tower', n: number): string {
  return `${kind === 'spy' ? 'op' : 'bo'}-${fnv1a(sim.state.options.seed).slice(0, 8)}-${n}`;
}

/** An operation of the city's waiting for the region's verdict (for the page, which puts it there). */
export interface FriendOpWaiting {
  /** The mission's number, or the blackout tower's operation's. */
  mission: number;
  /** The id the region knows it by. */
  key: string;
  slot: number;
  op: FriendOp;
  target?: SabotageTarget;
  branch?: Branch;
  /** Put to the region already (pinned: it waits longer for the answer). */
  settling: boolean;
}

/** Operations waiting for the region: agents arrived at friends' cities, the tower aimed at one. */
export function friendOpsWaiting(sim: Sim): FriendOpWaiting[] {
  const w = sim.state.war;
  if (!w) return [];
  const out: FriendOpWaiting[] = [];
  for (const m of w.intel?.missions ?? [])
    if (m.state === 'arrived' && m.slot !== undefined)
      out.push({
        mission: m.id,
        key: opKey(sim, 'spy', m.id),
        slot: m.slot,
        op: m.op,
        ...(m.target ? { target: m.target } : {}),
        ...(m.branch ? { branch: m.branch } : {}),
        settling: !!m.settling,
      });
  const c = w.supers?.tower?.charging;
  if (c?.slot !== undefined && c.op !== undefined && !c.kept)
    out.push({
      mission: c.op,
      key: opKey(sim, 'tower', c.op),
      slot: c.slot,
      op: 'blackout',
      settling: !!c.settling,
    });
  return out;
}

// ---------------------------------------------------------------- the sender

/** Why the city's agent can't go to a friend's city (beyond what any mission needs), or null. */
export function friendSpyRefusal(sim: Sim, n: Neighbour, op: SpyOp): string | null {
  const p = n.player!;
  if (sim.shared) return 'Spies from a shared city come with war among friends';
  if (!sim.state.region.rules?.war) return 'Your region’s rules don’t allow war';
  // As the region room would decide it (it has the last word).
  if (op !== 'reveal' && p.raid === 'neutral') return `${n.name} is neutral: spies may only look there`;
  if (op === 'sabotage' && p.raid === 'new')
    return `${n.name} is too young or small for that, unless it strikes first`;
  if (op === 'sabotage' && !p.online) return `${n.name}’s player isn’t here: saboteurs wait for them`;
  return null;
}

/** A friend's research tier in a branch, as its last report said (0 when it hasn't said). */
export function friendTier(n: Neighbour, branch: Branch): number {
  return n.player?.tiers?.[BRANCH_IDS.indexOf(branch)] ?? 0;
}

/** Tiers the city's agents stole points of from a friend's city (by its place in the region). */
export function stolenFrom(sim: Sim, slot: number): TierKey[] {
  return sim.state.war?.intel?.stolen?.[slot] ?? [];
}

/**
 * An agent arrives at a friend's city (M37): it waits there for the region's verdict, which the
 * page asks for (`spyArrived`).
 */
export function friendArrived(sim: Sim, m: Mission): void {
  m.state = 'arrived';
  sim.events.push({ kind: 'spyArrived', id: m.id, info: { to: m.name, slot: m.slot ?? 0, op: m.op } });
  sim.warChanged();
}

/** An agent waiting at a friend's city hears nothing for too long: it comes home with nothing. */
export function friendMissionHour(sim: Sim, m: Mission): void {
  const now = sim.state.war!.clock;
  const wait = m.settling ? SETTLE_TIMEOUT_HOURS : FIGHT_TIMEOUT_HOURS;
  if (m.state !== 'arrived' || now < m.arrive + wait) return;
  goHome(sim, m);
  intelResult(sim, m.to, `Agent ${m.agent} heard nothing from the region in ${m.name}, and came home`);
}

/** An agent's way home from where it waited: the second half of its mission. */
function goHome(sim: Sim, m: Mission): void {
  const now = sim.state.war!.clock;
  const back = Math.max(1, m.home - m.arrive);
  m.state = 'back';
  delete m.settling;
  m.home = now + back;
  sim.warChanged();
}

/** Pin an operation while the region decides on it (page only), or free it again. */
export function spySettling(sim: Sim, mission: number, on: boolean, dryRun: boolean): CommandResult {
  const w = sim.state.war;
  const m = w?.intel?.missions.find((x) => x.id === mission);
  const t = w?.supers?.tower?.charging;
  const tower = t && t.op === mission && t.slot !== undefined && !t.kept ? t : undefined;
  if (!m && !tower) return fail('No such operation');
  if (m && (m.state !== 'arrived' || m.slot === undefined))
    return fail('That agent isn’t waiting for the region');
  if (dryRun) return ok(0);
  const pin = (m ?? tower)!;
  if (on) pin.settling = true;
  else delete pin.settling;
  sim.warChanged();
  return ok(0);
}

/** The region's verdict on an operation of the city's (page only). */
export type MissionOutcome = FriendOutcome | 'refused';

/**
 * The region's verdict on an operation the city sent (M37), taken once: an agent's (its outcome,
 * the tier a theft took points of, and a look round's dossier) or the blackout tower's. Turned away
 * (`refused`), the agent comes home and the mission is refunded in full; the tower is left ready.
 */
export function missionResult(
  sim: Sim,
  mission: number,
  outcome: MissionOutcome,
  dryRun: boolean,
  extra: { stole?: TierKey; dossier?: unknown; reason?: string } = {},
): CommandResult {
  const w = sim.state.war;
  if (!w) return fail('War is off in this city');
  if (!['success', 'failed', 'caught', 'refused'].includes(outcome)) return fail('No such outcome');
  const t = w.supers?.tower;
  if (t?.charging && t.charging.op === mission && t.charging.slot !== undefined && !t.charging.kept)
    return towerResult(sim, outcome, extra.reason, dryRun);
  const m = w.intel?.missions.find((x) => x.id === mission);
  if (!m || m.state !== 'arrived' || m.slot === undefined)
    return fail('No such operation waiting for the region');
  // A theft's tier and a look round's dossier: checked, and only with their own operation.
  if (extra.stole !== undefined && (outcome !== 'success' || m.op !== 'steal' || !TIER.has(extra.stole)))
    return fail('That report could not be read');
  let dossier: Dossier | null = null;
  if (extra.dossier !== undefined) {
    dossier = outcome === 'success' && m.op === 'reveal' ? checkDossier(extra.dossier) : null;
    if (!dossier) return fail('That report could not be read');
  }
  if (dryRun) return ok(0);
  const agent = `Agent ${m.agent}`;
  const slot = m.slot;
  const now = w.clock;
  if (outcome === 'refused') {
    // Nothing happened: the agent turns for home and the mission's money comes back.
    accrue(sim, 'spies', m.paid);
    goHome(sim, m);
    intelResult(
      sim,
      m.to,
      `${agent} was turned back from ${m.name}${extra.reason ? `: ${cleanReason(extra.reason)}` : ''}. The mission’s ${money(m.paid)} is refunded`,
    );
    return ok(0);
  }
  m.outcome = outcome;
  if (outcome === 'caught') {
    // Lost, replaced in two days; an incident, logged on both sides (friends keep their own score).
    const i = intelOf(sim);
    i.missions = i.missions.filter((x) => x !== m);
    i.lost = [...(i.lost ?? []).filter((at) => at > now), now + INTEL.replaceHours];
    (i.incidents ??= {})[m.to] = now;
    intelResult(sim, m.to, `${agent} was caught in ${m.name}: an incident`, 'bad');
    return ok(0);
  }
  goHome(sim, m);
  if (outcome === 'failed') {
    intelResult(sim, m.to, `${agent} came away from ${m.name} with nothing`);
    return ok(0);
  }
  if (m.op === 'reveal') {
    if (dossier) {
      const i = intelOf(sim);
      i.seen = { ...(i.seen ?? {}), [slot]: { ...dossier, until: now + INTEL.revealHours } };
      const units = Object.values(dossier.forces).reduce((a, v) => a + (v ?? 0), 0);
      const guns = Object.values(dossier.defences).reduce((a, v) => a + v, 0);
      intelResult(
        sim,
        m.to,
        `${agent} looked round ${m.name}: ${formatInt(units)} units, ${formatInt(guns)} defences, research ${dossier.tiers.join('/')}`,
        'good',
      );
    } else intelResult(sim, m.to, `${agent} looked round ${m.name}, but brought nothing back`);
  } else if (m.op === 'sabotage') {
    const what = m.target === 'depot' ? 'vehicle depot' : 'power plant';
    intelResult(sim, m.to, `${agent} sabotaged ${m.name}’s ${what}: it’s closed for a day`, 'good');
  } else {
    // A theft: a quarter of the tier the city lacks next in that branch, once per friend and tier.
    const branch = m.branch!;
    const have = tierCounts(sim)[branch];
    const next = have < 4 ? (`${branch}${have + 1}` as TierKey) : null;
    const stolen = stolenFrom(sim, slot);
    if (next && extra.stole === next && !stolen.includes(next)) {
      const pts = Math.floor(TIER.get(next)!.points * INTEL.stealShare);
      bankPoints(sim, next, pts);
      const i = intelOf(sim);
      i.stolen = { ...(i.stolen ?? {}), [slot]: [...stolen, next] };
      intelResult(
        sim,
        m.to,
        `${agent} stole ${formatInt(pts)} points of ${TIER.get(next)!.name} from ${m.name}`,
        'good',
      );
    } else {
      m.outcome = 'failed';
      intelResult(sim, m.to, `${agent} found nothing new in ${m.name}`);
    }
  }
  return ok(0);
}

/** A refusal's words as the region sent them, bounded. */
function cleanReason(r: string): string {
  return String(r).slice(0, 160);
}

const money = (v: number) => `$${formatInt(Math.round(v))}`;

/** The region's verdict on the blackout tower aimed at a friend: kept (the recharge starts), or not. */
function towerResult(
  sim: Sim,
  outcome: MissionOutcome,
  reason: string | undefined,
  dryRun: boolean,
): CommandResult {
  const w = sim.state.war!;
  const t = w.supers!.tower!;
  const c = t.charging!;
  if (outcome !== 'success' && outcome !== 'refused') return fail('No such outcome');
  if (dryRun) return ok(0);
  const n = sim.state.region.neighbours.find((x) => x.id === c.to);
  const name = n?.name ?? 'the city';
  if (outcome === 'refused') {
    // Turned away: the tower stands ready again.
    delete t.charging;
    sim.events.push({
      kind: 'blackoutRefused',
      id: c.to,
      info: { to: name, ...(reason ? { reason: cleanReason(reason) } : {}) },
    });
    sim.warChanged();
    return ok(0);
  }
  // Kept: the recharge counts from now, and the friend's own sim darkens it after its warning.
  t.ready = w.clock + BLACKOUT.recharge;
  c.kept = true;
  delete c.settling;
  if (w.clock >= c.at) friendTowerFired(sim);
  sim.warChanged();
  return ok(0);
}

/** The tower's charge at a friend is done and the region kept it: the friend is blacked out. */
function friendTowerFired(sim: Sim): void {
  const t = sim.state.war!.supers!.tower!;
  const c = t.charging!;
  delete t.charging;
  const n = sim.state.region.neighbours.find((x) => x.id === c.to);
  sim.events.push({ kind: 'blackout', id: c.to, info: { to: n?.name ?? 'the city', hours: BLACKOUT.lasts } });
}

/**
 * The tower's hour while it's aimed at a friend: done once its charge is over and the region kept
 * it; waiting for the region otherwise, until it has heard nothing for too long (then it stands
 * ready again, with no recharge).
 */
export function friendTowerHour(sim: Sim): void {
  const w = sim.state.war!;
  const c = w.supers?.tower?.charging;
  if (!c || c.slot === undefined || w.clock < c.at) return;
  if (c.kept) {
    friendTowerFired(sim);
    sim.warChanged();
    return;
  }
  if (w.clock >= c.at + (c.settling ? SETTLE_TIMEOUT_HOURS : FIGHT_TIMEOUT_HOURS)) {
    delete w.supers!.tower!.charging;
    sim.warChanged();
  }
}

/** Why the blackout tower can't be aimed at a friend's city, or null (M37). */
export function friendBlackoutRefusal(sim: Sim, n: Neighbour, breakPact: boolean): CommandResult | null {
  if (sim.shared) return fail('Blackouts from a shared city come with war among friends');
  if (!sim.state.region.rules?.war) return fail('Your region’s rules don’t allow war');
  if (!n.player!.online) return fail(`${n.name}’s player isn’t here: superweapons wait for them`);
  // As the region room would decide it: neutral, a newcomer, the day's raids spent.
  return strikeRefusal(sim, n.id, 'power', breakPact);
}

/**
 * Aim the blackout tower at a friend's city: it charges for an hour as at a computer neighbour, and
 * the page puts the blackout to the region; its recharge starts only when the region keeps it.
 */
export function friendBlackout(sim: Sim, n: Neighbour, breakPact: boolean, dryRun: boolean): CommandResult {
  const why = friendBlackoutRefusal(sim, n, breakPact);
  if (why) return why;
  if (dryRun) return ok(0);
  const s = sim.state;
  const w = s.war!;
  const supers = (w.supers ??= {});
  const tower = supers.tower ?? { ready: w.clock };
  tower.charging = { to: n.id, at: w.clock + BLACKOUT.chargeHours, slot: n.player!.slot, op: s.nextId++ };
  supers.tower = tower;
  sim.events.push({ kind: 'blackoutCharging', id: n.id, info: { to: n.name } });
  sim.warChanged();
  return ok(0);
}

// ---------------------------------------------------------------- the target

/** The fields of an operation against the city, as the page passes the region's word on. */
export interface OpInput {
  from: number;
  id: string;
  op: FriendOp;
  outcome: FriendOutcome;
  target?: SabotageTarget;
  late: boolean;
}

/** Why an operation's fields can't be one, or null. */
export function checkOpInput(o: unknown): string | null {
  const BAD = 'That operation could not be read';
  if (!isObj(o)) return BAD;
  if (!isInt(o.from, 1, 64) || typeof o.id !== 'string' || !/^[\w-]{1,40}$/.test(o.id)) return BAD;
  if (!FRIEND_OPS.includes(o.op as FriendOp)) return BAD;
  if (o.outcome !== 'success' && o.outcome !== 'failed' && o.outcome !== 'caught') return BAD;
  if (o.op === 'blackout' && o.outcome !== 'success') return BAD;
  if (o.op === 'sabotage' ? o.target !== 'power' && o.target !== 'depot' : o.target !== undefined) return BAD;
  if (typeof o.late !== 'boolean') return BAD;
  return null;
}

/**
 * An operation another city of the region made against this one (M37, page only), as the region
 * decided it; each is taken once. The city's own sim chooses what a saboteur closes; one that came
 * while its player was away (`late`) brings only a notice.
 */
export function opResolve(sim: Sim, o: OpInput, dryRun: boolean): CommandResult {
  const why = checkOpInput(o);
  if (why) return fail(why);
  const s = sim.state;
  const w = s.war;
  if (!w) return fail('War is off in this city');
  const n = s.region.neighbours.find((x) => x.player?.slot === o.from);
  if (!n) return fail('That came from a city this one doesn’t know');
  const key = `${o.from}:op:${o.id}`;
  if (w.taken?.includes(key)) return fail(OP_TAKEN);
  if (dryRun) return ok(0);
  w.taken = [...(w.taken ?? []), key].slice(-BATTLE_TAKEN_KEEP);
  sim.warChanged();
  const now = w.clock;
  if (o.outcome === 'failed') return ok(0);
  if (o.outcome === 'caught') {
    // An incident: logged here as at the sender's.
    const where =
      o.op === 'sabotage' ? ` at the ${o.target === 'depot' ? 'vehicle depot' : 'power plant'}` : '';
    (intelOf(sim).grievance ??= {})[n.id] = now;
    intelResult(sim, n.id, `Your agents caught a spy from ${n.name}${where}`, 'good');
    sim.events.push({ kind: 'enemySpyCaught', id: n.id, info: { from: n.name } });
    return ok(0);
  }
  if (o.op === 'reveal' || o.op === 'steal') {
    // A quiet look or theft: heard of only with good counter-intelligence.
    if (counterIntel(sim, n.id) >= INTEL.noticeCounter)
      intelResult(
        sim,
        n.id,
        o.op === 'reveal'
          ? `Spies from ${n.name} have been looking round the city`
          : `Spies from ${n.name} got away with some of the city’s research`,
        'bad',
      );
    return ok(0);
  }
  if (o.op === 'sabotage') {
    if (o.late) {
      intelResult(sim, n.id, `Saboteurs from ${n.name} came while you were away and found nothing to strike`);
      return ok(0);
    }
    const c = sabotageTarget(sim, o.target!);
    if (c) {
      damageCivic(sim, c.id, INTEL.sabotageClosed, false);
      intelResult(
        sim,
        n.id,
        `Saboteurs from ${n.name} closed the ${lowerName(CIVIC.get(c.def)!.name)} for a day`,
        'bad',
      );
      sim.events.push({ kind: 'sabotaged', id: c.id, info: { from: n.name } });
    } else intelResult(sim, n.id, `Saboteurs from ${n.name} found nothing to strike`);
    return ok(0);
  }
  // A blackout: an hour's warning, then the city's power plants falter, its radars and maps go out.
  if (o.late) {
    sim.events.push({ kind: 'blackoutWarning', id: n.id, info: { by: n.name, late: 1 } });
    return ok(0);
  }
  w.blackout = {
    by: o.from,
    from: now + BLACKOUT.chargeHours,
    until: now + BLACKOUT.chargeHours + BLACKOUT.lasts,
  };
  sim.events.push({
    kind: 'blackoutWarning',
    id: n.id,
    info: { by: n.name, in: BLACKOUT.chargeHours, hours: BLACKOUT.lasts },
  });
  return ok(0);
}
