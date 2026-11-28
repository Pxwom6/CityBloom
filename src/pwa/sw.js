/*
 * Citybloom's service worker (M15): keeps a copy of the whole game so it opens offline, and hands a
 * new version over only when the player says so ("New version, reload"). The build writes this file
 * to `sw.js` with the version and the list of files filled in (scripts/vite-pwa.ts).
 *
 * Saves live in IndexedDB and settings in localStorage, which a new version never touches.
 */
const VERSION = '__VERSION__';
/** Every file of this build kept when it installs, relative to the service worker (its scope). */
const FILES = __FILES__;
/**
 * Files kept only once the game first asks for them (M49: a phone's data): the scenarios' and the
 * lessons' towns. Each is kept from its first download, and carried over to the next version.
 */
const EXTRAS = new Set(__EXTRAS__.map((f) => new URL(f, self.location).href));
const CACHE = `citybloom-${VERSION}`;
const INDEX = new URL('index.html', self.location).href;

/** A file named by its content (assets/index-1a2b3c4d.js, assets/models-0123456789.bin) never changes. */
const HASHED = /\/assets\/[^/]+-[\w-]{8,}\.\w+$/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        FILES.map(async (f) => {
          const url = new URL(f, self.location).href;
          if (HASHED.test(url)) {
            // Kept from the last version, or from the page's own download: fetched only once.
            const old = await caches.match(url);
            if (old) return cache.put(url, old);
            return cache.add(new Request(url));
          }
          // The rest past the HTTP cache: GitHub Pages lets browsers keep index.html for ten minutes.
          return cache.add(new Request(url, { cache: 'reload' }));
        }),
      ).then(() => keepExtras(cache)),
    ),
  );
  // No skipWaiting here: a new version waits until the player chooses to reload.
});

/** Extras the last version kept (a scenario played before) come along, if this version has them. */
async function keepExtras(cache) {
  for (const key of await caches.keys()) {
    if (!key.startsWith('citybloom-') || key === CACHE) continue;
    const old = await caches.open(key);
    for (const req of await old.keys()) {
      if (!EXTRAS.has(req.url)) continue;
      const res = await old.match(req);
      if (res) await cache.put(req.url, res);
    }
  }
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('citybloom-') && k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') void self.skipWaiting();
  else if (event.data === 'version') event.source?.postMessage({ version: VERSION });
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Pages (with any query: ?load=…, ?new=…) are the one index.html.
  const key = req.mode === 'navigate' ? INDEX : req;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(key, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      // An extra, first asked for now: kept for offline play from here on.
      const url = new URL(req.url);
      url.search = '';
      if (res.ok && EXTRAS.has(url.href)) await cache.put(url.href, res.clone());
      return res;
    }),
  );
});
