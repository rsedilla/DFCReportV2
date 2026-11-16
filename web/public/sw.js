/*
 * The offline page's helper (SKILL.md section 23, decision 0497).
 *
 * **It keeps two files and nothing else**: the offline page and the logo on it. No page of the
 * application, no script of the build and no answer of the API is kept on the device, so the
 * application still opens the version on the server every time (decision 0424), and nothing a
 * leader reads here can be old.
 *
 * **It answers one kind of request**: opening a page. When that fails because there is no
 * connection, the offline page is shown in its place. Every other request (the API, scripts,
 * styles, fonts) is left to the browser exactly as if this file did not exist.
 *
 * **Change `CACHE` when `offline.html` or the logo changes**, so a device takes the new copy.
 */
const CACHE = 'dreams-offline-v1';
const OFFLINE_PAGE = '/offline.html';
const KEPT = [OFFLINE_PAGE, '/dreams-logo-168.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // `reload`: the copy kept is the server's, never the browser's own cached one.
      .then((cache) => cache.addAll(KEPT.map((path) => new Request(path, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      // The browser starts the page request while this file starts up, so a page opens no
      // later than it did without it.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const preloaded = await event.preloadResponse;
          return preloaded || (await fetch(request));
        } catch (failure) {
          const kept = await caches.match(OFFLINE_PAGE);
          if (kept) {
            return kept;
          }
          // Nothing kept: the browser shows its own page, as it did before this file.
          throw failure;
        }
      })(),
    );
    return;
  }

  // The logo on the offline page, when the connection cannot give it.
  if (request.method === 'GET' && new URL(request.url).pathname === '/dreams-logo-168.png') {
    event.respondWith(fetch(request).catch(() => caches.match(request.url)));
  }
});
