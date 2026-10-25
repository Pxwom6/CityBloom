/**
 * Keeping within Cloudflare's free plan under abuse (F8): a token bucket for rate limits, and the
 * daily row budget each room and region keeps. One person with a script must not be able to use up
 * the account's daily allowance for everyone; honest play stays far inside both.
 */

/** A token bucket: `rate` tokens a second up to `burst`. Starts full. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    readonly rate: number,
    readonly burst: number,
    now: number,
  ) {
    this.tokens = burst;
    this.last = now;
  }

  private refill(now: number): void {
    this.tokens = Math.min(this.burst, this.tokens + (Math.max(0, now - this.last) / 1000) * this.rate);
    this.last = now;
  }

  /** Take a token if there is one. */
  take(now: number): boolean {
    this.refill(now);
    if (this.tokens < 1) return false;
    this.tokens--;
    return true;
  }

  /**
   * Spend a token whether there is one or not, and say what's left: below zero the message is
   * dropped, and a connection that keeps going until `-burst` is closed (dropped messages are
   * still billed as requests, so a torrent mustn't be left open).
   */
  spend(now: number): number {
    this.refill(now);
    this.tokens = Math.max(-2 * this.burst, this.tokens - 1);
    return this.tokens;
  }

  /** Milliseconds until a token is free (0: one is). */
  wait(now: number): number {
    this.refill(now);
    return this.tokens >= 1 ? 0 : Math.ceil(((1 - this.tokens) / this.rate) * 1000);
  }
}

export const DAY_MS = 86_400_000;

/** Rows written on one UTC day, kept in a room's or region's own record across restarts. */
export interface RowBudget {
  day: number;
  rows: number;
}

/**
 * The rows an object may write in a UTC day. Counted from its store's own tally, so every write is
 * counted whatever made it; the count at the last save of the object's record carries over a
 * restart (rows written after that and lost to an eviction go uncounted, a few at most).
 */
export class DailyRows {
  private day: number;
  private base: number;
  private from: number;

  constructor(
    readonly limit: number,
    private readonly written: () => number,
    saved: RowBudget | undefined,
    now: number,
  ) {
    this.day = Math.floor(now / DAY_MS);
    this.base = saved && saved.day === this.day ? saved.rows : 0;
    this.from = written();
  }

  /** Rows written today. */
  used(now: number): number {
    const day = Math.floor(now / DAY_MS);
    if (day !== this.day) {
      this.day = day;
      this.base = 0;
      this.from = this.written();
    }
    return this.base + this.written() - this.from;
  }

  /** Has today's allowance gone? */
  over(now: number): boolean {
    return this.used(now) >= this.limit;
  }

  /** For the object's record. */
  record(now: number): RowBudget {
    return { day: this.day, rows: this.used(now) };
  }
}

/** What a room or region says when its day's allowance has gone. */
export const dailyLimitText = (what: 'room' | 'region'): string =>
  `This ${what} has reached today's limit; back tomorrow (UTC)`;
