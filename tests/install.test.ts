import { describe, expect, it, vi } from 'vitest';
import { AppInstall, runningInstalled, safariWay, type InstallHost } from '../src/client/install';
import { SaveKeeper, type PersistentStorage } from '../src/client/keepSaves';

const UA = {
  macSafari17:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  macSafari16:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  macEdge:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
  macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0',
  winChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1',
};

/** A stand-in for `window`: events to dispatch, display modes that match, a user agent. */
class FakeHost implements InstallHost {
  private listeners = new Map<string, ((e: Event) => void)[]>();
  navigator: InstallHost['navigator'];
  constructor(
    userAgent: string,
    private readonly modes: string[] = [],
    extra: Partial<InstallHost['navigator']> = {},
  ) {
    this.navigator = { userAgent, maxTouchPoints: 0, ...extra };
  }
  addEventListener(type: string, fn: (e: Event) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  matchMedia(query: string) {
    return { matches: this.modes.some((m) => query === `(display-mode: ${m})`) };
  }
  dispatch(e: Event): Event {
    for (const fn of this.listeners.get(e.type) ?? []) fn(e);
    return e;
  }
}

/** Chromium's offer to install, with the player's answer. */
function offer(outcome: 'accepted' | 'dismissed', fail = false) {
  const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  };
  e.prompt = vi.fn(() => (fail ? Promise.reject(new Error('not allowed')) : Promise.resolve()));
  e.userChoice = Promise.resolve({ outcome });
  return e;
}

describe('installing as an app', () => {
  it('reads Safari from its user agent: Add to Dock on a Mac (Safari 17+), the Home Screen on iPhone and iPad', () => {
    expect(safariWay({ userAgent: UA.macSafari17 })).toBe('mac-safari');
    expect(safariWay({ userAgent: UA.macSafari16 })).toBe(null);
    for (const ua of [UA.macChrome, UA.macEdge, UA.macFirefox, UA.winChrome])
      expect(safariWay({ userAgent: ua }), ua).toBe(null);
    expect(safariWay({ userAgent: UA.iphoneSafari })).toBe('ios');
    expect(safariWay({ userAgent: UA.iphoneChrome })).toBe('ios');
    // iPadOS asks for desktop pages as a Mac, but has a touch screen.
    expect(safariWay({ userAgent: UA.macSafari17, maxTouchPoints: 5 })).toBe('ios');
  });

  it('knows when it runs as the installed app (not just a full-screen tab)', () => {
    expect(runningInstalled(new FakeHost(UA.winChrome, ['standalone']))).toBe(true);
    expect(runningInstalled(new FakeHost(UA.winChrome, ['window-controls-overlay']))).toBe(true);
    expect(runningInstalled(new FakeHost(UA.iphoneSafari, [], { standalone: true }))).toBe(true);
    expect(runningInstalled(new FakeHost(UA.winChrome, ['fullscreen']))).toBe(false);
    expect(runningInstalled(new FakeHost(UA.winChrome))).toBe(false);
  });

  it("keeps Chrome's offer for the menu, shows the browser's dialog once, and hides when installed", async () => {
    const host = new FakeHost(UA.winChrome);
    const install = new AppInstall(host);
    const changed = vi.fn();
    const installed = vi.fn();
    install.onChange = changed;
    install.onInstalled = installed;
    // Nothing to offer until the browser makes its offer.
    expect(install.way).toBe(null);
    expect(await install.prompt()).toBe(null);
    const e = host.dispatch(offer('accepted'));
    expect(e.defaultPrevented).toBe(true);
    expect(install.way).toBe('prompt');
    expect(changed).toHaveBeenCalledTimes(1);
    expect(await install.prompt()).toBe('accepted');
    expect((e as ReturnType<typeof offer>).prompt).toHaveBeenCalledTimes(1);
    // An offer is shown once.
    expect(install.way).toBe(null);
    expect(await install.prompt()).toBe(null);
    host.dispatch(new Event('appinstalled'));
    expect(install.installed).toBe(true);
    expect(installed).toHaveBeenCalledTimes(1);
    // A later offer (another visit) is ignored once installed.
    host.dispatch(offer('accepted'));
    expect(install.way).toBe(null);
  });

  it('takes a dismissed or refused dialog as no, and the button goes until the next offer', async () => {
    const host = new FakeHost(UA.macEdge);
    const install = new AppInstall(host);
    host.dispatch(offer('dismissed'));
    expect(await install.prompt()).toBe('dismissed');
    expect(install.way).toBe(null);
    host.dispatch(offer('accepted', true));
    expect(install.way).toBe('prompt');
    expect(await install.prompt()).toBe('dismissed');
    expect(install.installed).toBe(false);
  });

  it('offers the steps in Safari, and nothing in the installed app or in Firefox', () => {
    expect(new AppInstall(new FakeHost(UA.macSafari17)).way).toBe('mac-safari');
    expect(new AppInstall(new FakeHost(UA.iphoneSafari)).way).toBe('ios');
    expect(new AppInstall(new FakeHost(UA.iphoneSafari, [], { standalone: true })).way).toBe(null);
    expect(new AppInstall(new FakeHost(UA.macSafari17, ['standalone'])).way).toBe(null);
    expect(new AppInstall(new FakeHost(UA.macFirefox)).way).toBe(null);
  });
});

/** A stand-in for the browser's StorageManager: says yes or no, counts the asks. */
function storage(grant: boolean, already = false): PersistentStorage & { asked: number } {
  let kept = already;
  const s = {
    asked: 0,
    persisted: () => Promise.resolve(kept),
    persist: () => {
      s.asked++;
      kept = grant;
      return Promise.resolve(grant);
    },
  };
  return s;
}

describe('keeping the saves', () => {
  it('asks once a page and remembers the answer', async () => {
    const s = storage(true);
    const changed = vi.fn();
    const keeper = new SaveKeeper(s, changed);
    expect(keeper.state).toBe('unknown');
    const [a, b] = await Promise.all([keeper.ask(), keeper.ask()]);
    expect([a, b]).toEqual(['kept', 'kept']);
    expect(s.asked).toBe(1);
    expect(keeper.asks).toBe(1);
    expect(changed).toHaveBeenCalled();
    // Kept is kept: even "again" doesn't ask a second time.
    expect(await keeper.ask(true)).toBe('kept');
    expect(s.asked).toBe(1);
  });

  it("doesn't ask when the browser already keeps them", async () => {
    const s = storage(true, true);
    const keeper = new SaveKeeper(s);
    expect(await keeper.ask()).toBe('kept');
    expect(s.asked).toBe(0);
  });

  it('a no stands for the page, unless the game was installed since', async () => {
    const s = storage(false);
    const keeper = new SaveKeeper(s);
    expect(await keeper.ask()).toBe('best-effort');
    expect(await keeper.ask()).toBe('best-effort');
    expect(s.asked).toBe(1);
    expect(await keeper.ask(true)).toBe('best-effort');
    expect(s.asked).toBe(2);
  });

  it('copes with browsers that have no persistent storage, or refuse to say', async () => {
    expect(await new SaveKeeper(undefined).ask()).toBe('unsupported');
    expect(await new SaveKeeper({} as PersistentStorage).ask()).toBe('unsupported');
    const broken: PersistentStorage = {
      persisted: () => Promise.reject(new Error('SecurityError')),
      persist: () => Promise.resolve(true),
    };
    const keeper = new SaveKeeper(broken);
    expect(await keeper.ask()).toBe('unsupported');
    expect(keeper.asks).toBe(0);
  });
});
