/**
 * Sending ideas and buildings in (M48): the page's side of the submissions desk. A private token made
 * in this browser (32 random hex digits in localStorage, never shown) is the only thing that ties a
 * player to what they sent: with it the desk lists their own submissions and their status. Nothing
 * else about the player goes.
 */
import type { AcceptedRow, IdeaKind, MineRow, SubmissionStatus } from '../../relay/submissions';
import type { StoredModel } from './myBuildings';
import { toBase64 } from './myBuildings';

const TOKEN_KEY = 'citybloom.submitToken';

/** What a status says to the player. */
export const STATUS_WORDS: Record<SubmissionStatus, string> = {
  sent: 'Sent',
  seen: 'Seen',
  accepted: 'Coming in an update',
  declined: 'Not this time',
};

export const IDEA_KIND_WORDS: Record<IdeaKind, string> = {
  building: 'A building',
  feature: 'A feature',
  fix: 'A fix',
  scenario: 'A scenario or challenge',
  other: 'Something else',
};

export type SendResult = { ok: true; id: number } | { ok: false; why: string };

export interface IdeaDraft {
  about: IdeaKind;
  title: string;
  text: string;
  /** A JPEG data URL from the game, or none. */
  shot: string | null;
  credit: string;
}

export class SubmitClient {
  constructor(private readonly base: string | null) {}

  /** Sending needs the relay (the internet). */
  get online(): boolean {
    return !!this.base;
  }

  /** The browser's private token: made once, kept in localStorage, never shown. */
  token(): string {
    let t: string | null = null;
    try {
      t = localStorage.getItem(TOKEN_KEY);
    } catch {
      /* private browsing: a token for this visit */
    }
    if (t && /^[0-9a-f]{32}$/.test(t)) return t;
    const b = crypto.getRandomValues(new Uint8Array(16));
    t = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    try {
      localStorage.setItem(TOKEN_KEY, t);
    } catch {
      /* kept for this visit only */
    }
    return t;
  }

  /** Has this browser sent anything (is there a token)? */
  hasSent(): boolean {
    try {
      return !!localStorage.getItem(TOKEN_KEY);
    } catch {
      return false;
    }
  }

  private async post(body: unknown): Promise<SendResult> {
    if (!this.base) return { ok: false, why: 'Sending needs the internet' };
    try {
      // JSON as text/plain: a simple request, no preflight.
      const res = await fetch(`${this.base}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { id?: number; error?: string };
      return res.ok && typeof json.id === 'number'
        ? { ok: true, id: json.id }
        : { ok: false, why: json.error ?? 'It couldn’t be sent: try again later' };
    } catch {
      return { ok: false, why: 'It couldn’t be sent: check the connection' };
    }
  }

  sendIdea(d: IdeaDraft): Promise<SendResult> {
    return this.post({
      token: this.token(),
      kind: 'idea',
      about: d.about,
      title: d.title,
      text: d.text,
      credit: d.credit,
      ...(d.shot ? { shot: d.shot.replace(/^data:image\/jpeg;base64,/, '') } : {}),
    });
  }

  /** A model of the player's own (it passed the check when it went into My buildings). */
  sendBuilding(m: StoredModel, line: string, credit: string): Promise<SendResult> {
    return this.post({
      token: this.token(),
      kind: 'building',
      about: m.target,
      title: m.name,
      text: line,
      credit,
      glb: toBase64(m.bytes),
      hash: m.hash,
    });
  }

  /** This browser's submissions and their status (none sent: an empty list, asking nothing). */
  async mine(): Promise<MineRow[] | null> {
    if (!this.base) return null;
    if (!this.hasSent()) return [];
    try {
      // The token in the body, never the address (logs may keep addresses); text/plain: no preflight.
      const res = await fetch(`${this.base}/submit/mine`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ token: this.token() }),
      });
      if (!res.ok) return null;
      return ((await res.json()) as { mine: MineRow[] }).mine;
    } catch {
      return null;
    }
  }

  /** What the owner accepted, with credit names. */
  async accepted(): Promise<AcceptedRow[] | null> {
    if (!this.base) return null;
    try {
      const res = await fetch(`${this.base}/submit/accepted`);
      if (!res.ok) return null;
      return ((await res.json()) as { accepted: AcceptedRow[] }).accepted;
    } catch {
      return null;
    }
  }
}
