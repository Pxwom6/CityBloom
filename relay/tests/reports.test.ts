/**
 * Problem reports (M41): the shape every hop holds to, folding, the desk's caps against a modified
 * client, the owner's key, fixed entries that reopen, and the 60-day sweep.
 */
import { describe, expect, it } from 'vitest';
import {
  cleanEvents,
  cleanReport,
  reportKey,
  scrubText,
  stripAddresses,
  firstFrame,
  REPORT_CAPS,
  type Report,
} from '../reports';
import { ReportDesk, REPORT_LIMITS } from '../reportDesk';
import { reportsHttp, type HttpRequest } from '../reportsHttp';
import { nodeSql } from '../nodeSql';
import { DAY_MS } from '../limits';
import { startRelay } from '../local';

const env = {
  build: 'abc123',
  browser: 'Chrome 142',
  os: 'macOS',
  quality: 'high',
  save: 32,
  shared: 'no',
  where: 'city',
} as const;

const error = (
  message: string,
  build = 'abc123',
  stack = 'Error\n    at placeZone (index-DkA9xq.js:1:2345)',
): Report => ({
  kind: 'error',
  env: { ...env, build },
  message,
  stack,
  at: 1,
});

async function desk(limits: Partial<typeof REPORT_LIMITS> = {}, now = 1_000_000) {
  const db = await nodeSql();
  return { desk: new ReportDesk(db.sql, now, { ...REPORT_LIMITS, ...limits }), db };
}

function request(
  method: string,
  path: string,
  body: unknown = null,
  key: string | null = null,
  address = '1.2.3.4',
): HttpRequest {
  const text = body === null ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  const url = new URL(`http://x${path}`);
  return {
    method,
    path: url.pathname,
    query: url.searchParams,
    header: (n) =>
      n === 'authorization' && key !== null
        ? `Bearer ${key}`
        : n === 'content-length'
          ? String(text.length)
          : null,
    text: () => Promise.resolve(text),
    address,
  };
}

describe('the report shape', () => {
  it('refuses what is not a report and cuts what is too long', () => {
    expect(cleanReport(null).ok).toBe(false);
    expect(cleanReport({ ...error('x'), kind: 'gossip' }).ok).toBe(false);
    expect(cleanReport({ ...error('x'), env: undefined }).ok).toBe(false);
    const c = cleanReport({ ...error('m'.repeat(5000)), stack: 's'.repeat(9000), extra: 'dropped' });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.report.message.length).toBe(REPORT_CAPS.message);
    expect(c.report.stack.length).toBe(REPORT_CAPS.stack);
    expect('extra' in c.report).toBe(false);
  });

  it('keeps labels to their characters and a written report to its message and picture', () => {
    const c = cleanReport({
      kind: 'user',
      env: { ...env, browser: '<script>alert(1)</script>Chrome', where: 'nowhere' },
      message: '',
      stack: '',
      at: 5,
      note: 'The bridge fell into the river' + String.fromCharCode(0x202e) + '!',
      shot: 'data:text/html;base64,PHNjcmlwdD4=',
    });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.report.env.browser).not.toContain('<');
    expect(c.report.env.where).toBe('boot');
    expect(c.report.note).toBe('The bridge fell into the river!');
    expect(c.report.shot).toBeUndefined();
  });

  it('strips query strings and origins from addresses, keeping line and column', () => {
    expect(
      stripAddresses('at f (https://pxwom6.github.io/CityBloom/assets/index-abc.js?name=Ada:12:34)'),
    ).toBe('at f (/CityBloom/assets/index-abc.js:12:34)');
    expect(stripAddresses('failed at http://localhost:4174/CityBloom/?new=1&name=Ada')).toBe(
      'failed at /CityBloom/',
    );
  });

  it('scrubs the names the page knows of, longest first', () => {
    expect(scrubText('Ada Lovelace opened Adatown', ['Ada', 'Ada Lovelace', 'Adatown', 'Al'])).toBe(
      '[name] opened [name]',
    );
  });

  it('replaces typed text in a replay’s commands, however deep, and again on the server', () => {
    const events = [
      { tick: 4, seq: 1, ev: { kind: 'cmd', by: 1, cmd: { type: 'renameCity', name: 'Adatown' } } },
      { tick: 5, seq: 2, ev: { kind: 'cmd', by: 1, cmd: { type: 'createDistrict', name: 'Old Quarter' } } },
      { tick: 6, seq: 3, ev: { kind: 'cmd', by: 2, cmd: { type: 'zone', zone: 'R', cells: [1, 2] } } },
    ];
    const cleaned = JSON.stringify(cleanEvents(events));
    expect(cleaned).not.toContain('Adatown');
    expect(cleaned).not.toContain('Old Quarter');
    expect(cleaned).toContain('"zone":"R"');
    const c = cleanReport({
      ...error('desync'),
      kind: 'desync',
      desync: { where: 'city', tick: 48, mine: 'aa', theirs: 'bb', events },
    });
    expect(c.ok && JSON.stringify(c.report)).not.toContain('Adatown');
  });

  it('leaves out a replay too big for the cap and says so', () => {
    const big = Array.from({ length: 1500 }, (_, i) => ({
      tick: i,
      seq: i,
      ev: { kind: 'cmd', by: 1, cmd: { type: 'zone', cells: Array.from({ length: 40 }, (_, k) => k) } },
    }));
    const c = cleanReport({
      ...error('d'),
      kind: 'desync',
      desync: { where: 'city', tick: 1, mine: '1', theirs: '2', events: big },
    });
    expect(c.ok).toBe(true);
    if (c.ok) {
      expect(c.report.desync?.events).toBeUndefined();
      expect(c.report.desync?.cut).toBe(true);
    }
  });

  it('folds the same error across builds and line numbers, and keeps different errors apart', () => {
    const a = error(
      'Cannot read properties of undefined (reading "x") at tick 1234',
      'abc',
      'Error\n    at placeZone (index-AbC123.js:1:2345)',
    );
    const b = error(
      'Cannot read properties of undefined (reading "x") at tick 99',
      'def',
      'Error\n    at placeZone (index-ZzZ999.js:1:9999)',
    );
    const c = error('Something else entirely', 'abc');
    expect(reportKey(a)).toBe(reportKey(b));
    expect(reportKey(a)).not.toBe(reportKey(c));
  });
});

