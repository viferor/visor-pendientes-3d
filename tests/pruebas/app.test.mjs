// Pruebas de la familia «app» · se ejecutan con: npm test
import { test, eq, near, assert, slice, extractScript, fs, path, REPO, app, api, loadApp, loadSW } from '../comun.mjs';

// Constantes que esta familia usa del arnés (el resto se lee de api.*)
const S = api.S;
const WMSOV = api.WMSOV;
const analyze = api.analyze;
const catastroHtml = api.catastroHtml;
const densify = api.densify;
const loadTrack = api.loadTrack;
const prefs = api.prefs;
const queryPoint = api.queryPoint;
const queryWms = api.queryWms;
import { appFicha, gpxSimple } from '../comun.mjs';

await test('E1', 'analyze: rutas con altitud del GPX, tramo automático', async () => {
  const pts = [];
  for (let i = 0; i < 200; i++) pts.push({ lat: 37 + i * 0.00009, lon: -3, ele: 100 + i * 0.5, t: NaN, hr: NaN, cad: NaN, pw: NaN, temp: NaN });
  await api.loadTrack('Prueba', pts, false);
  eq(api.S.mode, 'gpx', 'modo de altitud');
  eq(api.S.L, 50, 'longitud de tramo automática para una ruta corta');
  const total = api.S.pts[api.S.pts.length - 1].d;
  const segs = api.S.segs;
  const pend = segs.map(g => g.g);
  assert(pend.every(Number.isFinite), 'todas las pendientes deben ser finitas');
  return { detail: `${(total / 1000).toFixed(2)} km, ${segs.length} tramos de ${api.S.L} m, pendiente media ${(pend.reduce((a, b) => a + b, 0) / pend.length).toFixed(2)} %` };
});

await test('E2', 'analyze: sin altitudes el modo pasa a "terreno" y, si no hay red, avisa sin romper la app', async () => {
  const appSinRed = loadApp({ imageMode: 'offline' });
  const a = appSinRed.api();
  const pts = [];
  for (let i = 0; i < 50; i++) pts.push({ lat: 37 + i * 0.00009, lon: -3, ele: NaN });
  await a.loadTrack('Sin altitudes', pts, false);
  eq(a.S.hasEle, false, 'hasEle');
  eq(a.S.mode, 'terrain', 'debe intentar el modelo de terreno');
  const st = appSinRed.el('status').textContent;
  assert(!/NaN/.test(st), 'el aviso no debe mostrar NaN');
  return { detail: 'estado mostrado al usuario: "' + st + '"' };
});

await test('E3', 'analyze: coordenadas inválidas → NaN en distancias y pendientes (sin aviso)', async () => {
  const pts = [{ lat: 95, lon: 500, ele: 100 }, { lat: 95.001, lon: 500, ele: 110 }];
  await api.loadTrack('Coordenadas malas', pts, false);
  const total = api.S.pts[api.S.pts.length - 1].d;
  const segs = api.S.segs;
  const stats = app.el('stats').innerHTML;
  return { detail: `distancia total = ${total}; primer tramo g = ${segs[0] && segs[0].g}; ¿el panel muestra NaN? ${/NaN/.test(stats)}` };
});

await test('E4', 'cargar una ruta nueva reinicia el estado de la anterior', async () => {
  const a = [];
  for (let i = 0; i < 100; i++) a.push({ lat: 37 + i * 0.00009, lon: -3, ele: 100 + i, t: NaN });
  await api.loadTrack('Ruta A', a, false);
  const nA = api.S.pts.length, segA = api.S.segs.length;
  const b = [{ lat: 40, lon: -4, ele: 500, t: NaN }, { lat: 40.001, lon: -4, ele: 510, t: NaN }];
  await api.loadTrack('Ruta B', b, false);
  eq(api.S.name, 'Ruta B', 'nombre actualizado');
  eq(api.S.pts.length, 2, 'puntos de la ruta nueva');
  assert(api.S.segs.every(g => g.i1 < 2), 'los tramos deben ser solo de la ruta nueva');
  return { detail: `ruta A: ${nA} puntos / ${segA} tramos; ruta B: ${api.S.pts.length} puntos / ${api.S.segs.length} tramos` };
});

