/**
 * Ideas and buildings players send in (M48), kept in a Durable Object's SQLite on the free plan
 * (`SubmissionsObject` in `relay/worker.ts`) or Node's SQLite in the local relay. Free of Cloudflare's
 * runtime, like `reportDesk.ts` and `challengeBoard.ts`, so tests run it as it runs online.
 *
 * Who sees what: the owner sees everything (behind `OWNER_KEY`, checked on every request); a player
 * sees only their own submissions, found by a private token their browser made (only its SHA-256 is
 * kept, never the token); everyone sees what the owner accepted, and nothing else. Nothing about a
 * player is asked for or kept beyond an optional "credit me as" name; addresses are used for rates in
 * the moment, hashed with a salt that lives in memory only.
 *
 * What it checks, cheaply (the Worker has milliseconds; the full model check runs in the owner's
 * browser): shapes and lengths, base64, a screenshot's JPEG header, a model's GLB header and JSON with
 * nothing pointing outside it, the model's hash against its bytes, a credit name through the owner's
 * word filter. Limits: a few a day per token and per address, capped sizes, at most so many kept,
 * rows a day; declined ones go 30 days after the decision.
 */
import { LazyTables, KV, type Sql } from './sqlStore';
import { DailyRows, DAY_MS, TokenBucket, type RowBudget } from './limits';
import { cleanName, secureIndex } from './protocol';
import { safeEqual } from './reportDesk';
import { fnv1a } from '../src/sim/hash';

export const SUBMIT_LIMITS = {
  /** Submissions a UTC day, per browser token. */
  perDay: 5,
  /**
   * And per address (in memory): the same few online. Only the local relay's tests raise it
   * (`--submit-per-address`), as every page there comes from 127.0.0.1.
   */
  perAddress: 5,
  titleChars: 80,
  textChars: 1_500,
  lineChars: 200,
  replyChars: 300,
  nameChars: 40,
  /** A screenshot (JPEG, characters of base64). */
  shotChars: 400_000,
  /** A model: 1 MB of bytes as base64. */
  glbChars: Math.ceil((1_048_576 * 4) / 3) + 8,
  /** The whole request. */
  body: 1_500_000,
  /** Submissions kept at once: past it, "the inbox is full". */
  kept: 2_000,
  rowsPerDay: 3_000,
  /** Declined submissions go this long after the decision. */
  declinedMs: 30 * DAY_MS,
  /** Reads an address may make (a burst, then one a second). */
  reads: { rate: 1, burst: 30 },
  /** The owner key and wrong tries, as the report desk's. */
  ownerKeyMin: 20,
  ownerTries: { rate: 1 / 60, burst: 5 },
  ownerTriesAll: { rate: 1 / 6, burst: 30 },
  words: 500,
  wordChars: 40,
};

export type SubmissionKind = 'idea' | 'building';
export const IDEA_KINDS = ['building', 'feature', 'fix', 'scenario', 'other'] as const;
export type IdeaKind = (typeof IDEA_KINDS)[number];
export type SubmissionStatus = 'sent' | 'seen' | 'accepted' | 'declined';
export const STATUSES: SubmissionStatus[] = ['sent', 'seen', 'accepted', 'declined'];

/** A building's target as sent: a landmark size or a civic building's id. */
export type SubmittedTarget = { kind: 'landmark'; size: 1 | 2 | 3 | 4 } | { kind: 'look'; def: string };

/** A submission as its sender sees it. */
export interface MineRow {
  id: number;
  kind: SubmissionKind;
  title: string;
  status: SubmissionStatus;
  reply: string;
  at: number;
  decided: number | null;
}

/** What everyone may see: the accepted ones. */
export interface AcceptedRow {
  id: number;
  kind: SubmissionKind;
  /** An idea's kind, or what a building is for. */
  about: string;
  title: string;
  credit: string;
  decided: number;
}

/** A submission as the owner sees it in the list (no files). */
export interface OwnerRow extends MineRow {
  about: string;
  text: string;
  credit: string;
  hash: string | null;
  bytes: number;
  /** It has a screenshot (an idea) or a model (a building). */
  file: boolean;
}

