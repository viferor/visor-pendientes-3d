// Pruebas de la familia «gpx» · se ejecutan con: npm test
import { test, eq, near, assert, slice, extractScript, fs, path, REPO, app, api, loadApp, loadSW } from '../comun.mjs';

// Constantes que esta familia usa del arnés (el resto se lee de api.*)
const S = api.S;
const haversine = api.haversine;
const loadTrack = api.loadTrack;
const parseGPX = api.parseGPX;
import { gpxOf, pt } from '../comun.mjs';

await test('A1', 'El script de index.html se evalúa sin errores en el entorno de pruebas', () => {
  assert(app.ok, 'error al evaluar index.html: ' + (app.error && app.error.message) + '\n' + (app.error && app.error.stack));
  assert(api && api.S, 'no se expuso el estado interno');
  return { detail: 'script evaluado correctamente (líneas: ' + app.src.split('\n').length + ')' };
});

await test('A2', 'parseGPX: GPX válido y sencillo', () => {
  const g = gpxOf(pt(37.0, -3.0, 1000) + pt(37.001, -3.0, 1010), 'Ruta simple');
  const r = api.parseGPX(g);
  eq(r.name, 'Ruta simple', 'nombre del track');
  eq(r.pts.length, 2, 'número de puntos');
  eq(r.pts[0].ele, 1000, 'altitud del primer punto');
});

await test('A3', 'parseGPX: GPX sin altitudes (ele ausente)', () => {
  const g = gpxOf(pt(37.0, -3.0) + pt(37.001, -3.0));
  const r = api.parseGPX(g);
  eq(r.pts.length, 2, 'número de puntos');
  assert(Number.isNaN(r.pts[0].ele), 'ele debería ser NaN cuando falta la altitud');
  return { detail: 'ele = NaN en todos los puntos (comportamiento esperado)' };
});

await test('A4', 'parseGPX: XML mal formado produce error controlado', () => {
  let msg = null;
  try { api.parseGPX('<gpx><trk><trkpt lat="37" lon="-3"></trk></gpx>'); } catch (e) { msg = e.message; }
  assert(msg !== null, 'un XML mal formado debería lanzar error');
  return { detail: 'error: ' + msg };
});

await test('A5', 'parseGPX: GPX vacío produce error controlado', () => {
  let msg = null;
  try { api.parseGPX('<gpx version="1.1"></gpx>'); } catch (e) { msg = e.message; }
  assert(msg !== null, 'un GPX sin puntos debería lanzar error');
  return { detail: 'error: ' + msg };
});

await test('A6', 'parseGPX: puntos con coordenadas no numéricas se descartan', () => {
  const g = gpxOf('<trkpt lat="abc" lon="-3"><ele>1</ele></trkpt>' + pt(37.0, -3.0, 100) + pt(37.001, -3.0, 110));
  const r = api.parseGPX(g);
  eq(r.pts.length, 2, 'solo deben quedar los puntos válidos');
});

await test('A7', 'parseGPX: descarta puntos repetidos a menos de 0,5 m', () => {
  const g = gpxOf(pt(37.0, -3.0, 100) + pt(37.0, -3.0, 100) + pt(37.0, -3.0, 100) + pt(37.001, -3.0, 110));
  const r = api.parseGPX(g);
  eq(r.pts.length, 2, 'los duplicados exactos deben colapsarse');
});

await test('A8', 'parseGPX: coordenadas fuera de rango se descartan (ya no se aceptan)', () => {
  const g = gpxOf(pt(95, 500, 100) + pt(95.001, 500, 110));
  let msg = null;
  try { api.parseGPX(g); } catch (e) { msg = e.message; }
  assert(msg !== null, 'un archivo con todas las coordenadas fuera de rango debe avisar en vez de dibujar algo imposible');
  const g2 = gpxOf(pt(95, 500, 100) + pt(37.0, -3.0, 100) + pt(37.001, -3.0, 110));
  const r = api.parseGPX(g2);
  eq(r.pts.length, 2, 'solo quedan los puntos válidos');
  eq(r.descartados, 1, 'se informa del punto descartado');
  assert(Math.abs(api.haversine({ lat: 37, lon: -3 }, { lat: 95, lon: 500 }) - 5456528) < 5, 'el cálculo directo sigue dando un valor absurdo: por eso hay que validar antes');
  return { detail: 'error controlado si no queda ningún punto válido: "' + msg + '"; con puntos válidos se descarta el imposible y se informa' };
});

await test('A9', 'parseGPX: GPX con varios segmentos une trkpt de todos ellos', () => {
  const g = gpxOf('<trkseg>' + pt(37.0, -3.0, 100) + pt(37.001, -3.0, 110) + '</trkseg><trkseg>' + pt(38.0, -3.5, 200) + pt(38.001, -3.5, 210) + '</trkseg>');
  const r = api.parseGPX(g);
  eq(r.pts.length, 4, 'puntos de los dos segmentos');
  const salto = api.haversine({ lat: 37.001, lon: -3.0 }, { lat: 38.0, lon: -3.5 });
  return { detail: `une los segmentos con un salto de ${(salto / 1000).toFixed(1)} km; al analizar la ruta se avisa del hueco (prueba A16)` };
});

