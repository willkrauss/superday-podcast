// Offline support: precache the app shell, then serve cached files and refresh them in the background.
const CACHE = 'reelwright-v1';
const FILES = [
  './',
  './css/app.css',
  './fonts/CourierPrime-Bold.woff2',
  './fonts/CourierPrime-BoldItalic.woff2',
  './fonts/CourierPrime-Italic.woff2',
  './fonts/CourierPrime-Regular.woff2',
  './icon-192.png',
  './icon-512.png',
  './icon.svg',
  './index.html',
  './js/app.js',
  './js/editor.js',
  './js/formatcss.js',
  './js/formats.js',
  './js/icons.js',
  './js/inline.js',
  './js/io.js',
  './js/main.js',
  './js/model.js',
  './js/paginate.js',
  './js/pdf.js',
  './js/preview.js',
  './js/production.js',
  './js/sample.js',
  './js/store.js',
  './js/ui.js',
  './js/util.js',
  './js/views/av.js',
  './js/views/board.js',
  './js/views/breakdown.js',
  './js/views/budget.js',
  './js/views/callsheet.js',
  './js/views/cards.js',
  './js/views/catalog.js',
  './js/views/common.js',
  './js/views/contacts.js',
  './js/views/library.js',
  './js/views/reports.js',
  './js/views/schedule.js',
  './js/views/script.js',
  './js/views/settings.js',
  './js/views/shell.js',
  './js/views/shots.js',
  './js/views/storyboard.js',
  './js/views/titlepage.js',
  './js/views/versions.js',
  './manifest.webmanifest',
  './samples/sample.fountain',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    return hit || (await net) || new Response('Offline', { status: 503 });
  }));
});
