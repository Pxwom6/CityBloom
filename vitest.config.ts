import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // The scenario and legacy-save tests play years of a city; this only guards against a hang.
    testTimeout: 180_000,
    pool: 'threads',
  },
});