/** One submission with its file, for the owner. */
export interface OwnerItem extends OwnerRow {
  /** The screenshot (JPEG) or the model (GLB), as base64. */
  data: string | null;
}

export type SubmitResult = { ok: true; id: number } | { ok: false; status: number; why: string };

interface Row {
  id: number;
  token: string;
  kind: SubmissionKind;
  about: string;
  title: string;
  text: string;
  credit: string;
  status: SubmissionStatus;
  reply: string;
  at: number;
  decided: number | null;
  hash: string | null;
  bytes: number;
  file?: string | null;
  has?: number;
}

/** A row's columns without its file (a model is up to 1.4 MB of text). */
const META =
  'id, token, kind, about, title, text, credit, status, reply, at, decided, hash, bytes, (file IS NOT NULL) AS has';

const TOKEN = /^[0-9a-f]{32}$/;
const HASH = /^[0-9a-f]{16}$/;
const DEF = /^[a-z0-9_]{1,32}$/;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Text a player typed: one line or paragraphs, nothing unseen, trimmed and capped. */
export function cleanText(raw: unknown, max: number, lines = false): string {
  if (typeof raw !== 'string') return '';
  let out = '';
  for (const ch of raw) {
    const c = ch.codePointAt(0)!;
    if (c === 10 && lines) out += '\n';
    else if (
      c < 32 ||
      c === 127 ||
      (c >= 0x200b && c <= 0x200f) ||
      c === 0x2028 ||
      c === 0x2029 ||
      c === 0xfeff
    )
      out += c === 9 || c === 10 || c === 13 ? ' ' : '';
    else out += ch;
  }
  out = out
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return [...out].slice(0, max).join('');
}

function fromBase64(b64: string): Uint8Array | null {
  if (!B64.test(b64) || b64.length % 4) return null;
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function sha256(bytes: Uint8Array | string): Promise<string> {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', data.slice().buffer));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** What's wrong with a GLB at a glance, or null: the header, the JSON, nothing pointing outside it. */
export function glbProblem(bytes: Uint8Array): string | null {
  if (bytes.length < 20) return 'That isn’t a GLB model';
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(0, true) !== 0x46546c67 || v.getUint32(4, true) !== 2) return 'That isn’t a GLB model';
  if (v.getUint32(8, true) > bytes.length) return 'The model is cut short';
  const len = v.getUint32(12, true);
  if (v.getUint32(16, true) !== 0x4e4f534a || 20 + len > bytes.length) return 'That isn’t a GLB model';
  let json: { buffers?: { uri?: unknown }[]; images?: { uri?: unknown }[] };
  try {
    json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len))) as typeof json;
  } catch {
    return 'The model can’t be read';
  }
  if ([...(json.buffers ?? []), ...(json.images ?? [])].some((x) => x && x.uri !== undefined))
    return 'The model points to files outside itself';
  return null;
}

/** The start of a JPEG (a screenshot from the game). */
const isJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

export class SubmissionsDesk extends LazyTables {
  private budget: DailyRows;
  private addresses = new Map<string, { day: number; n: number }>();
  private readBuckets = new Map<string, TokenBucket>();
  private ownerTries = new Map<string, TokenBucket>();
  private ownerTriesAll: TokenBucket;
  private readonly salt = `${secureIndex(0x7fff_ffff)}-${secureIndex(0x7fff_ffff)}`;

  constructor(
    sql: Sql,
    now: number,
    readonly limits = SUBMIT_LIMITS,
  ) {
    super(sql, {
      kv: KV,
      subs:
        '(id INTEGER PRIMARY KEY, token TEXT NOT NULL, kind TEXT NOT NULL, about TEXT NOT NULL, ' +
        'title TEXT NOT NULL, text TEXT NOT NULL, credit TEXT NOT NULL, status TEXT NOT NULL, ' +
        'reply TEXT NOT NULL, at INTEGER NOT NULL, decided INTEGER, hash TEXT, bytes INTEGER NOT NULL, file TEXT)',
    });
    const saved = this.get('budget');
    this.budget = new DailyRows(
      limits.rowsPerDay,
      () => this.rowsWritten,
      saved ? (JSON.parse(saved) as RowBudget) : undefined,
      now,
    );
    this.ownerTriesAll = new TokenBucket(limits.ownerTriesAll.rate, limits.ownerTriesAll.burst, now);
  }

