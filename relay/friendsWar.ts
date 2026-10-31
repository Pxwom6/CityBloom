/**
 * Wars and treaties between friends (M39 step 5a, design calls 9 and 10), as the region room keeps
 * them: the state machine alone, with no connections and no clock of its own (the room gives it
 * `now`, and says what it knows of the cities), so the room can run it wherever it runs and tests can
 * drive it step by step. Nothing here is a timer: the room calls `tick` whenever anything reaches it,
 * and a declared war opens, a ceasefire runs out and a proposal lapses at the next message after its time.
 *
 * The room keeps the truth; each city mirrors it in its own sim (step 5b) by applying every treaty
 * once (`tsign`, kept for it until `tseen`). What is kept, in `RegionMeta`:
 *   - `friends.wars`: at most one war between two cities, its score from its declarer's side, ending
 *     in `ended` (and gone from the list) when a treaty signs peace;
 *   - `friends.pacts`: a ceasefire (which pauses its war), non-aggression, alliance, defensive pact,
 *     embargo, trade; `friends.vassals`: who is whose vassal;
 *   - `friends.proposals` waiting for their answer, `friends.queue` per city the treaties it hasn't
 *     applied, `friends.ended` the cooldown after each pair's last war, `friends.done` proposals answered;
 *   - `history`: the last 100 war events.
 *
 * It follows M36 (`src/sim/systems/diplomacy.ts`) so a war with a friend feels the same as one with a
 * computer neighbour: the score a battle moves (`scoreBattle`), capitulation at −60, the hold on the
 * seat of power in a total war (a battle won by the other side breaks it, 48 game hours conquer), the
 * terms and their limits (`cleanTerm`), the cooldown, vassals and their rising. Game time becomes real
 * time at the fair clock's pace (a game hour is 7.5 s at 1×): `FRIENDS` in `protocol.ts` has the numbers.
 */
import {
  DIPLOMACY,
  TERM_KINDS,
  TERM_NAMES,
  cleanTerm,
  termProblem,
  type TermKind,
} from '../src/data/diplomacy';
import type { RegionWarRules } from '../src/data/war';
import {
  FRIENDS,
  PACT_NAMES,
  type BattleOutcome,
  type FriendPact,
  type FriendProposal,
  type FriendScale,
  type FriendTerm,
  type FriendWar,
  type FriendsRoomMsg,
  type FriendsWelcome,
  type PactKind,
  type SignedTreaty,
  type Vassal,
  type WarEvent,
  type WarEventKind,
} from './protocol';

/** Everything the room keeps of friends' wars and treaties (a field of `RegionMeta`, plain JSON). */
export interface FriendsState {
  /** The last id given to a war or a pact. */
  next: number;
  wars: FriendWar[];
  pacts: FriendPact[];
  proposals: FriendProposal[];
  vassals: Vassal[];
  /** Per city (slot), the treaties signed that it hasn't said it has seen. */
  queue: Record<number, SignedTreaty[]>;
  /** The ms the last war between two cities ended, by `pairKey`: the cooldown counts from it. */
  ended: Record<string, number>;
  /** Proposals answered lately (their ids), so one sent again isn't signed twice. */
  done: string[];
}

/** Where the state lives: the region's record. */
export interface FwHost {
  friends?: FriendsState;
  history?: WarEvent[];
}

/** What the room tells the module about a city. */
export interface FwCity {
  slot: number;
  name: string;
  /** Its report's shield: a newcomer, or neutral (neither raids nor is raided, and goes to no war). */
  shield?: 'new' | 'neutral';
  /** It has reported (the region knows its war state). */
  reported: boolean;
  /** The protocol its page speaks. */
  proto: number;
}

export interface FwContext {
  /** The room's clock (ms). */
  now: number;
  rules: RegionWarRules;
  city(slot: number): FwCity | undefined;
  /** Did `by` raid `slot` lately (a newcomer may answer a city that struck it first)? */
  struck(slot: number, by: number): boolean;
  /** Is this a battle the region kept or fought live (`from` attacked `to`)? */
  battleKnown(from: number, to: number, id: string): boolean;
}

/** A message for some cities (or all of them but a few), to be sent to those that are here. */
export interface FwOut {
  to: number[] | 'all';
  except?: number[];
  msg: FriendsRoomMsg;
}

