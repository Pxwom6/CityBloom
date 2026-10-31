/**
 * Wars and treaties between friends, the city's side (M39 step 5b, `docs/plans/M39-design.md` calls 9
 * and 10). The region room keeps the truth of a war between two players' cities (its opening, its
 * score, who capitulated, the hold on a seat of power), of the pacts they have and of who is whose
 * vassal; each city's page passes it on as page-only commands and the city's own sim mirrors it in
 * `WarState.diplomacy`, so everything that already reads a war, a pact or a vassal (weariness, the
 * stakes that freeze, who may raid whom, the ledger) works for friends as for computer neighbours.
 *
 * - `friendWar`: a war's state, whole and idempotent (it is applied again with every message about it):
 *   declared, open, ceasefire, capitulated, ended, with its score from this city's side.
 * - `friendTreaty`: a treaty signed, applied once (`WarState.taken`): peace ends the mirror war,
 *   reparations are booked at once (the payer pays, the other receives: the same amount in both cities),
 *   tribute is booked monthly for its months on this city's own clock, an embargo ends this city's
 *   deals with that friend. Pacts and vassals are not made here: they come from the region's list.
 * - `friendPacts`: the region's pacts and vassals for this city, reconciled (what the region no longer
 *   lists is gone; the mirror has the ids the region gave).
 *
 * Nothing here reads a clock: the region's times are the page's (it passes how long a warning has to
 * run), and a pact ends when the region's list stops holding it.
 */
import {
  cleanTerm,
  DIPLOMACY,
  TERM_KINDS,
  TERM_NAMES,
  TREATY_TAKEN,
  UNKNOWN_FRIEND,
  timeWords,
  type Party,
  type Term,
} from '../../data/diplomacy';

export { TREATY_TAKEN, UNKNOWN_FRIEND };
import { RAIDS } from '../../data/battle';
import { fail, ok, type CommandResult } from '../commands';
import { formatInt } from '../dmath';
import type { Sim } from '../sim';
import { dateOf, START_TICK_OFFSET, TICKS_PER_HOUR, TICKS_PER_MONTH } from '../time';
import { accrue } from './economy';
import {
  bindingPacts,
  breakPacts,
  dip,
  endWar,
  heldBy,
  monthlyTaxes,
  neighbourOf,
  neighbourTaxes,
  note,
  pactsWith,
  stopFighting,
  termText,
  warScaleAllowed,
  warWith,
  type Diplomacy,
  type War,
} from './diplomacy';
import { grieved } from './intel';
import type { Neighbour } from './region';
import { BATTLE_TAKEN_KEEP } from './raids';
import { endArmsDeals } from './warEconomy';

const M = TICKS_PER_MONTH;
/** A game hour in real time at 1× (ms): the fair clock's pace, in which the region counts its times. */
const HOUR_MS = 7_500;
/** Ticks "far off": a declared war's opening, a capitulation's deadline (the region decides them, not the tick). */
const FAR = 1e9;

export const FRIEND_PACT_KINDS = [
  'ceasefire',
  'nonAggression',
  'alliance',
  'defensivePact',
  'embargo',
  'trade',
] as const;
export type FriendPactKind = (typeof FRIEND_PACT_KINDS)[number];

export type MirrorState = 'declared' | 'open' | 'ceasefire' | 'capitulated' | 'ended';
const STATES: readonly MirrorState[] = ['declared', 'open', 'ceasefire', 'capitulated', 'ended'];
const SCALES = ['skirmish', 'war', 'total'] as const;

/** A term a treaty between friends may hold: M36's less a computer town's, plus vassalage (from `a`'s side). */
export type FriendTermIn = Term | { k: 'vassal' };
const FRIEND_TERMS: readonly string[] = [
  'ceasefire',
  'peace',
  'reparations',
  'tribute',
  'nonAggression',
  'alliance',
  'defensivePact',
  'embargo',
  'trade',
  'independence',
  'vassal',
];

