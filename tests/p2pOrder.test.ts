import { describe, expect, it } from 'vitest';
import { inOrder, numbered, ORDER_LIMITS } from '../src/net/order';

/**
 * Trystero sends a big message as a transfer of its own, so a small one sent after it can arrive
 * first (a room's events overtook the city a friend was joining with). A Trystero link numbers its
 * messages and the other side hands them on in order (multiplayer review).
 */
function pair() {
  const sent: string[] = [];
  const got: string[] = [];
  const why: string[] = [];
  const send = numbered((raw) => sent.push(raw));
  const receive = inOrder(
    (text) => got.push(text),
    (w) => why.push(w),
  );
  return { sent, got, why, send, receive };
}

describe('messages over Trystero arrive in the order they were sent', () => {
  it('hands on a city and the events after it in order, though the events overtook it', () => {
    const { sent, got, why, send, receive } = pair();
    const city = JSON.stringify({ t: 'snap', part: 0, data: 'x'.repeat(50_000) });
    const events = JSON.stringify({ t: 'ev', list: [], allow: 99 });
    send(city);
    send(events);
    // As Trystero delivered them: the small message first.
    receive(sent[1]);
    expect(got).toEqual([]);
    receive(sent[0]);
    expect(got).toEqual([city, events]);
    expect(why).toEqual([]);
  });

  it('puts any shuffle of many messages back in order', () => {
    const { sent, got, why, send, receive } = pair();
    const texts = Array.from({ length: 300 }, (_, i) => `{"n":${i}}`);
    for (const t of texts) send(t);
    // A fixed shuffle (no Math.random in tests that must repeat).
    const order = sent.map((_, i) => i).sort((a, b) => ((a * 7919) % 300) - ((b * 7919) % 300));
    for (const i of order) receive(sent[i]);
    expect(got).toEqual(texts);
    expect(why).toEqual([]);
  });

  it('drops a message it already handed on, and keeps text with colons whole', () => {
    const { sent, got, send, receive } = pair();
    send('{"t":"chat","text":"a: b: c"}');
    receive(sent[0]);
    receive(sent[0]);
    expect(got).toEqual(['{"t":"chat","text":"a: b: c"}']);
  });

  it('gives the link up on a message without its number, or that is not text', () => {
    for (const bad of ['{"t":"ev"}', ':{"t":"ev"}', 'x:{}', '-1:{}', 42, new Uint8Array(4)]) {
      const { got, why, receive } = pair();
      receive(bad);
      receive('0:{"t":"ev"}');
      expect(got).toEqual([]);
      expect(why.length).toBe(1);
    }
  });

  it('gives the link up when a gap never fills', () => {
    const { got, why, receive } = pair();
    for (let n = 1; n <= ORDER_LIMITS.held + 1; n++) receive(`${n}:{}`);
    expect(got).toEqual([]);
    expect(why).toEqual(['too many messages out of order']);
    receive('0:{}');
    expect(got).toEqual([]);
  });

  it('gives the link up when what is held back grows too big', () => {
    const { why, receive } = pair();
    receive(`1:${'x'.repeat(ORDER_LIMITS.chars + 1)}`);
    expect(why).toEqual(['too many messages out of order']);
  });
});
