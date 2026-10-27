/**
 * The superweapon buildings (M37, SPEC-5.md): the dome shield, the blackout tower and the express
 * gate, built as big projects once their research is done (`docs/plans/M37-design.md`, key call 9).
 * Their state appears when the first of them is finished, so other cities are unchanged.
 */
import { BLACKOUT, DOME, DOME_MODES, GATE, type DomeMode } from '../../data/research';
import { CIVIC } from '../../data/civic';
import { fail, ok, type CommandResult } from '../commands';
import { formatInt } from '../dmath';
import type { Sim } from '../sim';
import { civicOnline, type Civic } from '../world/civic';
import { incident, strikeBreaks, strikeRefusal } from './diplomacy';
import type { Neighbour } from './region';
import { superweaponsAllowed } from './research';

export type SuperBuilding = 'dome' | 'tower' | 'gate';

export interface Supers {
  /** The dome: hours charged (of `DOME.chargeHours`), its mode, hours left on its reserve in a blackout, raised now. */
  dome?: { hours: number; mode: DomeMode; reserve?: number; raised?: true };
  /** The tower: the war-clock hour it can fire again, and the neighbour it's charging at (and when it fires). */
  tower?: { ready: number; charging?: { to: number; at: number } };
  /** The gate: the war-clock hour it can send a force again. */
  gate?: { ready: number };
}

/** A computer neighbour blacked out by the city (M37): war-clock hours (the city's clock). */
export interface RivalBlackout {
  from: number;
  until: number;
}

const NAMES: Record<SuperBuilding, string> = {
  dome: 'dome shield',
  tower: 'blackout tower',
  gate: 'express gate',
};

/** The city's superweapon building of a kind, finished (absent while it's being built). */
export function superBuilding(sim: Sim, kind: SuperBuilding): Civic | undefined {
  for (const c of sim.state.civics.values())
    if (CIVIC.get(c.def)?.military?.superweapon === kind && !c.build) return c;
  return undefined;
}

/** Working: online, staffed to a quarter and powered to a half. */
export function superWorking(c: Civic | undefined): boolean {
  return !!c && civicOnline(c) && (c.staff ?? 0) >= 0.25 && (c.powered ?? 0) >= 0.5;
}

/** The city is blacked out now (by a friend, M37 step 9): its war clock is within the blackout. */
export function blackedOut(sim: Sim): boolean {
  const w = sim.state.war;
  const b = w?.blackout;
  return !!b && w!.clock >= b.from && w!.clock < b.until;
}

/** A computer neighbour is blacked out by the city now. */
export function rivalBlackedOut(sim: Sim, n: Neighbour): boolean {
  const b = n.rival?.blackout;
  const clock = sim.state.war?.clock ?? 0;
  return !!b && clock >= b.from && clock < b.until;
}

/** The dome's charge, 0–1 (0 without a dome). */
export function domeCharge(sim: Sim): number {
  const d = sim.state.war?.supers?.dome;
  return d ? d.hours / DOME.chargeHours : 0;
}

/** The superweapon buildings' hour on the war clock: the dome charges, the tower fires, blackouts end. */
export function supersHour(sim: Sim): void {
  const w = sim.state.war;
  if (!w) return;
  // State for each building finished (made once, kept if it's knocked down: a rebuilt one carries on).
  for (const kind of ['dome', 'tower', 'gate'] as const) {
    if (!superBuilding(sim, kind)) continue;
    const s = (w.supers ??= {});
    if (kind === 'dome' && !s.dome) s.dome = { hours: 0, mode: 'all' };
    if (kind === 'tower' && !s.tower) s.tower = { ready: w.clock };
    if (kind === 'gate' && !s.gate) s.gate = { ready: w.clock };
  }
  const s = w.supers;
  if (!s) return;
  if (s.dome && !s.dome.raised) {
    const dome = s.dome;
    if (blackedOut(sim)) {
      // No charging in a blackout; a full dome holds on its reserve, then falls.
      if (dome.hours >= DOME.chargeHours) {
        dome.reserve = (dome.reserve ?? DOME.reserveHours) - 1;
        if (dome.reserve <= 0) {
          dome.hours = 0;
          delete dome.reserve;
          sim.events.push({ kind: 'domeFell', id: 0 });
        }
        sim.warChanged();
      }
    } else {
      if (dome.reserve !== undefined) delete dome.reserve;
      if (dome.hours < DOME.chargeHours && superWorking(superBuilding(sim, 'dome'))) {
        dome.hours++;
        if (dome.hours >= DOME.chargeHours) sim.events.push({ kind: 'domeCharged', id: 0 });
        sim.warChanged();
      }
    }
  }
  const t = s.tower;
  if (t?.charging && w.clock >= t.charging.at) {
    const n = sim.state.region.neighbours.find((x) => x.id === t.charging!.to);
    delete t.charging;
    if (n?.rival && !n.player) {
      n.rival.blackout = { from: w.clock, until: w.clock + BLACKOUT.lasts };
      incident(
        sim,
        n,
        BLACKOUT.relation,
        0,
        'blackout',
        `The blackout tower darkened ${n.name}: its power, radar and maps are out for ${BLACKOUT.lasts} hours`,
        'good',
      );
      sim.events.push({ kind: 'blackout', id: n.id, info: { to: n.name, hours: BLACKOUT.lasts } });
    }
    sim.warChanged();
  }
  // Blackouts over.
  for (const n of sim.state.region.neighbours)
    if (n.rival?.blackout && w.clock >= n.rival.blackout.until) {
      delete n.rival.blackout;
      sim.warChanged();
    }
}

