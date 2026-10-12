// Service worker de Visor de Pendientes 3D
// - La app (HTML, librería, iconos) se guarda al instalar: abre sin conexión.
// - Las teselas de satélite y relieve que ya has visto se guardan para reutilizarlas.
// - Los mapas de las rutas guardadas para sin cobertura van en una caché aparte que no se recorta.
// - El cálculo de rutas siempre va por red.
const VERSION = 'v29';
const APP_CACHE = `pendientes3d-app-${VERSION}`;
const TILE_CACHE = 'pendientes3d-tiles';
const FONT_CACHE = 'pendientes3d-fonts';
const OFFLINE_CACHE = 'pendientes3d-offline';   // mapas guardados a propósito: nunca se recortan
const MAX_TILES = 8000;

const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './lib/maplibre-gl.js',
  './lib/maplibre-gl.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP_CACHE).then(c => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith('pendientes3d-app-') && k !== APP_CACHE) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

const isTile = url =>
  (url.origin === self.location.origin && (url.pathname.startsWith('/wmt/') || url.pathname.startsWith('/catastro/Cartografia/') || (url.pathname.startsWith('/rediam/') && /GetMap/i.test(url.search)))) ||
  url.hostname === 'server.arcgisonline.com' ||
  url.hostname.endsWith('.tile-cyclosm.openstreetmap.fr') ||
  url.hostname === 'tile.waymarkedtrails.org' ||
  url.hostname === 'tiles.openfreemap.org' ||
  (url.hostname === 's3.amazonaws.com' && url.pathname.startsWith('/elevation-tiles-prod/'));
const isFont = url => url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

let putsSinceTrim = 0;
async function trimTiles() {
  const cache = await caches.open(TILE_CACHE);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Navegación: red primero, copia guardada si no hay conexión
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => {
      const copy = r.clone();
      caches.open(APP_CACHE).then(c => c.put('./index.html', copy));
      return r;
    }).catch(() => caches.match('./index.html')));
    return;
  }

  // Archivos propios de la app (las teselas /wmt se tratan más abajo como teselas)
  if (url.origin === self.location.origin && !isTile(url)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
    return;
  }

  // Teselas: caché primero
  if (isTile(url)) {
    e.respondWith((async () => {
      // Primero los mapas guardados para sin cobertura (no se borran solos), luego la caché normal
      const saved = await (await caches.open(OFFLINE_CACHE)).match(req.url);
      if (saved) return saved;
      const cache = await caches.open(TILE_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const r = await fetch(req);
      if (r.ok) {
        cache.put(req, r.clone());
        if (++putsSinceTrim >= 100) { putsSinceTrim = 0; trimTiles(); }
      }
      return r;
    })());
    return;
  }

  // Tipografías: guardada si existe, actualizando por detrás
  if (isFont(url)) {
    e.respondWith((async () => {
      const cache = await caches.open(FONT_CACHE);
      const hit = await cache.match(req);
      const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') cache.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    })());
  }
  // El resto (cálculo de rutas) va directo a la red
});
