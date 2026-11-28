import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SUBMIT_LIMITS, SubmissionsDesk, cleanText, glbProblem } from '../submissions';
import { submissionsHttp } from '../submissionsHttp';
import { nodeSql } from '../nodeSql';
import type { HttpRequest } from '../reportsHttp';
import { testModels } from '../../scripts/lib/makeGlb';

/**
 * M48: ideas and buildings players send in. Only the owner sees them (OWNER_KEY on every request); a
 * player sees only their own, by a private token kept as its hash; everyone sees what was accepted and
 * nothing else; a modified client can't push past the caps or read another's submissions.
 */
const KEY = 'owner-key-0123456789-abcdef';
const T = Date.UTC(2026, 10, 27, 12);
const DAY = 86_400_000;
const tokenA = 'a'.repeat(32);
const tokenB = 'b'.repeat(32);
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
const JPEG = b64(
  new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
);
const good = testModels().good;
const goodHash = createHash('sha256').update(good).digest('hex').slice(0, 16);

/** A browser token for the i-th player. */
const tokenOf = (i: number) => i.toString(16).padStart(32, 'c');

/** A GLB holding only a JSON chunk. */
function glbWithJson(json: string): Uint8Array {
  const text = new TextEncoder().encode(json.padEnd(Math.ceil(json.length / 4) * 4, ' '));
  const out = new Uint8Array(20 + text.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, out.length, true);
  v.setUint32(12, text.length, true);
  v.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20);
  return out;
}

async function deskAt(limits: Partial<typeof SUBMIT_LIMITS> = {}) {
  const db = await nodeSql(':memory:');
  return new SubmissionsDesk(db.sql, T, { ...SUBMIT_LIMITS, ...limits });
}

const idea = (o: Record<string, unknown> = {}) => ({
  token: tokenA,
  kind: 'idea',
  about: 'feature',
  title: 'Tram depots with a roof garden',
  text: 'A green roof on the tram depot.\nIt would look lovely from above.',
  credit: 'Ada',
  ...o,
});
const building = (o: Record<string, unknown> = {}) => ({
  token: tokenA,
  kind: 'building',
  about: { kind: 'landmark', size: 2 },
  title: 'Clock pavilion',
  text: 'A little clock tower for the square',
  credit: '',
  glb: b64(good),
  hash: goodHash,
  ...o,
});

function req(
  method: string,
  path: string,
  o: { body?: unknown; key?: string; address?: string } = {},
): HttpRequest {
  const url = new URL(`http://x${path}`);
  return {
    method,
    path: url.pathname,
    query: url.searchParams,
    header: (name) => (name === 'authorization' && o.key ? `Bearer ${o.key}` : null),
    text: () => Promise.resolve(o.body === undefined ? '' : JSON.stringify(o.body)),
    address: o.address ?? '10.0.0.1',
  };
}

