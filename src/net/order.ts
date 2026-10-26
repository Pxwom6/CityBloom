/**
 * A link's messages in the order they were sent, over Trystero (multiplayer review).
 *
 * Trystero sends a message bigger than one frame (about 16 KB) as a transfer of its own, offered and
 * accepted before its chunks go, so a small message sent after a big one can arrive first. A room
 * sends a joining player the city and then the events since: through Trystero the events overtook
 * the city, the join waited for events that had already come and gone, and a friend joining a city
 * that stood still never got in. So every message on a Trystero link carries its number, and the
 * other side hands them on in that order. (Our relay's own data channels and sockets keep order.)
 */

/** Messages that may wait for one sent before them, and their characters, before the link is given up. */
export const ORDER_LIMITS = { held: 4096, chars: 16_000_000 };

/** Number each message sent: `7:{"t":"ev",…}`. */
export function numbered(send: (text: string) => void): (text: string) => void {
  let n = 0;
  return (text) => send(`${n++}:${text}`);
}

/**
 * Take numbered messages as they arrive and hand them on in order. A message already handed on is
 * dropped; one that isn't numbered text, or a gap that never fills (more held back than
 * `ORDER_LIMITS` allows), calls `broken` once and nothing more is handed on.
 */
export function inOrder(
  deliver: (text: string) => void,
  broken: (why: string) => void,
): (raw: unknown) => void {
  let next = 0;
  let chars = 0;
  let dead = false;
  const held = new Map<number, string>();
  const fail = (why: string) => {
    if (dead) return;
    dead = true;
    held.clear();
    broken(why);
  };
  return (raw) => {
    if (dead) return;
    if (typeof raw !== 'string') return fail('a message that was not text');
    const colon = raw.indexOf(':');
    const n = colon > 0 && colon <= 15 ? Number(raw.slice(0, colon)) : NaN;
    if (!Number.isSafeInteger(n) || n < 0) return fail('a message without its number');
    if (n < next || held.has(n)) return;
    const text = raw.slice(colon + 1);
    held.set(n, text);
    chars += text.length;
    if (held.size > ORDER_LIMITS.held || chars > ORDER_LIMITS.chars)
      return fail('too many messages out of order');
    for (let t = held.get(next); t !== undefined; t = held.get(next)) {
      held.delete(next);
      chars -= t.length;
      next++;
      deliver(t);
      if (dead) return;
    }
  };
}
