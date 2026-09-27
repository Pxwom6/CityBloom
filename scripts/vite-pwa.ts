/**
 * Vite plugin for the installable, offline app (M15). After a build it writes `sw.js` (from
 * src/pwa/sw.js) with the build's file list and a version hashed from their contents, so any change
 * to any file is a new version the service worker offers to switch to. It also adds the share
 * preview's absolute URLs to index.html when the site address is known (SITE_URL).
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

/** Built files the offline copy leaves out: source maps, the share image and the worker itself. */
const SKIP = [/\.map$/, /^social\.jpg$/, /^sw\.js$/];

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
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(readFileSync(join(out, f)));
      const version = hash.digest('hex').slice(0, 12);
      const sw = readFileSync(resolve(config.root, 'src/pwa/sw.js'), 'utf8')
        .replace("'__VERSION__'", JSON.stringify(version))
        .replace('__FILES__', JSON.stringify(files));
      writeFileSync(join(out, 'sw.js'), sw);
      config.logger.info(`sw.js: version ${version}, ${files.length} files kept for offline play`);
    },
  };
}
