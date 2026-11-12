/* Scadense service worker - offline cache con aggiornamento controllato */
/* Cambia CACHE_VERSION a ogni release per forzare l'aggiornamento. */
const CACHE_VERSION = 'v1';
const CACHE = 'scadense-' + CACHE_VERSION;
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './app.bundle.js',
  './vendor/supabase.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => Promise.all(ASSETS.map((u) =>
      c.add(new Request(u, { cache: 'reload' })).catch(() => {}) // un asset mancante non deve far fallire l'installazione
    )))
  );
  // L'attivazione avviene su messaggio dalla pagina (SKIP_WAITING).
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('scadense-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

const isAppCode = (url) => /\.(js|html|css|webmanifest)$/.test(url.pathname);

async function networkFirst(req, fallbackShell) {
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  } catch {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    if (fallbackShell) return caches.match('./index.html');
    return Response.error();
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Volutamente NON intercettiamo mai le richieste a Supabase (auth, REST, realtime): niente cache di dati o token.
  if (url.hostname.endsWith('.supabase.co')) return;
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') { e.respondWith(networkFirst(req, true)); return; }
  if (isAppCode(url)) { e.respondWith(networkFirst(req, false)); return; }
  e.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => Response.error()))
  );
});
