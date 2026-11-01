/**
 * The war room's Bomb tab and the countdown card in plain arithmetic (M40 step 11): the ladder's rows,
 * the targets with the reasons the others are greyed out, what a launch costs the city in words, the
 * countdown's clock, the dome in a sentence, the region's race as rows, and the fallout block. Pure, so
 * a test can hold each to the sim's summary (`AtomSummary`, `SupersSummary`) and to the tone the game
 * keeps (no word of anyone hurt). `Atom.tsx` draws what these return.
 */
import type { RegionAtomMark } from '../../relay/region';
import {
  ATOM,
  ATOM_STAGES,
  ATOM_STAGE_NAMES,
  FALLOUT,
  WINTER_YEARS,
  atomStageNo,
  bombLine,
  raceLine,
} from '../data/atom';
import { DOME } from '../data/research';
import { HOST_ONLY_LAUNCH } from '../sim/rules';
import { TICKS_PER_HOUR } from '../sim/time';
import type { AtomSummary } from '../sim/systems/atom';
import type { FalloutSummary } from '../sim/systems/fallout';
import type { SupersSummary } from '../sim/systems/supers';

/** Game hours the dome is out after stopping a bomb, charging again included (`DOME.bombRecharge`). */
const DOME_AFTER = DOME.bombRecharge;

/** The launch button is held this long (ms) before it commits the city to the launch. */
export const HOLD_MS = 3000;

/** How far through the hold a press of `elapsed` ms has got, 0 to 1. */
export function holdFraction(elapsed: number): number {
  return Math.max(0, Math.min(1, elapsed / HOLD_MS));
}

/** Whole seconds still to hold, 3 down to 0 (the button's label counts them). */
export function holdSeconds(elapsed: number): number {
  return Math.max(0, Math.ceil((HOLD_MS - Math.max(0, elapsed)) / 1000));
}

/**
 * What a key does to a held button: Space and Enter hold it, and the keyboard's auto-repeat of a key
 * held down is swallowed like the first press (it must not reach the window's Space, which pauses the
 * game, thirty times a second) but does not begin the hold again.
 */
export function holdKey(e: { key: string; code?: string; repeat: boolean }): {
  swallow: boolean;
  begin: boolean;
} {
  const mine = e.key === ' ' || e.key === 'Enter' || e.code === 'Space';
  return { swallow: mine, begin: mine && !e.repeat };
}

/**
 * Whether a pointer is still over a box. A finger that touches a button is captured by it (a touch has no
 * "leave" until it lifts), so the hold asks this on every move to learn it has slid off.
 */
