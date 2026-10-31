/**
 * Wars and treaties between friends, the page's part (M39 step 5b, `docs/plans/M39-design.md` calls 9
 * and 10). The region room keeps the truth: a declaration, a war's score, a treaty, a pact, a vassal.
 * This page does four things with it:
 *
 * - asks: it sends the player's declaration, proposal, answer and pact ending (`wdeclare`, `tprop`,
 *   `tans`, `tbreak`) and keeps the room's refusals in plain words for the control they belong to;
 * - mirrors: what the room says (a war's state, the pacts and vassals, a treaty signed) reaches the
 *   city's own sim as page-only commands (`friendWar`, `friendPacts`, `friendTreaty`), each applied
 *   again when the room says it again and a treaty once; the city is saved before the room hears it
 *   was seen (`tseen`), so closing the page never loses a treaty;
 * - reports: the city's end of a friend's raid says how it went (`battleResult`), which moves the
 *   war's score, sent again for a while until the room's history shows it counted;
 * - remembers what the player's tab shows: the wars, pacts, vassals, proposals and history as this
 *   page knows them (`view()`).
 *
 * Times from the room are on its clock (ms); `roomNow()` carries the clock forward from the latest
 * word that had one.
 */
import type { Command, CommandResult } from '../sim/commands';
import type { FriendWarFacts } from '../sim/systems/friendsWar';
import { RAIDS } from '../data/battle';
import { UNKNOWN_FRIEND, TREATY_TAKEN, raidVerdictWhy } from '../data/diplomacy';
import {
  FRIENDS,
  termsFor,
  type BattleOutcome,
  type FriendPact,
  type FriendScale,
  type FriendTerm,
  type FriendWar,
  type FriendsWelcome,
  type Vassal,
  type WarEvent,
} from '../../relay/protocol';
import type { RegionRoomMsg } from '../../relay/region';
import { roomBattleId, type FriendsSink, type RegionLink } from '../net/regionLink';
import { cleanEvent, mergeHistory } from './regionHistory';

/** What the city's game offers this helper. */
export interface FriendsHost {
  command(cmd: Command): Promise<CommandResult>;
  query<T>(q: {
    type: 'friendTerms';
    slot: number;
    terms: unknown[];
    imposed?: boolean;
    side?: 'a' | 'b';
  }): Promise<T>;
  /** The city saved as it stands (so a treaty applied is never lost); whether it was. */
  keep(): Promise<boolean>;
  notice(key: string, text: string, tone: 'info' | 'ok' | 'bad'): void;
  /** The page's clock (ms). */
  now(): number;
  changed(): void;
  /** A fresh proposal id (the room wants `[\w-]{1,40}`). */
  newId?(slot: number): string;
}

/** A battle's result waiting for the room's history to show it counted. */
interface Result {
  id: string;
  from: number;
  outcome: BattleOutcome;
  decisive: number;
  worth: number;
  seatDown: boolean;
  away: boolean;
  sent: number;
  tries: number;
}

/** A proposal put to this city, or by it, as the page keeps it. */
export interface KeptProposal {
  id: string;
  /** The other city's place. */
  with: number;
  /** The terms as the proposer reads them ('us' is the proposer). */
  terms: FriendTerm[];
  imposed?: true;
  /** The room's ms. */
  made: number;
  expires: number;
}

/** What the tab shows of a war, pact or proposal (a copy). */
export interface FriendsView {
  /** The room's clock now (ms), and this city's place. */
  now: number;
  me: number;
  wars: FriendWar[];
  pacts: FriendPact[];
  vassals: Vassal[];
  incoming: KeptProposal[];
  outgoing: KeptProposal[];
  history: WarEvent[];
  /** The room's last refusal for a control, in words: `war:SLOT`, `terms:SLOT`, `pact`. */
  refusals: Record<string, string>;
}

const RETRY_MS = 5_000;
const RESULT_TRIES = 4;

