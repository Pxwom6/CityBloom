/**
 * Hearing about problems (phase 6, M41): the page's side of problem reports. Errors on the page, in
 * the sim worker and the battle workers, saves and loads that fail, models that fail at start-up and
 * desyncs are caught here, cleaned (`relay/reports.ts`), folded and sent to the relay's report desk.
 *
 * - Off when the player turns "Send crash reports" off (Settings): automatic reports aren't even kept.
 *   A written report ("Report a problem") is the player's choice and goes either way.
 * - Never sent: names, chat, city names, saves, typed text. Messages and stacks have every name the
 *   page knows of scrubbed out, and addresses lose their query strings.
 * - At most three reports a minute leave a browser; the same problem within ten minutes is counted
 *   into the next report of it rather than sent again.
 * - With the network down, reports wait in IndexedDB (twenty at most, written ones kept first) and go
 *   when it's back.
 */
import {
  cleanReport,
  reportKey,
  scrubText,
  stripAddresses,
  REPORT_CAPS,
  type Report,
  type ReportDesync,
  type ReportEnv,
  type ReportKind,
} from '../../relay/reports';
import { TokenBucket } from '../../relay/limits';

/** Where reports wait until they can be sent. */
export interface ReportQueue {
  load(): Promise<Report[]>;
  save(list: Report[]): Promise<void>;
}

/** A queue in memory (tests, or a browser without IndexedDB). */
export class MemoryQueue implements ReportQueue {
  list: Report[] = [];
  load(): Promise<Report[]> {
    return Promise.resolve(this.list.slice());
  }
  save(list: Report[]): Promise<void> {
    this.list = list.slice();
    return Promise.resolve();
  }
}

/** The queue in IndexedDB (a database of its own, so the saves' database never changes version). */
export class IdbQueue implements ReportQueue {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (!this.db)
      this.db = new Promise((resolve, reject) => {
        const req = indexedDB.open('citybloom-reports', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('queue');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
      });
    return this.db;
  }

  async load(): Promise<Report[]> {
    const db = await this.open();
    return new Promise((resolve) => {
      const req = db.transaction('queue', 'readonly').objectStore('queue').get('pending');
      req.onsuccess = () => resolve(Array.isArray(req.result) ? (req.result as Report[]) : []);
      req.onerror = () => resolve([]);
    });
  }

  async save(list: Report[]): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve) => {
      const tx = db.transaction('queue', 'readwrite');
      tx.objectStore('queue').put(list, 'pending');
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
}

/** What the reporter asks of the game. */
export interface ReporterHost {
  /** The game and machine, as a report carries them. */
  env(): ReportEnv;
  /** Every name the page knows of (the player's, the city's, friends', districts'), to scrub. */
  names(): string[];
  /** Is "Send crash reports" on? */
  enabled(): boolean;
  /** The report desk's address, or null when this copy of the game has no relay. */
  endpoint(): string | null;
}

export const REPORTER = {
  /** Reports a minute that leave this browser. */
  perMinute: 3,
  /** Reports kept waiting while the network is down. */
  queue: 20,
  /** The same problem again within this long is counted, not sent (ms). */
  fold: 10 * 60_000,
  /** How long to wait before trying again after a failed send (ms), doubling up to `retryMax`. */
  retry: 30_000,
  retryMax: 15 * 60_000,
};

/** The browser and OS from a user agent: nothing finer than a major version. */
export function describeBrowser(ua: string): { browser: string; os: string } {
  const v = (re: RegExp) => re.exec(ua)?.[1];
  let browser = 'Other';
  if (v(/Edg(?:e|A|iOS)?\/(\d+)/)) browser = `Edge ${v(/Edg(?:e|A|iOS)?\/(\d+)/)}`;
  else if (v(/OPR\/(\d+)/)) browser = `Opera ${v(/OPR\/(\d+)/)}`;
  else if (v(/(?:Firefox|FxiOS)\/(\d+)/)) browser = `Firefox ${v(/(?:Firefox|FxiOS)\/(\d+)/)}`;
  else if (v(/CriOS\/(\d+)/)) browser = `Chrome ${v(/CriOS\/(\d+)/)}`;
  else if (v(/HeadlessChrome\/(\d+)/)) browser = `Chrome ${v(/HeadlessChrome\/(\d+)/)} headless`;
  else if (v(/Chrome\/(\d+)/)) browser = `Chrome ${v(/Chrome\/(\d+)/)}`;
  else if (v(/Version\/(\d+(?:\.\d+)?).*Safari/)) browser = `Safari ${v(/Version\/(\d+(?:\.\d+)?).*Safari/)}`;
  let os = 'Other';
  if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  return { browser, os };
}