describe('where an error came from', () => {
  it('names the first frame by its function, or its file without the build hash and line', () => {
    expect(firstFrame('Error: x\n    at placeZone (https://a.b/assets/index-AbC123x.js:1:2345)')).toBe(
      'placeZone',
    );
    expect(firstFrame('Error: x\n    at https://a.b/assets/index-AbC123x.js:1:2345')).toBe('index.js');
    expect(firstFrame('Error: x\n    at e (https://a.b/assets/index-ZZZ999y.js:9:99)')).toBe('index.js');
    expect(firstFrame('placeZone@https://a.b/assets/index-AbC123x.js:1:2345')).toBe('placeZone');
    expect(firstFrame('@https://a.b/assets/worker-Qq12345.js:3:4')).toBe('worker.js');
  });
});

describe('the report desk', () => {
  it('folds duplicates into one entry with a count, builds and browsers', async () => {
    const { desk: d } = await desk();
    for (let i = 0; i < 3; i++) expect(d.add(error('Boom 1'), `a${i}`, 1_000_000 + i).ok).toBe(true);
    d.add({ ...error('Boom 2'), env: { ...env, browser: 'Safari 18', os: 'iOS' } }, 'b', 1_000_100);
    const groups = d.groups();
    expect(groups).toHaveLength(1);
    expect(groups[0]!.count).toBe(4);
    expect(groups[0]!.browsers).toEqual([
      { browser: 'Chrome 142 · macOS', count: 3 },
      { browser: 'Safari 18 · iOS', count: 1 },
    ]);
    expect(groups[0]!.first).toBe(1_000_000);
    expect(groups[0]!.last).toBe(1_000_100);
  });

  it('reopens an entry marked fixed when it comes back on a newer build, not an old one', async () => {
    const { desk: d } = await desk();
    const r = d.add(error('Boom'), 'a', 1);
    expect(r.ok).toBe(true);
    const key = r.ok ? r.key : '';
    expect(d.setStatus(key, 'fixed', 2)).toBe(true);
    // Someone still on the old build: counted, still fixed.
    expect(d.add(error('Boom'), 'b', 3)).toMatchObject({ ok: true, reopened: false });
    expect(d.group(key)!.status).toBe('fixed');
    // The same error on a build after the fix: open again.
    expect(d.add(error('Boom', 'newer9'), 'c', 4)).toMatchObject({ ok: true, reopened: true });
    expect(d.group(key)).toMatchObject({ status: 'open', reopened: true, count: 3 });
  });

  it('keeps every written report, with its message and picture, as an entry of its own', async () => {
    const { desk: d } = await desk();
    const user = (note: string): Report => ({
      kind: 'user',
      env,
      message: '',
      stack: '',
      at: 1,
      note,
      shot: 'data:image/jpeg;base64,/9j/4AAQ',
    });
    d.add(user('The trains stopped'), 'a', 1);
    d.add(user('The trains stopped'), 'a', 2);
    const groups = d.groups();
    expect(groups).toHaveLength(2);
    expect(groups[0]!.items[0]).toMatchObject({ note: 'The trains stopped', shot: true });
    const full = d.item(groups[0]!.items[0]!.id)!;
    expect(full.report.shot).toMatch(/^data:image\/jpeg/);
  });

  it('can’t be filled past its caps by a modified client', async () => {
    const { desk: d, db } = await desk({
      maxGroups: 20,
      maxItems: 5,
      itemBytes: 60_000,
      rowsPerDay: 200,
      perAddress: { rate: 1000, burst: 1000 },
    });
    let refused = 0;
    // Distinct errors from many addresses: no more groups than the cap.
    for (let i = 0; i < 60; i++)
      if (!d.add(error(`Error number ${'x'.repeat(i)}`), `addr${i}`, 10 + i).ok) refused++;
    expect(d.groups()).toHaveLength(20);
    expect(refused).toBe(40);
    // Written reports with pictures: no more items or bytes than the caps, though they're still counted.
    const user = (i: number): Report => ({
      kind: 'user',
      env,
      message: `m${i}`,
      stack: '',
      at: i,
      note: 'n'.repeat(400),
      shot: `data:image/jpeg;base64,${'A'.repeat(20_000)}`,
    });
    const { desk: d2 } = await desk({
      maxItems: 5,
      itemBytes: 60_000,
      perAddress: { rate: 1000, burst: 1000 },
    });
    for (let i = 0; i < 20; i++) d2.add(user(i), 'z', 100 + i);
    const u = d2.usage(200);
    expect(u.items).toBeLessThanOrEqual(5);
    expect(u.bytes).toBeLessThanOrEqual(60_000);
    // The day's rows: once spent, everything is refused until tomorrow (UTC).
    const { desk: d3, db: db3 } = await desk({ rowsPerDay: 30, perAddress: { rate: 1000, burst: 1000 } });
    let last: ReturnType<ReportDesk['add']> | null = null;
    for (let i = 0; i < 50; i++) last = d3.add(error(`E${'y'.repeat(i)}`), 'q', 1_000 + i);
    expect(last).toMatchObject({ ok: false, status: 503 });
    expect(db3.written()).toBeLessThan(40);
    expect(d3.add(error('tomorrow'), 'q', 1_000 + DAY_MS).ok).toBe(true);
    expect(db.written()).toBeGreaterThan(0);
  });

  it('limits each address and refuses a body over the cap', async () => {
    const { desk: d } = await desk();
    const results = Array.from({ length: 10 }, (_, i) => d.add(error(`E${i}`), 'same', 5));
    expect(results.filter((r) => r.ok)).toHaveLength(REPORT_LIMITS.perAddress.burst);
    expect(results.at(-1)).toMatchObject({ ok: false, status: 429 });
    const huge = await reportsHttp(request('POST', '/report', 'x'.repeat(REPORT_CAPS.body + 10)), d, 'k', 5);
    expect(huge?.status).toBe(413);
  });

  it('forgets entries and items 60 days after they were last seen', async () => {
    const day0 = 10 * DAY_MS;
    const { desk: d } = await desk({}, day0);
    d.add(error('old'), 'a', day0);
    d.add({ kind: 'user', env, message: '', stack: '', at: 1, note: 'old note' }, 'a', day0);
    d.add(error('recent'), 'b', day0 + 30 * DAY_MS);
    expect(d.sweep(day0 + 59 * DAY_MS)).toBe(true);
    expect(d.groups()).toHaveLength(3);
    d.sweep(day0 + 61 * DAY_MS);
    expect(d.groups().map((g) => g.message)).toEqual(['recent']);
    expect(d.usage(day0 + 61 * DAY_MS).items).toBe(0);
  });
});

