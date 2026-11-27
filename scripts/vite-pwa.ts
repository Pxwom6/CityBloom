/**
 * Vite plugin for the installable, offline app (M15). After a build it writes `sw.js` (from
 * src/pwa/sw.js) with the build's file list and a version hashed from their contents, so any change
 * to any file is a new version the service worker offers to switch to. It also adds the share
 * preview's absolute URLs to index.html when the site address is known (SITE_URL).
 */
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

/**
 * Built files the offline copy leaves out: source maps, the share image, the worker itself, and the
 * war models (phase 5), which only a city with war on fetches: a peaceful player never downloads them.
 */
// The owner area (phase 6) isn't part of the game played offline.
const SKIP = [
  /\.map$/,
  /^social\.jpg$/,
  /^sw\.js$/,
  /^assets\/war-models-[\w-]+\.bin$/,
  /^owner\.html$/,
  /^assets\/owner-[\w-]+\.(js|css)$/,
];

/**
 * Files the offline copy keeps only once they're first used (M49: a phone's data): the scenarios'
 * starting cities, the lessons' towns and the Workshop's style sheet (M47), most of the download otherwise and most never opened.
 */
export const EXTRAS = [/^scenarios\//, /^lessons\//, /^workshop\//];

/** What a first visit downloads, gzipped as Pages sends it (bytes): every file but the extras. */
export function firstDownload(out: string, files: string[]): number {
  let total = 0;
  for (const f of files)
    if (!EXTRAS.some((re) => re.test(f))) total += gzipSync(readFileSync(join(out, f)), { level: 9 }).length;
  return total;
}

/** "1.6 MB", for the boot screen. */
export function sizeText(bytes: number): string {
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

function walk(dir: string, root = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path, root) : [relative(root, path).split(sep).join('/')];
  });
}

export interface PwaOptions {
  /** Absolute address the site is served from (with a trailing slash), for the share preview. */
  siteUrl?: string;
}

export function pwa(opts: PwaOptions = {}): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'citybloom-pwa',
    apply: 'build',
    configResolved(c) {
      config = c;
    },
    transformIndexHtml() {
      if (!opts.siteUrl) return [];
      const url = opts.siteUrl.endsWith('/') ? opts.siteUrl : `${opts.siteUrl}/`;
      return [
        { tag: 'meta', attrs: { property: 'og:url', content: url }, injectTo: 'head' },
        { tag: 'meta', attrs: { property: 'og:image', content: `${url}social.jpg` }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'twitter:image', content: `${url}social.jpg` }, injectTo: 'head' },
      ];
    },
    closeBundle() {
      const out = resolve(config.root, config.build.outDir);
      const files = walk(out)
        .filter((f) => !SKIP.some((re) => re.test(f)))
        .sort();
      // The boot screen says what the first visit costs (M49), before the version is hashed.
      const bytes = firstDownload(out, files);
      const index = join(out, 'index.html');
      writeFileSync(index, readFileSync(index, 'utf8').replace('__FIRST_DOWNLOAD__', sizeText(bytes)));
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(readFileSync(join(out, f)));
      const version = hash.digest('hex').slice(0, 12);
      const sw = readFileSync(resolve(config.root, 'src/pwa/sw.js'), 'utf8')
        .replace("'__VERSION__'", JSON.stringify(version))
        .replace('__FILES__', JSON.stringify(files.filter((f) => !EXTRAS.some((re) => re.test(f)))))
        .replace('__EXTRAS__', JSON.stringify(files.filter((f) => EXTRAS.some((re) => re.test(f)))));
      writeFileSync(join(out, 'sw.js'), sw);
      config.logger.info(
        `sw.js: version ${version}, ${files.length} files kept for offline play (a first visit ${sizeText(bytes)})`,
      );
    },
  };
}
