/**
 * Players' own models in a shared city (M46): a page that lacks a model the city's buildings wear
 * asks the room by its hash, and a page that has it answers, in parts the room relays to whoever
 * asked and never keeps. What arrives is put together, its hash checked against its bytes, then
 * checked as any model is (in a worker) before it's kept as a friend's and drawn.
 *
 * Nothing is asked for while friends' buildings are hidden (this page's setting) or custom buildings
 * are off in the room (the host's), and a model that fails the check isn't asked for again.
 */
import { MODEL_PART, MODEL_PARTS, type ModelPartMsg } from '../../relay/protocol';
import { CUSTOM, targetOfDef } from '../models/customCheck';
import { cleanTarget, fromBase64, toBase64 } from './myBuildings';
import { modelHash } from './modelCheck';
import type { Game } from '../game';
import type { RoomSession as Session } from '../net/session';

/** How long before an unanswered ask goes out again, and an answer is sent again for the same model. */
const ASK_AGAIN_MS = 20_000;
const ANSWER_AGAIN_MS = 10_000;
/** A model arriving that stops (its sender left) is given up after this long. */
const STALLED_MS = 30_000;
/** Models asked for at once. */
const IN_FLIGHT = 4;

interface Arriving {
  from: number;
  parts: (string | null)[];
  got: number;
  name?: string;
  target?: unknown;
  at: number;
}

export class RoomModels {
  private asked = new Map<string, number>();
  private answered = new Map<string, number>();
  private arriving = new Map<string, Arriving>();
  /**
   * Models that came whole, the bytes their hash names, and failed the check: any player would send the
   * same bytes, so they aren't asked for again this session.
   */
  private refused = new Set<string>();
  /** Players whose answer for a model wasn't the model its hash names: the room is told to skip them. */
  private wrong = new Map<string, Set<number>>();
  private session: Session | null = null;
  private lastLook = 0;
  private wasOn = true;
  /** What has passed (the network budget, and tests). */
  readonly stats = { asked: 0, received: 0, sent: 0, sentChars: 0, refused: 0 };

  constructor(private game: Game) {}

  attach(session: Session): void {
    this.session = session;
    this.wasOn = true;
    this.asked.clear();
    this.answered.clear();
    this.arriving.clear();
    this.wrong.clear();
    session.onModelNeed = (from, hash) => void this.answer(from, hash);
    session.onModelPart = (m) => void this.part(m);
  }

  detach(): void {
    if (this.session) {
      this.session.onModelNeed = null;
      this.session.onModelPart = null;
    }
    this.session = null;
  }

  /** Custom buildings are on in this room (the host's rule). */
  private allowed(): boolean {
    return this.session?.room?.rules.customBuildings !== false;
  }

  /** Each frame: at most once a second, ask for what the city's buildings wear that isn't here. */
  frame(now: number): void {
    const s = this.session;
    if (!s || now - this.lastLook < 1000) return;
    this.lastLook = now;
    // The host turned custom buildings on or off: everyone's are drawn again (or as the game's).
    const on = this.allowed();
    if (on !== this.wasOn) {
      this.wasOn = on;
      this.game.renderer.civics.redrawLooks();
      this.game.notify();
    }
    for (const [hash, a] of this.arriving) if (now - a.at > STALLED_MS) this.arriving.delete(hash);
    if (!this.allowed() || !this.game.settings.showFriendsBuildings) return;
    // In flight: arriving, or asked lately and not here yet.
    let flying = 0;
    for (const [hash, at] of this.asked)
      if (!this.game.buildings.get(hash) && (this.arriving.has(hash) || now - at < ASK_AGAIN_MS)) flying++;
    for (const hash of this.game.looksInCity()) {
      if (flying >= IN_FLIGHT) break;
      if (this.game.buildings.get(hash) || this.refused.has(hash) || this.arriving.has(hash)) continue;
      const at = this.asked.get(hash);
      if (at !== undefined && now - at < ASK_AGAIN_MS) continue;
      this.asked.set(hash, now);
      this.stats.asked++;
      flying++;
      const not = this.wrong.get(hash);
      s.askModel(hash, not ? [...not] : undefined);
    }
  }

