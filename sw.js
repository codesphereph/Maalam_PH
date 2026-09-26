/* Maalam PH service worker.
   When you upload a new version of the game, change VERSION (for example v2 → v3)
   so every family's device downloads the new files. */
const VERSION = 'maalam-app-v3';
const FONTS = 'maalam-fonts-v1';
const MEDIA = 'maalam-media-v1';          // pictures + voices saved by the game (kept across updates)
const SHELL = [
  './', './index.html', './game.js', './vendor/three.min.js', './manifest.webmanifest',
  './icons/icon-32.png', './icons/icon-96.png', './icons/icon-192.png', './icons/icon-512.png',
  './icons/logo-512.png', './icons/apple-touch-icon.png', './icons/maskable-192.png', './icons/maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => ![VERSION, FONTS, MEDIA].includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;                         // API calls (POST) always go to the network
  const url = new URL(req.url);

  // Google Fonts: keep a copy so the game looks right offline.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(caches.open(FONTS).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      try { const res = await fetch(req); c.put(req, res.clone()); return res; } catch (e) { return new Response('', { status: 504 }); }
    }));
    return;
  }

  if (url.origin !== self.location.origin) return;           // everything else outside the app: normal network

  // Opening the app: try the network for the newest page, fall back to the saved copy offline.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then(res => {
      const copy = res.clone(); caches.open(VERSION).then(c => c.put('./index.html', copy)); return res;
    }).catch(() => caches.match('./index.html')));
    return;
  }

  // Game files: answer from the saved copy right away, refresh it in the background.
  event.respondWith(caches.match(req).then(hit => {
    const refresh = fetch(req).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => hit);
    return hit || refresh;
  }));
});