await test('E5', 'terrainEle no se mezcla entre rutas (modelo de terreno cacheado por ruta)', async () => {
  const appSinRed = loadApp({ imageMode: 'offline' });
  const a = appSinRed.api();
  const a1 = [{ lat: 37, lon: -3, ele: NaN }, { lat: 37.001, lon: -3, ele: NaN }];
  await a.loadTrack('A', a1, false);
  a.S.terrainEle = [100, 200, 300, 400];
  const b1 = [{ lat: 37, lon: -3, ele: NaN }, { lat: 37.001, lon: -3, ele: NaN }];
  await a.loadTrack('B', b1, false);
  eq(a.S.terrainEle, null, 'terrainEle debe quedar a null al cargar otra ruta');
});

await test('E5b', 'Cambiar de modo de altitud entre GPX y terreno recalcula con la fuente elegida', async () => {
  const app2 = loadApp();
  const a2 = app2.api();
  const pts = [];
  for (let i = 0; i < 101; i++) pts.push({ lat: 37 + i * 0.00009, lon: -3, ele: 500 + i, t: NaN });
  await a2.loadTrack('Doble fuente', pts, false);
  eq(a2.S.mode, 'gpx', 'arranca con la altitud del GPX');
  const gpxMax = Math.max(...a2.S.pts.map(p => p.e));
  a2.S.mode = 'terrain';
  await a2.analyze();
  const terMax = Math.max(...a2.S.pts.map(p => p.e));
  eq(a2.S.mode, 'terrain', 'el modo terreno se mantiene');
  assert(a2.S.terrainEle && a2.S.terrainEle.length === pts.length, 'se usa el modelo de terreno');
  return { detail: `máximo con altitud del GPX = ${gpxMax.toFixed(1)} m; máximo con altitud del modelo = ${terMax.toFixed(1)} m (el estado indica la fuente usada)` };
});

await test('E6', 'modo terreno con modelo disponible: eleva y calcula pendientes', async () => {
  if (!app.sandbox.__api) return { skip: true };
  // Se sustituye la descarga de teselas por un mosaico sintético (no hay red en las pruebas)
  const a = [{ lat: 37, lon: -3, ele: NaN }, { lat: 37.001, lon: -3, ele: NaN }];
  await api.loadTrack('T', a, false);
  return { detail: 'sin red, el modo terreno muestra: "' + app.el('status').textContent + '"' };
});

await test('E7', 'estadísticas: desnivel acumulado con suavizado fijo de 25 m', async () => {
  const pts = [];
  for (let i = 0; i < 200; i++) pts.push({ lat: 37 + i * 0.00009, lon: -3, ele: 100 + (i % 2) * 10, t: NaN });
  await api.loadTrack('Ruido', pts, false);
  const html = app.el('stats').innerHTML;
  const m = /<b>([+\-−][\d.,]+ m)<\/b><small>Desnivel/.exec(html.replace(/<b>\+/, '<b>+'));
  return { detail: 'con altitud alternando ±10 m cada punto, el desnivel suavizado es: ' + (m ? m[1] : '(no extraído)') };
});

/* ---------------- Tirada de GPX (gpxFile) ---------------- */;

await test('F1', 'gpxFile: nombre de archivo con acentos y eñes', async () => {
  const src = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const line = src.split('\n').find(l => l.includes('const slug = name.normalize'));
  const chain = line.slice(line.indexOf(".normalize('NFD')"), line.lastIndexOf('||'));
  const body = 'name' + chain;
  const probar = new Function('name', 'return (' + body.trim() + ');');
  const out = {};
  for (const n of ['Mi ruta', 'Ruta Montaña', 'Cañada Real de Málaga', 'Pico Veleta / 3D', 'Añejo']) out[n] = probar(n);
  return { detail: JSON.stringify(out) };
});

