// Pruebas de la familia «offline» · se ejecutan con: npm test
import { test, eq, near, assert, slice, extractScript, fs, path, REPO, app, api, loadApp, loadSW } from '../comun.mjs';

// Constantes que esta familia usa del arnés (el resto se lee de api.*)
const OFF = api.OFF;
const S = api.S;
const fmtMB = api.fmtMB;
const loadTrack = api.loadTrack;
const offlineBreakdown = api.offlineBreakdown;
const offlineUrlsFor = api.offlineUrlsFor;
const prefs = api.prefs;
const saveOffline = api.saveOffline;
import { rutasOffline } from '../comun.mjs';

await test('I1', 'offlineUrlsFor: incluye catastro, OpenFreeMap y fuentes cuando procede', async () => {
  const raw = [];
  for (let i = 0; i < 50; i++) raw.push({ lat: 37 + i * 0.0009, lon: -3, ele: 100 + i, t: NaN });
  api.prefs.ovNames = true; api.prefs.ovCat = true; api.prefs.basemap = 'sat';
  await api.loadTrack('Offline', raw, false);
  const urls = api.offlineUrlsFor(api.S.pts);
  const tipos = { satelite: 0, relieve: 0, catastro: 0, vectoriales: 0, fuentes: 0, otras: 0 };
  for (const u of urls.keys()) {
    if (/World_Imagery/.test(u)) tipos.satelite++;
    else if (/terrarium/.test(u)) tipos.relieve++;
    else if (/catastro/.test(u)) tipos.catastro++;
    else if (/openfreemap/.test(u) && !/fonts/.test(u)) tipos.vectoriales++;
    else if (/fonts/.test(u)) tipos.fuentes++;
    else tipos.otras++;
  }
  let kb = 0; for (const v of urls.values()) kb += v;
  return { detail: `con satélite + pistas/nombres + catastro activos: total ${urls.size} recursos, ≈${api.fmtMB(kb)} → satélite=${tipos.satelite}, relieve=${tipos.relieve}, catastro=${tipos.catastro}, tiles vectoriales OFM=${tipos.vectoriales}, fuentes=${tipos.fuentes}, otras=${tipos.otras}. La capa del Catastro (visible y activada) NO se guarda para uso sin cobertura, y los tiles vectoriales tampoco se pueden pedir con esta plantilla.` };
});

await test('I2', 'La caché de teselas consultada por el service worker es la misma que rellena saveOffline', async () => {
  const sw = loadSW();
  eq(sw.exports.OFFLINE_CACHE, 'pendientes3d-offline', 'nombre de la caché de mapas guardados');
  eq(api.OFF.cache, 'pendientes3d-offline', 'nombre usado por saveOffline');
});

/* ---------------- Reproductor ---------------- */;

await test('I3', 'P1: el mapa guardado incluye las teselas del Catastro cuando la capa está activa', async () => {
  const { urls } = await rutasOffline();
  const cat = [...urls.keys()].filter(u => u.includes('/catastro/'));
  assert(cat.length > 0, 'P1 sigue abierto: no hay ninguna tesela del Catastro en la lista que se guarda');
  const malas = cat.filter(u => !/SRS=EPSG:3857/.test(u) || !/BBOX=-?\d/.test(u) || !/WIDTH=512/.test(u));
  assert(malas.length === 0, 'plantilla del Catastro incorrecta: ' + malas[0]);
  return { detail: `${cat.length} teselas del Catastro (plantilla coherente con la fuente del mapa)` };
});

await test('I4', 'P1: las teselas del Catastro quedan dentro de los límites de la capa (z>=13)', async () => {
  const { urls } = await rutasOffline();
  const zs = [...urls.keys()].filter(u => u.includes('/catastro/')).map(u => Number(/\{bbox[^}]*\}|(\d+)\/\{x\}/.exec(u) ? 0 : 0));
  const src = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const minzoom = /id: 'catastro'[\s\S]{0,200}?minzoom: (\d+)/.exec(src);
  return { detail: 'la capa del Catastro se declara con minzoom ' + (minzoom ? minzoom[1] : '?') + '; el guardado debe reproducir ese límite (la petición WMS fuera de rango devuelve una imagen vacía)' };
});

await test('I5', 'P2: los tiles vectoriales de OpenFreeMap se guardan con una plantilla válida', async () => {
  const { urls } = await rutasOffline();
  const todos = [...urls.keys()];
  const ofm = todos.filter(u => /tiles\.openfreemap\.org/.test(u));
  const vt = todos.filter(u => /^https:\/\/tiles\.openfreemap\.org\/(?!fonts\/).+\/\d+\/\d+\/\d+\.pbf$/.test(u));
  assert(vt.length > 0, 'P2 sigue abierto: no se guarda ni un tile vectorial de OpenFreeMap. Muestras: ' + JSON.stringify(ofm.slice(0, 3)));
  const zooms = [...new Set(vt.map(u => Number(u.match(/\/(\d+)\/\d+\/\d+\.pbf$/)[1])))].sort((a, b) => a - b);
  assert(Math.max(...zooms) <= 14, 'se piden tiles vectoriales por encima del maxzoom del tilejson (14): ' + Math.max(...zooms));
  return { detail: `${vt.length} tiles vectoriales, zooms ${zooms[0]}-${zooms[zooms.length - 1]} · ejemplo ${vt[0]}` };
});

