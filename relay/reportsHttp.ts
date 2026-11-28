/**
 * The report desk over HTTP (M41), the same for the Worker (`ReportsObject`) and the local relay:
 *
 *   POST   /report                         a report (JSON sent as text/plain, so no preflight)
 *   GET    /owner/status                   { setUp, ok }: is there an owner key, and is this it
 *   GET    /owner/reports?status=open|fixed|all   the groups, newest first, with their items listed
 *   GET    /owner/reports/usage            what the desk holds against its caps
 *   GET    /owner/reports/item/<id>        one kept item in full (a written report, a desync's replay)
 *   POST   /owner/reports/group/<key>      { action: 'fixed' | 'open' | 'delete' }
 *   DELETE /owner/reports/item/<id>
 *
 * Every `/owner/` request needs `Authorization: Bearer <OWNER_KEY>`, checked here on each request
 * (never in the page alone); wrong keys are limited per address. Without a key set, the owner area
 * says it isn't set up yet, and reports are still taken.
 */
import { REPORT_CAPS } from './reports';
import type { GroupStatus, ReportDesk } from './reportDesk';

export interface HttpRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  header(name: string): string | null;
  text(): Promise<string>;
  /** The caller's address, for rate limits in the moment only. */
  address: string;
}

export interface HttpReply {
  status: number;
  json: unknown;
}

const reply = (status: number, json: unknown): HttpReply => ({ status, json });

/** The owner key from an Authorization header. */
export function bearer(req: HttpRequest): string | null {
  const h = req.header('authorization') ?? '';
  return /^Bearer\s+/i.test(h) ? h.replace(/^Bearer\s+/i, '').trim() : null;
}

export const NOT_SET_UP = 'The owner area isn’t set up yet: it needs OWNER_KEY (see PROGRESS.md).';

/** Handle a request if it's the desk's; null if it isn't (the caller answers 404). */
export async function reportsHttp(
  req: HttpRequest,
  desk: ReportDesk,
  ownerKey: string | undefined,
  now: number,
): Promise<HttpReply | null> {
  const { method, path } = req;
  if (path === '/report') {
    if (method !== 'POST') return reply(405, { error: 'POST a report' });
    const length = Number(req.header('content-length') ?? 0);
    if (length > REPORT_CAPS.body) return reply(413, { error: 'That report is too big' });
    const body = await req.text();
    if (body.length > REPORT_CAPS.body) return reply(413, { error: 'That report is too big' });
    let raw: unknown;
    try {
      raw = JSON.parse(body);
    } catch {
      return reply(400, { error: 'Not JSON' });
    }
    const r = desk.add(raw, req.address, now);
    return r.ok ? reply(202, { ok: true }) : reply(r.status, { error: r.why });
  }
  if (!path.startsWith('/owner/')) return null;
  const who = desk.owner(bearer(req), ownerKey, req.address, now);
  if (path === '/owner/status' && method === 'GET')
    return reply(200, { setUp: who !== 'unset', ok: who === 'ok', busy: who === 'busy' });
  if (who === 'unset') return reply(503, { error: NOT_SET_UP });
  if (who === 'busy') return reply(429, { error: 'Too many wrong keys: wait a minute' });
  if (who === 'wrong') return reply(401, { error: 'That isn’t the owner key' });
  if (path === '/owner/reports' && method === 'GET') {
    const s = req.query.get('status');
    const status: GroupStatus | 'all' = s === 'open' || s === 'fixed' ? s : 'all';
    return reply(200, { groups: desk.groups(status), usage: desk.usage(now) });
  }
  if (path === '/owner/reports/usage' && method === 'GET') return reply(200, desk.usage(now));
  const item = /^\/owner\/reports\/item\/(\d+)$/.exec(path);
  if (item) {
    const id = Number(item[1]);
    if (method === 'GET') {
      const it = desk.item(id);
      return it ? reply(200, it) : reply(404, { error: 'No such report' });
    }
    if (method === 'DELETE')
      return desk.deleteItem(id) ? reply(200, { ok: true }) : reply(404, { error: 'No such report' });
  }
  const group = /^\/owner\/reports\/group\/([A-Za-z0-9-]{1,80})$/.exec(path);
  if (group && method === 'POST') {
    let action: unknown;
    try {
      action = (JSON.parse(await req.text()) as { action?: unknown }).action;
    } catch {
      return reply(400, { error: 'Not JSON' });
    }
    const key = group[1]!;
    if (action === 'delete')
      return desk.deleteGroup(key) ? reply(200, { ok: true }) : reply(404, { error: 'No such entry' });
    if (action === 'fixed' || action === 'open')
      return desk.setStatus(key, action, now)
        ? reply(200, { ok: true })
        : reply(404, { error: 'No such entry' });
    return reply(400, { error: 'Unknown action' });
  }
  return reply(404, { error: 'Not found' });
}

/**
 * CORS headers for a reply: the caller's origin when it's allowed (any origin when the list is empty,
 * as in development), with what the owner area's requests need.
 */
export function corsHeaders(origin: string, allowed: string[]): Record<string, string> | null {
  if (allowed.length && !allowed.includes(origin)) return null;
  return {
    'access-control-allow-origin': allowed.length ? origin : '*',
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}
