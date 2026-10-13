// Service worker do Sound. Guarda só o "casco" do app (HTML, JS/CSS com hash, ícones) para abrir
// rápido e mostrar algo sem rede. NUNCA intercepta /api/: sessão, playlists e áudio sempre vão ao
// servidor (logout/banimento imediatos dependem disso).
const CACHE = 'sound-shell-v1';
const MAX_ASSETS = 80;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Páginas: rede primeiro (pega a versão nova a cada deploy); sem rede, o index.html guardado.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('/', copy));
          }
          return res;
        })
        .catch(async () => (await caches.match('/')) || Response.error())
    );
    return;
  }

  // Arquivos com hash no nome (/assets/) e ícones: cache primeiro, são imutáveis.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(request, copy).then(() => trim(c)));
            }
            return res;
          })
      )
    );
  }
});

// Remove os arquivos mais antigos para os builds velhos não se acumularem.
async function trim(cache) {
  const keys = await cache.keys();
  for (const req of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(req);
}
