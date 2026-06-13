const PWA_CACHE_VERSION = '2026.06.13-otp.2';
const STATIC_CACHE = `texasholdem-static-${PWA_CACHE_VERSION}`;
const RUNTIME_CACHE = `texasholdem-runtime-${PWA_CACHE_VERSION}`;

const CORE_ASSETS = [
  '.',
  'index.html',
  'manifest.webmanifest',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'assets/css/app.css',
  'assets/js/00-supabase-config.js',
  'assets/js/01-data.js',
  'assets/js/02-remote.js',
  'assets/js/03-share.js',
  'assets/js/04-navigation.js',
  'assets/js/05-tournament-settings.js',
  'assets/js/06-entry.js',
  'assets/js/09-history.js',
  'assets/js/10-settings.js',
  'assets/js/11-cash-game.js',
  'assets/js/12-toast.js',
  'assets/js/13-ingame.js',
  'assets/js/14-init.js',
  'assets/js/15-pwa.js',
  'timer/index.html',
  'timer/timer.css',
  'timer/timer.js'
];

function scopedUrl(path) {
  return new URL(path, self.registration.scope).toString();
}

function canCache(request, response) {
  return request.method === 'GET' && response && (response.ok || response.type === 'opaque');
}

async function putInCache(cacheName, request, response) {
  if (!canCache(request, response)) return;
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  } catch (e) {
    console.warn('[pwa] cache write failed', e);
  }
}

async function networkFirst(request, fallbackUrl) {
  try {
    const response = await fetch(request);
    await putInCache(RUNTIME_CACHE, request, response);
    return response;
  } catch (e) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await caches.match(fallbackUrl);
      if (fallback) return fallback;
    }
    throw e;
  }
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(CORE_ASSETS.map(scopedUrl)))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith('texasholdem-') && key !== STATIC_CACHE && key !== RUNTIME_CACHE)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isInsideScope = url.href.startsWith(self.registration.scope);
  const fallbackIndex = scopedUrl('index.html');

  if (request.mode === 'navigate' && isInsideScope) {
    event.respondWith(networkFirst(request, fallbackIndex));
    return;
  }

  if (isInsideScope || url.origin === 'https://cdn.jsdelivr.net') {
    event.respondWith(networkFirst(request));
  }
});