  /** Another page lacks a model this one has: send it, in parts. */
  private async answer(_from: number, hash: string): Promise<void> {
    const s = this.session;
    if (!s || !this.allowed()) return;
    await this.game.buildings.ready;
    const m = this.game.buildings.get(hash);
    if (!m || m.bytes.length > CUSTOM.maxBytes) return;
    const now = performance.now();
    const last = this.answered.get(hash);
    if (last !== undefined && now - last < ANSWER_AGAIN_MS) return;
    this.answered.set(hash, now);
    const b64 = toBase64(m.bytes);
    const parts = Math.ceil(b64.length / MODEL_PART);
    if (parts > MODEL_PARTS) return;
    for (let i = 0; i < parts; i++) {
      const msg: ModelPartMsg = {
        t: 'mpart',
        hash,
        part: i,
        parts,
        data: b64.slice(i * MODEL_PART, (i + 1) * MODEL_PART),
        ...(i === 0 ? { name: m.name, target: m.target } : {}),
      };
      s.sendModelPart(msg);
      this.stats.sentChars += msg.data.length;
    }
    this.stats.sent++;
  }

  /** A part of a model this page asked for: kept until every part is here, then checked and kept. */
  private async part(m: ModelPartMsg & { from: number }): Promise<void> {
    if (!this.asked.has(m.hash) || this.game.buildings.get(m.hash) || this.refused.has(m.hash)) return;
    if (m.parts < 1 || m.parts > MODEL_PARTS || m.part < 0 || m.part >= m.parts) return;
    let a = this.arriving.get(m.hash);
    if (!a) {
      if (m.part !== 0) return;
      a = { from: m.from, parts: new Array<string | null>(m.parts).fill(null), got: 0, at: 0 };
      this.arriving.set(m.hash, a);
    }
    if (a.from !== m.from || a.parts.length !== m.parts || a.parts[m.part] !== null) return;
    a.parts[m.part] = m.data;
    a.got++;
    a.at = performance.now();
    if (m.part === 0) {
      a.name = m.name;
      a.target = m.target;
    }
    if (a.got < a.parts.length) return;
    this.arriving.delete(m.hash);
    const r = await this.take(m.hash, a);
    if (r === 'kept') this.stats.received++;
    else if (r === 'wrong') {
      // Not the model its hash names: that player is skipped, and the model asked for again soon.
      let w = this.wrong.get(m.hash);
      if (!w) this.wrong.set(m.hash, (w = new Set()));
      w.add(a.from);
      this.asked.set(m.hash, performance.now() - ASK_AGAIN_MS + 2000);
      this.stats.refused++;
    } else {
      this.refused.add(m.hash);
      this.stats.refused++;
    }
  }

  /** A whole model: the bytes its hash names, then the check, then kept as a friend's. */
  private async take(hash: string, a: Arriving): Promise<'kept' | 'wrong' | 'failed'> {
    let bytes: Uint8Array;
    try {
      bytes = fromBase64(a.parts.join(''));
    } catch {
      return 'wrong';
    }
    if (bytes.length > CUSTOM.maxBytes || (await modelHash(bytes)) !== hash) return 'wrong';
    // What it was made for: as its sender said, else the building wearing it here.
    const wearer = [...this.game.world.civics.values()].find((c) => c.look === hash);
    const target = cleanTarget(a.target) ?? (wearer ? targetOfDef(wearer.def) : null);
    if (!target) return 'wrong';
    const r = await this.game.buildings.add(bytes, a.name ?? 'A friend’s building', target, false);
    return r.ok ? 'kept' : 'failed';
  }
}
