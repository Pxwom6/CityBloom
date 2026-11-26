/**
 * The player's platform, for shortcuts (M14): macOS uses Cmd where others use Ctrl, and the
 * interface names the keys the way the platform does.
 */
export const isMac: boolean =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
      navigator.platform ??
      navigator.userAgent,
  );

/** The command key's name: ⌘ on macOS, Ctrl elsewhere. */
export const MOD = isMac ? '⌘' : 'Ctrl';

/** A shortcut with the command key, as shown to the player ("⌘Z", "Ctrl+Z"). */
export function modKey(key: string, shift = false): string {
  if (isMac) return `${shift ? '⇧' : ''}⌘${key}`;
  return `Ctrl+${shift ? 'Shift+' : ''}${key}`;
}

/** Is the platform's command key down (Cmd on macOS, Ctrl elsewhere; either is accepted)? */
export function modDown(e: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return e.metaKey || e.ctrlKey;
}

/**
 * An iPhone or iPad (M49), where Safari may clear a site's storage after weeks unused, so the game
 * suggests exporting a backup now and then. iPadOS says it is a Mac: its touch screen gives it away.
 */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && (navigator.maxTouchPoints || 0) > 1)
  );
}
