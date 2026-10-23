/* Service worker: la agenda abre aunque no haya internet (muestra lo último guardado). */
const CACHE = 'agenda-v1.2';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/icon-maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(()=>{})))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Primero la red (para que los cambios lleguen), con la copia guardada como respaldo.
function redPrimero(req, ms) {
  return new Promise(resolve => {
    let listo = false;
    const usarCache = () => caches.match(req).then(r => { if (!listo) { listo = true; resolve(r || Response.error()); } });
    const t = setTimeout(usarCache, ms);
    fetch(req).then(res => {
      clearTimeout(t);
      if (res && res.ok) { const copia = res.clone(); caches.open(CACHE).then(c => c.put(req, copia)); }
      if (!listo) { listo = true; resolve(res); }
    }).catch(() => { clearTimeout(t); usarCache(); });
  });
}
function cachePrimero(req) {
  return caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) { const copia = res.clone(); caches.open(CACHE).then(c => c.put(req, copia)); }
    return res;
  }));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      e.respondWith(redPrimero(req, 4000).then(r => r && r.type !== 'error' ? r : caches.match('index.html')));
    } else {
      e.respondWith(redPrimero(req, 4000));
    }
  } else if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    e.respondWith(cachePrimero(req));      // las librerías de Firebase vienen versionadas: no cambian
  }
  // lo demás (los datos de Firestore, el inicio de sesión) va directo a internet
});