export class FriendsWarClient implements FriendsSink {
  private link: RegionLink | null = null;
  private wars = new Map<number, FriendWar>();
  private pacts: FriendPact[] = [];
  private vassals: Vassal[] = [];
  private incoming = new Map<string, KeptProposal>();
  private outgoing = new Map<string, KeptProposal>();
  private history: WarEvent[] = [];
  private refusals = new Map<string, string>();
  /** The room's clock as of the latest word that had it, and this page's clock then. */
  private clock = { at: 0, recv: 0 };
  /** What has been mirrored into the sim: a war's signature by the room's number, and the pacts' as a whole. */
  private applied = new Map<number, string>();
  private appliedPacts = '';
  /** The room has told this page its whole state since the link came up. */
  private synced = false;
  /** The room answered the welcome with no word on friends: it is of a version that keeps none (protocol 5). */
  private unsupported = false;
  /** Treaties applied (and acknowledged, or about to be), by id. */
  private treaties = new Set<string>();
  private busy = new Set<string>();
  private results: Result[] = [];
  /** Whom a proposal or an answer this page sent was about (by the proposal's id), to place the room's refusal of it. */
  private about = new Map<string, number>();
  /** Words in order: each is handled after the one before it. */
  private chain: Promise<void> = Promise.resolve();
  private mirroring = false;
  private again = false;
  private lastOpen = '';
  private seq = 0;

  constructor(private readonly host: FriendsHost) {}

  // ---- Wiring -------------------------------------------------------------------------------

  attach(link: RegionLink): void {
    this.detach();
    this.link = link;
    link.friends = this;
  }

  detach(): void {
    if (this.link) {
      this.link.friends = null;
      this.link.atWar = new Set();
    }
    this.link = null;
    this.wars.clear();
    this.pacts = [];
    this.vassals = [];
    this.incoming.clear();
    this.outgoing.clear();
    this.history = [];
    this.refusals.clear();
    this.applied.clear();
    this.appliedPacts = '';
    this.synced = false;
    this.unsupported = false;
    this.about.clear();
    this.results = [];
    this.lastOpen = '';
    this.host.changed();
  }

  /** This city's place in the region (0 when it isn't in one). */
  get me(): number {
    return this.link?.slot ?? 0;
  }

  /** The room's clock now (ms). */
  roomNow(): number {
    return this.clock.at + (this.host.now() - this.clock.recv);
  }

  private stamp(at: number | undefined): void {
    if (typeof at === 'number') this.clock = { at, recv: this.host.now() };
  }

  /** The places of the cities this one is at war with now (the war is open: the room lets them raid each other). */
  openWith(): Set<number> {
    const me = this.me;
    const out = new Set<number>();
    for (const w of this.wars.values())
      if (w.state === 'open' && (w.a === me || w.b === me)) out.add(w.a === me ? w.b : w.a);
    return out;
  }

  /** Is the war with this city open now? */
  atWar(slot: number): boolean {
    return this.openWith().has(slot);
  }

  private nameOf(slot: number): string {
    return this.link?.view?.cities.find((c) => c.slot === slot)?.name ?? 'A neighbour';
  }

  // ---- What the tab reads -------------------------------------------------------------------

  view(): FriendsView {
    const copy = <T>(x: T): T => structuredClone(x);
    return {
      now: this.roomNow(),
      me: this.me,
      wars: [...this.wars.values()].map(copy),
      pacts: this.pacts.map(copy),
      vassals: this.vassals.map(copy),
      incoming: [...this.incoming.values()].map(copy),
      outgoing: [...this.outgoing.values()].map(copy),
      history: this.history.map(copy),
      refusals: Object.fromEntries(this.refusals),
    };
  }

  /** The room's last refusal for a control, or null. */
  refusal(key: string): string | null {
    return this.refusals.get(key) ?? null;
  }

  clearRefusal(key: string): void {
    if (this.refusals.delete(key)) this.host.changed();
  }

