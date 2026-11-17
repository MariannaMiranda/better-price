/* Better Price service worker.
 * - App shell: precached; navigations are network-first (fresh deploys win) with a cache fallback, so the app
 *   opens offline. Same-origin static files and the two CDN scripts the shell needs are stale-while-revalidate.
 * - NEVER cached/intercepted: /api/*, Supabase, Stripe, Groq, non-GET. Data sync is done by the page (outbox in
 *   localStorage), not here, so there is no Background Sync dependency (iOS Safari doesn't support it).
 * Bump VERSION on every deploy that changes the precache list. */
const VERSION = 'bp-v2';
const SHELL = `${VERSION}-shell`;
const RUNTIME = `${VERSION}-runtime`;
const SAME_ORIGIN_PRECACHE = ['/', '/manifest.webmanifest', '/bp-store.js', '/bp-ui.js', '/favicon.svg', '/apple-touch-icon.png',
  '/icons/icon-192.png', '/icons/icon-512.png'];
// Cross-origin scripts index.html cannot boot without. Loaded via <script src> (no-cors) => opaque responses, which is fine.
const CDN_PRECACHE = ['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', 'https://unpkg.com/html5-qrcode'];
const CDN_HOSTS = new Set(['cdn.jsdelivr.net', 'unpkg.com']);
const NAV_TIMEOUT_MS = 4000;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // The same-origin shell must succeed or the install fails (so we never activate a broken shell).
    await cache.addAll(SAME_ORIGIN_PRECACHE.map(u => new Request(u, { cache: 'reload' })));
    // CDN scripts are best-effort: an offline/blocked CDN must not block installing the rest.
    await Promise.all(CDN_PRECACHE.map(async u => {
      try { const req = new Request(u, { mode: 'no-cors' }); await cache.put(req, await fetch(req)); }
      catch (e) { /* will be cached on first successful load via the runtime handler */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (!k.startsWith(VERSION)) await caches.delete(k);
    await self.clients.claim();
  })());
});

const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));

async function networkFirstNavigation(request) {
  const cache = await caches.open(SHELL);
  try {
    const res = await Promise.race([fetch(request), timeout(NAV_TIMEOUT_MS)]);
    if (res.ok) cache.put('/', res.clone());                        // every route is the same single-file app
    return res;
  } catch (e) {
    const cached = await cache.match('/');
    return cached || new Response('<h1>Offline</h1><p>Open Better Price once while online to use it offline.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request) || await (await caches.open(SHELL)).match(request);
  const refresh = fetch(request).then(res => { if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone()); return res; }).catch(() => null);
  return cached || (await refresh) || Response.error();
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return;
    if (req.mode === 'navigate') return event.respondWith(networkFirstNavigation(req));
    return event.respondWith(staleWhileRevalidate(req, RUNTIME));
  }
  if (CDN_HOSTS.has(url.hostname)) return event.respondWith(staleWhileRevalidate(req, RUNTIME));
  // everything else (Supabase REST/realtime/auth, Stripe, Groq, fonts, analytics): straight to the network
});
