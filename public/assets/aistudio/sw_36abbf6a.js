const CACHE_NAME = 'my-budget-v10'; // Меняй версию (v8, v9...) при каждом обновлении, если хочешь форсировать сброс
const ASSETS = [
  './',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  
  const url = new URL(e.request.url);
  // Для HTML-файлов всегда сначала пытаемся скачать из сети (Network First)
  if (e.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/') {
    e.respondWith(
      fetch(e.request).then((res) => {
        const cache = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(e.request, cache));
        return res;
      }).catch(() => caches.match(e.request))
    );
  } else {
    // Для остального (иконки, шрифты) сначала берем из кэша (Cache First)
    e.respondWith(
      caches.match(e.request).then((res) => {
        return res || fetch(e.request).then((response) => {
          const cache = response.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, cache));
          return response;
        });
      })
    );
  }
});
