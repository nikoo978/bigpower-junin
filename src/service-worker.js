const CACHE_PREFIX = 'big-power-';
const CACHE = `${CACHE_PREFIX}v1.9.3`;
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './db.js',
  './pdf-export.js',
  './vendor/pdf-lib.esm.min.js',
  './vendor/html2canvas.esm.js',
  './cloud.js',
  './cloud-config.js',
  './manifest.webmanifest',
  './bigpower-mark-transparent.png',
  './circuit-pattern-dark.svg',
  './circuit-pattern-light.svg',
  './circuit-pattern-print.png',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];
const OWN_ASSET_PATHS = new Set(ASSETS.map(asset => new URL(asset, self.location.href).pathname));
const required = ASSETS.filter(asset => asset === './' || /\.(?:html|js|css)$/.test(asset));

function canCache(response) {
  return response.ok && response.type === 'basic' && !/(?:no-store|private)/i.test(response.headers.get('cache-control') || '');
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // No reemplazar la copia anterior si falta código necesario para trabajar offline.
    await cache.addAll(required);
    await Promise.allSettled(ASSETS.filter(asset => !required.includes(asset)).map(asset => cache.add(asset)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

function unavailable() {
  return new Response('Sin conexión. Abrí la aplicación con internet para guardar su copia offline.', {
    status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !OWN_ASSET_PATHS.has(url.pathname)) return;
  const isNavigation = request.mode === 'navigate';
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = isNavigation ? './index.html' : request;
    try {
      const response = await fetch(request);
      if (canCache(response) && (!isNavigation || /text\/html/i.test(response.headers.get('content-type') || ''))) {
        await cache.put(key, response.clone());
      }
      if (response.status >= 500) return (await cache.match(key, { ignoreSearch: true })) || response;
      return response;
    } catch {
      return (await cache.match(key, { ignoreSearch: true })) || unavailable();
    }
  })());
});
