/**
 * The installable, offline app on the page's side (M15). Registers the service worker (built
 * pages only, not the dev server), notices when a new version has been downloaded, and switches to
 * it when the player asks: the page reloads into the new version. DESIGN.md §6.
 */

/** How often a long session looks for a new version (also on returning to the tab). */
const CHECK_EVERY_MS = 60 * 60_000;
/** Set just before reloading into a new version, so the new page can say so. */
const UPDATED_KEY = 'citybloom.updated';

export class AppUpdates {
  /** A new version is downloaded and waiting; reloading switches to it. */
  waiting = false;
  /** The game's files are kept on this device: it opens without a network. */
  offlineReady = false;
  /** The player chose "Later" for the waiting version. */
  dismissed = false;
  private reg: ServiceWorkerRegistration | null = null;
  private applying = false;

  constructor(private readonly onChange: () => void) {}

  start(url: string, scope: string): void {
    const sw = navigator.serviceWorker as ServiceWorkerContainer | undefined;
    if (!sw) return;
    let controlled = !!sw.controller;
    sw.addEventListener('controllerchange', () => {
      if (this.applying) location.reload();
      // Another tab switched to a new version: this one is out of date until it reloads.
      else if (controlled) this.found();
      controlled = true;
    });
    sw.register(url, { scope })
      .then((reg) => {
        this.reg = reg;
        if (reg.waiting && sw.controller) this.found();
        reg.addEventListener('updatefound', () => {
          const next = reg.installing;
          next?.addEventListener('statechange', () => {
            // With no controller yet this is the first install, not an update.
            if (next.state === 'installed' && sw.controller) this.found();
          });
        });
        void sw.ready.then(() => {
          this.offlineReady = true;
          this.onChange();
        });
        setInterval(() => void this.check(), CHECK_EVERY_MS);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') void this.check();
        });
      })
      // No service worker (private windows in some browsers, file://): the game still runs online.
      .catch(() => undefined);
  }

  /** Ask the server for a new version now (fails quietly offline). */
  async check(): Promise<void> {
    await this.reg?.update().catch(() => undefined);
  }

  /** Reload into the waiting version. */
  apply(): void {
    this.applying = true;
    try {
      sessionStorage.setItem(UPDATED_KEY, '1');
    } catch {
      // Storage blocked: the new page just won't mention the update.
    }
    const next = this.reg?.waiting;
    if (next) next.postMessage('skipWaiting');
    else location.reload();
  }

  dismiss(): void {
    this.dismissed = true;
    this.onChange();
  }

  private found(): void {
    if (this.waiting) return;
    this.waiting = true;
    this.dismissed = false;
    this.onChange();
  }
}

/** True once, on the first page after reloading into a new version. */
export function justUpdated(): boolean {
  try {
    const was = sessionStorage.getItem(UPDATED_KEY) === '1';
    sessionStorage.removeItem(UPDATED_KEY);
    return was;
  } catch {
    return false;
  }
}