/** A war between this city and a friend's, as the region room has it, from this city's side. */
export interface FriendWarFacts {
  /** The region's number for the war, and the other city's place in the region. */
  room: number;
  slot: number;
  /** Who declared it: 'us' is this city. */
  by: Party;
  scale: (typeof SCALES)[number];
  reason: string;
  state: MirrorState;
  /** −100 to 100, from this city's side. */
  score: number;
  battles: number;
  rebellion?: true;
  /** A total war: who holds whose seat of power. */
  hold?: Party;
  /** Who capitulated ('us': this city). */
  capitulated?: Party;
  /** A declared war: how long the warning still has to run (ms of the region's time), for the notice's words. */
  opensIn?: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const isParty = (v: unknown): v is Party => v === 'us' || v === 'them';
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const money = (v: number) => `$${formatInt(Math.round(v))}`;

/** A friend's war as the page hands it over, checked: a clean copy, or null if it isn't one. */
export function checkFriendWar(f: unknown): FriendWarFacts | null {
  if (!isObj(f)) return null;
  if (!isInt(f.room, 1, 1e9) || !isInt(f.slot, 1, 64) || !isParty(f.by)) return null;
  if (!SCALES.includes(f.scale as never) || !STATES.includes(f.state as never)) return null;
  if (typeof f.reason !== 'string' || f.reason.length > 200) return null;
  if (typeof f.score !== 'number' || !Number.isFinite(f.score) || f.score < -100 || f.score > 100)
    return null;
  if (!isInt(f.battles, 0, 1e6)) return null;
  if (f.hold !== undefined && !isParty(f.hold)) return null;
  if (f.capitulated !== undefined && !isParty(f.capitulated)) return null;
  if (f.rebellion !== undefined && f.rebellion !== true) return null;
  if (f.opensIn !== undefined && !(typeof f.opensIn === 'number' && f.opensIn >= 0 && f.opensIn <= 1e9))
    return null;
  return {
    room: f.room,
    slot: f.slot,
    by: f.by,
    scale: f.scale as FriendWarFacts['scale'],
    reason: f.reason,
    state: f.state as MirrorState,
    score: Math.round(f.score * 10) / 10,
    battles: f.battles,
    ...(f.rebellion ? { rebellion: true as const } : {}),
    ...(f.hold ? { hold: f.hold } : {}),
    ...(f.capitulated ? { capitulated: f.capitulated } : {}),
    ...(f.opensIn !== undefined ? { opensIn: f.opensIn } : {}),
  };
}

/** The neighbour that is the friend's city in this place of the region. */
export function friendNeighbour(sim: Sim, slot: number): Neighbour | undefined {
  return sim.state.region.neighbours.find((n) => n.player?.slot === slot);
}

/** How long a seat of power held (game hours at the region's pace) takes to conquer, in words. */
const conquestWords = () => timeWords(DIPLOMACY.conquestHours * HOUR_MS);

// ---------------------------------------------------------------- wars

/**
 * The region's state of a war with a friend, mirrored (page only): made when it first shows, updated
 * with every word about it, gone when it ends. Applied again with the same facts it changes nothing.
 */
export function friendWar(sim: Sim, raw: unknown, dryRun: boolean): CommandResult {
  const s = sim.state;
  if (!s.war) return fail('War is off in this city');
  const f = checkFriendWar(raw);
  if (!f) return fail('That war could not be read');
  const n = friendNeighbour(sim, f.slot);
  if (!n) return fail(UNKNOWN_FRIEND);
  const known = s.war.diplomacy?.wars.find((x) => x.friend?.room === f.room);
  if (!known && f.state === 'ended') return ok(0);
  // A war with this city that the room doesn't know (a computer neighbour's place a friend took): none.
  if (!known && s.war.diplomacy?.wars.some((x) => x.with === n.id))
    return fail(`The city is at war with ${n.name} already`);
  if (dryRun) return ok(0);
  const d = dip(sim);
  if (f.state === 'ended') {
    endWar(sim, n.id);
    note(sim, n.id, 'ended', `The war with ${n.name} is over`, 'good');
    return ok(0);
  }
  let war = known;
  if (!war) {
    if (f.by === 'us') {
      // (A war first seen already open was declared before this page saw it: its cost was paid then.)
      if (f.state === 'declared') declaredByUs(sim, n, !!f.rebellion);
    } else {
      // Attacked, a neutral city is neutral no more (the region doesn't declare on a neutral one; just in case).
      if (d.neutral || d.leaving !== undefined) {
        delete d.neutral;
        delete d.leaving;
        note(sim, 0, 'notNeutral', 'Attacked, the city is neutral no more');
      }
    }
    war = {
      id: s.nextId++,
      with: n.id,
      name: n.name,
      scale: f.scale,
      by: f.by,
      reason: f.reason.slice(0, DIPLOMACY.reasonMax),
      declared: s.tick,
      opens: f.state === 'declared' ? s.tick + FAR : s.tick,
      score: 0,
      battles: 0,
      ...(f.rebellion ? { rebellion: true as const } : {}),
      friend: { room: f.room, slot: f.slot, state: f.state },
    };
    if (f.state !== 'declared') war.opened = true;
    d.wars.push(war);
    declaredNote(sim, n, war, f);
  } else if (war.friend!.state === 'declared' && f.state !== 'declared') {
    war.opened = true;
    war.opens = s.tick;
    note(sim, n.id, 'opened', `The war with ${n.name} has begun`);
  }
  const fr = war.friend!;
  fr.state = f.state;
  war.score = f.score;
  war.battles = f.battles;
  // The seat of power (a total war): held by one side, or not.
  if (f.hold && war.hold?.by !== f.hold) {
    war.hold = { by: f.hold, since: s.tick };
    note(
      sim,
      n.id,
      'hold',
      f.hold === 'us'
        ? `The city’s forces hold ${n.name}’s seat of power: in about ${conquestWords()} ${n.name} falls`
        : `${n.name} holds the city’s HQ: win a battle within about ${conquestWords()} or the city falls`,
      f.hold === 'us' ? 'good' : 'bad',
    );
  } else if (!f.hold && war.hold) {
    const by = war.hold.by;
    delete war.hold;
    note(
      sim,
      n.id,
      'holdBroken',
      by === 'us'
        ? `${n.name} wins a battle and takes back its seat of power`
        : `The city wins a battle and takes back its HQ from ${n.name}`,
      by === 'us' ? 'bad' : 'good',
    );
  }
  // A side gives up: no more battles; the winner sets the terms (within a day) or plain peace stands.
  if (f.capitulated && !war.capitulated) {
    war.capitulated = { by: f.capitulated, until: s.tick + FAR };
    stopFighting(sim, n.id);
    if (f.capitulated === 'us') note(sim, n.id, 'capitulated', `The city capitulates to ${n.name}`, 'bad');
    else
      note(
        sim,
        n.id,
        'theyCapitulate',
        `${n.name} capitulates: set your terms within a day, or plain peace stands`,
        'good',
      );
  } else if (!f.capitulated && war.capitulated) delete war.capitulated;
  sim.warChanged();
  return ok(0);
}

/** The cost of declaring a war on a friend: its reputation, and a pact in the way broken. */
function declaredByUs(sim: Sim, n: Neighbour, rebellion: boolean): void {
  const s = sim.state;
  const d = dip(sim);
  // Struck first by its raid, or (M37) its spy caught here lately: a declaration costs no reputation.
  const struckUs =
    s.tick - (s.war!.raided?.by[n.id] ?? -Infinity) < RAIDS.retaliate * M || grieved(sim, n.id);
  if (!struckUs && !rebellion) d.reputation = clamp(d.reputation + DIPLOMACY.reputation.declare, 0, 100);
  const bound = bindingPacts(sim, n.id);
  if (bound.length) breakPacts(sim, n, bound);
}

function declaredNote(sim: Sim, n: Neighbour, war: War, f: FriendWarFacts): void {
  const what = war.scale === 'total' ? 'total war' : war.scale === 'skirmish' ? 'skirmish war' : 'war';
  const in_ = f.opensIn !== undefined ? ` in ${timeWords(f.opensIn)}` : '';
  if (f.state !== 'declared') {
    note(
      sim,
      n.id,
      f.by === 'us' ? 'declared' : 'declaredOn',
      f.by === 'us'
        ? `The city is at ${what} with ${n.name}: “${war.reason}”`
        : `${n.name} is at ${what} with the city: “${war.reason}”`,
      f.by === 'us' ? undefined : 'bad',
    );
    return;
  }
  if (f.by === 'us')
    note(
      sim,
      n.id,
      war.rebellion ? 'rebellion' : 'declared',
      war.rebellion
        ? `The city rises against ${n.name}: a total war opens${in_}`
        : `The city declares ${what} on ${n.name}: it opens${in_}`,
    );
  else
    note(
      sim,
      n.id,
      'declaredOn',
      `${n.name} declares ${what} on the city: “${war.reason}”. It opens${in_}`,
      'bad',
    );
}

// ---------------------------------------------------------------- treaties

export interface FriendTreatyIn {
  /** The region's id for the treaty. */
  id: string;
  /** The other city's place in the region, and which side of the treaty this city is ('a': the proposer or winner). */
  slot: number;
  side: 'a' | 'b';
  /** The terms as `a` reads them ('us' is `a`). */
  terms: FriendTermIn[];
  imposed?: true;
}

/** A treaty from the page, checked: a clean copy, or why not. */
export function checkFriendTreaty(raw: unknown): FriendTreatyIn | string {
  const BAD = 'That treaty could not be read';
  if (!isObj(raw)) return BAD;
  if (typeof raw.id !== 'string' || !/^[\w-]{1,40}$/.test(raw.id)) return BAD;
  if (!isInt(raw.slot, 1, 64) || (raw.side !== 'a' && raw.side !== 'b')) return BAD;
  if (!Array.isArray(raw.terms) || raw.terms.length < 1 || raw.terms.length > DIPLOMACY.maxTerms) return BAD;
  if (raw.imposed !== undefined && raw.imposed !== true) return BAD;
  const terms: FriendTermIn[] = [];
  for (const t of raw.terms) {
    const k = isObj(t) ? t.k : undefined;
    if (typeof k !== 'string' || !FRIEND_TERMS.includes(k)) return BAD;
    if (k === 'vassal') {
      terms.push({ k: 'vassal' });
      continue;
    }
    const c = cleanTerm(t);
    if (!c) return BAD;
    terms.push(c);
  }
  return {
    id: raw.id,
    slot: raw.slot,
    side: raw.side,
    terms,
    ...(raw.imposed ? { imposed: true as const } : {}),
  };
}

/** The same term from the other side of the table. */
function flip(t: FriendTermIn): FriendTermIn {
  const f = (p: Party): Party => (p === 'us' ? 'them' : 'us');
  return t.k === 'reparations' || t.k === 'tribute' ? { ...t, payer: f(t.payer) } : { ...t };
}

/** A term in words, from this city's side. */
function termWords(sim: Sim, n: Neighbour, t: FriendTermIn, side: 'a' | 'b'): string {
  if (t.k === 'vassal')
    return side === 'a' ? `${n.name} becomes the city’s vassal` : `the city becomes ${n.name}’s vassal`;
  if (t.k === 'independence') return 'the vassal goes free';
  return termText(sim, n, t);
}

/**
 * A treaty the region signed between this city and a friend's, applied once (page only). Money is
 * booked on this side as the other side books it; pacts, vassals and a war's end come from the region's
 * own words (`friendPacts`, `friendWar`), so a treaty read late changes only what hasn't changed yet.
 */
export function friendTreaty(sim: Sim, raw: unknown, dryRun: boolean): CommandResult {
  const s = sim.state;
  const w = s.war;
  if (!w) return fail('War is off in this city');
  const t = checkFriendTreaty(raw);
  if (typeof t === 'string') return fail(t);
  const n = friendNeighbour(sim, t.slot);
  if (!n) return fail(UNKNOWN_FRIEND);
  const key = `${t.slot}:treaty:${t.id}`;
  if (w.taken?.includes(key)) return fail(TREATY_TAKEN);
  if (dryRun) return ok(0);
  w.taken = [...(w.taken ?? []), key].slice(-BATTLE_TAKEN_KEEP);
  const d = dip(sim);
  const terms = t.side === 'a' ? t.terms : t.terms.map(flip);
  const nextMonth = (dateOf(s.tick).totalMonths + 1) * M - START_TICK_OFFSET;
  const said: string[] = [];
  for (const term of terms) {
    said.push(termWords(sim, n, term, t.side));
    switch (term.k) {
      case 'peace':
        // (Usually the region's word that the war is over came first.)
        if (warWith(sim, n.id)) endWar(sim, n.id);
        break;
      case 'reparations':
        accrue(
          sim,
          term.payer === 'us' ? 'reparationsOut' : 'reparationsIn',
          term.payer === 'us' ? -term.amount : term.amount,
        );
        break;
      case 'tribute':
        d.pacts.push({
          id: s.nextId++,
          with: n.id,
          term,
          since: nextMonth,
          left: term.months,
          paid: 0,
          ...(t.imposed ? { imposed: true as const } : {}),
        });
        break;
      case 'embargo':
        s.region.deals = s.region.deals.filter((x) => x.neighbour !== n.id);
        endArmsDeals(sim, n, 'an embargo is signed');
        break;
      default:
        // A ceasefire, a pact, trade, vassalage and independence are the region's list (`friendPacts`).
        break;
    }
  }
  // Imposed on the city (it capitulated) is bad news; any other terms, good.
  const lost = !!t.imposed && t.side === 'b';
  note(
    sim,
    n.id,
    'signed',
    `${t.imposed ? 'Terms imposed' : 'A treaty signed'} with ${n.name}: ${said.join('; ')}`,
    lost ? 'bad' : 'good',
  );
  sim.warChanged();
  return ok(0);
}

// ---------------------------------------------------------------- pacts and vassals

export interface FriendPactIn {
  /** The region's number for the pact. */
  room: number;
  /** The other city's place. */
  slot: number;
  kind: FriendPactKind;
  /** A ceasefire's length in game hours, a non-aggression pact's in game months (from the region's times). */
  hours?: number;
  months?: number;
}

export interface FriendPactsIn {
  /** The pacts this city is party to. */
  pacts: FriendPactIn[];
  /** The vassal links this city is in: the vassal's place and its overlord's. */
  vassals: { vassal: number; overlord: number }[];
  /** This city's own place in the region. */
  me: number;
  /** The region's numbers for the wars this city is in: a mirror war not among them is over. Absent: not reconciled. */
  wars?: number[];
}

/** The term a pact of the region's stands for. */
function pactTerm(p: FriendPactIn): Term {
  switch (p.kind) {
    case 'ceasefire':
      return { k: 'ceasefire', hours: Math.max(1, p.hours ?? 12) };
    case 'nonAggression':
      return { k: 'nonAggression', months: Math.max(1, p.months ?? 1) };
    default:
      return { k: p.kind };
  }
}

/** The region's pacts and vassals as this city is in them, mirrored (page only): what it no longer lists is gone. */
export function friendPacts(sim: Sim, raw: unknown, dryRun: boolean): CommandResult {
  const s = sim.state;
  if (!s.war) return fail('War is off in this city');
  if (!isObj(raw) || !isInt(raw.me, 1, 64) || !Array.isArray(raw.pacts) || !Array.isArray(raw.vassals))
    return fail('Those pacts could not be read');
  if (raw.pacts.length > 64 || raw.vassals.length > 64) return fail('Those pacts could not be read');
  const pacts: FriendPactIn[] = [];
  for (const p of raw.pacts as unknown[]) {
    if (
      !isObj(p) ||
      !isInt(p.room, 1, 1e9) ||
      !isInt(p.slot, 1, 64) ||
      !FRIEND_PACT_KINDS.includes(p.kind as never) ||
      (p.hours !== undefined && !isInt(p.hours, 1, 1e6)) ||
      (p.months !== undefined && !isInt(p.months, 1, 1e4))
    )
      return fail('Those pacts could not be read');
    pacts.push({
      room: p.room,
      slot: p.slot,
      kind: p.kind as FriendPactKind,
      ...(p.hours !== undefined ? { hours: p.hours as number } : {}),
      ...(p.months !== undefined ? { months: p.months as number } : {}),
    });
  }
  const vassals: FriendPactsIn['vassals'] = [];
  for (const v of raw.vassals as unknown[]) {
    if (!isObj(v) || !isInt(v.vassal, 1, 64) || !isInt(v.overlord, 1, 64))
      return fail('Those pacts could not be read');
    vassals.push({ vassal: v.vassal, overlord: v.overlord });
  }
  let wars: number[] | undefined;
  if (raw.wars !== undefined) {
    if (!Array.isArray(raw.wars) || raw.wars.length > 64 || !raw.wars.every((x) => isInt(x, 1, 1e9)))
      return fail('Those pacts could not be read');
    wars = raw.wars as number[];
  }
  const me = raw.me;
  if (dryRun) return ok(0);
  const d = dip(sim);
  let pending = 0;
  // Pacts: the mirror holds exactly the region's, by the region's number.
  const keep = new Set<number>();
  for (const p of pacts) {
    const n = friendNeighbour(sim, p.slot);
    if (!n) {
      pending++;
      continue;
    }
    keep.add(p.room);
    if (d.pacts.some((x) => x.room === p.room)) continue;
    d.pacts.push({ id: s.nextId++, with: n.id, term: pactTerm(p), since: s.tick, room: p.room });
    sim.warChanged();
  }
  const gone = d.pacts.filter((p) => p.room !== undefined && !keep.has(p.room));
  if (gone.length && pending === 0) {
    d.pacts = d.pacts.filter((p) => !gone.includes(p));
    sim.warChanged();
  }
  // Vassals.
  pending += mirrorVassals(sim, d, me, vassals);
  // Wars: one the region no longer has is over.
  if (wars)
    for (const war of [...d.wars])
      if (war.friend && !wars.includes(war.friend.room)) {
        const n = neighbourOf(sim, war.with);
        endWar(sim, war.with);
        if (n) note(sim, n.id, 'ended', `The war with ${n.name} is over`, 'good');
      }
  return ok(0, pending ? { info: { pending } } : undefined);
}

/** The vassal links of this city mirrored; how many couldn't be (the friend isn't a neighbour yet). */
function mirrorVassals(sim: Sim, d: Diplomacy, me: number, links: FriendPactsIn['vassals']): number {
  const s = sim.state;
  let pending = 0;
  // This city as a vassal.
  const over = links.find((v) => v.vassal === me);
  const on = over ? friendNeighbour(sim, over.overlord) : undefined;
  if (over && !on) pending++;
  if (on && d.vassal?.overlord !== on.id && !(d.vassal && !neighbourOf(sim, d.vassal.overlord)?.player)) {
    d.vassal = { overlord: on.id, since: s.tick };
    d.fell = { by: on.id, name: on.name, at: s.tick };
    delete d.neutral;
    delete d.leaving;
    // Every other war with a computer neighbour ends with the fall (a vassal sends no forces).
    for (const other of [...d.wars]) if (!other.friend) endWar(sim, other.with);
    note(
      sim,
      on.id,
      'fell',
      `The city falls to ${on.name}: it is ${on.name}’s vassal and pays it a fifth of its taxes`,
      'bad',
    );
    sim.warChanged();
  } else if (!over && d.vassal && neighbourOf(sim, d.vassal.overlord)?.player) {
    const was = neighbourOf(sim, d.vassal.overlord);
    delete d.vassal;
    delete d.fell;
    note(sim, was?.id ?? 0, 'freed', `The city is free of ${was?.name ?? 'its overlord'}`, 'good');
    sim.warChanged();
  }
  // Friends' cities that are this city's vassals.
  const subs: Neighbour[] = [];
  for (const v of links) {
    if (v.overlord !== me) continue;
    const n = friendNeighbour(sim, v.vassal);
    if (n) subs.push(n);
    else pending++;
  }
  const had = d.subjects ?? [];
  for (const n of subs)
    if (!had.some((x) => x.with === n.id)) {
      (d.subjects ??= []).push({ with: n.id, since: s.tick });
      note(
        sim,
        n.id,
        'conquered',
        `${n.name} falls to the city: it is the city’s vassal now and pays a fifth of its taxes`,
        'good',
      );
      sim.warChanged();
    }
  if (pending === 0 && d.subjects)
    for (const x of [...d.subjects])
      if (!subs.some((n) => n.id === x.with)) {
        const rest: { with: number; since: number }[] = (d.subjects ?? []).filter((y) => y !== x);
        if (rest.length) d.subjects = rest;
        else delete d.subjects;
        const n = neighbourOf(sim, x.with);
        note(sim, n?.id ?? 0, 'freed', `${n?.name ?? 'A vassal'} is free of the city`);
        sim.warChanged();
      }
  return pending;
}

/**
 * The city left its region (or the region ended war): what it had with friends there ends. Wars are
 * over, the region's pacts and vassalage gone; tribute and reparations already booked stay.
 */
export function forgetFriends(sim: Sim): void {
  const d = sim.state.war?.diplomacy;
  if (!d) return;
  for (const war of [...d.wars]) if (war.friend) endWar(sim, war.with);
  const had = d.pacts.length;
  d.pacts = d.pacts.filter((p) => p.room === undefined);
  const subs = d.subjects?.length ?? 0;
  delete d.subjects;
  const vassal = d.vassal && neighbourOf(sim, d.vassal.overlord)?.player;
  if (vassal) {
    delete d.vassal;
    delete d.fell;
  }
  if (had !== d.pacts.length || subs || vassal) sim.warChanged();
}

// ---------------------------------------------------------------- what the page asks first

/** Terms the page checks before it sends, or the sim before it accepts: money within what the payer's taxes allow. */
export function friendTermsProblem(
  terms: readonly FriendTermIn[],
  ctx: { taxes: number; treasury: number },
): string | null {
  const L = DIPLOMACY.limits;
  for (const t of terms) {
    if (t.k === 'reparations' && t.payer === 'us') {
      const cap = Math.max(10_000, ctx.taxes * L.reparationsMonths);
      if (t.amount > cap) return `Reparations are at most ${money(cap)}`;
      if (t.amount > ctx.treasury) return 'The city can’t pay that much now';
    }
    if (t.k === 'tribute' && t.payer === 'us') {
      const cap = Math.max(1_000, ctx.taxes * L.tributeShare);
      if (t.amount > cap) return `Tribute is at most ${money(cap)} a month`;
    }
  }
  return null;
}

/** Why the city may not declare war on this friend now, as far as the city can tell (the region has the last word). */
export function friendDeclareProblem(sim: Sim, n: Neighbour): { why: string | null; breaks: boolean } {
  const s = sim.state;
  const p = n.player;
  if (!s.war || !p) return { why: 'War is off in this city', breaks: false };
  const allowed = warScaleAllowed(sim);
  if (!allowed) return { why: 'Your region’s rules don’t allow war', breaks: false };
  const d = s.war.diplomacy;
  if (d?.neutral) return { why: 'A neutral city doesn’t go to war', breaks: false };
  if (d?.leaving !== undefined && s.tick < d.leaving)
    return {
      why: `Leaving neutrality counts in ${Math.ceil((d.leaving - s.tick) / TICKS_PER_HOUR)} hours`,
      breaks: false,
    };
  if (p.raid === 'neutral') return { why: `${n.name} is neutral`, breaks: false };
  if (p.raid === 'new')
    return {
      why: `${n.name} is too young or small to go to war with, unless it strikes first`,
      breaks: false,
    };
  if (d?.wars.some((w) => w.with === n.id))
    return { why: `The city is at war with ${n.name} already`, breaks: false };
  if (d?.subjects?.some((x) => x.with === n.id)) return { why: `${n.name} is your vassal`, breaks: false };
  if (d?.vassal && d.vassal.overlord !== n.id)
    return { why: 'A vassal can’t go to war, except to rise against its overlord', breaks: false };
  if (heldBy(sim, n.id)) return { why: `${n.name} is held by another town`, breaks: false };
  const bound = bindingPacts(sim, n.id);
  if (bound.length)
    return {
      why: `That breaks your ${TERM_NAMES[bound[0]!.term.k].toLowerCase()} with ${n.name}`,
      breaks: true,
    };
  return { why: null, breaks: false };
}

/**
 * Why these terms can't be put to this friend now (the region's rules, checked here first so the
 * player sees it beside the control), or null. `ctx` is the city's taxes and treasury.
 */
export function friendProposalProblem(
  sim: Sim,
  n: Neighbour,
  terms: readonly FriendTermIn[],
  ctx: { taxes: number; treasury: number },
  imposed = false,
): string | null {
  const s = sim.state;
  if (!s.war) return 'War is off in this city';
  if (!s.region.rules?.war) return 'Your region’s rules don’t allow war';
  if (!terms.length) return 'A treaty needs terms';
  if (terms.length > DIPLOMACY.maxTerms) return `A treaty has ${DIPLOMACY.maxTerms} terms at most`;
  const kinds = terms.map((t) => t.k);
  for (const k of FRIEND_TERMS)
    if (kinds.filter((x) => x === k).length > 1)
      return `${k === 'vassal' ? 'Vassalage' : TERM_NAMES[k as Term['k']]} is listed twice`;
  const d = s.war.diplomacy;
  const war = warWith(sim, n.id);
  const peace = kinds.includes('peace');
  const has = (k: Term['k']) => pactsWith(sim, n.id, k).length > 0;
  const neutral = (d?.neutral ?? false) || n.player?.raid === 'neutral';
  for (const t of terms) {
    switch (t.k) {
      case 'ceasefire':
        if (!war) return `The city isn’t at war with ${n.name}`;
        if (peace) return 'Peace and a ceasefire together make no sense';
        if (war.friend?.state === 'declared') return 'The war hasn’t opened yet: ask for peace instead';
        if (war.friend?.state === 'ceasefire') return 'There is a ceasefire already';
        if (war.friend?.state === 'capitulated') return 'That war is over: the winner sets the terms';
        break;
      case 'peace':
        if (!war) return `The city isn’t at war with ${n.name}`;
        break;
      case 'nonAggression':
        if (has('nonAggression')) return `A non-aggression pact with ${n.name} is in force already`;
        if (war && !peace) return 'A non-aggression pact needs peace first';
        break;
      case 'alliance':
      case 'defensivePact':
        if (has(t.k)) return `${TERM_NAMES[t.k]} with ${n.name} is in force already`;
        if (war && !peace) return `${TERM_NAMES[t.k]} needs peace first`;
        if (neutral) return `${d?.neutral ? 'The city is' : `${n.name} is`} neutral: it joins no wars`;
        break;
      case 'embargo':
        if (has('embargo')) return `${n.name} is under embargo already`;
        if (kinds.includes('trade')) return 'An embargo and trade together make no sense';
        break;
      case 'trade':
        if (has('trade')) return `Trade with ${n.name} is open already`;
        break;
      case 'independence':
        if (d?.vassal?.overlord !== n.id && !d?.subjects?.some((x) => x.with === n.id))
          return 'Neither city is the other’s vassal';
        break;
      case 'vassal':
        if (!imposed) return 'Vassalage can only be imposed by the winner of a total war';
        break;
      default:
        break;
    }
  }
  return friendTermsProblem(terms, ctx);
}

/**
 * The page's question before it sends terms or accepts them: why they can't stand now, or null.
 * `terms` are as the proposer ('a') reads them; `side` is which side this city is.
 */
export function friendTermsQuery(
  sim: Sim,
  slot: number,
  raw: unknown[],
  imposed: boolean,
  side: 'a' | 'b',
): string | null {
  const n = friendNeighbour(sim, slot);
  if (!n) return UNKNOWN_FRIEND;
  const c = checkFriendTreaty({ id: 'q', slot, side, terms: raw });
  if (typeof c === 'string') {
    for (const t of raw) {
      const k = isObj(t) ? t.k : undefined;
      if (typeof k === 'string' && !FRIEND_TERMS.includes(k) && TERM_KINDS.includes(k as never))
        return `${TERM_NAMES[k as Term['k']]} is for computer towns, not for friends`;
    }
    return 'A term doesn’t make sense';
  }
  // From this city's side: the proposer's terms flipped for 'b'. The other side's propose rules are
  // about the proposer's state, so they are checked from `a`'s (here only when this city is `a`).
  const mine = side === 'a' ? c.terms : c.terms.map(flip);
  const ctx = { taxes: monthlyTaxes(sim), treasury: sim.state.treasury };
  if (side === 'a') return friendProposalProblem(sim, n, mine, ctx, imposed);
  return friendTermsProblem(mine, ctx);
}

// ---------------------------------------------------------------- for the war room

/** A friend's city as the war room's Diplomacy tab lists it (M39). */
export interface FriendSummary {
  id: number;
  slot: number;
  name: string;
  mayor: string;
  online: boolean;
  population: number;
  /** Why the city can't declare war on it now (as far as the city can tell), or null. */
  declare: string | null;
  /** It may be declared on only by breaking a pact. */
  breaks: boolean;
  /** It is this city's overlord, or this city's vassal. */
  overlord: boolean;
  subject: boolean;
  /** What it pays the city a month as its vassal (from its own report). */
  dues: number | null;
  /** Its taxes a month, roughly (from its people), for the sums beside a money term. */
  taxes: number;
}

export function friendsSummary(sim: Sim): FriendSummary[] {
  const s = sim.state;
  if (!s.war) return [];
  const d = s.war.diplomacy;
  const out: FriendSummary[] = [];
  for (const n of s.region.neighbours) {
    const p = n.player;
    if (!p) continue;
    const why = friendDeclareProblem(sim, n);
    out.push({
      id: n.id,
      slot: p.slot,
      name: n.name,
      mayor: p.mayor,
      online: p.online,
      population: n.population,
      declare: why.why,
      breaks: why.breaks,
      overlord: d?.vassal?.overlord === n.id,
      subject: !!d?.subjects?.some((x) => x.with === n.id),
      dues: d?.subjects?.some((x) => x.with === n.id) ? (p.dues ?? 0) : null,
      taxes: neighbourTaxes(n),
    });
  }
  return out;
}