  // ---- The room's words ----------------------------------------------------------------------

  welcome(info: FriendsWelcome | undefined): void {
    if (!info) {
      // A room that doesn't speak wars between friends (protocol 5): nothing to keep, and nothing will come
      // (the panel says so, rather than that it is still asking).
      this.synced = false;
      this.unsupported = true;
      this.host.changed();
      return;
    }
    this.enqueue(async () => {
      this.stamp(info.now);
      this.wars = new Map(info.wars.map((w) => [w.id, structuredClone(w)]));
      this.pacts = info.pacts.map((p) => ({ ...p }));
      this.vassals = info.vassals.map((v) => ({ ...v }));
      // Merged, not replaced: ids only grow, and an event heard while the welcome was being taken is not lost.
      this.history = mergeHistory(this.history, info.history);
      // The proposals this city made and had no answer to are the room's list; its own sends that never got
      // there are gone with the link.
      this.outgoing = new Map(
        info.proposals.map((p) => [
          p.id,
          { id: p.id, with: p.to, terms: structuredClone(p.terms), made: p.made, expires: p.expires },
        ]),
      );
      this.incoming.clear();
      this.synced = true;
      this.unsupported = false;
      this.applied.clear();
      this.appliedPacts = '';
      await this.mirror();
      this.afterChange();
      // Results the room hasn't shown counted are sent again.
      for (const r of this.results) r.sent = 0;
      this.pump();
    });
  }

  message(m: RegionRoomMsg): void {
    this.enqueue(() => this.handle(m));
  }

  viewChanged(): void {
    // A friend that wasn't a neighbour yet may be one now: what failed for that is tried again.
    if (this.synced) this.enqueue(() => this.mirror());
  }

  private enqueue(fn: () => Promise<void>): void {
    this.chain = this.chain.then(fn).catch(() => undefined);
  }

  private async handle(m: RegionRoomMsg): Promise<void> {
    const me = this.me;
    switch (m.t) {
      case 'war': {
        this.stamp(m.at);
        const w = structuredClone(m.war);
        if (w.state === 'ended') {
          this.wars.delete(w.id);
          // Told to the sim at once (the war is over there), then forgotten.
          await this.applyWar(w);
          this.applied.delete(w.id);
        } else {
          this.wars.set(w.id, w);
          await this.mirror();
        }
        this.afterChange();
        return;
      }
      case 'wrefused':
        this.refusals.set(`war:${m.to}`, m.why);
        // A pact is in the way: the player is asked, and sends it again with `breakPact`.
        if (m.breaks) this.refusals.set(`warBreaks:${m.to}`, m.why);
        this.host.notice(`fw-refused:war:${m.to}:${m.why}`, m.why, 'info');
        this.host.changed();
        return;
      case 'tprop': {
        this.stamp(m.at);
        if (m.to !== me) return;
        const fresh = !this.incoming.has(m.id);
        this.incoming.set(m.id, {
          id: m.id,
          with: m.from,
          terms: structuredClone(m.terms),
          made: m.made,
          expires: m.expires,
        });
        if (fresh)
          this.host.notice(
            `fw-prop:${m.id}`,
            `${this.nameOf(m.from)} proposes a treaty: ${this.termsWords(termsFor(m.terms, 'b'), m.from)}. Answer it in the war room’s Diplomacy tab.`,
            'info',
          );
        this.host.changed();
        return;
      }
      case 'tsign':
        this.stamp(m.at);
        await this.treaty(m);
        return;
      case 'trefused': {
        // A proposal of this city's turned down, declined, or run out; or an answer or a pact ending refused.
        const mine = this.outgoing.get(m.id);
        const theirs = this.incoming.get(m.id);
        const who = mine?.with ?? theirs?.with ?? this.about.get(m.id);
        const key = who !== undefined ? `terms:${who}` : 'pact';
        this.outgoing.delete(m.id);
        this.incoming.delete(m.id);
        this.refusals.set(key, m.why);
        this.host.notice(`fw-trefused:${m.id}:${m.why}`, m.why, m.declined ? 'bad' : 'info');
        this.host.changed();
        return;
      }
      case 'pacts':
        this.stamp(m.at);
        this.pacts = m.pacts.map((p) => ({ ...p }));
        this.vassals = m.vassals.map((v) => ({ ...v }));
        await this.mirror();
        this.afterChange();
        return;
      case 'history': {
        // (The region's history, merged as the City history panel reads it: `regionHistory.ts`.)
        const e = cleanEvent(m.event);
        if (!e) return;
        this.history = mergeHistory(this.history, [e]);
        // A battle counted: its result needn't be sent again.
        if (e.battle && e.outcome)
          this.results = this.results.filter((r) => !(r.id === e.battle!.id && r.from === e.battle!.from));
        // A pact a friend broke, or that ran its course, in words.
        if (
          e.kind === 'broken'
            ? e.b === me
            : (e.kind === 'ended' || e.kind === 'ceasefire') && (e.a === me || e.b === me)
        )
          this.host.notice(`fw-hist:${e.id}`, e.text, 'info');
        this.host.changed();
        return;
      }
      default:
        return;
    }
  }

