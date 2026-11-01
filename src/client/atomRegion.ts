/**
 * The atom bomb among friends, the page's part (M40 step 10, `docs/plans/M40-design.md` calls 12, 16
 * and 17). The region room keeps the truth of the race, the nuclear winters and who finished first, and
 * a friend's cloud arrives in the report. This page does four things with it:
 *
 * - cleans: the room's lists are checked again before anything is done with them (`cleanAtomMarks`,
 *   `cleanWinters`), because a region that runs in a player's browser has a host that is not trusted;
 * - mirrors: each new winter id becomes the page-only command `friendWinter` once, the room's word that
 *   this city finished the bomb first becomes `atomFirst` (the achievement's fact), and each friend's
 *   cloud towards this city (from the region's news) becomes `friendFallout`; all idempotent in the sim,
 *   so a message heard again, a reload, or a page that missed some changes nothing;
 * - keeps the region's record of the bomb for the war room and the region's history to draw (`atoms`);
 * - tells the region at once when the city's own race stage changes (`frame`), rather than waiting for
 *   the next of its reports, so the others see the plant go up, the fuel begin and the bomb ready as
 *   it happens.
 *
 * The strike itself (a prepared bomb put to the room, and a kept one arriving here) is not here: it
 * rides the operations road (`ops.ts`, `Game.takeOp`).
 */
import type { Command, CommandResult } from '../sim/commands';
import type { RegionUpdate } from '../sim/systems/region';
import { ATOM_MARK_KINDS, ATOM_WIRE, atomStageNo, winterIdOk, type AtomStage } from '../data/atom';
import type { RegionAtomMark, RegionRoomMsg, RegionWinter } from '../../relay/region';
import type { AtomSink, RegionLink } from '../net/regionLink';

/** What the city's game offers this helper. */
export interface AtomHost {
  command(cmd: Command): Promise<CommandResult>;
  /** The page's clock (ms). */
  now(): number;
  changed(): void;
}

/** The least time (ms) between two reports asked for by a stage change: the room takes a few messages a second. */
const ASK_GAP = 5_000;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const whole = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/**
 * The region's record of the bomb as this page takes it: the marks that are well formed (a place, a
 * name of 40 characters at most, a kind, a time), the last `ATOM_WIRE.marks` of them, and one first
 * finisher at most (the earliest). Anything else is left out.
 */
export function cleanAtomMarks(v: unknown): RegionAtomMark[] {
  if (!Array.isArray(v)) return [];
  const out: RegionAtomMark[] = [];
  let first = false;
  for (const m of v) {
    if (!isObj(m) || !whole(m.slot, 1, ATOM_WIRE.slots) || typeof m.name !== 'string') continue;
    if (!(ATOM_MARK_KINDS as readonly unknown[]).includes(m.kind)) continue;
    if (typeof m.at !== 'number' || !Number.isFinite(m.at)) continue;
    const mark: RegionAtomMark = { slot: m.slot, name: m.name.slice(0, 40), kind: m.kind as never, at: m.at };
    if (m.to !== undefined) {
      if (!whole(m.to, 1, ATOM_WIRE.slots)) continue;
      mark.to = m.to;
    }
    if (m.first === true && !first) {
      first = true;
      mark.first = true;
    }
    out.push(mark);
  }
  return out.slice(-ATOM_WIRE.marks);
}

/**
 * The winters the region says chill the city in `me`, as this page takes them: well-formed ids ("2-1")
 * that name this city among the cities chilled, none of its own (its own bombs' winters are its sim's),
 * each id once and at most `ATOM_WIRE.winters` from any one city, in all a few more than a region holds.
 */
export function cleanWinters(v: unknown, me: number): RegionWinter[] {
  if (!Array.isArray(v)) return [];
  const out: RegionWinter[] = [];
  const per = new Map<number, number>();
  for (const w of v) {
    if (!isObj(w) || !winterIdOk(w.id) || typeof w.at !== 'number' || !Number.isFinite(w.at)) continue;
    if (!Array.isArray(w.slots)) continue;
    const slots = w.slots.filter((s): s is number => whole(s, 1, ATOM_WIRE.slots)).slice(0, 8);
    if (!slots.includes(me)) continue;
    const from = Number(w.id.split('-')[0]);
    if (from === me || out.some((x) => x.id === w.id)) continue;
    if ((per.get(from) ?? 0) >= ATOM_WIRE.winters) continue;
    per.set(from, (per.get(from) ?? 0) + 1);
    out.push({ id: w.id, at: w.at, slots });
  }
  return out.slice(0, ATOM_WIRE.winters * 4);
}

