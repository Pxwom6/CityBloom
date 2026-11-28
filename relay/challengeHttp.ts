/**
 * The weekly challenge's board over HTTP (M44), the same for the Worker (`ChallengeObject`) and the
 * local relay:
 *
 *   GET    /challenge/current                  the week, its start and end, the owner's pin, the top score
 *   GET    /challenge/board?week=&group=&limit= the board (a group's, given its code)
 *   POST   /challenge/score                    a score with its packed run (JSON as text/plain: no preflight)
 *   GET    /challenge/run?id=                  a kept run, to watch (and check)
 *   POST   /challenge/verdict                  { id, ok }: a page replayed that run
 *   GET    /owner/challenge?week=              every entry of a week, the pin, the word filter, usage
 *   POST   /owner/challenge/entry/<id>         { action: 'remove' | 'restore' }
 *   POST   /owner/challenge/pin                { week, def } (def null: back to the generator's)
 *   POST   /owner/challenge/words              { words: [...] }
 *
 * Every `/owner/` request needs `Authorization: Bearer <OWNER_KEY>`, checked here on each request.
 */
import { BOARD_LIMITS, type ChallengeBoard } from './challengeBoard';
import { bearer, NOT_SET_UP, type HttpReply, type HttpRequest } from './reportsHttp';
import { normaliseCode } from './protocol';
import { challengeWeek, weekStart } from './week';

const reply = (status: number, json: unknown): HttpReply => ({ status, json });

async function body(req: HttpRequest): Promise<unknown> {
  const length = Number(req.header('content-length') ?? 0);
  if (length > BOARD_LIMITS.body) throw new Error('too big');
  const text = await req.text();
  if (text.length > BOARD_LIMITS.body) throw new Error('too big');
  return JSON.parse(text);
}

/** Is this path the board's? */
export const isBoardPath = (path: string) =>
  path.startsWith('/challenge/') || path.startsWith('/owner/challenge');

/** Handle a request if it's the board's; null if it isn't. */
export async function challengeHttp(
  req: HttpRequest,
  board: ChallengeBoard,
  ownerKey: string | undefined,
  now: number,
): Promise<HttpReply | null> {
  const { method, path, query } = req;
  if (path.startsWith('/challenge/')) {
    if (method === 'GET' && !board.mayRead(req.address, now))
      return reply(429, { error: 'Slow down a little' });
    const week = challengeWeek(now);
    if (path === '/challenge/current' && method === 'GET')
      return reply(200, {
        week,
        start: weekStart(week),
        end: weekStart(week + 1),
        now,
        pin: board.pin(week),
        top: board.top(week),
        last: board.top(week - 1),
      });
    if (path === '/challenge/board' && method === 'GET') {
      const w = Number(query.get('week') ?? week);
      if (!Number.isInteger(w) || (w !== week && w !== week - 1))
        return reply(404, { error: 'That week isn’t kept' });
      const g = query.get('group');
      const group = g ? normaliseCode(g) : null;
      if (g && !group) return reply(400, { error: 'That isn’t a group code' });
      return reply(200, { week: w, ...board.board(w, group, Number(query.get('limit') ?? 50)) });
    }
    if (path === '/challenge/run' && method === 'GET') {
      const run = board.run(Number(query.get('id')));
      return run ? reply(200, run) : reply(404, { error: 'That run isn’t kept' });
    }
    if (path === '/challenge/score' && method === 'POST') {
      let raw: unknown;
      try {
        raw = await body(req);
      } catch (e) {
        return e instanceof Error && e.message === 'too big'
          ? reply(413, { error: 'That run is too big' })
          : reply(400, { error: 'Not JSON' });
      }
      const r = board.post(raw, req.address, now);
      return r.ok ? reply(200, r) : reply(r.status, { error: r.why });
    }
    if (path === '/challenge/verdict' && method === 'POST') {
      let raw: unknown;
      try {
        raw = await body(req);
      } catch {
        return reply(400, { error: 'Not JSON' });
      }
      const r = board.verdict(raw, req.address, now);
      return r.ok ? reply(200, r) : reply(400, { error: r.why });
    }
    return reply(404, { error: 'Not found' });
  }
  if (!path.startsWith('/owner/challenge')) return null;
  const who = board.owner(bearer(req), ownerKey, req.address, now);
  if (who === 'unset') return reply(503, { error: NOT_SET_UP });
  if (who === 'busy') return reply(429, { error: 'Too many wrong keys: wait a minute' });
  if (who === 'wrong') return reply(401, { error: 'That isn’t the owner key' });
  if (path === '/owner/challenge' && method === 'GET') {
    const week = Number(query.get('week') ?? challengeWeek(now));
    return reply(200, {
      week,
      now: challengeWeek(now),
      entries: board.ownerRows(week),
      pin: board.pin(week),
      challenge: board.challenge(week),
      words: board.words(),
      usage: board.usage(now),
    });
  }
  const entry = /^\/owner\/challenge\/entry\/(\d+)$/.exec(path);
  if (entry && method === 'POST') {
    let action: unknown;
    try {
      action = (JSON.parse(await req.text()) as { action?: unknown }).action;
    } catch {
      return reply(400, { error: 'Not JSON' });
    }
    if (action !== 'remove' && action !== 'restore') return reply(400, { error: 'Unknown action' });
    return board.setStatus(Number(entry[1]), action)
      ? reply(200, { ok: true })
      : reply(404, { error: 'No such entry' });
  }
  if (path === '/owner/challenge/pin' && method === 'POST') {
    let raw: { week?: unknown; def?: unknown };
    try {
      raw = (await body(req)) as typeof raw;
    } catch {
      return reply(400, { error: 'Not JSON' });
    }
    const r = board.setPin(Number(raw.week), raw.def ?? null);
    return r.ok ? reply(200, { ok: true }) : reply(400, { error: r.why });
  }
  if (path === '/owner/challenge/words' && method === 'POST') {
    let raw: { words?: unknown };
    try {
      raw = (await body(req)) as typeof raw;
    } catch {
      return reply(400, { error: 'Not JSON' });
    }
    const r = board.setWords(raw.words);
    return r.ok ? reply(200, r) : reply(400, { error: 'Send a list of words' });
  }
  return reply(404, { error: 'Not found' });
}
