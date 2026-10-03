// Service worker: red primero (siempre la versión más reciente) y caché
// como respaldo para que la app funcione sin conexión.
const CACHE = 'banksync-v3';
const SHELL = [
  './',
  'index.html',
  'css/styles.css',
  'js/app.js',
  'js/store.js',
  'js/sync.js',
  'js/util.js',
  'js/install.js',
  'js/config.js',
  'fonts/archivo.woff2',
  'fonts/jetbrains-mono.woff2',
  'icons/icon.svg',
  'icons/icon-192.png',
  'manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;

  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await Promise.race([
          // no-cache: revalida siempre con el servidor (ignora el max-age de GitHub Pages)
          fetch(request, { cache: 'no-cache' }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
        ]);
        if (res.ok) cache.put(request, res.clone());
        return res;
      } catch {
        const hit = await cache.match(request, { ignoreSearch: true });
        if (hit) return hit;
        if (request.mode === 'navigate') return cache.match('index.html');
        return Response.error();
      }
    })()
  );
});