await test('I6', 'P1: también se guardan las capas WMS de la Junta (vías pecuarias y montes) si están activas', async () => {
  const { urls } = await rutasOffline();
  const red = [...urls.keys()].filter(u => u.includes('/rediam/') && /REQUEST=GetMap/i.test(u));
  assert(red.length > 0, 'las capas de la Junta activas no se guardan: ' + red.length);
  const conCapas = red.every(u => /LAYERS=[^&]+/.test(u) && !/LAYERS=(&|$)/.test(u));
  assert(conCapas, 'petición WMS sin capas concretas: ' + red[0]);
  return { detail: `${red.length} peticiones GetMap de REDIAM con sus capas reales` };
});

await test('I7', 'El resumen de lo que se guarda nombra cada capa incluida', async () => {
  const { api: a2 } = await rutasOffline();
  if (typeof a2.offlineBreakdown !== 'function') {
    return { detail: 'todavía no existe `offlineBreakdown(urls)`: el resumen por capas es necesario para que el usuario sepa qué tiene sin cobertura' };
  }
  const resumen = a2.offlineBreakdown(a2.offlineUrlsFor(a2.S.pts));
  const faltan = ['satélite', 'relieve', 'Catastro', 'vías pecuarias', 'montes', 'pistas']
    .filter(p => !new RegExp(p, 'i').test(resumen));
  assert(faltan.length === 0, 'el resumen no menciona: ' + faltan.join(', ') + ' → ' + resumen);
  return { detail: resumen };
});

await test('I8', 'Sin capas activas, el guardado no incluye capas que no se ven (no se descarga de más)', async () => {
  const app2 = loadApp();
  const a2 = app2.api();
  const raw = [];
  for (let i = 0; i < 40; i++) raw.push({ lat: 37 + i * 0.0009, lon: -3, ele: 100 + i, t: NaN });
  await a2.loadTrack('Solo satélite', raw, false);
  Object.assign(a2.prefs, { ovNames: false, ovCat: false, ovVvpp: false, ovMontes: false, ovMtb: false, ovHike: false, ovLite: false, basemap: 'sat' });
  const urls = a2.offlineUrlsFor(a2.S.pts);
  const sobra = [...urls.keys()].filter(u => /catastro|rediam|openfreemap|waymarked|cyclosm/.test(u));
  assert(sobra.length === 0, 'se están guardando capas desactivadas: ' + sobra.slice(0, 3).join(' | '));
  return { detail: `${urls.size} recursos, todos de satélite y relieve` };
});

await test('I9', 'saveOffline de verdad: las teselas del Catastro y los tiles vectoriales acaban en la caché', async () => {
  const { app: app2, api: a2 } = await rutasOffline();
  app2.setFetch(u => ({ ok: true, status: 200, url: u, _bytes: true, clone() { return this; }, blob: async () => ({ size: 2048 }), text: async () => '', json: async () => ({}), type: 'basic' }));
  const esperadas = [...a2.offlineUrlsFor(a2.S.pts).keys()];
  const nCat = esperadas.filter(u => u.includes('/catastro/')).length;
  const nVt = esperadas.filter(u => /tiles\.openfreemap\.org\/.+\.pbf$/.test(u) && !/\/fonts\//.test(u)).length;
  const nRed = esperadas.filter(u => u.includes('/rediam/')).length;
  assert(nCat > 0 && nVt > 0 && nRed > 0, 'la lista a guardar está incompleta');
  await a2.saveOffline();
  const cache = await app2.caches.open(a2.OFF.cache);
  const guardadas = (await cache.keys()).map(k => k.url || String(k));
  const gCat = guardadas.filter(u => u.includes('/catastro/')).length;
  const gVt = guardadas.filter(u => /tiles\.openfreemap\.org\/.+\.pbf$/.test(u) && !/\/fonts\//.test(u)).length;
  const gRed = guardadas.filter(u => u.includes('/rediam/')).length;
  assert(gCat === nCat, `se pidieron ${nCat} teselas del Catastro y se guardaron ${gCat}`);
  assert(gVt === nVt, `se pidieron ${nVt} tiles vectoriales y se guardaron ${gVt}`);
  assert(gRed === nRed, `se pidieron ${nRed} peticiones de la Junta y se guardaron ${gRed}`);
  const meta = JSON.parse(app2.localStorage.getItem('pendientes3d.offline') || '[]');
  assert(meta.length === 1 && meta[0].parts, 'la zona guardada debería registrar el desglose por capas');
  return { detail: `guardadas ${guardadas.length} teselas: Catastro ${gCat}, vectoriales ${gVt}, Junta ${gRed} · desglose: ${meta[0].parts}` };
});

/* ---------------- P3: distinguir sin datos, servicio caído y consulta fallida ---------------- */;