  private key(s: string): string {
    return fnv1a(`${this.salt}|${s}`);
  }

  private bucket(map: Map<string, TokenBucket>, address: string, rate: number, burst: number, now: number) {
    const k = this.key(address);
    let b = map.get(k);
    if (!b) {
      if (map.size > 5000) map.clear();
      map.set(k, (b = new TokenBucket(rate, burst, now)));
    }
    return b;
  }

  /** May this address read now (a burst, then one a second)? */
  mayRead(address: string, now: number): boolean {
    return this.bucket(this.readBuckets, address, this.limits.reads.rate, this.limits.reads.burst, now).take(
      now,
    );
  }

  words(): string[] {
    const w = this.get('words');
    return w ? (JSON.parse(w) as string[]) : [];
  }

  /** A credit name: cleaned as names are, and not one the owner's filter catches ('' for none). */
  creditName(raw: unknown): string | null {
    if (raw === undefined || raw === null || raw === '') return '';
    const n = cleanName(raw);
    if (!n) return null;
    const flat = n.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const w of this.words()) if (w && flat.includes(w)) return null;
    return n.slice(0, this.limits.nameChars);
  }

  /** Delete what's due: declined submissions 30 days after the decision. Says whether to look again. */
  sweep(now: number): boolean {
    this.write("DELETE FROM subs WHERE status = 'declined' AND decided < ?", now - this.limits.declinedMs);
    return (
      (this.read<{ n: number }>("SELECT count(*) AS n FROM subs WHERE status = 'declined'")[0]?.n ?? 0) > 0
    );
  }

  /** When the sweep should next look (a day from now). */
  nextSweep(now: number): number {
    return now + DAY_MS;
  }

  /** Take a submission, or say why not. */
  async submit(raw: unknown, address: string, now: number): Promise<SubmitResult> {
    const r = raw as Record<string, unknown> | null;
    if (!r || typeof r !== 'object') return { ok: false, status: 400, why: 'Not a submission' };
    if (typeof r.token !== 'string' || !TOKEN.test(r.token))
      return { ok: false, status: 400, why: 'Not a submission' };
    const kind = r.kind;
    if (kind !== 'idea' && kind !== 'building') return { ok: false, status: 400, why: 'Not a submission' };
    const credit = this.creditName(r.credit);
    if (credit === null) return { ok: false, status: 400, why: 'That name isn’t allowed: choose another' };
    let about: string;
    let title: string;
    let text: string;
    let hash: string | null = null;
    let file: string | null = null;
    if (kind === 'idea') {
      if (typeof r.about !== 'string' || !(IDEA_KINDS as readonly string[]).includes(r.about))
        return { ok: false, status: 400, why: 'Say what kind of idea it is' };
      about = r.about;
      title = cleanText(r.title, this.limits.titleChars);
      text = cleanText(r.text, this.limits.textChars, true);
      if (!title) return { ok: false, status: 400, why: 'Give it a title' };
      if (!text) return { ok: false, status: 400, why: 'Say a little about it' };
      if (r.shot !== undefined && r.shot !== null) {
        if (typeof r.shot !== 'string' || r.shot.length > this.limits.shotChars)
          return { ok: false, status: 413, why: 'The screenshot is too big' };
        const b = fromBase64(r.shot);
        if (!b || !isJpeg(b)) return { ok: false, status: 400, why: 'The screenshot isn’t a picture' };
        file = r.shot;
      }
    } else {
      const t = r.about as { kind?: unknown; size?: unknown; def?: unknown } | null;
      if (t?.kind === 'landmark' && [1, 2, 3, 4].includes(t.size as number))
        about = JSON.stringify({ kind: 'landmark', size: t.size });
      else if (t?.kind === 'look' && typeof t.def === 'string' && DEF.test(t.def))
        about = JSON.stringify({ kind: 'look', def: t.def });
      else return { ok: false, status: 400, why: 'Say what the building is for' };
      title = cleanText(r.title, this.limits.nameChars);
      text = cleanText(r.text, this.limits.lineChars);
      if (!title) return { ok: false, status: 400, why: 'Give it a name' };
      if (typeof r.glb !== 'string' || !r.glb.length)
        return { ok: false, status: 400, why: 'There’s no model' };
      if (r.glb.length > this.limits.glbChars)
        return { ok: false, status: 413, why: 'The model is over 1 MB' };
      const bytes = fromBase64(r.glb);
      if (!bytes) return { ok: false, status: 400, why: 'The model can’t be read' };
      const problem = glbProblem(bytes);
      if (problem) return { ok: false, status: 400, why: problem };
      if (typeof r.hash !== 'string' || !HASH.test(r.hash) || (await sha256(bytes)).slice(0, 16) !== r.hash)
        return { ok: false, status: 400, why: 'The model isn’t the one it says it is' };
      hash = r.hash;
      file = r.glb;
    }
    // Rates: a few a day, per token (kept, so a restart doesn't reset it) and per address (in memory).
    const token = await sha256(r.token);
    const day = Math.floor(now / DAY_MS);
    const byToken =
      this.read<{ n: number }>(
        'SELECT count(*) AS n FROM subs WHERE token = ? AND at >= ?',
        token,
        day * DAY_MS,
      )[0]?.n ?? 0;
    const ak = this.key(address);
    const a = this.addresses.get(ak);
    const byAddress = a && a.day === day ? a.n : 0;
    if (byToken >= this.limits.perDay || byAddress >= this.limits.perAddress)
      return { ok: false, status: 429, why: `That’s ${this.limits.perDay} for today: try again tomorrow` };
    this.sweep(now);
    const kept = this.read<{ n: number }>('SELECT count(*) AS n FROM subs')[0]?.n ?? 0;
    if (kept >= this.limits.kept)
      return { ok: false, status: 503, why: 'The inbox is full: try again another day' };
    if (this.budget.over(now)) return { ok: false, status: 503, why: 'Too busy today: try again tomorrow' };
    this.write(
      'INSERT INTO subs (token, kind, about, title, text, credit, status, reply, at, decided, hash, bytes, file) ' +
        "VALUES (?, ?, ?, ?, ?, ?, 'sent', '', ?, NULL, ?, ?, ?)",
      token,
      kind,
      about,
      title,
      text,
      credit,
      now,
      hash,
      file ? Math.floor((file.length * 3) / 4) : 0,
      file,
    );
    if (this.addresses.size > 5000) this.addresses.clear();
    this.addresses.set(ak, { day, n: byAddress + 1 });
    const id = this.read<{ id: number }>('SELECT last_insert_rowid() AS id')[0]!.id;
    this.put('budget', JSON.stringify(this.budget.record(now)));
    return { ok: true, id };
  }

  /** A player's own submissions, by their token (none for any other token). */
  async mine(token: unknown): Promise<MineRow[] | null> {
    if (typeof token !== 'string' || !TOKEN.test(token)) return null;
    const rows = this.read<Row>(
      `SELECT ${META} FROM subs WHERE token = ? ORDER BY id DESC`,
      await sha256(token),
    );
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      status: r.status,
      reply: r.reply,
      at: r.at,
      decided: r.decided,
    }));
  }

  /** What the owner accepted: everyone may see these, and only these. */
  accepted(limit = 200): AcceptedRow[] {
    return this.read<Row>(
      `SELECT ${META} FROM subs WHERE status = 'accepted' ORDER BY decided DESC LIMIT ?`,
      Math.max(1, Math.min(500, limit | 0)),
    ).map((r) => ({
      id: r.id,
      kind: r.kind,
      about: r.about,
      title: r.title,
      credit: r.credit,
      decided: r.decided!,
    }));
  }

  // ---- The owner -----------------------------------------------------------------------------

  owner(
    given: string | null,
    ownerKey: string | undefined,
    address: string,
    now: number,
  ): 'ok' | 'unset' | 'wrong' | 'busy' {
    const key = ownerKey?.trim() ?? '';
    if (key.length < this.limits.ownerKeyMin) return 'unset';
    const b = this.bucket(
      this.ownerTries,
      address,
      this.limits.ownerTries.rate,
      this.limits.ownerTries.burst,
      now,
    );
    if (!b.has(now) || !this.ownerTriesAll.has(now)) return 'busy';
    if (given !== null && safeEqual(given, key)) return 'ok';
    b.take(now);
    this.ownerTriesAll.take(now);
    return 'wrong';
  }

  private ownerRow(r: Row): OwnerRow {
    return {
      id: r.id,
      kind: r.kind,
      title: r.title,
      status: r.status,
      reply: r.reply,
      at: r.at,
      decided: r.decided,
      about: r.about,
      text: r.text,
      credit: r.credit,
      hash: r.hash,
      bytes: r.bytes,
      file: !!r.has,
    };
  }

  /** Every submission newest first, by kind and status if given (no files). */
  ownerList(kind?: string | null, status?: string | null): OwnerRow[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (kind === 'idea' || kind === 'building') {
      where.push('kind = ?');
      args.push(kind);
    }
    if (status && (STATUSES as string[]).includes(status)) {
      where.push('status = ?');
      args.push(status);
    }
    return this.read<Row>(
      `SELECT ${META} FROM subs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT 500`,
      ...args,
    ).map((r) => this.ownerRow(r));
  }

  /** One submission with its file. */
  ownerItem(id: number): OwnerItem | null {
    const r = this.read<Row>(`SELECT ${META}, file FROM subs WHERE id = ?`, id)[0];
    return r ? { ...this.ownerRow(r), data: r.file ?? null } : null;
  }

  /** Mark one seen, accepted or declined, with a short reply the player sees. */
  decide(id: number, status: unknown, reply: unknown, now: number): { ok: boolean; why?: string } {
    if (status !== 'sent' && status !== 'seen' && status !== 'accepted' && status !== 'declined')
      return { ok: false, why: 'Unknown status' };
    const row = this.read<Row>('SELECT id FROM subs WHERE id = ?', id)[0];
    if (!row) return { ok: false, why: 'No such submission' };
    const text = cleanText(reply, this.limits.replyChars);
    this.write(
      'UPDATE subs SET status = ?, reply = ?, decided = ? WHERE id = ?',
      status,
      text,
      status === 'accepted' || status === 'declined' ? now : null,
      id,
    );
    return { ok: true };
  }

  remove(id: number): boolean {
    if (!this.read<Row>('SELECT id FROM subs WHERE id = ?', id)[0]) return false;
    this.write('DELETE FROM subs WHERE id = ?', id);
    return true;
  }

  /** The owner's word filter for credit names (lower case, letters and digits). */
  setWords(raw: unknown): { ok: boolean; words: string[] } {
    if (!Array.isArray(raw)) return { ok: false, words: this.words() };
    const words = [
      ...new Set(
        raw
          .filter((w): w is string => typeof w === 'string')
          .map((w) =>
            w
              .toLowerCase()
              .replace(/[^a-z0-9]/g, '')
              .slice(0, this.limits.wordChars),
          )
          .filter(Boolean),
      ),
    ].slice(0, this.limits.words);
    this.put('words', JSON.stringify(words));
    return { ok: true, words };
  }

  /** What the desk holds (the owner's status line). */
  usage(now: number): {
    kept: number;
    bytes: number;
    rowsToday: number;
    rowsPerDay: number;
    byStatus: Record<string, number>;
  } {
    const e = this.read<{ n: number; b: number | null }>(
      'SELECT count(*) AS n, sum(bytes) AS b FROM subs',
    )[0];
    const byStatus: Record<string, number> = {};
    for (const s of this.read<{ status: string; n: number }>(
      'SELECT status, count(*) AS n FROM subs GROUP BY status',
    ))
      byStatus[s.status] = s.n;
    return {
      kept: e?.n ?? 0,
      bytes: e?.b ?? 0,
      rowsToday: this.budget.used(now),
      rowsPerDay: this.limits.rowsPerDay,
      byStatus,
    };
  }
}