  /** The state that follows a change: who this city is at war with now, to the link, and the tab redrawn. */
  private afterChange(): void {
    const open = [...this.openWith()].sort((a, b) => a - b);
    const sig = open.join(',');
    if (this.link) this.link.atWar = new Set(open);
    if (sig !== this.lastOpen) {
      this.lastOpen = sig;
      // The region's news for the sim says whether a friend may be raided: it changes with a war opening.
      this.link?.refresh();
    }
    this.host.changed();
  }

  // ---- Mirroring into the sim -----------------------------------------------------------------

  /** A war as the sim's mirror reads it, from this city's side; null when this city isn't in it. */
  private factsOf(w: FriendWar): FriendWarFacts | null {
    const me = this.me;
    if (me !== w.a && me !== w.b) return null;
    const a = me === w.a;
    return {
      room: w.id,
      slot: a ? w.b : w.a,
      by: a ? 'us' : 'them',
      scale: w.scale,
      reason: w.reason,
      state: w.state,
      score: a ? w.score : -w.score,
      battles: w.battles,
      ...(w.rebellion ? { rebellion: true as const } : {}),
      ...(w.hold ? { hold: w.hold.by === me ? ('us' as const) : ('them' as const) } : {}),
      ...(w.capitulated
        ? { capitulated: w.capitulated.by === me ? ('us' as const) : ('them' as const) }
        : {}),
      ...(w.state === 'declared' ? { opensIn: Math.max(0, w.opens - this.roomNow()) } : {}),
    };
  }

  private async applyWar(w: FriendWar): Promise<boolean> {
    const facts = this.factsOf(w);
    if (!facts) return true;
    const sig = JSON.stringify({ ...facts, opensIn: undefined });
    if (this.applied.get(w.id) === sig) return true;
    const r = await this.host.command({ type: 'friendWar', ...facts });
    if (r.ok) {
      this.applied.set(w.id, sig);
      return true;
    }
    return r.reason !== UNKNOWN_FRIEND ? true : false;
  }

  /** The wars and pacts as they stand, into the sim: what changed since last time, in one pass at a time. */
  private async mirror(): Promise<void> {
    if (this.mirroring) {
      this.again = true;
      return;
    }
    this.mirroring = true;
    try {
      do {
        this.again = false;
        for (const w of [...this.wars.values()]) await this.applyWar(w);
        await this.mirrorPacts();
      } while (this.again);
    } finally {
      this.mirroring = false;
    }
    this.host.changed();
  }

