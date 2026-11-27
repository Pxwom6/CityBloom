/**
 * The owner area's requests to the relay (M41): every one carries the owner key, which the relay
 * checks each time; the page never decides on its own that the key is right.
 */
import type { GroupStatus, GroupView, ItemFull, REPORT_LIMITS } from '../../relay/reportDesk';
import type { OwnerRow } from '../../relay/challengeBoard';
import type { ChallengeDef } from '../data/challenges';

export interface OwnerStatus {
  setUp: boolean;
  ok: boolean;
  busy: boolean;
}

export interface Usage {
  groups: number;
  items: number;
  bytes: number;
  rowsToday: number;
  limits: typeof REPORT_LIMITS;
}

/** The weekly challenge's board as the owner sees a week of it (M44). */
export interface ChallengeWeekView {
  week: number;
  /** This week's number. */
  now: number;
  entries: OwnerRow[];
  pin: ChallengeDef | null;
  /** The challenge played that week: the pin, or the generator's. */
  challenge: ChallengeDef;
  words: string[];
  usage: { entries: number; runs: number; runChars: number; rowsToday: number; rowsPerDay: number };
}

export class OwnerApi {
  constructor(
    readonly base: string,
    private key: string,
    private fetcher: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetcher(`${this.base}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${this.key}` },
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(json.error ?? `The relay said ${res.status}`);
    return json;
  }

  status(): Promise<OwnerStatus> {
    return this.call('/owner/status');
  }

  reports(status: GroupStatus | 'all'): Promise<{ groups: GroupView[]; usage: Usage }> {
    return this.call(`/owner/reports?status=${status}`);
  }

  item(id: number): Promise<ItemFull> {
    return this.call(`/owner/reports/item/${id}`);
  }

  setGroup(key: string, action: 'fixed' | 'open' | 'delete'): Promise<{ ok: true }> {
    return this.call(`/owner/reports/group/${encodeURIComponent(key)}`, {
      method: 'POST',
      body: JSON.stringify({ action }),
      headers: { 'content-type': 'text/plain' },
    });
  }

  deleteItem(id: number): Promise<{ ok: true }> {
    return this.call(`/owner/reports/item/${id}`, { method: 'DELETE' });
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.call(path, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'text/plain' },
    });
  }

  /** A week of the challenge board (M44): every entry whatever its status, the pin, the word filter. */
  challenge(week?: number): Promise<ChallengeWeekView> {
    return this.call(`/owner/challenge${week === undefined ? '' : `?week=${week}`}`);
  }

  /** Take an entry off the board, or put one back (a run pages found didn't replay, too). */
  setEntry(id: number, action: 'remove' | 'restore'): Promise<{ ok: true }> {
    return this.post(`/owner/challenge/entry/${id}`, { action });
  }

  /** Pin a hand-made challenge for a week, or take the pin away (null: the generator's again). */
  pin(week: number, def: unknown): Promise<{ ok: true }> {
    return this.post('/owner/challenge/pin', { week, def });
  }

  /** The words a name on the board may not contain. */
  setWords(words: string[]): Promise<{ ok: true; words: string[] }> {
    return this.post('/owner/challenge/words', { words });
  }
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const when = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

/**
 * An entry as plain text to paste into a Claude Code session: what it is, where and how often it came,
 * the stack, the written reports' messages, and for a desync how to replay it.
 */
export function groupForClaude(g: GroupView, details: ItemFull[] = []): string {
  const lines = [
    'Citybloom problem report (from the owner area)',
    `Kind: ${g.kind} · Status: ${g.status}${g.reopened ? ' (came back on a newer build)' : ''}`,
    `Message: ${g.message || '(none)'}`,
    `Seen ${g.count} time${g.count === 1 ? '' : 's'}, first ${day(g.first)}, last ${when(g.last)} UTC`,
    `Builds: ${g.builds.map((b) => `${b.build} (${b.count})`).join(', ')}`,
    `Browsers: ${g.browsers.map((b) => `${b.browser} (${b.count})`).join(', ')}`,
    `Latest: graphics ${g.env.quality}, save v${g.env.save}, shared city: ${g.env.shared}, where: ${g.env.where}`,
  ];
  if (g.stack) lines.push('Stack:', g.stack);
  const notes = g.items.filter((i) => i.note);
  if (notes.length) {
    lines.push('Written reports:');
    for (const i of notes) lines.push(`- ${when(i.at)}: ${i.note}`);
  }
  for (const d of details) {
    const ds = d.report.desync;
    if (!ds) continue;
    lines.push(
      `Desync (${ds.where}) at tick ${ds.tick}: this side ${ds.mine || '?'}, the other ${ds.theirs || '?'}` +
        (ds.battle ? `, battle v${ds.battle.v} after ${ds.battle.steps} steps` : '') +
        (ds.start
          ? `; replay from tick ${ds.start.tick}${ds.start.founded ? ' (founded on that machine: needs nothing more)' : ' (needs the city saved at that tick)'}`
          : '') +
        (ds.cut ? '; its events were too many to send' : ''),
    );
  }
  if (g.kind === 'desync')
    lines.push(
      'To replay: download the desync from the owner area, then run `npx tsx scripts/desync.ts <file.json> [--save start.citybloom]`.',
    );
  return lines.join('\n');
}