/** Pacts that stand in the way of a war or a raid (a ceasefire, and M36's `BINDING`). */
const BINDING: readonly PactKind[] = ['ceasefire', 'nonAggression', 'alliance', 'defensivePact'];
/** The terms friends may sign: M36's less a computer town's (districts, a demilitarised zone), plus vassalage. */
export const FRIEND_TERM_KINDS: readonly string[] = [
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
const SCALE_RANK: Record<FriendScale, number> = { skirmish: 0, war: 1, total: 2 };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
const pairKey = (p: number, q: number) => (p < q ? `${p}-${q}` : `${q}-${p}`);
const between = (x: { a: number; b: number }, p: number, q: number) =>
  (x.a === p && x.b === q) || (x.a === q && x.b === p);
const money = (v: number) =>
  `$${Math.round(v)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

/** A time in words: "90 seconds", "2 minutes", "3 hours". */
export function timeWords(ms: number): string {
  const s = Math.max(1, Math.ceil(ms / 1000));
  if (s < 120) return s === 1 ? '1 second' : `${s} seconds`;
  const m = Math.ceil(s / 60);
  if (m < 120) return `${m} minutes`;
  return `${Math.ceil(m / 60)} hours`;
}

export function emptyFriends(): FriendsState {
  return { next: 0, wars: [], pacts: [], proposals: [], vassals: [], queue: {}, ended: {}, done: [] };
}

/** A term from outside, cleaned (M36's `cleanTerm`), or what is wrong with it in words. */
export function cleanFriendTerm(raw: unknown): { term: FriendTerm } | { problem: string } {
  const k = raw && typeof raw === 'object' ? (raw as { k?: unknown }).k : undefined;
  if (k === 'vassal') return { term: { k: 'vassal' } };
  if (typeof k !== 'string' || !FRIEND_TERM_KINDS.includes(k)) {
    if (typeof k === 'string' && (TERM_KINDS as readonly string[]).includes(k))
      return { problem: `${TERM_NAMES[k as TermKind]} is for computer towns, not for friends` };
    return { problem: 'A term doesn’t make sense' };
  }
  const t = cleanTerm(raw);
  return t ? { term: t as FriendTerm } : { problem: termProblem(raw) ?? 'A term doesn’t make sense' };
}

const termName = (k: FriendTerm['k']) => (k === 'vassal' ? 'Vassalage' : TERM_NAMES[k]);

/** The words for a war's outcome of a raid. */
function outcomeWords(o: BattleOutcome): string {
  return o === 'raided'
    ? 'the raid succeeded'
    : o === 'repelled'
      ? 'the raid was repelled'
      : 'the raiders withdrew';
}

/** A war as a city is told it: without the room's tally of battles counted. */
export function warView(w: FriendWar): FriendWar {
  const { hold, capitulated, counted: _counted, ...rest } = w;
  return {
    ...rest,
    ...(capitulated ? { capitulated: { ...capitulated } } : {}),
    ...(hold ? { hold: { ...hold } } : {}),
  };
}

/** The room's side of friends' wars: methods give `out` messages (and set `dirty` if the record changed). */
export class FriendsWar {
  readonly out: FwOut[] = [];
  /** Something the record keeps that must not be lost has changed: the room writes it at the city's pace. */
  dirty = false;
  /** Something has changed that time or the next message would work out again (a history line, a lapsed proposal): it can wait. */
  quiet = false;
  /** Pacts or vassals changed: `settle` tells every city. */
  private pactsChanged = false;

  constructor(
    private readonly host: FwHost,
    private readonly cx: FwContext,
  ) {}

  // ---- Plumbing ---------------------------------------------------------------------------

  private get st(): FriendsState {
    return (this.host.friends ??= emptyFriends());
  }

  private get now(): number {
    return this.cx.now;
  }

  private name(slot: number): string {
    return this.cx.city(slot)?.name ?? 'A city';
  }

  private tell(to: number[], msg: FriendsRoomMsg): void {
    this.out.push({ to, msg });
  }

  private tellAll(msg: FriendsRoomMsg, except?: number[]): void {
    this.out.push({ to: 'all', ...(except ? { except } : {}), msg });
  }

  private mark(): void {
    this.dirty = true;
  }

  /** A change that can wait for the region's slower pace of writing (nothing is lost if it never lands). */
  private lazy(): void {
    this.quiet = true;
  }

  /** Whatever the call changed in pacts or vassals goes to every city, once. */
  private settle(): void {
    if (!this.pactsChanged) return;
    this.pactsChanged = false;
    const st = this.st;
    this.tellAll({
      t: 'pacts',
      pacts: st.pacts.map((p) => ({ ...p })),
      vassals: st.vassals.map((v) => ({ ...v })),
      at: this.now,
    });
  }

  private event(
    kind: WarEventKind,
    a: number,
    b: number,
    text: string,
    extra: Partial<WarEvent> = {},
  ): WarEvent {
    const log = (this.host.history ??= []);
    const ev: WarEvent = { id: (log.at(-1)?.id ?? 0) + 1, at: this.now, kind, a, b, text, ...extra };
    log.push(ev);
    if (log.length > FRIENDS.history) log.splice(0, log.length - FRIENDS.history);
    this.tellAll({ t: 'history', event: ev });
    this.lazy();
    return ev;
  }

  private warOf(p: number, q: number): FriendWar | undefined {
    return this.host.friends?.wars.find((w) => between(w, p, q));
  }

  private pactsOf(p: number, q: number): FriendPact[] {
    return (this.host.friends?.pacts ?? []).filter((x) => between(x, p, q));
  }

  /** The vassal link whose vassal is `slot`. */
  private vassalOf(slot: number): Vassal | undefined {
    return this.host.friends?.vassals.find((v) => v.vassal === slot);
  }

  /** The vassal link between two cities, either way round. */
  private linkOf(p: number, q: number): Vassal | undefined {
    return this.host.friends?.vassals.find(
      (v) => (v.vassal === p && v.overlord === q) || (v.vassal === q && v.overlord === p),
    );
  }

  private announce(w: FriendWar, text?: string): void {
    this.tell([w.a, w.b], { t: 'war', war: warView(w), at: this.now, ...(text ? { text } : {}) });
  }

  // ---- Declaring war ----------------------------------------------------------------------

  private declareRefusal(
    from: number,
    m: { to: number; scale: FriendScale; reason: string; breakPact?: true },
  ): { why: string; breaks?: true } | null {
    const rules = this.cx.rules;
    const F = this.cx.city(from);
    const T = this.cx.city(m.to);
    if (!rules.war) return { why: 'War is off in this region' };
    if (!F || !T || from === m.to) return { why: 'That city isn’t in the region' };
    if (SCALE_RANK[m.scale] > SCALE_RANK[rules.scale])
      return {
        why:
          rules.scale === 'skirmish'
            ? 'This region’s rules allow skirmishes only'
            : 'This region’s rules don’t allow total war',
      };
    if (m.reason.length > FRIENDS.reasonMax) return { why: 'That reason is too long' };
    if (F.proto < 6 || T.proto < 6)
      return {
        why: `${F.proto < 6 ? F.name : T.name}’s page is an older version, which can’t go to war with friends`,
      };
    if (!F.reported || !T.reported)
      return { why: `${F.reported ? T.name : F.name} isn’t in the region’s war yet` };
    if (F.shield === 'neutral') return { why: `${F.name} is neutral: a neutral city doesn’t go to war` };
    if (T.shield === 'neutral') return { why: `${T.name} is neutral` };
    if (T.shield === 'new' && !this.cx.struck(from, m.to))
      return { why: `${T.name} is too young or small to go to war with, unless it strikes first` };
    if (this.warOf(from, m.to)) return { why: `${F.name} is at war with ${T.name} already` };
    // A vassal goes to war only to rise against its overlord, and its overlord doesn't declare on it.
    const own = this.vassalOf(from);
    if (own && own.overlord !== m.to)
      return { why: 'A vassal can’t go to war, except to rise against its overlord' };
    if (this.vassalOf(m.to)?.overlord === from) return { why: `${T.name} is your vassal` };
    const ended = this.host.friends?.ended[pairKey(from, m.to)];
    if (ended !== undefined && this.now - ended < FRIENDS.cooldown)
      return {
        why: `The last war with ${T.name} ended too recently (${timeWords(ended + FRIENDS.cooldown - this.now)} to wait)`,
      };
    const bound = this.pactsOf(from, m.to).filter((p) => BINDING.includes(p.kind));
    if (bound.length && !m.breakPact)
      return { why: `That breaks your ${PACT_NAMES[bound[0]!.kind]} with ${T.name}`, breaks: true };
    return null;
  }

  declare(from: number, m: { to: number; scale: FriendScale; reason: string; breakPact?: true }): void {
    const why = this.declareRefusal(from, m);
    if (why) {
      this.tell([from], {
        t: 'wrefused',
        to: m.to,
        why: why.why,
        ...(why.breaks ? { breaks: true as const } : {}),
      });
      return;
    }
    const st = this.st;
    const A = this.name(from);
    const B = this.name(m.to);
    // The pacts in the way are broken, as the city agreed.
    for (const p of this.pactsOf(from, m.to).filter((x) => BINDING.includes(x.kind))) {
      this.dropPact(p);
      this.event('broken', from, m.to, `${A} breaks its ${PACT_NAMES[p.kind]} with ${B} to declare war`);
    }
    // What was on the table lapses: a war starts afresh.
    for (const p of st.proposals.filter((x) => between({ a: x.from, b: x.to }, from, m.to))) {
      st.proposals = st.proposals.filter((x) => x !== p);
      this.tell([p.from], { t: 'trefused', id: p.id, why: 'The war made that proposal moot', expired: true });
    }
    const rebellion = this.vassalOf(from)?.overlord === m.to;
    const war: FriendWar = {
      id: ++st.next,
      a: from,
      b: m.to,
      scale: m.scale,
      reason: m.reason.trim() || 'No reason given',
      declared: this.now,
      opens: this.now + FRIENDS.warning,
      score: 0,
      battles: 0,
      state: 'declared',
      ...(rebellion ? { rebellion: true as const } : {}),
    };
    st.wars.push(war);
    const what = m.scale === 'total' ? 'a total war' : m.scale === 'war' ? 'war' : 'a skirmish war';
    const text = rebellion
      ? `${A} rises against ${B}: ${what} opens in ${timeWords(FRIENDS.warning)}`
      : `${A} declares ${what} on ${B}: “${war.reason}”. It opens in ${timeWords(FRIENDS.warning)}`;
    this.event('declared', from, m.to, text, { war: war.id });
    this.announce(war, text);
    this.tellAll({ t: 'notice', text }, [from, m.to]);
    this.mark();
    this.settle();
  }

  // ---- Treaties ---------------------------------------------------------------------------

  /** Why these terms can't stand between these two now (from `from`'s side), or null. */
  private termsProblem(from: number, to: number, terms: FriendTerm[], imposed: boolean): string | null {
    const F = this.cx.city(from);
    const T = this.cx.city(to);
    if (!F || !T || from === to) return 'That city isn’t in the region';
    if (F.proto < 6 || T.proto < 6)
      return `${F.proto < 6 ? F.name : T.name}’s page is an older version, which can’t sign treaties with friends`;
    if (!terms.length) return 'A treaty needs terms';
    if (terms.length > FRIENDS.maxTerms) return `A treaty has ${FRIENDS.maxTerms} terms at most`;
    const kinds = terms.map((t) => t.k);
    for (const k of FRIEND_TERM_KINDS)
      if (kinds.filter((x) => x === k).length > 1) return `${termName(k as FriendTerm['k'])} is listed twice`;
    const war = this.warOf(from, to);
    const pacts = this.pactsOf(from, to);
    const has = (k: PactKind) => pacts.some((p) => p.kind === k);
    const peace = kinds.includes('peace');
    for (const t of terms) {
      switch (t.k) {
        case 'ceasefire':
          if (!war) return `${F.name} isn’t at war with ${T.name}`;
          if (peace) return 'Peace and a ceasefire together make no sense';
          if (war.state === 'declared') return 'The war hasn’t opened yet: ask for peace instead';
          if (war.state === 'ceasefire') return 'There is a ceasefire already';
          if (war.state === 'capitulated') return 'That war is over: the winner sets the terms';
          break;
        case 'peace':
          if (!war) return `${F.name} isn’t at war with ${T.name}`;
          break;
        case 'nonAggression':
          if (has('nonAggression')) return `A non-aggression pact with ${T.name} is in force already`;
          if (war && !peace) return 'A non-aggression pact needs peace first';
          break;
        case 'alliance':
        case 'defensivePact':
          if (has(t.k)) return `${termName(t.k)} with ${T.name} is in force already`;
          if (war && !peace) return `${termName(t.k)} needs peace first`;
          if (F.shield === 'neutral' || T.shield === 'neutral')
            return `${F.shield === 'neutral' ? F.name : T.name} is neutral: it joins no wars`;
          break;
        case 'embargo':
          if (has('embargo')) return `${T.name} is under embargo already`;
          if (kinds.includes('trade')) return 'An embargo and trade together make no sense';
          break;
        case 'trade':
          if (has('trade')) return `Trade with ${T.name} is open already`;
          break;
        case 'independence':
          if (!this.linkOf(from, to)) return 'Neither city is the other’s vassal';
          break;
        case 'vassal':
          if (!imposed) return 'Vassalage can only be imposed by the winner of a total war';
          if (this.vassalOf(to)) return `${T.name} is a vassal already`;
          if (this.vassalOf(from)) return `${F.name} is a vassal itself`;
          break;
        default:
          break;
      }
    }
    return null;
  }

  /** A treaty is put to `to` (or, from the winner of a capitulated war, imposed and signed at once). */
  propose(from: number, m: { id: string; to: number; terms: unknown[]; imposed?: true }): void {
    const refuse = (why: string, extra: { declined?: true } = {}) =>
      this.tell([from], { t: 'trefused', id: m.id, why, ...extra });
    const st = this.st;
    if (!this.cx.rules.war) return refuse('War is off in this region');
    // The same proposal sent again (nothing came back): put to its city again, not made twice.
    const known = st.proposals.find((p) => p.id === m.id);
    if (known) {
      if (known.from !== from) return refuse('That proposal id is taken');
      this.deliver(known);
      return;
    }
    if (st.done.includes(m.id) || Object.values(st.queue).some((q) => q.some((s) => s.id === m.id)))
      return refuse('That proposal has been answered already');
    const terms: FriendTerm[] = [];
    for (const raw of m.terms) {
      const c = cleanFriendTerm(raw);
      if ('problem' in c) return refuse(c.problem);
      terms.push(c.term);
    }
    if (m.imposed) return this.impose(from, m.id, m.to, terms, refuse);
    const why = this.termsProblem(from, m.to, terms, false);
    if (why) return refuse(why);
    if (st.proposals.some((p) => p.from === from && p.to === m.to))
      return refuse('Wait for an answer to the last proposal');
    if (st.proposals.length >= FRIENDS.proposals)
      return refuse(`The region holds ${FRIENDS.proposals} proposals at a time`);
    const p: FriendProposal = {
      id: m.id,
      from,
      to: m.to,
      terms,
      made: this.now,
      expires: this.now + FRIENDS.proposal,
    };
    st.proposals.push(p);
    this.deliver(p);
    // Lost to a restart, it is a proposal its target never sees: its city finds it missing from its own
    // list when it next joins. So it can wait for the region's slower pace of writing.
    this.lazy();
  }

  private deliver(p: FriendProposal): void {
    this.tell([p.to], {
      t: 'tprop',
      id: p.id,
      from: p.from,
      to: p.to,
      terms: p.terms.map((t) => ({ ...t })),
      made: p.made,
      expires: p.expires,
      at: this.now,
    });
  }

  /** The winner of a capitulated war sets its terms: peace among them, signed without an answer. */
  private impose(
    from: number,
    id: string,
    to: number,
    given: FriendTerm[],
    refuse: (why: string) => void,
  ): void {
    const war = this.warOf(from, to);
    if (!war || war.state !== 'capitulated' || war.capitulated?.by !== to)
      return refuse(`Only the winner of a war ${this.name(to)} capitulated in can impose terms`);
    for (const t of given) {
      if (t.k === 'ceasefire' || t.k === 'alliance' || t.k === 'defensivePact')
        return refuse(`${termName(t.k)} can’t be imposed`);
      if ((t.k === 'reparations' || t.k === 'tribute') && t.payer !== 'them')
        return refuse('Imposed money is paid by the side that capitulated');
      if (t.k === 'vassal' && war.scale !== 'total') return refuse('Only a total war ends in vassalage');
    }
    // Peace always among them, and a rising that won sets the vassal free.
    const terms: FriendTerm[] = [{ k: 'peace' }, ...given.filter((t) => t.k !== 'peace')];
    if (this.vassalOf(from)?.overlord === to && war.rebellion && !terms.some((t) => t.k === 'independence'))
      terms.push({ k: 'independence' });
    // Checked as terms are, with the war just ended (peace is among them).
    const why = this.termsProblem(from, to, terms, true);
    if (why) return refuse(why);
    this.sign(id, from, to, terms, true);
    this.settle();
  }

  answer(slot: number, m: { id: string; accept: boolean }): void {
    const st = this.st;
    const p = st.proposals.find((x) => x.id === m.id);
    const refuse = (why: string, extra: { expired?: true } = {}) =>
      this.tell([slot], { t: 'trefused', id: m.id, why, ...extra });
    if (!p) return refuse('That proposal is gone');
    if (p.to !== slot) return refuse('That proposal isn’t yours to answer');
    const gone = () => {
      st.proposals = st.proposals.filter((x) => x !== p);
      st.done = [...st.done, p.id].slice(-FRIENDS.done);
      this.lazy();
    };
    if (this.now >= p.expires) {
      gone();
      this.tell([p.from], { t: 'trefused', id: p.id, why: 'That proposal ran out', expired: true });
      return refuse('That proposal ran out', { expired: true });
    }
    if (!this.cx.rules.war) {
      gone();
      this.tell([p.from], { t: 'trefused', id: p.id, why: 'War is off in this region' });
      return refuse('War is off in this region');
    }
    if (!m.accept) {
      gone();
      this.tell([p.from], {
        t: 'trefused',
        id: p.id,
        why: `${this.name(slot)} turned down your proposal`,
        declined: true,
      });
      return;
    }
    // Things may have moved on since it was made (the war ended, a pact was signed some other way).
    const why = this.termsProblem(p.from, p.to, p.terms, false);
    if (why) {
      gone();
      this.tell([p.from], { t: 'trefused', id: p.id, why });
      return refuse(why);
    }
    gone();
    this.sign(p.id, p.from, p.to, p.terms, false);
    this.settle();
  }

  /** A pact ends early (either of its cities may end it; its word is that city's own affair). */
  breakPact(slot: number, m: { pact: number }): void {
    const st = this.host.friends;
    const p = st?.pacts.find((x) => x.id === m.pact && (x.a === slot || x.b === slot));
    if (!st || !p) return this.tell([slot], { t: 'trefused', id: String(m.pact), why: 'No such pact' });
    const other = p.a === slot ? p.b : p.a;
    this.dropPact(p);
    // A ceasefire ended is the war on again.
    if (p.kind === 'ceasefire') this.resume(p.war);
    this.event(
      'broken',
      slot,
      other,
      `${this.name(slot)} ends the ${PACT_NAMES[p.kind]} with ${this.name(other)}${p.kind === 'ceasefire' ? ': the war is on again' : ''}`,
    );
    this.mark();
    this.settle();
  }

  /** A treaty applied: its city forgets it. */
  seen(slot: number, id: string): void {
    const q = this.host.friends?.queue[slot];
    if (!q) return;
    const rest = q.filter((s) => s.id !== id);
    if (rest.length === q.length) return;
    if (rest.length) this.host.friends!.queue[slot] = rest;
    else delete this.host.friends!.queue[slot];
    // Lost, the treaty comes again and its city (which keeps the ids it has applied) ignores it.
    this.lazy();
  }

  /** Terms in force: pacts made, wars ended, vassals set, the treaty kept for both cities until seen. */
  private sign(id: string, a: number, b: number, terms: FriendTerm[], imposed: boolean): void {
    const st = this.st;
    const A = this.name(a);
    const B = this.name(b);
    const who = (p: 'us' | 'them') => (p === 'us' ? A : B);
    const said: string[] = [];
    // Events a term causes come after the treaty's own line.
    const after: (() => void)[] = [];
    for (const t of terms) {
      switch (t.k) {
        case 'peace': {
          const w = this.warOf(a, b);
          if (w) this.endWar(w);
          said.push('peace');
          break;
        }
        case 'ceasefire': {
          const w = this.warOf(a, b);
          this.addPact(a, b, 'ceasefire', {
            until: this.now + t.hours * FRIENDS.hour,
            ...(w ? { war: w.id } : {}),
          });
          if (w) {
            w.state = 'ceasefire';
            w.paused = this.now;
            this.announce(w);
          }
          said.push(`a ceasefire for ${t.hours} hours`);
          break;
        }
        case 'reparations':
          said.push(`${who(t.payer)} pays ${money(t.amount)} in reparations`);
          break;
        case 'tribute':
          said.push(`${who(t.payer)} pays ${money(t.amount)} a month for ${t.months} months`);
          break;
        case 'nonAggression':
          this.addPact(a, b, 'nonAggression', { until: this.now + t.months * FRIENDS.month });
          said.push(`a non-aggression pact for ${t.months} months`);
          break;
        case 'alliance':
          this.addPact(a, b, 'alliance');
          said.push('an alliance');
          break;
        case 'defensivePact':
          this.addPact(a, b, 'defensivePact');
          said.push('a defensive pact');
          break;
        case 'embargo':
          for (const p of this.pactsOf(a, b).filter((x) => x.kind === 'trade')) this.dropPact(p);
          this.addPact(a, b, 'embargo');
          said.push('an embargo on trade');
          break;
        case 'trade':
          for (const p of this.pactsOf(a, b).filter((x) => x.kind === 'embargo')) this.dropPact(p);
          this.addPact(a, b, 'trade');
          said.push('a trade agreement');
          break;
        case 'independence': {
          const link = this.linkOf(a, b);
          if (link) {
            st.vassals = st.vassals.filter((v) => v !== link);
            this.pactsChanged = true;
            said.push(`${this.name(link.vassal)} goes free`);
            after.push(() =>
              this.event(
                'freed',
                link.vassal,
                link.overlord,
                `${this.name(link.vassal)} is free of ${this.name(link.overlord)}`,
              ),
            );
          }
          break;
        }
        case 'vassal': {
          // The fallen side's pacts with the winner end with its fall.
          for (const p of this.pactsOf(a, b).filter((x) => BINDING.includes(x.kind) || x.kind === 'embargo'))
            this.dropPact(p);
          st.vassals.push({ vassal: b, overlord: a, since: this.now, share: DIPLOMACY.vassal.taxShare });
          this.pactsChanged = true;
          said.push(`${B} becomes ${A}’s vassal`);
          after.push(() =>
            this.event(
              'vassal',
              a,
              b,
              `${B} falls to ${A}: it is ${A}’s vassal now and pays it a fifth of its taxes`,
            ),
          );
          break;
        }
      }
    }
    const signed: SignedTreaty = {
      id,
      a,
      b,
      terms: terms.map((t) => ({ ...t })),
      ...(imposed ? { imposed: true as const } : {}),
      at: this.now,
    };
    for (const slot of [a, b]) {
      const q = (st.queue[slot] ??= []);
      q.push(signed);
      if (q.length > FRIENDS.queue) q.splice(0, q.length - FRIENDS.queue);
    }
    this.tell([a, b], {
      t: 'tsign',
      id,
      a,
      b,
      terms: terms.map((t) => ({ ...t })),
      ...(imposed ? { imposed: true as const } : {}),
      at: this.now,
    });
    this.event(
      'treaty',
      a,
      b,
      imposed
        ? `${A} imposes terms on ${B}: ${said.join('; ')}`
        : `${A} and ${B} sign a treaty: ${said.join('; ')}`,
    );
    for (const f of after) f();
    this.mark();
  }

  private addPact(a: number, b: number, kind: PactKind, extra: Partial<FriendPact> = {}): void {
    const st = this.st;
    st.pacts.push({ id: ++st.next, a, b, kind, since: this.now, ...extra });
    this.pactsChanged = true;
  }

  private dropPact(p: FriendPact): void {
    const st = this.st;
    st.pacts = st.pacts.filter((x) => x !== p);
    this.pactsChanged = true;
    this.lazy();
  }

  /** A war ends (peace): gone from the list, its cooldown starts and its ceasefire goes. */
  private endWar(w: FriendWar): void {
    const st = this.st;
    st.wars = st.wars.filter((x) => x !== w);
    st.ended[pairKey(w.a, w.b)] = this.now;
    for (const p of this.pactsOf(w.a, w.b).filter((x) => x.kind === 'ceasefire')) this.dropPact(p);
    w.state = 'ended';
    delete w.hold;
    this.announce(w, `The war between ${this.name(w.a)} and ${this.name(w.b)} is over`);
    this.lazy();
  }

  /** A ceasefire is over (it ran out, or was ended): the war is on again, its hold counting from now. */
  private resume(warId: number | undefined): void {
    const w = this.host.friends?.wars.find((x) => x.id === warId);
    if (!w || w.state !== 'ceasefire') return;
    const paused = w.paused ?? this.now;
    delete w.paused;
    const shift = Math.max(0, this.now - paused);
    if (w.hold) {
      w.hold.since += shift;
      w.hold.scored += shift;
    }
    w.state = 'open';
    this.announce(w, `The ceasefire between ${this.name(w.a)} and ${this.name(w.b)} is over: the war is on`);
    this.lazy();
  }

  // ---- Battles and the score --------------------------------------------------------------

  /** A battle the region kept or saw end (the old way, or live): one line of history, its outcome to follow. */
  battle(
    from: number,
    to: number,
    id: string,
    how: { live?: true; agree?: boolean; abandoned?: true } = {},
  ): void {
    const had = this.findBattle(from, id);
    if (had) {
      // The defender's result can reach the room before the battle's end does (the defender's sim is
      // first to finish): its line was written without the live mark, which it gains now.
      if (how.live && had.battle && !had.battle.live) {
        had.battle.live = true;
        this.tellAll({ t: 'history', event: had });
        this.lazy();
      }
      return;
    }
    const A = this.name(from);
    const B = this.name(to);
    const text = how.live
      ? `${A} and ${B} fought a live battle${how.abandoned ? ' that nobody finished' : how.agree === false ? ' (the two pages saw it end differently)' : ''}`
      : `${A} raids ${B}`;
    this.event('battle', from, to, text, {
      battle: { from, id, ...(how.live ? { live: true as const } : {}) },
    });
  }

  private findBattle(from: number, id: string): WarEvent | undefined {
    return this.host.history?.find((e) => e.battle?.from === from && e.battle.id === id);
  }

  /** How a battle ended, from its defender: the war score moves as M36's `scoreBattle` would move it. */
  result(
    slot: number,
    m: {
      id: string;
      from: number;
      to: number;
      outcome: BattleOutcome;
      decisive?: number;
      worth?: number;
      seatDown?: true;
      away?: true;
    },
  ): void {
    if (m.to !== slot || m.from === m.to) return;
    // Only a battle the region kept or fought live, once.
    if (!this.cx.battleKnown(m.from, m.to, m.id)) return;
    if (this.findBattle(m.from, m.id)?.outcome) return;
    const A = this.name(m.from);
    const B = this.name(m.to);
    const base = `${A} raided ${B}: ${outcomeWords(m.outcome)}`;
    const w = this.warOf(m.from, m.to);
    const key = `${m.from}:${m.id}`;
    let score: number | undefined;
    if (w && w.state === 'open' && this.now >= w.opens && !w.counted?.includes(key)) {
      const S = DIPLOMACY.score;
      const attackerWon = m.outcome === 'raided';
      const pts = S.battleMin + (S.battleMax - S.battleMin) * clamp(m.decisive ?? 0, 0, 1);
      // From the attacker's side: the win or loss, and the defender's buildings lost.
      const forAttacker = (attackerWon ? pts : -pts) + clamp(m.worth ?? 0, 0, 5e7) / S.damagePer;
      w.score = clamp(round1(w.score + (w.a === m.from ? forAttacker : -forAttacker)), -100, 100);
      w.battles++;
      w.counted = [...(w.counted ?? []), key].slice(-FRIENDS.counted);
      score = w.score;
      this.mark();
    }
    const text =
      w && score !== undefined
        ? `${base}. War score: ${this.name(w.a)} ${score > 0 ? '+' : ''}${score}`
        : base;
    const seen = this.findBattle(m.from, m.id);
    if (seen) {
      seen.outcome = m.outcome;
      seen.text = text;
      if (w && score !== undefined) {
        seen.score = score;
        seen.war = w.id;
      }
      this.tellAll({ t: 'history', event: seen });
      this.lazy();
    } else
      this.event('battle', m.from, m.to, text, {
        battle: { from: m.from, id: m.id },
        outcome: m.outcome,
        ...(w && score !== undefined ? { score, war: w.id } : {}),
      });
    if (w && score !== undefined) {
      this.afterBattle(w, m);
      // Told as it now stands (a capitulation or a hold may have followed the battle).
      if (this.host.friends?.wars.includes(w)) this.announce(w);
    }
    this.settle();
  }

  /** The seat of power, a vassal's freedom and capitulation, after a battle was counted. */
  private afterBattle(
    w: FriendWar,
    m: { from: number; to: number; outcome: BattleOutcome; seatDown?: true; away?: true },
  ): void {
    const attackerWon = m.outcome === 'raided';
    // A battle won by the other side than the holder breaks the hold.
    if (w.hold && (attackerWon ? m.from : m.to) !== w.hold.by) {
      const by = w.hold.by;
      delete w.hold;
      this.event(
        'hold',
        w.a,
        w.b,
        `${this.name(by === w.a ? w.b : w.a)} wins a battle and takes back its seat of power`,
        { war: w.id },
      );
    }
    if (w.scale === 'total' && m.seatDown && attackerWon && !w.hold && !m.away) {
      w.hold = { by: m.from, since: this.now, scored: this.now };
      const H = this.name(m.from);
      const L = this.name(m.to);
      this.event(
        'hold',
        m.from,
        m.to,
        `${H} holds ${L}’s seat of power: in ${timeWords(DIPLOMACY.conquestHours * FRIENDS.hour)} ${L} falls, unless it wins a battle`,
        { war: w.id },
      );
      this.tellAll({ t: 'notice', text: `${H} holds ${L}’s seat of power` }, [w.a, w.b]);
    }
    // A vassal that rises and reaches +30 in its rising is free.
    if (w.rebellion) {
      const link = this.linkOf(w.a, w.b);
      if (link) {
        const score = link.vassal === w.a ? w.score : -w.score;
        if (score >= FRIENDS.freeAt) {
          delete w.rebellion;
          this.sign(`w${w.id}-free`, link.vassal, link.overlord, [{ k: 'independence' }], true);
        }
      }
    }
    this.checkCapitulation(w);
  }

  private checkCapitulation(w: FriendWar): void {
    // A seat of power held is settled by the hold, not the score.
    if (w.state !== 'open' || w.hold) return;
    const cap = DIPLOMACY.score.capitulate;
    const by = w.score <= cap ? w.a : w.score >= -cap ? w.b : 0;
    if (!by) return;
    const winner = by === w.a ? w.b : w.a;
    w.state = 'capitulated';
    w.capitulated = { by, at: this.now };
    const text = `${this.name(by)} capitulates to ${this.name(winner)}: ${this.name(winner)} may set its terms within ${timeWords(FRIENDS.terms)}${w.scale === 'total' ? ', and may take it as a vassal' : ''}`;
    this.event('capitulated', by, winner, text, { war: w.id });
    this.announce(w, text);
    this.tellAll({ t: 'notice', text }, [w.a, w.b]);
    this.mark();
  }

  /** A seat of power held long enough: the city falls to the holder, as its vassal where that can be. */
  private conquer(w: FriendWar): void {
    const h = w.hold!;
    const winner = h.by;
    const loser = winner === w.a ? w.b : w.a;
    const W = this.name(winner);
    const L = this.name(loser);
    const terms: FriendTerm[] = [{ k: 'peace' }];
    const risen = this.vassalOf(winner);
    if (risen?.overlord === loser) terms.push({ k: 'independence' });
    else if (!this.vassalOf(winner) && !this.vassalOf(loser) && !this.linkOf(winner, loser))
      terms.push({ k: 'vassal' });
    this.tellAll({ t: 'notice', text: `${L} falls to ${W}` }, [w.a, w.b]);
    this.sign(`w${w.id}-fall`, winner, loser, terms, true);
  }

  // ---- Time -------------------------------------------------------------------------------

  /** What time has done since the room last looked: wars open, ceasefires and pacts run out, proposals lapse. */
  tick(): void {
    const st = this.host.friends;
    if (!st) return;
    const now = this.now;
    for (const p of [...st.pacts]) {
      if (p.until === undefined || now < p.until || !st.pacts.includes(p)) continue;
      this.dropPact(p);
      if (p.kind === 'ceasefire') this.resume(p.war);
      this.event(
        p.kind === 'ceasefire' ? 'ceasefire' : 'ended',
        p.a,
        p.b,
        `The ${PACT_NAMES[p.kind]} between ${this.name(p.a)} and ${this.name(p.b)} has run its course`,
      );
    }
    for (const w of [...st.wars]) {
      if (!st.wars.includes(w)) continue;
      if (w.state === 'declared' && now >= w.opens) {
        w.state = 'open';
        const text = `The war between ${this.name(w.a)} and ${this.name(w.b)} has begun`;
        this.event('opened', w.a, w.b, text, { war: w.id });
        this.announce(w, text);
        this.lazy();
      }
      if (w.state === 'open' && w.hold) this.accrue(w);
      else if (w.state === 'open') this.checkCapitulation(w);
      if (w.state === 'capitulated' && w.capitulated && now - w.capitulated.at >= FRIENDS.terms) {
        // The winner set no terms in time: plain peace.
        const loser = w.capitulated.by;
        this.sign(`w${w.id}-peace`, loser === w.a ? w.b : w.a, loser, [{ k: 'peace' }], true);
      }
    }
    for (const p of [...st.proposals])
      if (now >= p.expires) {
        st.proposals = st.proposals.filter((x) => x !== p);
        st.done = [...st.done, p.id].slice(-FRIENDS.done);
        this.tell([p.from], { t: 'trefused', id: p.id, why: 'That proposal ran out', expired: true });
        this.lazy();
      }
    this.settle();
  }

  /** The seat of power held counts a point a game hour (the score), and conquers after 48 of them. */
  private accrue(w: FriendWar): void {
    const h = w.hold!;
    const hours = Math.floor((this.now - h.scored) / FRIENDS.hour);
    if (hours > 0) {
      // Not written promptly: the score is carried in the war, saved with whatever is saved next.
      w.score = clamp(
        round1(w.score + DIPLOMACY.score.holdPerHour * hours * (h.by === w.a ? 1 : -1)),
        -100,
        100,
      );
      h.scored += hours * FRIENDS.hour;
    }
    if (this.now - h.since >= DIPLOMACY.conquestHours * FRIENDS.hour) this.conquer(w);
  }

  /** The region turned war off: every war ends in plain peace. */
  warOff(): void {
    const st = this.host.friends;
    if (!st) return;
    for (const w of [...st.wars]) this.sign(`w${w.id}-off`, w.a, w.b, [{ k: 'peace' }], true);
    this.settle();
  }

  // ---- What the room asks ------------------------------------------------------------------

  /** Is a war open between these two now (raids between them aren't held back by the newcomer shield)? */
  atWar(p: number, q: number): boolean {
    const w = this.warOf(p, q);
    return !!w && w.state === 'open' && this.now >= w.opens;
  }

  /**
   * Why `from` may not raid `target` for friends' diplomacy, or null: a war that hasn't opened, a
   * ceasefire, a capitulation, a pact that binds, a vassal's duty.
   */
  raidBlock(from: number, target: number): string | null {
    if (!this.host.friends) return null;
    const T = this.name(target);
    const w = this.warOf(from, target);
    if (w) {
      if (w.state === 'declared') return `The war with ${T} opens in ${timeWords(w.opens - this.now)}`;
      if (w.state === 'ceasefire') return `There is a ceasefire with ${T}`;
      if (w.state === 'capitulated')
        return w.capitulated?.by === from
          ? `The city capitulated to ${T}`
          : `${T} has capitulated: set your terms`;
    }
    const own = this.vassalOf(from);
    if (own && own.overlord !== target)
      return 'A vassal sends no forces, except to rise against its overlord';
    if (this.linkOf(from, target) && !(w && w.state === 'open'))
      return own ? 'A vassal sends no forces, except to rise against its overlord' : `${T} is your vassal`;
    for (const p of this.pactsOf(from, target))
      if (BINDING.includes(p.kind)) return `That breaks your ${PACT_NAMES[p.kind]} with ${T}: end it first`;
    return null;
  }

  /** What a city is told when it joins, and the messages that follow (proposals to answer, treaties to apply). */
  welcome(slot: number): { info: FriendsWelcome; after: FriendsRoomMsg[] } {
    const st = this.host.friends ?? emptyFriends();
    const after: FriendsRoomMsg[] = [];
    for (const p of st.proposals)
      if (p.to === slot)
        after.push({
          t: 'tprop',
          id: p.id,
          from: p.from,
          to: p.to,
          terms: p.terms.map((t) => ({ ...t })),
          made: p.made,
          expires: p.expires,
          at: this.now,
        });
    for (const s of st.queue[slot] ?? [])
      after.push({
        t: 'tsign',
        id: s.id,
        a: s.a,
        b: s.b,
        terms: s.terms.map((t) => ({ ...t })),
        ...(s.imposed ? { imposed: true as const } : {}),
        at: s.at,
      });
    return {
      info: {
        now: this.now,
        wars: st.wars.map(warView),
        pacts: st.pacts.map((p) => ({ ...p })),
        vassals: st.vassals.map((v) => ({ ...v })),
        proposals: st.proposals
          .filter((p) => p.from === slot)
          .map((p) => ({ ...p, terms: p.terms.map((t) => ({ ...t })) })),
        history: (this.host.history ?? []).map((e) => ({ ...e })),
      },
      after,
    };
  }
}
