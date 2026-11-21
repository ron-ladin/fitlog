// Offline support: network-first (so updates arrive automatically), cache as fallback offline.
const VERSION = 'fitlog-v4';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './food.js',
  './foods-il.json',
  './vendor/html5-qrcode.min.js',
  './assets/fonts/karantina-700-hebrew.woff2',
  './assets/fonts/barlow-condensed-700-latin.woff2',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-store' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html'))
      )
  );
});