  private async mirrorPacts(): Promise<void> {
    const me = this.me;
    if (!me || !this.synced) return;
    const mine = this.pacts.filter((p) => p.a === me || p.b === me);
    const facts = {
      me,
      pacts: mine.map((p) => ({
        room: p.id,
        slot: p.a === me ? p.b : p.a,
        kind: p.kind,
        ...(p.until !== undefined && p.kind === 'ceasefire'
          ? { hours: Math.max(1, Math.round((p.until - p.since) / FRIENDS.hour)) }
          : {}),
        ...(p.until !== undefined && p.kind === 'nonAggression'
          ? { months: Math.max(1, Math.round((p.until - p.since) / FRIENDS.month)) }
          : {}),
      })),
      vassals: this.vassals
        .filter((v) => v.vassal === me || v.overlord === me)
        .map((v) => ({ vassal: v.vassal, overlord: v.overlord })),
      wars: [...this.wars.values()].filter((w) => w.a === me || w.b === me).map((w) => w.id),
    };
    const sig = JSON.stringify(facts);
    if (sig === this.appliedPacts) return;
    const r = await this.host.command({ type: 'friendPacts', ...facts });
    // Applied whole unless some friend isn't a neighbour yet (then again at the next view).
    if (r.ok && !(r.info as { pending?: number } | undefined)?.pending) this.appliedPacts = sig;
  }

  /** A treaty signed: this city's sim applies it once, the city is saved, and the room hears it was seen. */
  private async treaty(m: Extract<RegionRoomMsg, { t: 'tsign' }>): Promise<void> {
    const me = this.me;
    if (m.a !== me && m.b !== me) return;
    // The room's word about this proposal is over.
    this.outgoing.delete(m.id);
    this.incoming.delete(m.id);
    if (this.busy.has(m.id)) return;
    this.busy.add(m.id);
    try {
      if (!this.treaties.has(m.id)) {
        const side = m.a === me ? ('a' as const) : ('b' as const);
        const r = await this.host.command({
          type: 'friendTreaty',
          id: m.id,
          slot: side === 'a' ? m.b : m.a,
          side,
          terms: m.terms,
          ...(m.imposed ? { imposed: true as const } : {}),
        });
        // Not a neighbour yet: the room sends it again (and the view's change tries it now).
        if (!r.ok && r.reason !== TREATY_TAKEN) return;
        // Saved before the room is told, so closing the page never loses it.
        if (!(await this.host.keep())) return;
        this.treaties.add(m.id);
        if (this.treaties.size > 64) this.treaties.delete(this.treaties.values().next().value as string);
      }
      this.link?.sendFriends({ t: 'tseen', id: m.id });
      // (The pacts it made come in the room's `pacts`, mirrored when they do.)
      await this.mirror();
      this.afterChange();
    } finally {
      this.busy.delete(m.id);
    }
  }

  // ---- The player's moves ----------------------------------------------------------------------

  /** Declare war on the city in this place. The room's word comes back as a war (or `refusal('war:SLOT')`). */
  declare(to: number, scale: FriendScale, reason: string, breakPact = false): boolean {
    this.refusals.delete(`war:${to}`);
    this.refusals.delete(`warBreaks:${to}`);
    const sent = !!this.link?.sendFriends({
      t: 'wdeclare',
      to,
      scale,
      reason: reason.trim().slice(0, FRIENDS.reasonMax),
      ...(breakPact ? { breakPact: true as const } : {}),
    });
    if (!sent) this.refusals.set(`war:${to}`, 'Not connected to the region right now: try again in a moment');
    this.host.changed();
    return sent;
  }