describe('the owner area', () => {
  it('says it isn’t set up without a key, and still takes reports', async () => {
    const { desk: d } = await desk();
    expect((await reportsHttp(request('GET', '/owner/status'), d, undefined, 1))?.json).toMatchObject({
      setUp: false,
    });
    expect(
      (await reportsHttp(request('GET', '/owner/reports', null, 'anything'), d, undefined, 1))?.status,
    ).toBe(503);
    expect((await reportsHttp(request('POST', '/report', error('x')), d, undefined, 1))?.status).toBe(202);
  });

  it('checks the key on every request and slows down guessing', async () => {
    const { desk: d } = await desk();
    await reportsHttp(request('POST', '/report', error('x')), d, 'secret-key', 1);
    expect((await reportsHttp(request('GET', '/owner/reports'), d, 'secret-key', 2))?.status).toBe(401);
    expect(
      (await reportsHttp(request('GET', '/owner/status', null, 'secret-key'), d, 'secret-key', 2))?.json,
    ).toMatchObject({ setUp: true, ok: true });
    const ok = await reportsHttp(
      request('GET', '/owner/reports?status=open', null, 'secret-key'),
      d,
      'secret-key',
      2,
    );
    expect(ok?.status).toBe(200);
    expect((ok?.json as { groups: unknown[] }).groups).toHaveLength(1);
    let last = 0;
    for (let i = 0; i < 15; i++)
      last = (await reportsHttp(
        request('GET', '/owner/reports', null, `guess${i}`, '9.9.9.9'),
        d,
        'secret-key',
        3,
      ))!.status;
    expect(last).toBe(429);
    // Another address is unaffected.
    expect(
      (await reportsHttp(request('GET', '/owner/reports', null, 'secret-key', '5.5.5.5'), d, 'secret-key', 3))
        ?.status,
    ).toBe(200);
  });

  it('marks fixed, reopens, deletes an item and an entry', async () => {
    const { desk: d } = await desk();
    await reportsHttp(
      request('POST', '/report', { kind: 'user', env, message: '', stack: '', at: 1, note: 'hello' }),
      d,
      'k',
      1,
    );
    const list = (await reportsHttp(request('GET', '/owner/reports', null, 'k'), d, 'k', 2))!.json as {
      groups: { key: string; items: { id: number }[] }[];
    };
    const g = list.groups[0]!;
    expect(
      (
        await reportsHttp(
          request('POST', `/owner/reports/group/${g.key}`, { action: 'fixed' }, 'k'),
          d,
          'k',
          3,
        )
      )?.status,
    ).toBe(200);
    expect(d.group(g.key)!.status).toBe('fixed');
    const item = await reportsHttp(
      request('GET', `/owner/reports/item/${g.items[0]!.id}`, null, 'k'),
      d,
      'k',
      3,
    );
    expect((item?.json as { report: Report }).report.note).toBe('hello');
    expect(
      (await reportsHttp(request('DELETE', `/owner/reports/item/${g.items[0]!.id}`, null, 'k'), d, 'k', 3))
        ?.status,
    ).toBe(200);
    expect(
      (
        await reportsHttp(
          request('POST', `/owner/reports/group/${g.key}`, { action: 'delete' }, 'k'),
          d,
          'k',
          3,
        )
      )?.status,
    ).toBe(200);
    expect(d.groups()).toHaveLength(0);
  });

  it('runs on the local relay over plain HTTP', async () => {
    const relay = await startRelay(0, null, { ownerKey: 'local-key' });
    try {
      const base = `http://127.0.0.1:${relay.port}`;
      const post = await fetch(`${base}/report`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify(error('From the page')),
      });
      expect(post.status).toBe(202);
      expect(post.headers.get('access-control-allow-origin')).toBe('*');
      const denied = await fetch(`${base}/owner/reports`);
      expect(denied.status).toBe(401);
      const list = await fetch(`${base}/owner/reports`, { headers: { authorization: 'Bearer local-key' } });
      const json = (await list.json()) as { groups: { message: string }[] };
      expect(json.groups[0]!.message).toBe('From the page');
    } finally {
      await relay.close();
    }
  });
});
