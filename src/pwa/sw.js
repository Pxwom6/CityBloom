/*
 * Citybloom's service worker (M15): keeps a copy of the whole game so it opens offline, and hands a
 * new version over only when the player says so ("New version, reload"). The build writes this file
 * to `sw.js` with the version and the list of files filled in (scripts/vite-pwa.ts).
 *
 * Saves live in IndexedDB and settings in localStorage, which a new version never touches.
 */
const VERSION = '__VERSION__';
/** Every file of this build, relative to the service worker (its scope). */
const FILES = __FILES__;
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
      ),
    ),
  );
  // No skipWaiting here: a new version waits until the player chooses to reload.
});

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
    caches
      .open(CACHE)
      .then((cache) => cache.match(key, { ignoreSearch: true }))
      .then((hit) => hit ?? fetch(req)),
  );
});