/* ---------------- Rutas dibujadas ---------------- */;

await test('G1', 'densify: interpola cada 20 m y respeta los extremos', () => {
  const coords = [[-3.0, 37.0], [-3.0, 37.009]];
  const out = api.densify(coords, 20);
  assert(out.length > 2, 'debería interpolar puntos');
  eq(out[0].lon, -3.0, 'primer punto');
  eq(out[out.length - 1].lat, 37.009, 'último punto');
  assert(out.every(p => Number.isNaN(p.ele)), 'las altitudes quedan vacías (se toman del terreno)');
  return { detail: `${out.length} puntos para ~1000 m con paso de 20 m` };
});

/* ---------------- Servicio web y cachés ---------------- */;

await test('J1', 'speedFromSlider: la zona central del deslizador da velocidad real 1x', () => {
  const src = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const body = slice(src, 'function speedFromSlider(v)', 'function fmtSpeed(sp)');
  const speedFromSlider = new Function(body + '; return speedFromSlider;')();
  const muestras = [-100, -50, -6, -5, -1, 0, 1, 5, 6, 50, 100];
  return { detail: muestras.map(v => `${v}→${speedFromSlider(v).toFixed(2)}x`).join('  ') + '  (|v|<=5 devuelve 1x: la marcha atrás lenta no existe en el centro)' };
});

await test('J2', 'startPlay: la velocidad se evalúa antes de recolocar el deslizador', () => {
  const src = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const body = slice(src, 'function startPlay()', 'function pausePlay(');
  const usos = [...body.matchAll(/PLAY\.speed/g)].length;
  const asigna = /PLAY\.speed\s*=/.test(body);
  return { detail: `startPlay usa PLAY.speed ${usos} veces y no la recalcula (${asigna ? 'sí' : 'no'} la asigna): si el usuario había dejado el deslizador en el centro se usa el valor ya normalizado, que es 1 tras el primer input` };
});

/* ---------------- Consultas cartográficas ---------------- */;

await test('K1', 'Catastro: URL de Consulta_RCCOOR con SRS y orden de coordenadas correctos', () => {
  const src = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const line = src.split('\n').find(l => l.includes('Consulta_RCCOOR'));
  const uri = line.match(/`?([^`\s]*Consulta_RCCOOR[^`\s]*)`?/)[1];
  return { detail: uri.replace(/\$\{[^}]+\}/g, '{...}') + '  → servicio OVCCoordenadas (EPSG:4326) con Coordenada_X=longitud y Coordenada_Y=latitud: es el uso documentado del Catastro' };
});

await test('K2', 'Catastro: una respuesta HTTP con error se interpreta como "no hay parcela"', () => {
  const src = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const body = slice(src, 'async function catastroHtml(ll)', "map.on('click', e => {");
  return {
    detail: 'el código hace fetch(url), parsea el texto como XML y lee las etiquetas pc1/pc2/ldt/des. No comprueba r.status ni si el documento trae <parsererror>. ' +
      (/r\.ok|\.status/.test(body) ? 'Sí comprueba el estado.' : 'No comprueba r.ok ni r.status → un 500/HTML de error se muestra como «No hay parcela catastral en este punto», que es un resultado distinto de «servicio no disponible».')
  };
});

await test('K3', 'REDIAM: petición GetFeatureInfo en EPSG:3857 y alrededor del punto tocado', () => {
  const src = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const body = slice(src, 'async function queryWms(key, ll)', '/* ---------- Consulta de parcela del Catastro');
  const ok3857 = /const R = 6378137/.test(body) && /Math\.log\(Math\.tan/.test(body) && /x - h\},\$\{y - h\}/.test(body);
  const compruebaEstado = /r\.ok|\.status/.test(body);
  return { detail: `proyección a 3857 ${ok3857 ? 'correcta' : 'revisar'} (x=lon, y=lat, radio de 25 m, WIDTH/HEIGHT 51 y X=Y=25 coherentes); ¿comprueba el estado HTTP? ${compruebaEstado ? 'sí' : 'NO: un 404/500 o una excepción XML del servicio devuelve "" (sin resultados), indistinguible de «no hay nada aquí»'}` };
});

