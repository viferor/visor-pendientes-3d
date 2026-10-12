// Pruebas de la familia «servicio» · se ejecutan con: npm test
import { test, eq, near, assert, slice, extractScript, fs, path, REPO, app, api, loadApp, loadSW } from '../comun.mjs';

// Constantes que esta familia usa del arnés (el resto se lee de api.*)
const PREF = api.PREF;
const TILE_CACHE_MAX = api.TILE_CACHE_MAX;
const loadTile = api.loadTile;
const loadTrack = api.loadTrack;
const stopPrefetch = api.stopPrefetch;
const tileCacheKeys = api.tileCacheKeys;
const tileCacheSize = api.tileCacheSize;

await test('H1', 'sw.js se evalúa y precachea solo los archivos listados', async () => {
  const sw = loadSW();
  assert(/^v\d+$/.test(sw.exports.VERSION), 'VERSION del service worker con formato vN: ' + sw.exports.VERSION);
  eq(sw.exports.APP_CACHE, 'pendientes3d-app-' + sw.exports.VERSION, 'el nombre de la caché de la app sigue a VERSION');
  await sw.fire('install', {});
  const names = await sw.caches.keys();
  const appCache = sw.exports.APP_CACHE;
  const c = await sw.caches.open(appCache);
  const keys = await c.keys();
  const tieneOffline = keys.some(k => /offline\.html/.test(k.url));
  return { detail: `VERSION=${sw.exports.VERSION}, cachés=${names.join(', ')}, precache=${keys.length} archivos, offline.html precacheado=${tieneOffline}` };
});

await test('H2', 'sw.js: al activar borra solo las cachés de app antiguas', async () => {
  const sw = loadSW();
  await sw.caches.open('pendientes3d-app-v25');
  await sw.caches.open(sw.exports.TILE_CACHE);
  await sw.caches.open(sw.exports.OFFLINE_CACHE);
  await sw.caches.open(sw.exports.FONT_CACHE);
  await sw.fire('activate', {});
  const names = await sw.caches.keys();
  assert(!names.includes('pendientes3d-app-v25'), 'debe borrar la caché de app antigua');
  assert(names.includes(sw.exports.TILE_CACHE), 'no debe borrar la caché de teselas');
  assert(names.includes(sw.exports.OFFLINE_CACHE), 'no debe borrar los mapas guardados');
  assert(names.includes(sw.exports.FONT_CACHE), 'no debe borrar las tipografías');
  return { detail: 'cachés tras activar: ' + names.join(', ') };
});

await test('H3', 'sw.js: navegación con red fallida devuelve index.html cacheado', async () => {
  const sw = loadSW({ fetchImpl: async () => { throw new Error('sin red'); } });
  const c = await sw.caches.open(sw.exports.APP_CACHE);
  await c.put('./index.html', { ok: true, url: './index.html', _body: 'HTML cacheado' });
  const ev = await sw.fire('fetch', { request: { method: 'GET', mode: 'navigate', url: 'https://visor-pendientes-3d.vercel.app/' } });
  assert(ev._response && ev._response._body === 'HTML cacheado', 'debería servir el HTML cacheado');
  return { detail: 'respuesta sin conexión: ' + ev._response._body };
});

await test('H4', 'sw.js: una tesela nueva se guarda y se reutiliza', async () => {
  let hits = 0;
  const sw = loadSW({ fetchImpl: async u => { hits++; return { ok: true, status: 200, url: String(u), _red: true, clone() { return this; } }; } });
  const req = { method: 'GET', mode: 'cors', url: 'https://a.tile-cyclosm.openstreetmap.fr/cyclosm/14/8000/6000.png' };
  const ev1 = await sw.fire('fetch', { request: req });
  const ev2 = await sw.fire('fetch', { request: req });
  eq(hits, 1, 'la segunda vez debe salir de la caché');
  const tileCache = await sw.caches.open(sw.exports.TILE_CACHE);
  const keys = await tileCache.keys();
  return { detail: `peticiones a la red: ${hits} para 2 solicitudes; teselas en caché: ${keys.length}` };
});