describe('M48 submissions', () => {
  it('takes an idea with a screenshot and a building that checks out, and turns away what doesn’t', async () => {
    const d = await deskAt();
    expect(await d.submit(idea({ shot: JPEG }), '10.0.0.1', T)).toMatchObject({ ok: true });
    expect(await d.submit(building(), '10.0.0.2', T)).toMatchObject({ ok: true });
    // An idea needs a kind, a title and words; a screenshot is a JPEG within its size.
    expect(await d.submit(idea({ about: 'cheat' }), 'x', T)).toMatchObject({ ok: false, status: 400 });
    expect(await d.submit(idea({ title: '   ' }), 'x', T)).toMatchObject({
      ok: false,
      why: 'Give it a title',
    });
    expect(await d.submit(idea({ shot: b64(new Uint8Array([1, 2, 3, 4])) }), 'x', T)).toMatchObject({
      ok: false,
    });
    expect(await d.submit(idea({ shot: 'A'.repeat(SUBMIT_LIMITS.shotChars + 4) }), 'x', T)).toMatchObject({
      status: 413,
    });
    // A building's model must be the one its hash names, a GLB with nothing outside it, within 1 MB.
    expect(await d.submit(building({ hash: '0'.repeat(16) }), 'x', T)).toMatchObject({
      ok: false,
      why: 'The model isn’t the one it says it is',
    });
    const outside = testModels().outside;
    expect(glbProblem(outside)).toMatch(/outside itself/);
    expect(await d.submit(building({ glb: b64(outside) }), 'x', T)).toMatchObject({ ok: false });
    expect(await d.submit(building({ glb: b64(new Uint8Array(64)) }), 'x', T)).toMatchObject({ ok: false });
    // A GLB whose JSON isn't an object, or whose lists aren't lists, is refused, not a crash.
    for (const json of ['null', '[]', '7', '{"buffers":5}', '{"images":{"uri":"x"}}', '{"buffers":[null]}'])
      expect(glbProblem(glbWithJson(json))).toBe(
        json === '{"buffers":[null]}' ? null : 'The model can’t be read',
      );
    expect(await d.submit(building({ glb: 'A'.repeat(SUBMIT_LIMITS.glbChars + 4) }), 'x', T)).toMatchObject({
      status: 413,
    });
    expect(await d.submit(building({ about: { kind: 'look', def: '../x' } }), 'x', T)).toMatchObject({
      ok: false,
    });
    // A token is 32 hex digits from the browser; nothing else identifies a player.
    expect(await d.submit(idea({ token: 'mine' }), 'x', T)).toMatchObject({ ok: false });
    // Text is cleaned: nothing unseen, lines kept, capped.
    expect(cleanText('a\u0000b​c\n\n\n\nd  e', 100, true)).toBe('abc\n\nd e');
    expect(cleanText('x'.repeat(200), 80)).toHaveLength(80);
  });

  it('shows a player only their own, and everyone only what was accepted', async () => {
    const d = await deskAt();
    const a1 = (await d.submit(idea(), '1', T)) as { id: number };
    const a2 = (await d.submit(building(), '1', T)) as { id: number };
    const b1 = (await d.submit(idea({ token: tokenB, title: 'Ferries', credit: 'Bo' }), '2', T)) as {
      id: number;
    };
    expect((await d.mine(tokenA))!.map((r) => r.id)).toEqual([a2.id, a1.id]);
    expect((await d.mine(tokenB))!.map((r) => r.id)).toEqual([b1.id]);
    expect(await d.mine('c'.repeat(32))).toEqual([]);
    expect(await d.mine('not a token')).toBeNull();
    // Nothing is public until accepted; declined and seen ones never are.
    expect(d.accepted()).toEqual([]);
    expect(d.decide(a1.id, 'accepted', 'Coming in an update!', T + 1)).toEqual({ ok: true });
    expect(d.decide(a2.id, 'declined', 'Not this time: too tall', T + 2)).toEqual({ ok: true });
    expect(d.decide(b1.id, 'seen', '', T + 3)).toEqual({ ok: true });
    expect(d.accepted()).toEqual([
      {
        id: a1.id,
        kind: 'idea',
        about: 'feature',
        title: 'Tram depots with a roof garden',
        credit: 'Ada',
        decided: T + 1,
      },
    ]);
    const mine = await d.mine(tokenA);
    expect(mine!.map((r) => [r.status, r.reply])).toEqual([
      ['declined', 'Not this time: too tall'],
      ['accepted', 'Coming in an update!'],
    ]);
    // The token itself is never stored: only its SHA-256.
    const stored = d
      .ownerList()
      .map((r) => JSON.stringify(r))
      .join();
    expect(stored).not.toContain(tokenA);
  });

  it('remembers each address’s sends after the object is put away, and forgets them with the day', async () => {
    const db = await nodeSql(':memory:');
    const first = new SubmissionsDesk(db.sql, T, SUBMIT_LIMITS);
    for (let i = 0; i < SUBMIT_LIMITS.perAddress; i++)
      expect(await first.submit(idea({ token: tokenOf(i) }), '10.0.0.9', T)).toMatchObject({ ok: true });
    // Evicted while idle: a new object on the same storage, new tokens, the same address.
    const second = new SubmissionsDesk(db.sql, T + 120_000, SUBMIT_LIMITS);
    expect(await second.submit(idea({ token: tokenOf(9) }), '10.0.0.9', T + 120_000)).toMatchObject({
      ok: false,
      status: 429,
    });
    // Nothing stored names the address; the day's salt and counts go once the day is over.
    const dump =
      JSON.stringify(db.sql.exec('SELECT * FROM rates').toArray()) +
      JSON.stringify(db.sql.exec('SELECT * FROM kv').toArray());
    expect(dump).not.toContain('10.0.0.9');
    second.sweep(T + DAY);
    expect(db.sql.exec('SELECT * FROM rates').toArray()).toEqual([]);
    expect(db.sql.exec("SELECT * FROM kv WHERE k LIKE 'salt%'").toArray()).toEqual([]);
    expect(await second.submit(idea({ token: tokenOf(9) }), '10.0.0.9', T + DAY)).toMatchObject({ ok: true });
    // And so many in all a day, from any number of tokens and addresses.
    const capped = await deskAt({ perDayAll: 3 });
    for (let i = 0; i < 3; i++)
      expect(await capped.submit(idea({ token: tokenOf(i) }), `10.2.0.${i}`, T)).toMatchObject({ ok: true });
    expect(await capped.submit(idea({ token: tokenOf(5) }), '10.2.0.5', T)).toMatchObject({
      ok: false,
      status: 503,
    });
  });

  it('holds a browser and an address to a few a day, and keeps within its size', async () => {
    const d = await deskAt();
    for (let i = 0; i < SUBMIT_LIMITS.perDay; i++)
      expect(await d.submit(idea({ title: `Idea ${i}` }), '10.0.0.9', T)).toMatchObject({ ok: true });
    expect(await d.submit(idea(), '10.0.0.10', T)).toMatchObject({ ok: false, status: 429 });
    // A new token from the same address: still that address's five.
    expect(SUBMIT_LIMITS.perAddress).toBe(SUBMIT_LIMITS.perDay);
    expect(await d.submit(idea({ token: tokenB }), '10.0.0.9', T)).toMatchObject({ ok: false, status: 429 });
    // Tomorrow, both may send again.
    expect(await d.submit(idea(), '10.0.0.9', T + DAY)).toMatchObject({ ok: true });
    // A full inbox says so.
    const small = await deskAt({ kept: 1 });
    expect(await small.submit(idea(), '1', T)).toMatchObject({ ok: true });
    expect(await small.submit(idea({ token: tokenB }), '2', T)).toMatchObject({ ok: false, status: 503 });
    // And so does one whose pictures and models fill their share of the storage.
    const full = await deskAt({ fileBytes: 30_000 });
    expect(await full.submit(building(), '1', T)).toMatchObject({ ok: true });
    expect(await full.submit(building({ token: tokenB }), '2', T)).toMatchObject({ ok: false, status: 503 });
    expect(await full.submit(idea({ token: tokenB }), '2', T)).toMatchObject({ ok: true });
    // A credit name the owner's filter catches is refused.
    d.setWords(['rude']);
    expect(await d.submit(idea({ token: tokenB, credit: 'Mr Rude' }), '3', T + DAY)).toMatchObject({
      ok: false,
      why: 'That name isn’t allowed: choose another',
    });
  });

  it('deletes declined ones 30 days after the decision, and keeps accepted ones', async () => {
    const d = await deskAt();
    const a = (await d.submit(idea(), '1', T)) as { id: number };
    const b = (await d.submit(idea({ token: tokenB }), '2', T)) as { id: number };
    d.decide(a.id, 'accepted', '', T);
    d.decide(b.id, 'declined', '', T);
    d.sweep(T + 29 * DAY);
    expect(d.ownerList().length).toBe(2);
    d.sweep(T + 31 * DAY);
    expect(d.ownerList().map((r) => r.id)).toEqual([a.id]);
    expect(d.accepted().map((r) => r.id)).toEqual([a.id]);
  });

  it('keeps everything behind the owner key over HTTP, and lets the owner decide, reply and delete', async () => {
    const d = await deskAt();
    const http = (r: HttpRequest, key: string | null = KEY) => submissionsHttp(r, d, key ?? undefined, T);
    const sent = await http(req('POST', '/submit', { body: idea({ shot: JPEG }) }));
    expect(sent).toMatchObject({ status: 200 });
    const id = (sent!.json as { id: number }).id;
    await http(req('POST', '/submit', { body: building(), address: '10.0.0.2' }));
    // Without the key (or with a wrong one) nothing is reachable; unset, it says so.
    expect((await http(req('GET', '/owner/submissions')))!.status).toBe(401);
    expect(
      (await http(req('GET', `/owner/submissions/${id}`, { key: 'wrong-key-0123456789x' })))!.status,
    ).toBe(401);
    expect((await http(req('GET', '/owner/submissions', { key: KEY }), null))!.status).toBe(503);
    // Nor can anything be changed: deciding, deleting, the word filter (each try from its own address:
    // one address's wrong keys are slowed to a few a minute, a 429).
    let n = 20;
    for (const [path, body] of [
      [`/owner/submissions/${id}`, { status: 'accepted', reply: 'Mine now' }],
      [`/owner/submissions/${id}`, { action: 'delete' }],
      ['/owner/submissions/words', { words: [] }],
    ] as const) {
      expect((await http(req('POST', path, { body, address: `10.1.0.${n++}` })))!.status).toBe(401);
      const wrong = { body, key: 'wrong-key-0123456789x', address: `10.1.0.${n++}` };
      expect((await http(req('POST', path, wrong)))!.status).toBe(401);
    }
    expect(d.ownerItem(id)).toMatchObject({ status: 'sent', reply: '' });
    // Wrong keys slow guessing from an address, but never lock the owner out, from there or anywhere.
    for (let i = 0; i < 40; i++)
      await http(req('GET', '/owner/submissions', { key: `guess-${i}-0123456789x` }));
    expect((await http(req('GET', '/owner/submissions', { key: 'guess-last-0123456789x' })))!.status).toBe(
      429,
    );
    expect((await http(req('GET', '/owner/submissions', { key: KEY })))!.status).toBe(200);
    // Players reach only their own and the accepted list.
    const mine = (token: string) => http(req('POST', '/submit/mine', { body: { token } }));
    expect((await mine(tokenB))!.json).toEqual({ mine: [] });
    expect((await http(req('POST', '/submit/mine', { body: { token: 'nope' } })))!.status).toBe(400);
    // The token goes in the body only: an address naming it reaches nothing.
    expect((await http(req('GET', `/submit/mine?token=${tokenA}`)))!.status).toBe(404);
    expect((await http(req('GET', '/submit/accepted')))!.json).toEqual({ accepted: [] });
    expect((await http(req('GET', `/submit/${id}`)))!.status).toBe(404);
    // The owner: the list without files, one with its file, a decision with a reply, a delete.
    const list = (await http(req('GET', '/owner/submissions?kind=idea', { key: KEY })))!.json as {
      submissions: { id: number; file: boolean }[];
    };
    expect(list.submissions.map((r) => [r.id, r.file])).toEqual([[id, true]]);
    const one = (await http(req('GET', `/owner/submissions/${id}`, { key: KEY })))!.json as { data: string };
    expect(one.data).toBe(JPEG);
    expect(
      (await http(
        req('POST', `/owner/submissions/${id}`, { key: KEY, body: { status: 'accepted', reply: 'Lovely' } }),
      ))!.status,
    ).toBe(200);
    const mineA = (
      (await mine(tokenA))!.json as {
        mine: { id: number; reply: string }[];
      }
    ).mine;
    // Token A sent both: the building is newest, the idea has the reply.
    expect(mineA.find((r) => r.id === id)!.reply).toBe('Lovely');
    expect(
      ((await http(req('GET', '/submit/accepted')))!.json as { accepted: unknown[] }).accepted,
    ).toHaveLength(1);
    expect(
      (await http(req('POST', `/owner/submissions/${id}`, { key: KEY, body: { action: 'delete' } })))!.status,
    ).toBe(200);
    expect((await http(req('GET', `/owner/submissions/${id}`, { key: KEY })))!.status).toBe(404);
    // Words for the filter.
    expect(
      (await http(req('POST', '/owner/submissions/words', { key: KEY, body: { words: ['Rude!', 'x'] } })))!
        .json,
    ).toEqual({
      ok: true,
      words: ['rude', 'x'],
    });
    // Too big a body is refused before it's read.
    const big: HttpRequest = {
      ...req('POST', '/submit'),
      header: (n) => (n === 'content-length' ? String(SUBMIT_LIMITS.body + 1) : null),
    };
    expect((await http(big))!.status).toBe(413);
  });
});
