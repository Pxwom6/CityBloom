import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
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

export default defineConfig({
  // GitHub Pages serves a project site from /<repo>/ (the deploy workflow sets BASE_PATH);
  // `--base` on the command line wins over this.
  base: process.env.BASE_PATH || '/',
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 2000 },
  server: { port: 5173 },
  preview: { port: 4173 },
  plugins: [pwa({ siteUrl: process.env.SITE_URL })],
});