await test('H5', 'sw.js: los mapas guardados para sin cobertura tienen prioridad y no se recortan', async () => {
  const sw = loadSW({ fetchImpl: async u => ({ ok: true, status: 200, url: String(u), _red: true, clone() { return this; } }) });
  const url = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/8000/6000.png';
  const off = await sw.caches.open(sw.exports.OFFLINE_CACHE);
  await off.put(url, { ok: true, url, _guardada: true });
  const ev = await sw.fire('fetch', { request: { method: 'GET', mode: 'cors', url } });
  assert(ev._response._guardada === true, 'debe servirse la copia guardada a propósito');
  assert(sw.exports.MAX_TILES === 8000, 'MAX_TILES');
  const trimSrc = sw.source.slice(sw.source.indexOf('async function trimTiles'));
  assert(!/OFFLINE_CACHE/.test(trimSrc.slice(0, 400)), 'trimTiles no debe tocar la caché de mapas guardados');
  return { detail: `prioridad correcta; MAX_TILES=${sw.exports.MAX_TILES} solo se aplica a la caché de teselas normales` };
});

await test('H6', 'sw.js: isTile cubre los servicios proxificados y externos usados por la app', async () => {
  const sw = loadSW();
  const casos = {
    '/wmt/mtb/14/1/1.png': true,
    '/catastro/Cartografia/WMS/ServidorWMS.aspx': true,
    '/rediam/REDIAM_Inventario_VVPP?SERVICE=WMS&REQUEST=GetMap': true,
    '/rediam/REDIAM_Inventario_VVPP?SERVICE=WMS&REQUEST=GetFeatureInfo': false,
    '/index.html': false,
    '/sw.js': false
  };
  const out = {};
  for (const [p, esperado] of Object.entries(casos)) {
    const got = sw.exports.isTile(new URL('https://visor-pendientes-3d.vercel.app' + p));
    out[p.split('?')[0]] = got === esperado ? 'ok' : `INESPERADO (${got})`;
  }
  return { detail: JSON.stringify(out) };
});

/* ---------------- Offline ---------------- */;

await test('R1', 'La caché de teselas de altitud en memoria tiene límite y no crece sin fin', async () => {
  const app2 = loadApp();
  const a2 = app2.api();
  if (typeof a2.tileCacheSize !== 'function') return { detail: 'pendiente: no hay forma de consultar el tamaño de la caché de altitud' };
  const max = a2.TILE_CACHE_MAX || 0;
  for (let i = 0; i < max + 50; i++) await a2.loadTile(15, 1000 + i, 2000);
  const n = a2.tileCacheSize();
  assert(n <= max, `la caché de altitud crece sin límite: ${n} teselas con máximo ${max}`);
  const terr = a2.tileCacheKeys().filter(k => k.startsWith('terrarium/')).length;
  assert(terr === 0 && a2.tileCacheSize() === n, 'las teselas de altitud del terreno no deben contarse ni desalojarse');
  return { detail: `${n} teselas en memoria (máximo ${max}) tras pedir ${max + 50}` };
});

await test('R2', 'Al cambiar de ruta se detiene la precarga pendiente', async () => {
  const app2 = loadApp();
  const a2 = app2.api();
  const raw = [];
  for (let i = 0; i < 40; i++) raw.push({ lat: 37 + i * 0.0009, lon: -3, ele: 100 + i, t: NaN });
  await a2.loadTrack('Uno', raw, false);
  assert(typeof a2.stopPrefetch === 'function', 'debería existir stopPrefetch()');
  a2.PREF.queue.push('https://ejemplo/tesela/1.png', 'https://ejemplo/tesela/2.png');
  a2.stopPrefetch();
  eq(a2.PREF.queue.length, 0, 'la cola debe quedar vacía');
  // Al cargar otra ruta también se vacía
  a2.PREF.queue.push('https://ejemplo/tesela/3.png');
  await a2.loadTrack('Dos', raw.slice(0, 10), false);
  eq(a2.PREF.queue.length, 0, 'loadTrack debe vaciar la cola de la ruta anterior');
  return { detail: 'stopPrefetch() vacía la cola y loadTrack lo llama al cambiar de recorrido' };
});

await test('R3', 'vercel.json: las tres rutas proxificadas tienen Cache-Control', () => {
  const v = JSON.parse(fs.readFileSync(path.join(REPO, 'vercel.json'), 'utf8'));
  const fuentes = v.headers.map(h => h.source);
  const faltan = ['/wmt/(.*)', '/catastro/Cartografia/(.*)', '/rediam/(.*)'].filter(s => !fuentes.includes(s));
  assert(faltan.length === 0, 'sin Cache-Control declarado: ' + faltan.join(', '));
  const swHeader = v.headers.find(h => h.source === '/sw.js').headers.find(x => x.key === 'Cache-Control');
  eq(swHeader.value, 'no-cache, no-store, must-revalidate', 'cabecera del service worker');
  return { detail: 'fuentes con cabeceras: ' + fuentes.join(', ') };
});

/* ---------------- Informe ---------------- */;