export class AtomRegion implements AtomSink {
  private link: RegionLink | null = null;
  /** The region's permanent record of the bomb, oldest first (for the war room and the region's history). */
  atoms: RegionAtomMark[] = [];
  /** The winters the region says chill this city, as the page cleaned them. */
  winters: RegionWinter[] = [];
  /** The region said this city finished the bomb first (it is told again on each return). */
  first = false;
  /** Winters handed to the sim already (it applies each id once anyway), and each friend's cloud as last handed over. */
  private applied = new Set<string>();
  private cloud = new Map<number, number>();
  /** Words in order: each is handled after the one before it. */
  private chain: Promise<void> = Promise.resolve();
  /** The city's own race stage as of the last frame, when the region was last asked for a report, and one is waiting for the gap. */
  private stage = -1;
  private asked = -Infinity;
  private waiting = false;

  constructor(private readonly host: AtomHost) {}

  attach(link: RegionLink): void {
    this.detach();
    this.link = link;
    link.atom = this;
  }

  detach(): void {
    if (this.link) this.link.atom = null;
    this.link = null;
    this.atoms = [];
    this.winters = [];
    this.first = false;
    this.applied.clear();
    this.cloud.clear();
    this.stage = -1;
    this.asked = -Infinity;
    this.waiting = false;
    this.host.changed();
  }

  /** Everything told so far has been handled (for tests, and for a page that wants to save after). */
  idle(): Promise<void> {
    return this.chain;
  }

  // ---- The region's words -------------------------------------------------------------------

  welcome(info: { atoms?: unknown; winters?: unknown }): void {
    if (info.atoms !== undefined) this.atoms = cleanAtomMarks(info.atoms);
    if (info.winters !== undefined) this.take(cleanWinters(info.winters, this.link?.slot ?? 0));
    this.host.changed();
  }

  message(m: RegionRoomMsg): void {
    switch (m.t) {
      case 'atoms':
        this.atoms = cleanAtomMarks(m.atoms);
        this.host.changed();
        return;
      case 'winters':
        this.take(cleanWinters(m.winters, this.link?.slot ?? 0));
        return;
      case 'atomFirst':
        this.first = true;
        this.then(async () => void (await this.host.command({ type: 'atomFirst' })));
        this.host.changed();
        return;
    }
  }

  /** The winters this city has not had yet are handed to its sim, once each. */
  private take(list: RegionWinter[]): void {
    this.winters = list;
    for (const w of list) {
      if (this.applied.has(w.id)) continue;
      this.applied.add(w.id);
      this.then(async () => {
        try {
          // (A refusal in words, like the sim's cap, is final; a failure of the call is tried again.)
          await this.host.command({ type: 'friendWinter', id: w.id });
        } catch (err) {
          this.applied.delete(w.id);
          throw err;
        }
      });
    }
    this.host.changed();
  }

  /**
   * The region's news was taken into the city (called by the link after the city's `regionUpdate`): each
   * friend's cloud over the border towards this city goes to the sim as its cumulative total, whenever
   * it is not what was last handed over. The sim keeps what it has taken in and deposits only what is new.
   */
  async update(update: RegionUpdate): Promise<void> {
    for (const c of update.cities) {
      const total = c.atom?.plume;
      if (total === undefined || this.cloud.get(c.slot) === total) continue;
      this.then(async () => {
        const r = await this.host.command({ type: 'friendFallout', from: c.slot, total });
        // (A cloud that waits at the border for the wind is handed over again with the next news, until
        // the sim has taken it in; one it has taken in, or turned away in words, is not.)
        if (!(r.ok && r.info?.waiting)) this.cloud.set(c.slot, total);
      });
    }
    await this.chain;
  }

  // ---- The city's own race ------------------------------------------------------------------

  /**
   * The city's race stage as the latest frame shows it (`undefined`: no war): when it changes, the
   * region is asked for a report at once (at most one every few seconds; one that has to wait is made
   * on the first frame after the gap).
   */
  frame(stage: AtomStage | undefined): void {
    const no = stage === undefined ? -1 : atomStageNo(stage);
    if (no !== this.stage) {
      const first = this.stage === -1;
      this.stage = no;
      // (The first frame only learns where the city is: the link reports on joining.)
      if (!first && no >= 0) this.waiting = true;
    }
    if (!this.waiting || !this.link) return;
    const now = this.host.now();
    if (now - this.asked < ASK_GAP) return;
    this.asked = now;
    this.waiting = false;
    void this.link.reportNow();
  }

  /** One thing after the one before it; a failure of one does not stop the rest. */
  private then(fn: () => Promise<void>): void {
    this.chain = this.chain.then(fn).catch(() => undefined);
  }
}