/**
 * A battle starts in the city: a fully charged, working dome in the right mode rises over it (its
 * pool), or nothing (0). `bringsSuper`: the battle brings a superweapon (for the `super` mode).
 */
export function raiseDome(sim: Sim, bringsSuper: boolean): number {
  const d = sim.state.war?.supers?.dome;
  if (!d || d.raised || d.hours < DOME.chargeHours) return 0;
  if (d.mode === 'off' || (d.mode === 'super' && !bringsSuper)) return 0;
  // Built while they were allowed, it stands idle where the region's rules turn superweapons off.
  if (!superweaponsAllowed(sim) || !superWorking(superBuilding(sim, 'dome'))) return 0;
  d.raised = true;
  sim.events.push({ kind: 'domeRaised', id: 0 });
  sim.warChanged();
  return DOME.pool;
}

/** The battle is over: a dome raised for it is down, and charges again from empty. */
export function lowerDome(sim: Sim): void {
  const d = sim.state.war?.supers?.dome;
  if (!d?.raised) return;
  delete d.raised;
  d.hours = 0;
  delete d.reserve;
  sim.warChanged();
}

/** Why the city can't use a superweapon building now, or null. */
function buildingRefusal(sim: Sim, kind: SuperBuilding): string | null {
  const w = sim.state.war;
  if (!w) return 'War is off in this city';
  const c = superBuilding(sim, kind);
  if (!c) return `The city has no ${NAMES[kind]}`;
  if (!superweaponsAllowed(sim)) return 'Your region’s rules turn superweapons off';
  if (!superWorking(c)) return `The ${NAMES[kind]} needs staff and power`;
  return null;
}

/** Hours until a superweapon building can be used again (0 when ready). */
export function superWait(sim: Sim, kind: 'tower' | 'gate'): number {
  const w = sim.state.war;
  const s = w?.supers?.[kind];
  return s ? Math.max(0, s.ready - w!.clock) : 0;
}

/** The dome's mode: raised for every battle, only for superweapons, or kept down. */
export function setDome(sim: Sim, mode: DomeMode, dryRun: boolean): CommandResult {
  if (!DOME_MODES.includes(mode)) return fail('No such mode');
  if (!sim.state.war) return fail('War is off in this city');
  if (!superBuilding(sim, 'dome')) return fail('The city has no dome shield');
  if (dryRun) return ok(0);
  const s = (sim.state.war.supers ??= {});
  (s.dome ??= { hours: 0, mode: 'all' }).mode = mode;
  sim.warChanged();
  return ok(0);
}

/**
 * Black out a computer neighbour (M37): the tower charges at it for an hour (it is warned), then its
 * power, radar and maps are out for 12 hours: no raids or spies from it, its guns half-manned at best
 * in battles there. A strike, so it goes through M36's refusals; the tower recharges for 240 hours.
 */
export function useBlackout(sim: Sim, to: number, breakPact: boolean, dryRun: boolean): CommandResult {
  const why = buildingRefusal(sim, 'tower');
  if (why) return fail(why);
  const w = sim.state.war!;
  const n = sim.state.region.neighbours.find((x) => x.id === to);
  if (!n) return fail('No such neighbour');
  if (n.player) return fail('Blacking out a friend’s city goes through the region');
  if (!n.rival) return fail(`${n.name} isn’t a rival`);
  const t = w.supers?.tower;
  if (t?.charging) return fail('The blackout tower is already charging');
  const wait = superWait(sim, 'tower');
  if (wait > 0) return fail(`The blackout tower is charging: ready in ${formatInt(wait)} hours`);
  if (rivalBlackedOut(sim, n)) return fail(`${n.name} is blacked out already`);
  const strike = strikeRefusal(sim, to, 'power', breakPact);
  if (strike) return strike;
  if (dryRun) return ok(0);
  strikeBreaks(sim, to);
  const tower = (w.supers ??= {}).tower ?? { ready: w.clock };
  tower.charging = { to, at: w.clock + BLACKOUT.chargeHours };
  tower.ready = w.clock + BLACKOUT.recharge;
  w.supers.tower = tower;
  sim.events.push({ kind: 'blackoutCharging', id: n.id, info: { to: n.name } });
  sim.warChanged();
  return ok(0);
}

/** Why a force can't go through the express gate, or null (M37). */
export function gateRefusal(sim: Sim, n: Neighbour, sea: boolean): string | null {
  const why = buildingRefusal(sim, 'gate');
  if (why) return why;
  const wait = superWait(sim, 'gate');
  if (wait > 0) return `The express gate is charging: ready in ${formatInt(wait)} hours`;
  if (sea) return 'Ships can’t go through the gate';
  if (n.player && !n.player.online) return `${n.name}’s player isn’t here: superweapons wait for them`;
  return null;
}

/** A force steps through the gate: it charges again from now. */
export function useGate(sim: Sim): void {
  const w = sim.state.war!;
  const s = (w.supers ??= {});
  s.gate = { ready: w.clock + GATE.recharge };
  sim.warChanged();
}

/** Test mode (M37): every superweapon building charged and ready now. */
export function superBuildingsReady(sim: Sim): void {
  const w = sim.state.war;
  const s = w?.supers;
  if (!s) return;
  if (s.dome) {
    s.dome.hours = DOME.chargeHours;
    delete s.dome.reserve;
  }
  if (s.tower && !s.tower.charging) s.tower.ready = w!.clock;
  if (s.gate) s.gate.ready = w!.clock;
}
