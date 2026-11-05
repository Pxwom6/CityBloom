import { configDefaults, defineConfig } from 'vitest/config';

/**
 * The relay's tests that run on the wall clock (F13): headless players paced by real timers, real
 * sockets, waits with real timeouts. Beside years-long sims on a busy machine they can run late, so
 * they're their own project: `npm test` runs both, the deploy only `--project unit` (a slow runner
 * mustn't hold back the site or switch its online rooms off), and CI runs `live` on its own.
 */
const LIVE = [
  'relay/tests/room.test.ts',
  'relay/tests/local.test.ts',
  'relay/tests/review.test.ts',
  // The war soak plays four cities against a room for minutes of room time: its links reconnect and
  // its clock is held to the wall clock while they do, and what it covers varies a little.
  'relay/tests/regionSoak.test.ts',
];

export default defineConfig({
  test: {
    environment: 'node',
    // The scenario and legacy-save tests play years of a city; this only guards against a hang.
    testTimeout: 180_000,
    pool: 'threads',
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/**/*.test.ts', 'relay/tests/**/*.test.ts'],
          exclude: [...configDefaults.exclude, ...LIVE],
        },
      },
      // A timing test that runs late once gets a second go; one that fails twice is a real failure.
      { extends: true, test: { name: 'live', include: LIVE, retry: 1 } },
    ],
  },
});
