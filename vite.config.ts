import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { models } from './scripts/vite-models';
import { pwa } from './scripts/vite-pwa';

/** Which build this is, shown in Settings: the commit (CI passes BUILD_ID), else the local HEAD. */
function buildId(): string {
  if (process.env.BUILD_ID) return process.env.BUILD_ID.slice(0, 12);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'local';
  }
}

/** When that commit was made (s since 1970), so reports can tell which of two builds is newer (M41). */
function buildTime(): number {
  try {
    return Number(
      execSync('git log -1 --format=%ct', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim(),
    );
  } catch {
    return 0;
  }
}

export default defineConfig({
  // GitHub Pages serves a project site from /<repo>/ (the deploy workflow sets BASE_PATH);
  // `--base` on the command line wins over this.
  base: process.env.BASE_PATH || '/',
  define: { __BUILD_ID__: JSON.stringify(buildId()), __BUILD_TIME__: JSON.stringify(buildTime()) },
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
    // The game, and the owner area (phase 6): a page of its own, linked from nowhere in the game.
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        owner: resolve(import.meta.dirname, 'owner.html'),
      },
    },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
  plugins: [models(), pwa({ siteUrl: process.env.SITE_URL })],
});