/** An error's message and stack, whatever was thrown. */
export function errorParts(err: unknown): { message: string; stack: string } {
  if (err instanceof Error) {
    const stack = err.stack ?? '';
    return { message: `${err.name && err.name !== 'Error' ? `${err.name}: ` : ''}${err.message}`, stack };
  }
  if (err && typeof err === 'object' && 'message' in err) {
    const o = err as { message?: unknown; stack?: unknown };
    return { message: String(o.message ?? ''), stack: typeof o.stack === 'string' ? o.stack : '' };
  }
  return { message: typeof err === 'string' ? err : (JSON.stringify(err) ?? String(err)), stack: '' };
}

/** Errors that aren't the game's: browser extensions, cross-origin scripts, a benign layout warning. */
export function ignorable(message: string, stack: string): boolean {
  return (
    /^Script error\.?$/.test(message) ||
    /ResizeObserver loop/.test(message) ||
    /(chrome|moz|safari(-web)?)-extension:\/\//.test(stack)
  );
}

export type SendResult = 'sent' | 'queued' | 'off';

/** The page's report sender. */
export class Reporter {
  private queue: Report[] = [];
  private loaded: Promise<void>;
  private bucket: TokenBucket;
  private folds = new Map<string, { at: number; extra: number }>();
  private flushing = false;
  private retryAt = 0;
  private retryWait = REPORTER.retry;
  private busy = false;
  /** What happened, for the test API and the settings screen. */
  readonly stats = { captured: 0, folded: 0, sent: 0, failed: 0, dropped: 0, skipped: 0 };
  /** The last report made (test API). */
  last: Report | null = null;

  constructor(
    private host: ReporterHost,
    private store: ReportQueue = new MemoryQueue(),
    private now: () => number = () => Date.now(),
    private post: (url: string, body: string) => Promise<number> = async (url, body) =>
      (
        await fetch(url, {
          method: 'POST',
          body,
          headers: { 'content-type': 'text/plain' },
          keepalive: body.length < 60_000,
        })
      ).status,
  ) {
    this.bucket = new TokenBucket(REPORTER.perMinute / 60, REPORTER.perMinute, now());
    this.loaded = store
      .load()
      .then((list) => {
        this.queue = [...list, ...this.queue].slice(-REPORTER.queue);
      })
      .catch(() => undefined);
  }

  /** Build a report from what the page knows, cleaned as the desk will clean it. */
  private make(kind: ReportKind, message: string, stack: string, extra: Partial<Report> = {}): Report | null {
    const names = this.host.names();
    const raw: Report = {
      kind,
      env: this.host.env(),
      message: scrubText(stripAddresses(message), names),
      stack: scrubText(stripAddresses(stack), names),
      at: this.now(),
      ...extra,
    };
    const c = cleanReport(raw);
    return c.ok ? c.report : null;
  }

  /**
   * An automatic report (an error, a worker's failure, a failed save, a desync). Nothing at all when
   * the setting is off; the same problem within ten minutes is only counted.
   */
  capture(
    kind: Exclude<ReportKind, 'user'>,
    err: unknown,
    extra: { desync?: ReportDesync; message?: string } = {},
  ): boolean {
    if (this.busy) return false;
    this.busy = true;
    try {
      if (!this.host.enabled()) {
        this.stats.skipped++;
        return false;
      }
      const parts = errorParts(err);
      const message = extra.message
        ? `${extra.message}${parts.message ? `: ${parts.message}` : ''}`
        : parts.message;
      if (ignorable(message, parts.stack)) return false;
      const r = this.make(kind, message, parts.stack, extra.desync ? { desync: extra.desync } : {});
      if (!r) return false;
      this.stats.captured++;
      const key = reportKey(r);
      const now = this.now();
      const fold = this.folds.get(key);
      if (fold && now - fold.at < REPORTER.fold) {
        fold.extra++;
        this.stats.folded++;
        return false;
      }
      if (fold?.extra) r.count = fold.extra + 1;
      this.folds.set(key, { at: now, extra: 0 });
      this.last = r;
      this.enqueue(r);
      return true;
    } catch {
      return false;
    } finally {
      this.busy = false;
    }
  }