await test('A10', 'parseGPX: sensores en extensions sin espacio de nombres (power)', () => {
  const g = gpxOf('<trkpt lat="37.0" lon="-3.0"><ele>100</ele><extensions><power>250</power><hr>140</hr><cad>85</cad><atemp>21</atemp></extensions></trkpt>' + pt(37.001, -3.0, 110));
  const r = api.parseGPX(g);
  eq(r.pts[0].pw, 250, 'potencia detectada');
  eq(r.pts[0].hr, 140, 'pulso detectado');
  return { detail: `pw=${r.pts[0].pw} hr=${r.pts[0].hr} cad=${r.pts[0].cad} temp=${r.pts[0].temp} (con prefijo gpxpx: el elemento se llama "gpxpx:hr" en el DOM real y el código no lo detecta: en el archivo real Bicicleta_por_la_mañana(1).gpx hay 40.516 etiquetas gpxtpx:*)` };
});

await test('A11', 'parseGPX: archivo real Bicicleta_por_la_mañana (1).gpx', () => {
  const p = path.resolve(process.cwd(), 'Bicicleta_por_la_mañana (1).gpx');
  if (!fs.existsSync(p)) return { skip: true, detail: 'no está el GPX de ejemplo en el directorio de trabajo' };
  const t0 = Date.now();
  const r = api.parseGPX(fs.readFileSync(p, 'utf8'));
  const ms = Date.now() - t0;
  assert(r.pts.length > 1000, 'debería tener miles de puntos');
  return { detail: `${r.pts.length} puntos en ${ms} ms; con altitud: ${r.pts.filter(p => Number.isFinite(p.ele)).length}` };
});

await test('A12', 'P4: los sensores de Garmin/Strava (gpxtpx:hr, gpxtpx:cad, gpxtpx:atemp) se leen', () => {
  const g = gpxOf('<trkpt lat="37.0" lon="-3.0"><ele>100</ele><time>2026-07-30T07:00:00Z</time><extensions><power>250</power>' +
    '<gpxtpx:TrackPointExtension><gpxtpx:atemp>28</gpxtpx:atemp><gpxtpx:hr>104</gpxtpx:hr><gpxtpx:cad>64</gpxtpx:cad></gpxtpx:TrackPointExtension>' +
    '</extensions></trkpt>' + pt(37.001, -3.0, 110));
  const r = api.parseGPX(g);
  eq(r.pts[0].hr, 104, 'pulso');
  eq(r.pts[0].cad, 64, 'cadencia');
  eq(r.pts[0].temp, 28, 'temperatura');
  eq(r.pts[0].pw, 250, 'potencia (etiqueta sin prefijo)');
  return { detail: `hr=${r.pts[0].hr} cad=${r.pts[0].cad} temp=${r.pts[0].temp} pw=${r.pts[0].pw}` };
});

await test('A13', 'P4: el GPX real de Strava aporta pulso, cadencia y temperatura en todos los puntos', () => {
  const p = path.resolve(process.cwd(), 'Bicicleta_por_la_mañana (1).gpx');
  if (!fs.existsSync(p)) return { skip: true, detail: 'no está el GPX real en el directorio de trabajo' };
  const r = api.parseGPX(fs.readFileSync(p, 'utf8'));
  const c = k => r.pts.filter(x => Number.isFinite(x[k])).length;
  assert(c('hr') > 10000, `apenas hay pulsos: ${c('hr')}`);
  assert(c('cad') > 10000, `apenas hay cadencias: ${c('cad')}`);
  assert(c('temp') > 10000, `apenas hay temperaturas: ${c('temp')}`);
  assert(c('pw') > 10000, `apenas hay potencias: ${c('pw')}`);
  return { detail: `${r.pts.length} puntos: hr ${c('hr')}, cad ${c('cad')}, temp ${c('temp')}, pw ${c('pw')}` };
});

/* ---------------- Distancias y empalme ---------------- */;

await test('A14', 'P8: las coordenadas imposibles se descartan y se informa de cuantas', () => {
  const g = gpxOf(pt(95, 500, 100) + pt(95.001, 500, 110) + pt(37.0, -3.0, 200) + pt(37.001, -3.0, 210) + pt(-91, 0, 300));
  const r = api.parseGPX(g);
  eq(r.pts.length, 2, 'solo deben quedar los dos puntos válidos');
  assert(r.descartados === 3, 'debería informar de 3 puntos descartados, informa de ' + r.descartados);
  return { detail: `${r.pts.length} puntos válidos, ${r.descartados} descartados` };
});

await test('A15', 'P8: si el GPX no trae altitudes utilizables, se avisa y se usa el terreno', async () => {
  const app2 = loadApp();
  const a2 = app2.api();
  const raw = [];
  for (let i = 0; i < 30; i++) raw.push({ lat: 37 + i * 0.0009, lon: -3, ele: NaN, t: NaN });
  await a2.loadTrack('Sin altitudes', raw, false);
  return { detail: 'estado: ' + JSON.stringify(app2.el('status').textContent) + ' · modo: ' + a2.S.mode };
});

await test('A16', 'P8: un GPX con varios segmentos avisa del salto entre ellos', async () => {
  const app2 = loadApp();
  const a2 = app2.api();
  const g = gpxOf('<trkseg>' + pt(37.0, -3.0, 100) + pt(37.001, -3.0, 110) + pt(37.002, -3.0, 120) + '</trkseg>' +
                  '<trkseg>' + pt(38.0, -3.5, 200) + pt(38.001, -3.5, 210) + '</trkseg>');
  const { name, pts } = a2.parseGPX(g);
  await a2.loadTrack(name, pts, false);
  const st = app2.el('status').textContent;
  assert(/segmento/i.test(st), 'debería avisar de los segmentos: ' + JSON.stringify(st));
  return { detail: st };
});

/* ---------------- R: memoria, precarga y caché del service worker ---------------- */;
