// Minimal app-shell service worker (Section 6.4). Caches shell + last-fetched GET API responses for offline reads.
const SHELL = 'shell-v1', DATA = 'data-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (e) => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(req).then((r) => { const c = r.clone(); caches.open(DATA).then((cache) => cache.put(req, c)); return r; }).catch(() => caches.match(req)));
    return;
  }
  if (url.origin === location.origin && !url.pathname.startsWith('/_next/webpack-hmr')) {
    e.respondWith(caches.match(req).then((hit) => { const net = fetch(req).then((r) => { if (r.ok) caches.open(SHELL).then((c) => c.put(req, r.clone())); return r; }).catch(() => hit); return hit ?? net; }));
  }
});
