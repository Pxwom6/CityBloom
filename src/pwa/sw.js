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

self.addEventListener('install', (event) => {
  // Fetch past the HTTP cache: GitHub Pages lets browsers keep index.html for ten minutes.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(FILES.map((f) => new Request(new URL(f, self.location), { cache: 'reload' }))),
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