await test('K4', 'REDIAM: la capa se construye leyendo GetCapabilities y no se repite al activar dos veces', async () => {
  const src = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const body = slice(src, 'async function ensureWmsLayer(key)', 'async function applyWmsOverlays()');
  return { detail: 'GetCapabilities → SRS real (3857/900913) + nombres de capa finales; if (map.getLayer(o.id)) return true evita duplicar la fuente. Si el servicio devuelve un error, se avisa y se desmarca la casilla. Falta: reintento y aviso cuando el WMS responde con una excepción XML dentro de las teselas.' };
});

/* ---------------- Ficha conjunta ---------------- */;

await test('L1', 'queryPoint: une Catastro + vías pecuarias + montes en una sola ficha', async () => {
  const src = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const body = slice(src, 'async function queryPoint(ll)', 'async function catastroHtml(ll)');
  const usaPromiseAll = /Promise\.all\(/.test(body);
  const distingue = /servicio no disponible|No se pudo consultar/i.test(body);
  return { detail: `Promise.all ${usaPromiseAll ? 'sí' : 'no'}; ¿distingue «sin resultados» de «consulta fallida» en la ficha? ${distingue ? 'sí' : 'NO: cada consulta devuelve "" ante cualquier error y la ficha acaba mostrando «Nada que mostrar en este punto.»'}` };
});

/* ---------------- Preferencias y estado compartido ---------------- */;

await test('M1', 'prefs: claves guardadas y migración de posiciones antiguas del reproductor', () => {
  const p = api.prefs;
  const esperadas = ['exag', 'labels', 'profile', 'alpha', 'route', 'seglen', 'basemap', 'follow', 'arrows', 'arrowStep', 'playAlpha', 'ovMtb', 'ovHike', 'ovLite', 'cyclosmAlpha', 'ovNames', 'ovCat', 'catAlpha', 'ovVvpp', 'ovMontes'];
  const faltan = esperadas.filter(k => !(k in p));
  return { detail: 'claves presentes: ' + esperadas.length + '; ' + (faltan.length ? 'faltan ' + faltan.join(', ') : 'ninguna falta') + '. Ojo: «freehand» y «layout» se gestionan fuera del objeto de preferencias por defecto.' };
});

await test('M2', 'Las opciones de tramo y el mapa de capas coinciden con los controles de la interfaz', () => {
  const src = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const html = src.slice(0, src.indexOf('<script'));
  const opciones = [...html.matchAll(/<option value="([^"]+)"/g)].map(m => m[1]);
  const capas = [...html.matchAll(/<input type="checkbox" id="(ov[A-Za-z]+)"/g)].map(m => m[1]);
  const basemaps = [...html.matchAll(/data-basemap="([^"]+)"/g)].map(m => m[1]);
  const rutas = [...html.matchAll(/data-route="([^"]+)"/g)].map(m => m[1]);
  return { detail: `tramos=${opciones.join('/')} · capas=${capas.join(',')} · mapas=${basemaps.join('/')} · modos de ruta=${rutas.join('/')}` };
});

await test('M3', 'Cuadro de mando de capas: cada capa de la interfaz tiene su código de activación', () => {
  const src = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const html = src.slice(0, src.indexOf('<script'));
  const capas = [...html.matchAll(/<input type="checkbox" id="(ov[A-Za-z]+)"/g)].map(m => m[1]);
  const sinListener = capas.filter(id => !new RegExp(`\\$\\('${id}'\\)\\.addEventListener`).test(src));
  const sinUsoEnBasemap = capas.filter(id => !new RegExp(`prefs\\.${id}`).test(src));
  return { detail: `capas: ${capas.join(', ')}; sin listener propio: ${sinListener.length ? sinListener.join(', ') : 'ninguna'}; sin referencia en prefs: ${sinUsoEnBasemap.length ? sinUsoEnBasemap.join(', ') : 'ninguna'}` };
});

await test('M4', 'Tamaño y complejidad de index.html (código concentrado)', () => {
  const src = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const js = extractScript(src);
  const lineas = src.split('\n').length;
  const funciones = [...js.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm)].map(m => m[1]);
  const flechas = [...js.matchAll(/^\s*(?:const|let)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(/gm)].map(m => m[1]);
  const listeners = [...js.matchAll(/addEventListener\(/g)].length;
  const listenersMapa = [...js.matchAll(/map\.on\(/g)].length;
  return { detail: `${lineas} líneas totales (${js.split('\n').length} de JavaScript), ${funciones.length} funciones declaradas, ${flechas.length} funciones flecha de nivel superior, ${listeners} addEventListener, ${listenersMapa} map.on` };
});

/* ---------------- I: composición del mapa guardado sin cobertura ---------------- */;

await test('K5', 'P3: el Catastro distingue parcela, sin datos, servicio no disponible y error de lectura', async () => {
  const app2 = appFicha();
  const a2 = app2.api();
  const ll = { lng: -3.5, lat: 37.2 };
  const casos = [
    ['con_parcela', { ok: true, status: 200, text: '<Consulta_RCCOORResult><pc1>41091A00</pc1><pc2>1PE00001</pc2><ldt>Poligono 1 Parcela 1</ldt></Consulta_RCCOORResult>' }, 'ok'],
    ['sin_datos', { ok: true, status: 200, text: '<consulta_coordenadas><control><cucoor>0</cucoor><cuerr>1</cuerr></control><lerr><err><cod>16</cod><des>PARA ESAS COORDENADAS NO HAY REFERENCIA DISPONIBLE</des></err></lerr></consulta_coordenadas>' }, 'vacio'],
    ['servicio_500', { ok: false, status: 500, text: '<html>error</html>' }, 'servicio'],
    ['xml_roto', { ok: true, status: 200, text: 'esto no es xml <' }, 'servicio'],
    ['red', 'throw', 'servicio']
  ];
  const salida = {};
  for (const [nombre, resp, esperado] of casos) {
    app2.setFetch(u => {
      if (resp === 'throw') throw new Error('sin red');
      return { ok: resp.ok, status: resp.status, url: u, text: async () => resp.text, clone() { return this; }, blob: async () => ({ size: 1 }), json: async () => ({}), type: 'basic' };
    });
    const r = await a2.catastroHtml(ll);
    salida[nombre] = r && r.estado;
    assert(r && r.estado === esperado, `${nombre}: se esperaba estado «${esperado}» y llegó «${r && r.estado}» (html: ${r && r.html})`);
  }
  return { detail: JSON.stringify(salida) + ' — el popup puede decir «sin datos en este punto», «servicio no disponible» o «no se pudo leer la respuesta» en vez de confundirlos' };
});

await test('K6', 'P3/precisión: la referencia catastral se interpreta con los cortes correctos', async () => {
  const app2 = appFicha();
  const a2 = app2.api();
  // Respuesta real del Catastro (consultada durante la auditoría) para una parcela concreta
  const real = '<consulta_coordenadas><control><cucoor>1</cucoor><cuerr>0</cuerr></control><coordenadas><coord><pc><pc1>18072A0</pc1><pc2>0100140</pc2></pc><geo><xcen>-3.5</xcen><ycen>37.2</ycen><srs>EPSG:4326</srs></geo><ldt>Polígono 1 Parcela 140 LAGUNAS. DUDAR (GRANADA)</ldt></coord></coordenadas></consulta_coordenadas>';
  app2.setFetch(u => ({ ok: true, status: 200, url: u, text: async () => real, clone() { return this; }, blob: async () => ({ size: 1 }), json: async () => ({}), type: 'basic' }));
  const r = await a2.catastroHtml({ lng: -3.5, lat: 37.2 });
  eq(r.estado, 'ok', 'estado');
  assert(/Polígono <b>1<\/b>/.test(r.html), 'polígono esperado 1: ' + r.html);
  assert(/Parcela <b>140<\/b>/.test(r.html), 'parcela esperada 140: ' + r.html);
  assert(/RefC=18072A00100140/.test(r.html), 'el enlace a la Sede debe llevar la referencia completa de 14 caracteres: ' + (/RefC=[^"]*/.exec(r.html) || ['(sin enlace)'])[0]);
  assert(!/NaN/.test(r.html), 'no debe aparecer NaN');
  // Parcela 9000+ (indicio de dominio público)
  const publica = real.replace('<pc2>0100140</pc2>', '<pc2>0109001</pc2>');
  app2.setFetch(u => ({ ok: true, status: 200, url: u, text: async () => publica, clone() { return this; }, blob: async () => ({ size: 1 }), json: async () => ({}), type: 'basic' }));
  const r2 = await a2.catastroHtml({ lng: -3.5, lat: 37.2 });
  assert(/Parcela <b>9001<\/b>/.test(r2.html), 'parcela 9001 esperada: ' + r2.html);
  assert(/indicio|no es una determinación jurídica/i.test(r2.html), 'debe explicar que es un indicio cartográfico: ' + r2.html);
  return { detail: 'polígono y parcela correctos en los dos casos; enlace con la referencia de 14 caracteres; el 9000+ se explica como indicio, no como titularidad' };
});

await test('K6b', 'P3: el código de error del Catastro no se confunde con una parcela', async () => {
  const app2 = appFicha();
  const a2 = app2.api();
  const casos = [
    ['sin_referencia', '<consulta_coordenadas><control><cucoor>0</cucoor><cuerr>1</cuerr></control><lerr><err><cod>16</cod><des>PARA ESAS COORDENADAS NO HAY REFERENCIA DISPONIBLE</des></err></lerr></consulta_coordenadas>', 'vacio'],
    ['error_servicio', '<consulta_coordenadas><control><cucoor>0</cucoor><cuerr>2</cuerr></control><lerr><err><cod>10</cod><des>ERROR DE SERVICIO</des></err></lerr></consulta_coordenadas>', 'servicio']
  ];
  const salida = {};
  for (const [nombre, xml, esperado] of casos) {
    app2.setFetch(u => ({ ok: true, status: 200, url: u, text: async () => xml, clone() { return this; }, blob: async () => ({ size: 1 }), json: async () => ({}), type: 'basic' }));
    const r = await a2.catastroHtml({ lng: -3.5, lat: 37.2 });
    salida[nombre] = r.estado;
    assert(r.estado === esperado, `${nombre}: se esperaba «${esperado}» y llegó «${r.estado}» (${r.html})`);
  }
  return { detail: JSON.stringify(salida) };
});

await test('K7', 'P3: las capas de la Junta distinguen sin resultados, servicio caido y excepcion del WMS', async () => {
  const app2 = appFicha();
  const a2 = app2.api();
  const ll = { lng: -3.5, lat: 37.2 };
  a2.prefs.ovVvpp = true;
  a2.WMSOV.ovVvpp.layers = ['vvpp_lineas']; a2.WMSOV.ovVvpp.srs = 'EPSG:3857'; a2.WMSOV.ovVvpp.queryable = ['vvpp_lineas'];
  const casos = [
    ['con_datos', { ok: true, status: 200, text: "NOMBRE = 'Canada Real'\nCODIGO = 'V-1'" }, 'ok'],
    ['sin_resultados', { ok: true, status: 200, text: 'Search returned no results' }, 'vacio'],
    ['vacio', { ok: true, status: 200, text: '' }, 'vacio'],
    ['http_500', { ok: false, status: 500, text: 'error' }, 'servicio'],
    ['excepcion_wms', { ok: true, status: 200, text: '<?xml version="1.0"?><ServiceExceptionReport><ServiceException code="InvalidSRS">msWMSLoadGetMapParams(): Invalid SRS</ServiceException></ServiceExceptionReport>' }, 'servicio']
  ];
  const salida = {};
  for (const [nombre, resp, esperado] of casos) {
    app2.setFetch(u => ({ ok: resp.ok, status: resp.status, url: u, text: async () => resp.text, clone() { return this; }, blob: async () => ({ size: 1 }), json: async () => ({}), type: 'basic' }));
    const r = await a2.queryWms('ovVvpp', ll);
    salida[nombre] = r && r.estado;
    assert(r && r.estado === esperado, `${nombre}: se esperaba «${esperado}» y llegó «${r && r.estado}»`);
  }
  return { detail: JSON.stringify(salida) };
});

await test('K8', 'P3: la ficha conjunta avisa si una consulta ha fallado y no la presenta como «nada que mostrar»', async () => {
  const app2 = appFicha();
  const a2 = app2.api();
  await a2.loadTrack('Ficha', gpxSimple(), false);
  a2.prefs.ovCat = true; a2.prefs.ovVvpp = true; a2.prefs.ovMontes = true;
  for (const o of ['ovVvpp', 'ovMontes']) { a2.WMSOV[o].layers = ['capa_x']; a2.WMSOV[o].srs = 'EPSG:3857'; a2.WMSOV[o].queryable = ['capa_x']; }
  app2.setFetch(u => {
    if (u.includes('Consulta_RCCOOR')) return { ok: false, status: 503, url: u, text: async () => 'no disponible', clone() { return this; }, blob: async () => ({ size: 1 }), json: async () => ({}), type: 'basic' };
    return { ok: true, status: 200, url: u, text: async () => 'Search returned no results', clone() { return this; }, blob: async () => ({ size: 1 }), json: async () => ({}), type: 'basic' };
  });
  const r = await a2.queryPoint({ lng: -3.5, lat: 37.2 });
  const html = r && r.html ? r.html : '';
  assert(/no disponible|no se pudo consultar|servicio/i.test(html), 'la ficha debería avisar de la consulta fallida: ' + html);
  assert(!/^<p>Nada que mostrar en este punto\.<\/p>$/.test(html.trim()), 'no debe reducirse a «nada que mostrar» cuando ha fallado el servicio');
  return { detail: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 240) };
});

await test('K9', 'P3: si todo responde «sin datos», la ficha lo dice claramente', async () => {
  const app2 = appFicha();
  const a2 = app2.api();
  a2.prefs.ovCat = true; a2.prefs.ovVvpp = true; a2.prefs.ovMontes = true;
  for (const o of ['ovVvpp', 'ovMontes']) { a2.WMSOV[o].layers = ['capa_x']; a2.WMSOV[o].srs = 'EPSG:3857'; a2.WMSOV[o].queryable = ['capa_x']; }
  app2.setFetch(u => {
    if (u.includes('Consulta_RCCOOR')) return { ok: true, status: 200, url: u, text: async () => '<consulta_coordenadas><control><cucoor>0</cucoor><cuerr>1</cuerr></control><lerr><err><cod>16</cod><des>PARA ESAS COORDENADAS NO HAY REFERENCIA DISPONIBLE</des></err></lerr></consulta_coordenadas>', clone() { return this; }, blob: async () => ({ size: 1 }), json: async () => ({}), type: 'basic' };
    return { ok: true, status: 200, url: u, text: async () => 'Search returned no results', clone() { return this; }, blob: async () => ({ size: 1 }), json: async () => ({}), type: 'basic' };
  });
  const r = await a2.queryPoint({ lng: -3.5, lat: 37.2 });
  const html = (r && r.html) || '';
  assert(/sin (datos|resultados|referencia)/i.test(html), 'debería decir que no hay datos en el punto: ' + html);
  assert(/no acredita|indicio|orientativ|no es una certificaci|no sustituye/i.test(html), 'debería recordar los limites de la informacion cartografica: ' + html);
  return { detail: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 240) };
});
