/**
 * Submissions over HTTP (M48), the same for the Worker (`SubmissionsObject`) and the local relay:
 *
 *   POST /submit                               an idea or a building (JSON as text/plain: no preflight)
 *   GET  /submit/mine?token=                   the token's own submissions and their status
 *   GET  /submit/accepted                      what the owner accepted (only that)
 *   GET  /owner/submissions?kind=&status=      every submission, newest first (no files)
 *   GET  /owner/submissions/<id>               one, with its screenshot or model
 *   POST /owner/submissions/<id>               { status, reply } or { action: 'delete' }
 *   POST /owner/submissions/words              { words: [...] }
 *
 * Every `/owner/submissions` request needs `Authorization: Bearer <OWNER_KEY>`, checked on each one.
 */
import { SUBMIT_LIMITS, type SubmissionsDesk } from './submissions';
import { bearer, NOT_SET_UP, type HttpReply, type HttpRequest } from './reportsHttp';

const reply = (status: number, json: unknown): HttpReply => ({ status, json });

async function body(req: HttpRequest, max: number): Promise<unknown> {
  const length = Number(req.header('content-length') ?? 0);
  if (length > max) throw new Error('too big');
  const text = await req.text();
  if (text.length > max) throw new Error('too big');
  return JSON.parse(text);
}

/** Is this path the submissions'? */
export const isSubmitPath = (path: string) =>
  path === '/submit' || path.startsWith('/submit/') || path.startsWith('/owner/submissions');

/** Handle a request if it's for submissions; null if it isn't. */
export async function submissionsHttp(
  req: HttpRequest,
  desk: SubmissionsDesk,
  ownerKey: string | undefined,
  now: number,
): Promise<HttpReply | null> {
  const { method, path, query } = req;
  if (path === '/submit' && method === 'POST') {
    let raw: unknown;
    try {
      raw = await body(req, SUBMIT_LIMITS.body);
    } catch (e) {
      return e instanceof Error && e.message === 'too big'
        ? reply(413, { error: 'That’s too big to send' })
        : reply(400, { error: 'Not JSON' });
    }
    const r = await desk.submit(raw, req.address, now);
    return r.ok ? reply(200, r) : reply(r.status, { error: r.why });
  }
  if (path.startsWith('/submit/')) {
    if (method !== 'GET') return reply(404, { error: 'Not found' });
    if (!desk.mayRead(req.address, now)) return reply(429, { error: 'Slow down a little' });
    if (path === '/submit/mine') {
      const rows = await desk.mine(query.get('token'));
      return rows ? reply(200, { mine: rows }) : reply(400, { error: 'Not a token' });
    }
    if (path === '/submit/accepted')
      return reply(200, { accepted: desk.accepted(Number(query.get('limit') ?? 200)) });
    return reply(404, { error: 'Not found' });
  }
  if (!path.startsWith('/owner/submissions')) return null;
  const who = desk.owner(bearer(req), ownerKey, req.address, now);
  if (who === 'unset') return reply(503, { error: NOT_SET_UP });
  if (who === 'busy') return reply(429, { error: 'Too many wrong keys: wait a minute' });
  if (who === 'wrong') return reply(401, { error: 'That isn’t the owner key' });
  if (path === '/owner/submissions' && method === 'GET')
    return reply(200, {
      submissions: desk.ownerList(query.get('kind'), query.get('status')),
      words: desk.words(),
      usage: desk.usage(now),
    });
  if (path === '/owner/submissions/words' && method === 'POST') {
    let raw: { words?: unknown };
    try {
      raw = (await body(req, 100_000)) as typeof raw;
    } catch {
      return reply(400, { error: 'Not JSON' });
    }
    const r = desk.setWords(raw.words);
    return r.ok ? reply(200, r) : reply(400, { error: 'Send a list of words' });
  }
  const one = /^\/owner\/submissions\/(\d+)$/.exec(path);
  if (one && method === 'GET') {
    const item = desk.ownerItem(Number(one[1]));
    return item ? reply(200, item) : reply(404, { error: 'No such submission' });
  }
  if (one && method === 'POST') {
    let raw: { status?: unknown; reply?: unknown; action?: unknown };
    try {
      raw = (await body(req, 10_000)) as typeof raw;
    } catch {
      return reply(400, { error: 'Not JSON' });
    }
    const id = Number(one[1]);
    if (raw.action === 'delete')
      return desk.remove(id) ? reply(200, { ok: true }) : reply(404, { error: 'No such submission' });
    const r = desk.decide(id, raw.status, raw.reply, now);
    return r.ok
      ? reply(200, { ok: true })
      : reply(r.why === 'No such submission' ? 404 : 400, { error: r.why });
  }
  return reply(404, { error: 'Not found' });
}
