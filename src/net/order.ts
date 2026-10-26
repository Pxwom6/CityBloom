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

/**
 * When a link is given up: more messages waiting for one sent before them, or more of their
 * characters, than this; or a gap that hasn't moved on for `gapMs` (a message Trystero lost). No
 * message the game sends is much over 200 KB (a city goes in parts of that size), each arrives much
 * sooner than a minute on any connection a game can be played over, and each one that lands moves the
 * gap on.
 */
export const ORDER_LIMITS = { held: 4096, chars: 16_000_000, gapMs: 60_000 };

/** Number each message sent: `7:{"t":"ev",…}`. */
export function numbered(send: (text: string) => void): (text: string) => void {
  let n = 0;
  return (text) => send(`${n++}:${text}`);
}

/**
 * Take numbered messages as they arrive and hand them on in order. A message already handed on is
 * dropped; one that isn't numbered text, too much held back (`ORDER_LIMITS`), or a gap that doesn't
 * fill within `gapMs` calls `broken` once and nothing more is handed on. If handing a message on
 * throws, the ones behind it are still handed on, and then the first error is thrown.
 */
export function inOrder(
  deliver: (text: string) => void,
  broken: (why: string) => void,
  gapMs = ORDER_LIMITS.gapMs,
): (raw: unknown) => void {
  let next = 0;
  let chars = 0;
  let dead = false;
  const held = new Map<number, string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** The number the running timer waits for. */
  let waitingFor = -1;
  const stopTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const fail = (why: string) => {
    if (dead) return;
    dead = true;
    held.clear();
    stopTimer();
    broken(why);
  };
  /** Time a gap from when the link started waiting for its first missing message. */
  const watch = () => {
    if (!held.size) return stopTimer();
    if (timer !== null && waitingFor === next) return;
    stopTimer();
    waitingFor = next;
    timer = setTimeout(() => {
      timer = null;
      if (held.size && waitingFor === next) fail('a message never arrived');
      else if (!dead) watch();
    }, gapMs);
  };
  return (raw) => {
    if (dead) return;
    if (typeof raw !== 'string') return fail('a message that was not text');
    const colon = raw.indexOf(':');
    const n = colon > 0 && colon <= 15 ? Number(raw.slice(0, colon)) : NaN;
    if (!Number.isSafeInteger(n) || n < 0) return fail('a message without its number');
    if (n < next || held.has(n)) return;
    const text = raw.slice(colon + 1);
    if (n > next) {
      held.set(n, text);
      chars += text.length;
      if (held.size > ORDER_LIMITS.held || chars > ORDER_LIMITS.chars)
        return fail('too many messages out of order');
      return watch();
    }
    // The one the link waits for: hand it on, then every one held back behind it.
    let error: { thrown: unknown } | null = null;
    let t: string | undefined = text;
    next++;
    while (t !== undefined && !dead) {
      try {
        deliver(t);
      } catch (thrown) {
        error ??= { thrown };
      }
      t = held.get(next);
      if (t !== undefined) {
        held.delete(next);
        chars -= t.length;
        next++;
      }
    }
    if (!dead) watch();
    if (error) throw error.thrown;
  };
}
