/**
 * Installing the game as an app from the main menu. Chrome and Edge (and other Chromium browsers)
 * offer it with `beforeinstallprompt`, which the menu's button turns into the browser's own install
 * dialog; Safari has no such event, so on a Mac and on iPhone or iPad the button shows the steps
 * instead. Nothing shows when the game already runs as the installed app, or where the browser
 * can't install it (Firefox, older Safari).
 */

/** How this browser installs the game, or null when it can't (or the game already is the app). */
export type InstallWay = 'prompt' | 'mac-safari' | 'ios' | null;

/** Chromium's `beforeinstallprompt` event (not in the DOM typings). */
interface InstallOffer extends Event {
  prompt(): Promise<unknown>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** The parts of `window` this needs (a stand-in in unit tests). */
export interface InstallHost {
  addEventListener(type: string, listener: (e: Event) => void): void;
  matchMedia(query: string): { matches: boolean };
  navigator: { userAgent: string; maxTouchPoints?: number; standalone?: boolean };
}

/**
 * Display modes of an installed app's own window. Not `fullscreen`, which Chrome also reports for a
 * browser tab made full screen.
 */
const APP_MODES = ['standalone', 'minimal-ui', 'window-controls-overlay'];

/** Running in the installed app's own window (or from the Home Screen on iPhone and iPad). */
export function runningInstalled(host: InstallHost): boolean {
  if (host.navigator.standalone === true) return true;
  return APP_MODES.some((m) => host.matchMedia(`(display-mode: ${m})`).matches);
}

/** Safari's way to install, from the browser's user agent; null for every other browser. */
export function safariWay(nav: { userAgent: string; maxTouchPoints?: number }): InstallWay {
  const ua = nav.userAgent;
  // iPhone and iPad (every browser there can add to the Home Screen); iPadOS asks for desktop pages
  // as a Mac with a touch screen.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1)) return 'ios';
  if (!/Macintosh/.test(ua) || /Chrome|Chromium|Edg|OPR|Firefox/.test(ua)) return null;
  // Safari on a Mac: Add to Dock came with Safari 17 (macOS Sonoma).
  const version = /Version\/(\d+)[\d.]*.*Safari\//.exec(ua);
  return version && Number(version[1]) >= 17 ? 'mac-safari' : null;
}

export class AppInstall {
  /** The game runs as the installed app, or was installed from this page. */
  installed: boolean;
  /** The browser's offer to install, kept for the menu's button (Chrome, Edge). */
  private offer: InstallOffer | null = null;
  /** Something the menu shows changed. */
  onChange: () => void = () => undefined;
  /** The game was just installed from this page. */
  onInstalled: () => void = () => undefined;

  constructor(private readonly host: InstallHost) {
    this.installed = runningInstalled(host);
    host.addEventListener('beforeinstallprompt', (e) => {
      // The menu's button offers it instead of the browser's own bar (Chrome on Android).
      e.preventDefault();
      this.offer = e as InstallOffer;
      this.onChange();
    });
    host.addEventListener('appinstalled', () => {
      this.installed = true;
      this.offer = null;
      this.onChange();
      this.onInstalled();
    });
  }

  /** How the menu's Install button works here, or null to leave it out. */
  get way(): InstallWay {
    if (this.installed) return null;
    if (this.offer) return 'prompt';
    return safariWay(this.host.navigator);
  }

  /**
   * Open the browser's install dialog and say what the player chose. An offer can be shown once, so
   * the button goes until the browser makes another (on a later visit).
   */
  async prompt(): Promise<'accepted' | 'dismissed' | null> {
    const offer = this.offer;
    if (!offer) return null;
    this.offer = null;
    try {
      // Straight from the click, with nothing awaited first: browsers show the dialog only then.
      await offer.prompt();
      return (await offer.userChoice).outcome;
    } catch {
      return 'dismissed';
    } finally {
      this.onChange();
    }
  }
}