  /** The report "Report a problem" would send, for the player to see before sending. */
  preview(note: string, shot: string | null): Report | null {
    return this.make('user', 'Report a problem', '', {
      ...(note.trim() ? { note: note.trim().slice(0, REPORT_CAPS.note) } : {}),
      ...(shot ? { shot } : {}),
    });
  }

  /** Send a written report ("Report a problem"): sent at once if it can be, else kept until it can. */
  async send(report: Report): Promise<SendResult> {
    if (!this.host.endpoint()) return 'off';
    this.last = report;
    this.enqueue(report, true);
    await this.flush();
    return this.queue.includes(report) ? 'queued' : 'sent';
  }

  /** Can reports leave this copy of the game at all (does it have a relay)? */
  get canSend(): boolean {
    return !!this.host.endpoint();
  }

  /** Reports waiting to be sent. */
  get waiting(): number {
    return this.queue.length;
  }

  private enqueue(r: Report, written = false): void {
    this.queue.push(r);
    // Over the limit, the oldest automatic report goes first; written ones are kept longest.
    while (this.queue.length > REPORTER.queue) {
      const i = this.queue.findIndex((q) => q.kind !== 'user');
      this.queue.splice(i >= 0 ? i : 0, 1);
      this.stats.dropped++;
    }
    void this.store.save(this.queue).catch(() => undefined);
    if (!written) void this.flush();
  }

  /** Send what's waiting, within the rate limit; try again later if the network or desk refuses. */
  async flush(force = false): Promise<void> {
    await this.loaded;
    const url = this.host.endpoint();
    if (!url || this.flushing || !this.queue.length) return;
    if (!force && this.now() < this.retryAt) return;
    this.flushing = true;
    try {
      while (this.queue.length) {
        const r = this.queue[0]!;
        // Written reports go at once; automatic ones keep to a few a minute.
        if (r.kind !== 'user' && !this.bucket.take(this.now())) break;
        let status = 0;
        try {
          status = await this.post(url, JSON.stringify(r));
        } catch {
          status = 0;
        }
        if (status === 202 || status === 400 || status === 413) {
          // Taken, or one the desk will never take: either way it leaves the queue.
          this.queue.shift();
          if (status === 202) this.stats.sent++;
          else this.stats.dropped++;
          this.retryWait = REPORTER.retry;
          continue;
        }
        // The network is down, or the desk is busy or full: keep it and try again later.
        this.stats.failed++;
        this.retryAt = this.now() + this.retryWait;
        this.retryWait = Math.min(REPORTER.retryMax, this.retryWait * 2);
        break;
      }
    } finally {
      this.flushing = false;
      void this.store.save(this.queue).catch(() => undefined);
    }
  }

  /** Watch the page: uncaught errors, rejected promises, and the network coming back. */
  listen(target: Window): void {
    target.addEventListener('error', (e: ErrorEvent) => {
      const err = e.error ?? {
        message: e.message,
        stack: e.filename ? `at ${e.filename}:${e.lineno}:${e.colno}` : '',
      };
      this.capture('error', err);
    });
    target.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) =>
      this.capture('error', e.reason),
    );
    target.addEventListener('online', () => void this.flush(true));
    // Anything waiting from an earlier visit goes once the page has settled, and again now and then.
    setTimeout(() => void this.flush(true), 8000);
    setInterval(() => void this.flush(), 60_000);
  }
}

/** A relay's WebSocket address as the report desk's HTTP address. */
export function reportEndpoint(relay: string | null): string | null {
  return relay ? `${relay.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/$/, '')}/report` : null;
}

/** The relay's HTTP base (the owner area's requests). */
export function relayHttpBase(relay: string | null): string | null {
  return relay ? relay.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/$/, '') : null;
}

/** The page's reporter once the game has made one (null in tests and before boot). */
let installed: Reporter | null = null;

export function installReporter(r: Reporter | null): void {
  installed = r;
}

export function currentReporter(): Reporter | null {
  return installed;
}

/**
 * Report a problem from anywhere on the page (a worker's failure, a save that failed, a desync); does
 * nothing until the game has a reporter, and nothing when the player has turned reports off.
 */
export function reportProblem(
  kind: Exclude<ReportKind, 'user'>,
  err: unknown,
  extra: { desync?: ReportDesync; message?: string } = {},
): void {
  installed?.capture(kind, err, extra);
}

/** A worker's error text ("message\nstack") as an error to report. */
export function workerError(text: string): { message: string; stack: string } {
  const i = text.indexOf('\n');
  return i < 0 ? { message: text, stack: '' } : { message: text.slice(0, i), stack: text.slice(i + 1) };
}
