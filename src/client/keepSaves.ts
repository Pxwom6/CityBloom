/**
 * Asking the browser to keep the game's storage (saved cities, maps, settings) instead of clearing
 * it when the device runs short of space, or, in Safari, after the site goes unvisited for a while.
 * The browser decides: Chrome and Edge agree for installed apps and sites people use a lot, Safari
 * for apps added to the Dock or Home Screen, and Firefox asks the player.
 */

/** What the browser said: 'best-effort' storage may be cleared, 'kept' won't be. */
export type SavesKept = 'unknown' | 'kept' | 'best-effort' | 'unsupported';

/** The two calls of the browser's StorageManager this uses (a stand-in in unit tests). */
export interface PersistentStorage {
  persist(): Promise<boolean>;
  persisted(): Promise<boolean>;
}

export class SaveKeeper {
  state: SavesKept = 'unknown';
  /** Times this page asked the browser (for tests). */
  asks = 0;
  private asking: Promise<SavesKept> | null = null;

  constructor(
    private readonly storage: PersistentStorage | undefined,
    private readonly onChange: () => void = () => undefined,
  ) {}

  /**
   * Ask the browser to keep the saves: once a page, or `again` when something changed its mind
   * (the game was just installed). Firefox shows the player a question, so the game asks only once
   * there's a city or a map to keep, never on a first visit's main menu.
   */
  ask(again = false): Promise<SavesKept> {
    if (this.state === 'kept' || this.state === 'unsupported') return Promise.resolve(this.state);
    if (!this.asking || again) this.asking = this.request();
    return this.asking;
  }

  private async request(): Promise<SavesKept> {
    const s = this.storage;
    if (typeof s?.persist !== 'function' || typeof s.persisted !== 'function') return this.set('unsupported');
    try {
      if (await s.persisted()) return this.set('kept');
      this.asks++;
      return this.set((await s.persist()) ? 'kept' : 'best-effort');
    } catch {
      // Some embedded or private pages refuse outright: the saves work as before.
      return this.set('unsupported');
    }
  }

  private set(state: SavesKept): SavesKept {
    this.state = state;
    this.onChange();
    return state;
  }
}
