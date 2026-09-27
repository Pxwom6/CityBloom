/** The game's working title. Rename the game by changing this one constant. */
export const GAME_TITLE = 'Citybloom';
export const GAME_VERSION = '0.2.0';
declare const __BUILD_ID__: string | undefined;
/** The commit this build was made from (vite.config.ts); 'dev' under plain Node and Vitest. */
export const BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
const env = (import.meta as { env?: { DEV?: boolean; MODE?: string } }).env;
/** True in dev and test builds: exposes window.__game and extra diagnostics (false under plain Node). */
export const IS_TEST_BUILD = !!env && (env.DEV === true || env.MODE === 'test');
