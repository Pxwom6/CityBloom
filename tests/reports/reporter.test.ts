/**
 * The page's reporter (M41): nothing when the setting is off, duplicates folded, a few a minute, a
 * queue that waits out the network and keeps written reports first, names scrubbed.
 */
import { describe, expect, it } from 'vitest';
import {
  describeBrowser,
  MemoryQueue,
  Reporter,
  REPORTER,
  type ReporterHost,
} from '../../src/client/reports';
import type { Report } from '../../relay/reports';

function setup(opts: { enabled?: boolean; down?: boolean; endpoint?: string | null } = {}) {
  let t = 1_000_000;
  const state = { enabled: opts.enabled ?? true, down: opts.down ?? false };
  const posted: Report[] = [];
  const host: ReporterHost = {
    env: () => ({
      build: 'abc',
      browser: 'Chrome 142',
      os: 'macOS',
      quality: 'high',
      save: 32,
      shared: 'no',
      where: 'city',
    }),
    names: () => ['Ada', 'Adatown'],
    enabled: () => state.enabled,
    endpoint: () => (opts.endpoint === undefined ? 'http://relay/report' : opts.endpoint),
  };
  const queue = new MemoryQueue();
  const reporter = new Reporter(
    host,
    queue,
    () => t,
    async (_url, body) => {
      if (state.down) throw new Error('offline');
      posted.push(JSON.parse(body) as Report);
      return 202;
    },
  );
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { reporter, posted, queue, state, settle, advance: (ms: number) => (t += ms) };
}

describe('the page reporter', () => {
  it('sends nothing at all with crash reports off', async () => {
    const { reporter, posted, queue, settle } = setup({ enabled: false });
    reporter.capture('error', new Error('Boom'));
    reporter.capture('worker', { message: 'x', stack: '' });
    await settle();
    await reporter.flush(true);
    expect(posted).toHaveLength(0);
    expect(queue.list).toHaveLength(0);
    expect(reporter.stats.skipped).toBe(2);
  });

  it('still sends a written report with crash reports off', async () => {
    const { reporter, posted } = setup({ enabled: false });
    const r = reporter.preview('The bridge vanished', null)!;
    expect(await reporter.send(r)).toBe('sent');
    expect(posted[0]!.note).toBe('The bridge vanished');
  });

  it('folds the same problem within ten minutes into the next report of it', async () => {
    const { reporter, posted, settle, advance } = setup();
    for (let i = 0; i < 4; i++) reporter.capture('error', new Error(`Boom at tick ${i}`));
    await settle();
    expect(posted).toHaveLength(1);
    advance(REPORTER.fold + 1);
    reporter.capture('error', new Error('Boom at tick 99'));
    await settle();
    expect(posted).toHaveLength(2);
    expect(posted[1]!.count).toBe(4);
  });

  it('sends at most three a minute and the rest later', async () => {
    const { reporter, posted, settle, advance } = setup();
    for (let i = 0; i < 5; i++) reporter.capture('error', new Error(`Different ${'x'.repeat(i)}`));
    await settle();
    expect(posted).toHaveLength(3);
    expect(reporter.waiting).toBe(2);
    advance(40_000);
    await reporter.flush();
    expect(posted).toHaveLength(5);
  });

  it('waits out the network, keeping twenty at most and written reports first', async () => {
    const { reporter, posted, queue, state, settle, advance } = setup({ down: true });
    const written = reporter.preview('Please look at this', null)!;
    await reporter.send(written);
    for (let i = 0; i < 30; i++) {
      reporter.capture('error', new Error(`E${'y'.repeat(i)}`));
      advance(1000);
    }
    await settle();
    expect(posted).toHaveLength(0);
    expect(queue.list.length).toBe(REPORTER.queue);
    expect(queue.list.some((r) => r.kind === 'user')).toBe(true);
    state.down = false;
    for (let i = 0; i < 12; i++) {
      advance(60_000);
      await reporter.flush(true);
    }
    expect(posted.some((r) => r.note === 'Please look at this')).toBe(true);
    expect(posted).toHaveLength(REPORTER.queue);
    expect(reporter.waiting).toBe(0);
  });

  it('scrubs names and strips query strings before anything leaves', async () => {
    const { reporter, posted, settle } = setup();
    const err = new Error('Ada could not open Adatown');
    err.stack =
      'Error: Ada could not open Adatown\n    at load (http://x.test/CityBloom/?load=s1&name=Adatown:1:2)';
    reporter.capture('load', err);
    await settle();
    const sent = JSON.stringify(posted[0]);
    expect(sent).not.toContain('Ada ');
    expect(sent).not.toContain('Adatown');
    expect(posted[0]!.message).toBe('[name] could not open [name]');
  });

  it('can’t send without a relay, and says so', async () => {
    const { reporter } = setup({ endpoint: null });
    expect(reporter.canSend).toBe(false);
    expect(await reporter.send(reporter.preview('hi', null)!)).toBe('off');
  });

  it('names browsers and systems no finer than a major version', () => {
    expect(
      describeBrowser(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15',
      ),
    ).toEqual({ browser: 'Safari 18.4', os: 'macOS' });
    expect(
      describeBrowser(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0',
      ),
    ).toEqual({ browser: 'Edge 142', os: 'Windows' });
    expect(
      describeBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) CriOS/142.0 Mobile Safari'),
    ).toEqual({
      browser: 'Chrome 142',
      os: 'iOS',
    });
    expect(
      describeBrowser('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0').browser,
    ).toBe('Firefox 140');
  });
});