  /** Put terms to the city in this place (the winner of a capitulation: `imposed`). Whether it was sent, and its id. */
  propose(to: number, terms: FriendTerm[], imposed = false): { sent: boolean; id: string } {
    this.refusals.delete(`terms:${to}`);
    const id =
      this.host.newId?.(this.me) ??
      `p${this.me}-${(++this.seq).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const sent = !!this.link?.sendFriends({
      t: 'tprop',
      id,
      to,
      terms,
      ...(imposed ? { imposed: true as const } : {}),
    });
    if (!sent)
      this.refusals.set(`terms:${to}`, 'Not connected to the region right now: try again in a moment');
    else {
      this.about.set(id, to);
    }
    if (sent && !imposed) {
      const now = this.roomNow();
      this.outgoing.set(id, { id, with: to, terms, made: now, expires: now + FRIENDS.proposal });
    }
    this.host.changed();
    return { sent, id };
  }

  /** Answer a proposal a friend put to this city. A problem on this side (money) is said at once and nothing is sent. */
  async answer(id: string, accept: boolean): Promise<string | null> {
    const p = this.incoming.get(id);
    if (!p) return 'That proposal is gone';
    if (accept) {
      const why = await this.host.query<string | null>({
        type: 'friendTerms',
        slot: p.with,
        terms: p.terms,
        side: 'b',
      });
      if (why) return why;
    }
    if (!this.link?.sendFriends({ t: 'tans', id, accept })) return 'Not connected to the region right now';
    this.about.set(id, p.with);
    this.incoming.delete(id);
    this.host.changed();
    return null;
  }

  /** End a pact with a friend: the city's word is spent first if it breaks it (the sim), then the region is asked. */
  async endPact(pact: { id: number; room: number }, breakPact: boolean): Promise<CommandResult> {
    const r = await this.host.command({ type: 'endPact', pact: pact.id, breakPact });
    if (!r.ok) return r;
    this.refusals.delete('pact');
    if (!this.link?.sendFriends({ t: 'tbreak', pact: pact.room })) {
      this.refusals.set('pact', 'Not connected to the region right now: try again in a moment');
      this.host.changed();
    }
    return r;
  }

  // ---- Reporting -------------------------------------------------------------------------------

  /** The city's events: a friend's raid that ended says how it went to the region. */
  events(events: readonly { kind: string; info?: Record<string, string | number> }[] | undefined): void {
    if (!events?.length || !this.link) return;
    for (const e of events) {
      if (e.kind !== 'battleEnded') continue;
      const i = e.info;
      if (
        !i ||
        typeof i.friendSlot !== 'number' ||
        typeof i.friendBattle !== 'string' ||
        i.friendScored !== 1
      )
        continue;
      const outcome = i.outcome;
      if (outcome !== 'raided' && outcome !== 'repelled' && outcome !== 'withdrew') continue;
      const id = roomBattleId(i.friendBattle);
      if (this.results.some((r) => r.id === id && r.from === i.friendSlot)) continue;
      this.results.push({
        id,
        from: i.friendSlot,
        outcome,
        decisive: Number(i.friendDecisive) || 0,
        worth: Number(i.friendWorth) || 0,
        seatDown: i.friendSeatDown === 1,
        away: i.friendAway === 1,
        sent: 0,
        tries: 0,
      });
      if (this.results.length > 16) this.results.shift();
    }
    this.pump();
  }

  /**
   * Called about once a second: results are sent (and sent again until the room's history shows them
   * counted, a few times), and what couldn't be mirrored yet is tried again.
   */
  pump(): void {
    const link = this.link;
    if (!link || link.state !== 'in') return;
    const now = this.host.now();
    for (const r of [...this.results]) {
      if (r.sent && now - r.sent < RETRY_MS) continue;
      if (r.tries >= RESULT_TRIES) {
        this.results = this.results.filter((x) => x !== r);
        continue;
      }
      r.sent = now;
      r.tries++;
      link.sendFriends({
        t: 'battleResult',
        id: r.id,
        from: r.from,
        to: this.me,
        outcome: r.outcome,
        ...(r.decisive > 0 ? { decisive: Math.round(r.decisive * 1000) / 1000 } : {}),
        ...(r.worth > 0 ? { worth: r.worth } : {}),
        ...(r.seatDown ? { seatDown: true as const } : {}),
        ...(r.away ? { away: true as const } : {}),
      });
    }
    if (this.synced && (this.wars.size || this.pacts.length)) this.enqueue(() => this.mirror());
  }

  // ---- Words ------------------------------------------------------------------------------------

  /** Terms in words as this city reads them ('us' is this city), for a notice or a card. */
  termsWords(terms: readonly FriendTerm[], other: number): string {
    return friendTermsWords(terms, this.nameOf(other));
  }

  /** The state the test API shows. */
  snapshot(): FriendsView & { results: number; synced: boolean; unsupported: boolean; treaties: string[] } {
    return {
      ...this.view(),
      results: this.results.length,
      synced: this.synced,
      unsupported: this.unsupported,
      treaties: [...this.treaties],
    };
  }
}

/**
 * What a "too young or small" refusal means, in the words a player needs: the room says a newcomer is
 * protected, and this says until when (a sentence to put after the refusal; nothing for any other).
 */
export function newcomerNote(why: string | null | undefined): string {
  return why && /too young or small/.test(why)
    ? ` A city is protected as a newcomer until it has ${RAIDS.minPopulation.toLocaleString('en-US')} residents and has been going for ${RAIDS.minMonths === 12 ? 'a year' : `${RAIDS.minMonths} months`}.`
    : '';
}

/** What the Send tab says a raid on a friend's city will be (M39): how it is fought, or why it can't be. */
export interface RaidNote {
  /** `live`: both players command it; `saved`: against the region's copy, waiting for the player; `refused`: the region won't have it. */
  kind: 'live' | 'saved' | 'refused';
  text: string;
}

/**
 * The note under the Send tab's town picker for a friend's city, from the region's verdict on raiding it
 * (`raid`, as the room decides it: the sim refuses a force on the same words) and whether its player is
 * here. A battle is live or a saved copy only when the verdict is `open`; a newcomer, a neutral city,
 * one raided out for the day, or (in a region on someone's computer) a player who is away is refused.
 * A region at peace gives no verdict: then only whether the player is here is known.
 */
export function raidNote(name: string, p: { online: boolean; raid?: string }): RaidNote {
  const why = raidVerdictWhy(p.raid, name);
  if (why) return { kind: 'refused', text: `${why}.${newcomerNote(why)}` };
  return p.online
    ? {
        kind: 'live',
        text: `${name}’s player is here, so the battle is live: you both command it on the battle map (the O key) as it is fought.`,
      }
    : {
        kind: 'saved',
        text: `${name}’s player is away: the battle is fought against their city as the region last saw it, with at most half the usual damage, and waits for them.`,
      };
}

const money = (v: number) =>
  `$${Math.round(v)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

/** One term in words, as the city it is read by ('us') would put it. */
export function friendTermWords(t: FriendTerm, other: string): string {
  const who = (p: 'us' | 'them') => (p === 'us' ? 'the city' : other);
  switch (t.k) {
    case 'ceasefire':
      return `a ceasefire for ${t.hours} hours`;
    case 'peace':
      return 'peace';
    case 'reparations':
      return `${who(t.payer)} pays ${money(t.amount)} in reparations`;
    case 'tribute':
      return `${who(t.payer)} pays ${money(t.amount)} a month for ${t.months} months`;
    case 'nonAggression':
      return `a non-aggression pact for ${t.months} months`;
    case 'alliance':
      return 'an alliance';
    case 'defensivePact':
      return 'a defensive pact';
    case 'embargo':
      return 'an embargo on trade';
    case 'trade':
      return 'a trade agreement';
    case 'independence':
      return 'the vassal goes free';
    case 'vassal':
      return `${other} becomes the vassal of the winner`;
  }
}

export function friendTermsWords(terms: readonly FriendTerm[], other: string): string {
  return terms.map((t) => friendTermWords(t, other)).join('; ');
}