export function pointerInside(
  r: { left: number; right: number; top: number; bottom: number },
  x: number,
  y: number,
): boolean {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

/** Why this player's launch button is greyed out, or null: in a shared city only the host launches (the room says so). */
export function launchGuestWhy(guest: boolean): string | null {
  return guest ? HOST_ONLY_LAUNCH : null;
}

/**
 * Whether the region map draws a cloud on a neighbour: a computer neighbour's own fallout, or the bomb
 * this city fired at it having had its flight; a friend's city only once the friend's own report says a
 * bomb fell on it (the friend's sim decides the dome and the damage, not the sender's).
 */
export function cloudOnMap(
  n: { id: number; rival?: { fallout?: number } | null; player?: { atom?: { hit?: number } } | null },
  fired: { to: number; tick: number } | null,
  tick: number,
  flightTicks: number,
): boolean {
  if (n.player) return (n.player.atom?.hit ?? 0) > 0;
  return (!!fired && fired.to === n.id && tick >= fired.tick + flightTicks) || (n.rival?.fallout ?? 0) >= 0.5;
}

/** Money as the war room says it: "$1.2M" for millions, "$650,000" below. */
export function moneyWords(v: number): string {
  if (v >= 1_000_000) return `$${(Math.round(v / 100_000) / 10).toString()}M`;
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

/**
 * Game hours as minutes or hours of play at normal speed (a game hour is 7.5 seconds): "30 seconds",
 * "2 minutes", "about 3 hours". The war room speaks in play time wherever a wait is long.
 */
export function playWords(gameHours: number): string {
  const seconds = gameHours * FALLOUT.secondsPerHour;
  if (seconds < 90) {
    const n = Math.max(1, Math.round(seconds));
    return `${n} second${n === 1 ? '' : 's'}`;
  }
  const minutes = seconds / 60;
  if (minutes < 90) return `${Math.round(minutes)} minutes`;
  const hours = Math.round((minutes / 60) * 2) / 2;
  return `${hours === Math.round(hours) ? hours : hours.toFixed(1)} hours`;
}

/**
 * Game hours in the game's own terms, as the war room counts a long wait: hours, or months for longer
 * (a month is a game day and night, 24 hours): "12 h", "1 month", "10 months".
 */
export function warTime(hours: number): string {
  if (hours < 24) return `${Math.max(0, Math.round(hours))} h`;
  const months = Math.round((hours / 24) * 10) / 10;
  return `${months} month${months === 1 ? '' : 's'}`;
}

/** When a computer neighbour's bomb leaves, from the war hours left of its preparation. */
export function launchWords(hoursLeft: number): string {
  if (hoursLeft < 1) return 'leaves within the hour';
  return `leaves in about ${warTime(hoursLeft)}`;
}

// ---------------------------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------------------------

export type RowState = 'done' | 'now' | 'wait' | 'todo';

export type LadderId = 'research' | 'plant' | 'fuel' | 'silo' | 'bomb' | 'ready' | 'launch' | 'fired';

/** One rung of the ladder: where the city stands on it, in a line, with the reason when it waits. */
export interface LadderRow {
  id: LadderId;
  label: string;
  state: RowState;
  text: string;
  /** Why it waits or what it needs, in the sim's words where it has them. */
  reason: string | null;
  /** A bar's fill, 0 to 1, when the rung is a quantity (fuel, the bomb's build, the preparation). */
  bar: number | null;
}

const pct = (v: number) => `${Math.round(v * 100)} %`;

/**
 * The race as a ladder from the research to the bomb's use. The rungs are the sim's own stages
 * (`atomStage`); the reasons are the sim's words (`fuelWait`, `bomb.wait`, `buildWhy`, `launch.held`)
 * and, where the sim has none, what the next step needs. Exactly one rung is `now` while the race is on
 * (the first that isn't done); the ones after it are `todo`.
 */
export function ladderRows(a: AtomSummary): LadderRow[] {
  const stage = atomStageNo(a.stage);
  const spent = !!a.fired;
  const researched = a.research.done >= a.research.total;
  const rows: LadderRow[] = [];
  const push = (r: LadderRow) => rows.push(r);

  push({
    id: 'research',
    label: 'Research',
    state: researched ? 'done' : 'now',
    text: `${a.research.done} of ${a.research.total} tiers done`,
    reason: researched
      ? null
      : (a.rules ??
        (a.research.next
          ? `Every branch must be maxed. Next: ${a.research.next}`
          : 'Every branch must be maxed')),
    bar: a.research.done / Math.max(1, a.research.total),
  });

  // The enrichment plant.
  const plantNeeds = !researched
    ? 'Finish the research first'
    : (a.rules ??
      (a.nuclear ? 'Place it from the Military bar' : 'Needs a nuclear power plant that is running'));
  const plantDone = a.plantState === 'built' || stage >= atomStageNo('enriching') || spent;
  push({
    id: 'plant',
    label: 'Enrichment plant',
    state: plantDone ? 'done' : a.plantState === 'building' ? 'now' : 'todo',
    text:
      a.plantState === 'built'
        ? a.plant
          ? 'Built and working'
          : 'Built'
        : a.plantState === 'building'
          ? 'Going up'
          : spent
            ? 'No longer standing'
            : 'Not built',
    reason: plantDone ? null : a.plantState === 'building' ? null : plantNeeds,
    bar: null,
  });

  // The fuel.
  const full = a.fuel >= 1;
  const fuelLive = a.plantState === 'built' || a.fuel > 0 || stage >= atomStageNo('enriching');
  push({
    id: 'fuel',
    label: 'Fuel',
    state: full || spent ? 'done' : !fuelLive ? 'todo' : a.fuelWait ? 'wait' : 'now',
    text: full ? 'A full load' : `${pct(a.fuel)} of a full load`,
    reason: full || spent ? null : fuelLive ? a.fuelWait : 'Needs the plant',
    bar: a.fuel,
  });

  // The silo.
  const siloDone = a.siloState === 'built' || stage >= atomStageNo('bomb') || spent;
  push({
    id: 'silo',
    label: 'Silo',
    state: siloDone
      ? a.siloWait && !spent && !a.have && !a.launch
        ? 'wait'
        : 'done'
      : a.siloState === 'building'
        ? 'now'
        : 'todo',
    text:
      a.siloState === 'built'
        ? 'Built'
        : a.siloState === 'building'
          ? 'Going up'
          : spent
            ? 'No longer standing'
            : 'Not built',
    reason:
      a.siloState === 'built'
        ? spent
          ? null
          : a.siloWait
        : a.siloState === 'building' || spent || a.have || !!a.launch
          ? null
          : 'Needs the plant online',
    bar: null,
  });

  // The bomb itself, built in instalments.
  const bombDone = a.have || !!a.launch || spent;
  push({
    id: 'bomb',
    label: 'The bomb',
    state: bombDone ? 'done' : a.bomb ? (a.bomb.wait ? 'wait' : 'now') : 'todo',
    text: bombDone
      ? 'Built'
      : a.bomb
        ? `${pct(a.bomb.done)} built, instalment ${a.bomb.paid} of ${a.bomb.of}`
        : 'Not started',
    reason: bombDone ? null : a.bomb ? a.bomb.wait : a.buildWhy,
    bar: bombDone ? 1 : (a.bomb?.done ?? 0),
  });

  // Ready in the silo.
  push({
    id: 'ready',
    label: 'Bomb ready',
    state: spent || a.have || a.launch ? 'done' : 'todo',
    text: spent ? 'Used' : a.have || a.launch ? 'The bomb is in the silo' : 'Not yet',
    reason: null,
    bar: null,
  });

  // The launch's preparation.
  const prep = a.launch;
  push({
    id: 'launch',
    label: 'Launch',
    state: spent
      ? 'done'
      : prep
        ? prep.ready
          ? prep.held
            ? 'wait'
            : 'now'
          : prep.wait
            ? 'wait'
            : 'now'
        : a.have
          ? 'now'
          : 'todo',
    text: spent
      ? 'Left the silo'
      : prep
        ? prep.ready
          ? `Prepared for ${prep.name}`
          : `Preparing for ${prep.name}, ${pct(prep.done)}`
        : a.have
          ? 'Not aimed yet'
          : 'Not prepared',
    reason: spent ? null : prep ? (prep.ready ? prep.held : prep.wait) : null,
    bar: prep ? prep.done : null,
  });

  // The end of it.
  push({
    id: 'fired',
    label: 'Used',
    state: spent ? 'done' : 'todo',
    text: a.fired
      ? stage >= atomStageNo('spent')
        ? `Fired at ${a.fired.name}`
        : `On its way to ${a.fired.name}`
      : 'The bomb has not been used',
    reason: null,
    bar: null,
  });
  // Wherever the city stands, the first rung it has not done is the one to work on, even when nothing
  // is under way yet (so the ladder always points at its next step).
  const next = rows.find((r) => r.state !== 'done');
  if (next?.state === 'todo') next.state = 'now';
  return rows;
}

/**
 * Where the city stands in a line: the rung it is working on ("Fuel: 50 % of a full load") rather than
 * the stage's name, which is what the region says of any city ("Silo going up" while the silo stands
 * and the fuel is not full), or the end of it once the bomb has left.
 */
export function headline(a: AtomSummary): string {
  if (a.fired)
    return atomStageNo(a.stage) >= atomStageNo('spent')
      ? 'The atom bomb has been used'
      : 'The atom bomb is on its way';
  const next = ladderRows(a).find((r) => r.state !== 'done');
  return next ? `${next.label}: ${next.text}` : 'Every step is done';
}

// ---------------------------------------------------------------------------------------------
// The launch
// ---------------------------------------------------------------------------------------------

export interface TargetRow {
  id: number;
  name: string;
  friend: boolean;
  /** Why it can't be aimed at now (the sim's words), or null. */
  why: string | null;
  /** The label on its button. */
  label: string;
}

/** Neighbours the bomb could be aimed at, the ones the city is in a total war with first, the rest greyed with the reason. */
export function targetRows(a: AtomSummary): TargetRow[] {
  const rows = a.targets.map((t) => ({
    ...t,
    label: t.friend ? `${t.name} (a friend’s city)` : t.name,
  }));
  return [...rows.filter((r) => !r.why), ...rows.filter((r) => r.why)];
}

/** The first target a launch can be aimed at, else the one already chosen, else none. */
export function defaultTarget(a: AtomSummary, chosen: number | null): number | null {
  const rows = targetRows(a);
  const keep = rows.find((r) => r.id === chosen && !r.why);
  if (keep) return keep.id;
  return rows.find((r) => !r.why)?.id ?? null;
}

/**
 * What a launch does, in plain words: every consequence the city takes on, from the sim's own numbers
 * (`ATOM`, the winter's length). Listed before the button that commits to it.
 */
export function consequences(): string[] {
  return [
    'Your reputation falls to nothing, for good. It never recovers.',
    'Every computer neighbour embargoes the city, for good: trade with them ends.',
    'Every pact and alliance of friendship ends.',
    'Any neighbour may declare a total war on the city at once, with no waiting.',
    'People at home protest: approval falls and residents leave.',
    `A nuclear winter falls on every city in the region, yours included: solar plants give less and heating costs more for about ${WINTER_YEARS} game years.`,
    'Fallout lies on the target’s ground for decades, and some of it drifts to its neighbours.',
    'The launch stays in the city’s history for good.',
  ];
}

/** What pressing the button commits to, one line: the price, the preparation and the way out. */
export function launchTerms(): string {
  return `Holding the button pays ${moneyWords(ATOM.launch.cost)} and starts the preparation, about ${playWords(ATOM.launch.prepHours)} of play. Until the bomb leaves you can call it off, and ${moneyWords(ATOM.launch.cost * ATOM.launch.refund)} comes back.`;
}

/** What building the bomb costs, one line: the instalments and where the materials come from. */
export function buildTerms(): string {
  const i = ATOM.bomb.instalment;
  const n = ATOM.bomb.hours / ATOM.bomb.every;
  return `${n} instalments of ${moneyWords(i.money)}, each with ${i.goods} goods, ${i.ore} ore and ${i.oil} oil, taken from the war stores first and bought in for the rest. About ${playWords(ATOM.bomb.hours)} of play. If it is stopped, everything built so far is lost, what was paid stays spent, and starting again begins from nothing.`;
}

/**
 * What stopping the bomb's build throws away, for the question asked before it is stopped: how far it
 * has got, what was paid (which stays spent), and that a restart begins from nothing (it pays the first
 * instalment again).
 */
export function stopTerms(bomb: { done: number; paid: number; of: number }): string {
  const i = ATOM.bomb.instalment;
  return `The bomb is ${pct(bomb.done)} built, with ${bomb.paid} of ${bomb.of} instalments paid. If it is stopped, all of that is lost: what was paid (${moneyWords(bomb.paid * i.money)} and the materials) stays spent, and starting again begins from nothing and pays the first instalment again.`;
}

// ---------------------------------------------------------------------------------------------
// The countdown
// ---------------------------------------------------------------------------------------------

/** The countdown's clock, "h:mm" of game time as the raid chip shows it (never below 0:00). */
export function etaClock(ticksLeft: number): string {
  // (Whole minutes: a tick is a game minute, and a fraction of one left would show as a minute short.)
  const left = Math.max(0, Math.floor(ticksLeft + 1e-6));
  return `${Math.floor(left / TICKS_PER_HOUR)}:${String(left % TICKS_PER_HOUR).padStart(2, '0')}`;
}

type Dome = SupersSummary['dome'];

/** The dome in a sentence for the card: whether it will stop this bomb, and why not when it won't. */
export interface DomeLine {
  text: string;
  tone: 'good' | 'warn' | 'bad';
  /** What stands between the dome and the bomb, for the words a screen reader is told (no figures in them). */
  kind: 'stops' | 'none' | 'down' | 'blackout' | 'charging' | 'off' | 'idle';
  /** The dome is charged but switched off, and raising it now would stop the bomb: the card offers to. */
  raise: boolean;
}

/**
 * What the dome shield will do to the bomb on its way. `stops` is the sim's own answer (a pure read of
 * `bombStopped`): when it is true the dome stops the bomb and is then down for a long while; when it is
 * false the reason is read off the dome the summary shows. `canRaise` is the sim's answer to "would it
 * stop the bomb if it were raised" (`bombStopped(sim, true)`): the way to raise it is offered only
 * then, never for a dome that is dark, unstaffed or unpowered, which raising would not help.
 */
export function domeLine(dome: Dome, stops: boolean, blackout: boolean, canRaise = false): DomeLine {
  if (stops)
    return {
      text: `The dome shield is charged: it will stop the bomb, then it is down for about ${playWords(DOME_AFTER)} of play.`,
      tone: 'good',
      kind: 'stops',
      raise: false,
    };
  if (!dome)
    return {
      text: 'The city has no dome shield: nothing will stop it.',
      tone: 'bad',
      kind: 'none',
      raise: false,
    };
  if (dome.down > 0)
    return {
      text: `The dome shield is down for ${playWords(dome.down)} more: it can’t stop this bomb.`,
      tone: 'bad',
      kind: 'down',
      raise: false,
    };
  if (blackout)
    return {
      text: 'A blackout has the dome shield dark: it can’t stop this bomb.',
      tone: 'bad',
      kind: 'blackout',
      raise: false,
    };
  if (dome.charge < 1)
    return {
      text: `The dome shield is still charging (${pct(dome.charge)}): it can’t stop this bomb yet.`,
      tone: 'bad',
      kind: 'charging',
      raise: false,
    };
  if (dome.mode === 'off' && canRaise)
    return {
      text: 'The dome shield is charged but switched off: it won’t stop the bomb unless it is raised.',
      tone: 'warn',
      kind: 'off',
      raise: true,
    };
  return {
    text: 'The dome shield isn’t working: it needs workers and power.',
    tone: 'bad',
    kind: 'idle',
    raise: false,
  };
}

/** The shelters in a line: how many of the residents in the blast's reach have a place. */
export function shelterLine(near: number, sheltered: number): string | null {
  if (near <= 0) return null;
  return `${sheltered.toLocaleString('en-US')} of the ${near.toLocaleString('en-US')} residents in its path can reach a shelter.`;
}

/** Everything the countdown card shows, from the summary and the display clock. */
export interface Countdown {
  from: string;
  eta: string;
  hoursLeft: number;
  playLeft: string;
  aim: string;
  dome: DomeLine;
  shelter: string | null;
  /** What a screen reader is told once when the card appears or the dome's state changes: no clock, no figures. */
  announce: string;
}

/** The dome's state as it is announced (the same for any charge or time left, so it is said when it changes, not as it counts). */
const DOME_ANNOUNCE: Record<DomeLine['kind'], string> = {
  stops: 'The dome shield will stop it.',
  none: 'The city has no dome shield.',
  down: 'The dome shield is down.',
  blackout: 'A blackout has the dome shield dark.',
  charging: 'The dome shield is still charging.',
  off: 'The dome shield is switched off. It can be raised from the card.',
  idle: 'The dome shield is not working.',
};

export function announcement(from: string, kind: DomeLine['kind']): string {
  return `An atom bomb from ${from} is on its way to the city. ${DOME_ANNOUNCE[kind]}`;
}

export function countdown(
  inbound: NonNullable<AtomSummary['inbound']>,
  displayTick: number,
  dome: Dome,
  blackout: boolean,
): Countdown {
  const ticks = Math.max(0, inbound.arrive - displayTick);
  const hoursLeft = ticks / TICKS_PER_HOUR;
  const line = domeLine(dome, inbound.stops, blackout, inbound.raisable);
  return {
    from: inbound.from,
    eta: etaClock(ticks),
    hoursLeft,
    playLeft: playWords(hoursLeft),
    aim: 'Aimed at your densest district',
    dome: line,
    shelter: shelterLine(inbound.near, inbound.sheltered),
    announce: announcement(inbound.from, line.kind),
  };
}

/** The card a bomb leaves behind: the blast's toll in the plain count, or the dome's save. */
export function aftermath(
  kind: 'hit' | 'stopped',
  info: { from?: string; fled?: number; levelled?: number },
): { title: string; text: string } {
  if (kind === 'stopped')
    return {
      title: 'The dome shield stopped the bomb',
      text: `${info.from ?? 'The bomb'}’s bomb did no harm to the city. The dome is down for about ${playWords(DOME_AFTER)} of play while it recharges.`,
    };
  const fled = (info.fled ?? 0).toLocaleString('en-US');
  const levelled = (info.levelled ?? 0).toLocaleString('en-US');
  return {
    title: 'The atom bomb landed',
    text: `${fled} residents have left the city; ${levelled} buildings were levelled. Fallout lies on the ground, and a nuclear winter is coming.`,
  };
}

// ---------------------------------------------------------------------------------------------
// The region's race
// ---------------------------------------------------------------------------------------------

/** The first six stages as pips: the plant, fuel, the silo, the bomb, ready, a launch being prepared. */
export const PIPS = 6;

export interface RaceRow {
  key: string;
  name: string;
  who: 'city' | 'friend' | 'computer';
  stage: number;
  stageName: string;
  /** Pips filled, of `PIPS`. */
  pips: number;
  /** The fuel made, in percent, while the bomb is unfinished and the fuel is under way; else null. */
  fuel: number | null;
  /** The bomb is finished and unused (the map frames it). */
  ready: boolean;
  fired: boolean;
  /** The first to finish a bomb in the region. */
  first: boolean;
  /** A launch is being prepared and about to leave, in game hours for a computer neighbour; else null. */
  launchIn: number | null;
}

/** A neighbour as the race list reads it: a friend's city carries its last report's race, a rival is in `rivals`. */
export interface RaceNeighbour {
  id: number;
  name: string;
  player?: { slot: number; atom?: { stage: number; fuel?: number; fired?: true } };
}

export function pipsOf(stage: number): number {
  return Math.max(0, Math.min(PIPS, stage));
}

export function raceRow(
  key: string,
  name: string,
  who: RaceRow['who'],
  stage: number,
  extra: {
    fuel?: number | null;
    fired?: boolean;
    first?: boolean;
    launchIn?: number | null;
    /** What to call the stage in place of the stage's own name (the city knows more than the region does). */
    stageName?: string;
  } = {},
): RaceRow {
  const fired = extra.fired === true || stage > atomStageNo('preparing');
  const fuel = extra.fuel ?? null;
  return {
    key,
    name,
    who,
    stage,
    stageName:
      extra.stageName ?? ATOM_STAGE_NAMES[ATOM_STAGES[Math.max(0, Math.min(ATOM_STAGES.length - 1, stage))]!],
    pips: pipsOf(stage),
    fuel: stage <= atomStageNo('bomb') && fuel !== null && fuel > 0 ? fuel : null,
    ready: stage === atomStageNo('ready') || stage === atomStageNo('preparing'),
    fired,
    first: extra.first === true,
    launchIn: extra.launchIn ?? null,
  };
}

/**
 * Everyone racing for the bomb: the city itself, each friend's city that has begun (from its report) and
 * each computer neighbour that races, the furthest along first, a tie by name. The first finisher is the
 * city (when the sim says it was first), or the friend the region's record names.
 */
export function raceRows(
  cityName: string,
  a: AtomSummary,
  neighbours: RaceNeighbour[],
  marks: readonly RegionAtomMark[],
): RaceRow[] {
  const rows: RaceRow[] = [];
  const firstSlot = marks.find((m) => m.first)?.slot;
  const stage = atomStageNo(a.stage);
  if (stage > 0 || a.fired)
    rows.push(
      raceRow('city', cityName, 'city', stage, {
        fuel: Math.round(a.fuel * 100),
        fired: !!a.fired,
        first: a.first,
        launchIn: null,
        stageName: headline(a),
      }),
    );
  for (const n of neighbours) {
    const atom = n.player?.atom;
    if (!n.player || !atom || (atom.stage <= 0 && !atom.fired)) continue;
    rows.push(
      raceRow(`friend-${n.player.slot}`, n.name, 'friend', atom.stage, {
        fuel: atom.fuel ?? null,
        fired: atom.fired === true,
        first: firstSlot === n.player.slot,
      }),
    );
  }
  for (const r of a.rivals)
    rows.push(raceRow(`rival-${r.id}`, r.name, 'computer', r.stage, { fuel: r.fuel, launchIn: r.launchIn }));
  return rows.sort((x, y) => y.stage - x.stage || x.name.localeCompare(y.name));
}

/** The region's record of the bomb as lines, newest first, the first finisher's mark named (`names` maps a place to a city). */
export function markLines(marks: readonly RegionAtomMark[], names: (slot: number) => string): string[] {
  return [...marks].reverse().map((m) => {
    const who = m.name || names(m.slot);
    const line =
      m.kind === 'ready'
        ? raceLine(atomStageNo('ready'), who)!
        : m.kind === 'fired'
          ? bombLine('fired', who, m.to ? names(m.to) : undefined)
          : m.kind === 'boom'
            ? bombLine('boom', who)
            : bombLine('stopped', who);
    return m.first ? `${line}, the first in the region` : line;
  });
}

// ---------------------------------------------------------------------------------------------
// Fallout
// ---------------------------------------------------------------------------------------------

export interface FalloutLines {
  closed: string;
  years: string | null;
  crews: string;
  price: string;
  relief: boolean;
}

const squareKm = (m2: number) => `${(Math.round(m2 / 10_000) / 100).toFixed(2)} km²`;

/**
 * The radiation block in words. `yearsLeft` is the game years until the worst ground reopens (the sim's
 * `falloutYears` of the peak, passed in so this stays free of the sim's maths).
 */
export function falloutLines(f: FalloutSummary, yearsLeft: number): FalloutLines {
  const n = f.jobs.length;
  const open = f.closedArea <= 0;
  const years = Math.max(1, Math.round(yearsLeft));
  return {
    closed: open
      ? 'No ground is closed to building'
      : `${squareKm(f.closedArea)} of ground is closed to building`,
    years: open ? null : `The worst of it reopens in about ${years} game year${years === 1 ? '' : 's'}`,
    crews: n === 0 ? 'No crews are out' : `${n} of ${FALLOUT.cleanup.jobs} crews out`,
    price: `${moneyWords(f.price)} a crew${f.relief ? ' (relief crews cost twice as much until Repair crews are researched)' : ''}`,
    relief: f.relief,
  };
}

/** What a crew does, for the clean-up tool's hint: its price and reach. */
export function cleanupHint(price: number, relief: boolean): string {
  return `Clean up here · ${moneyWords(price)}${relief ? ' (relief crews)' : ''} · ${FALLOUT.cleanup.radius} m · ${FALLOUT.cleanup.hours} h`;
}

// ---------------------------------------------------------------------------------------------
// When the tab shows
// ---------------------------------------------------------------------------------------------

/**
 * The Bomb tab is there when the bomb is allowed, or when a race, a strike or fallout exists
 * (a region that turned the bomb off after a race began still shows what happened).
 */
export function bombTabShown(
  a: AtomSummary | null,
  friends: { player?: { atom?: { stage: number } } }[],
  regionMarks: number,
): boolean {
  if (!a) return false;
  return (
    a.allowed ||
    atomStageNo(a.stage) > 0 ||
    !!a.fired ||
    !!a.inbound ||
    !!a.impact ||
    a.fallout ||
    a.rivals.length > 0 ||
    regionMarks > 0 ||
    friends.some((n) => (n.player?.atom?.stage ?? 0) > 0)
  );
}
