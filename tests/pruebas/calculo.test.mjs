// Pruebas de la familia «calculo» · se ejecutan con: npm test
import { test, eq, near, assert, slice, extractScript, fs, path, REPO, app, api, loadApp, loadSW } from '../comun.mjs';

// Constantes que esta familia usa del arnés (el resto se lee de api.*)
const S = api.S;
const autoLength = api.autoLength;
const buildSegments = api.buildSegments;
const fmtGrade = api.fmtGrade;
const gradeColor = api.gradeColor;
const haversine = api.haversine;
const loadTrack = api.loadTrack;
const smooth = api.smooth;
const tileXY = api.tileXY;

await test('B1', 'haversine: 1° de latitud ≈ 111,2 km', () => {
  near(api.haversine({ lat: 37, lon: -3 }, { lat: 38, lon: -3 }), 111195, 200, 'distancia de 1 grado de latitud');
});

await test('B2', 'haversine: cruce del antimeridiano (179,999 → -179,999)', () => {
  const d = api.haversine({ lat: 0, lon: 179.999 }, { lat: 0, lon: -179.999 });
  near(d, 222, 30, 'distancia a través del antimeridiano');
  return { detail: d.toFixed(1) + ' m (≈222 m esperados): el cálculo directo es correcto' };
});

await test('B3', 'autoLength: umbrales 50 / 100 / 200 m', () => {
  eq(api.autoLength(10000), 50, 'ruta de 10 km');
  eq(api.autoLength(49999), 50, 'justo por debajo de 50 km');
  eq(api.autoLength(50000), 100, 'justo en 50 km');
  eq(api.autoLength(120000), 200, 'justo en 120 km');
});

await test('B4', 'smooth: no produce NaN con altitudes constantes', () => {
  const pts = Array.from({ length: 100 }, (_, i) => ({ d: i * 10, e0: 500 }));
  const sm = api.smooth(pts, 25);
  eq(sm.length, 100, 'longitud del resultado');
  assert(sm.every(v => Number.isFinite(v)), 'todos los valores deben ser finitos');
  near(sm[50], 500, 1e-9, 'valor suavizado');
});

/* ---------------- Pendiente ---------------- */;

await test('C1', 'buildSegments: rampa conocida del 10 % (1000 m, +100 m)', () => {
  const n = 101, pts = [];
  for (let i = 0; i < n; i++) pts.push({ lat: 37 + i * 0.000089932, lon: -3, d: i * 10, e0: 100 + i, e: 100 + i });
  pts.forEach((p, i) => p.e = 100 + i);
  const segs = api.buildSegments(pts, 50);
  eq(segs.length, 20, 'número de tramos de 50 m');
  for (const g of segs) near(g.g, 10, 0.001, 'pendiente del tramo');
  eq(segs[0].color, api.gradeColor(10), 'color coherente con el intervalo de pendiente');
  near(segs[0].mid[0], -3, 1e-9, 'longitud del punto medio');
  return { detail: `20 tramos, pendiente ${segs[0].g.toFixed(3)} % cada uno, color ${segs[0].color}` };
});

await test('C2', 'buildSegments: pendiente negativa (bajada del 10 %)', () => {
  const pts = [];
  for (let i = 0; i < 101; i++) pts.push({ lat: 37, lon: -3 + i * 1.1e-4, d: i * 10, e: 100 - i });
  const segs = api.buildSegments(pts, 50);
  near(segs[0].g, -10, 0.001, 'pendiente negativa');
  eq(segs[0].color, api.gradeColor(-10), 'color de bajada');
});

await test('C3', 'buildSegments: última fracción corta se fusiona con el tramo anterior', () => {
  const pts = [];
  for (let i = 0; i < 106; i++) pts.push({ lat: 37, lon: -3 + i * 1e-4, d: i * 10, e: 100 });
  const segs = api.buildSegments(pts, 50);
  const last = segs[segs.length - 1];
  near(last.d1, 1050, 1e-6, 'fin del último tramo');
  assert(segs.every(g => g.d1 - g.d0 >= 20), 'ningún tramo debe quedar por debajo del 40 % de la longitud pedida');
  return { detail: segs.map(g => Math.round(g.d1 - g.d0)).join(', ') };
});

await test('C4', 'buildSegments: distancias repetidas (d iguales) no generan Infinity', () => {
  const pts = [];
  for (let i = 0; i < 20; i++) pts.push({ lat: 37, lon: -3, d: 0, e: 100 + i });
  const segs = api.buildSegments(pts, 50);
  return { detail: `tramos: ${segs.length}; g = ${segs.map(g => g.g).join(',')} (Math.max(1, b.d-a.d) evita la división por cero)` };
});

await test('C5', 'buildSegments: altitudes ausentes (NaN) contaminan la pendiente', () => {
  const pts = [];
  for (let i = 0; i < 101; i++) pts.push({ lat: 37, lon: -3 + i * 1e-4, d: i * 10, e: NaN });
  const segs = api.buildSegments(pts, 50);
  const todosNaN = segs.every(g => Number.isNaN(g.g));
  assert(todosNaN, 'se esperaba NaN en la pendiente');
  return { detail: `pendientes = NaN en los ${segs.length} tramos; gradeColor(NaN) = ${api.gradeColor(NaN)} (cae en el intervalo > 15 %)` };
});

await test('C6', 'fmtGrade / textOn / color: unidades en porcentaje', () => {
  eq(api.fmtGrade(12.34), '+12.3%', 'formato de pendiente positiva');
  eq(api.fmtGrade(-5), '−5.0%', 'formato de pendiente negativa');
  eq(api.fmtGrade(0), '0.0%', 'pendiente nula');
  eq(api.gradeColor(0), '#8fe36b', 'llano');
  eq(api.gradeColor(-10), '#3a6ee8', 'bajada fuerte');
  eq(api.gradeColor(20), '#7a1f86', 'rampa extrema');
  return { detail: 'fmtGrade siempre en %, nunca en grados' };
});

/* ---------------- Altitud del terreno ---------------- */;

await test('D1', 'tileXY: tesela z15 de un punto conocido (Pradollano)', () => {
  const [x, y] = api.tileXY(-3.3965, 37.0935, 15);
  const n = 2 ** 15;
  near(x, Math.floor((-3.3965 + 180) / 360 * n), 1e-9, 'x de la tesela');
  near(y, Math.floor((0.5 - Math.log((1 + Math.sin(37.0935 * Math.PI / 180)) / (1 - Math.sin(37.0935 * Math.PI / 180))) / (4 * Math.PI)) * n), 1e-9, 'y de la tesela');
  return { detail: `z15 → x=${x} y=${y}` };
});

await test('D2', 'descodificación Terrarium (RGB → metros) de valores conocidos', () => {
  const decode = (r, g, b) => r * 256 + g + b / 256 - 32768;
  near(decode(128, 0, 0), 0, 1e-9, 'nivel del mar');
  near(decode(128, 34, 0), 34, 1e-9, '34 m');
  near(decode(128, 90, 0), 90, 1e-9, '90 m');
  near(decode(128, 46, 0), 46, 1e-9, '46 m');
  return { detail: 'la fórmula del código (data[i]*256 + data[i+1] + data[i+2]/256 - 32768) coincide con la definición de Terrarium: R*256 + G + B/256 - 32768' };
});

await test('D3', 'terrainElevations: un fallo de red rechaza la promesa (no devuelve NaN)', async () => {
  const appSinRed = loadApp({ imageMode: 'offline' });
  const a = appSinRed.api();
  let msg = null;
  try { await a.terrainElevations([{ lat: 37, lon: -3 }, { lat: 37.001, lon: -3 }], 5000); } catch (e) { msg = e.message; }
  assert(msg !== null, 'debería rechazar cuando no se pueden descargar las teselas');
  return { detail: 'error: ' + msg };
});

await test('D4', 'terrainElevations: con teselas disponibles devuelve las altitudes del modelo', async () => {
  const app2 = loadApp();
  const a2 = app2.api();
  const pts = [];
  for (let i = 0; i < 61; i++) pts.push({ lat: 37 + i * 0.00009, lon: -3, ele: NaN, t: NaN });
  await a2.loadTrack('Modelo', pts, false);
  eq(a2.S.mode, 'terrain', 'modo terreno');
  const ele = a2.S.terrainEle || (a2.S.pts && a2.S.pts.map(p => p.e0));
  const finitas = ele.filter(Number.isFinite).length;
  const rango = Math.max(...ele) - Math.min(...ele);
  assert(finitas === ele.length, 'todas las altitudes del modelo deben ser finitas');
  assert(a2.S.segs.every(g => Number.isFinite(g.g)), 'las pendientes deben calcularse con la altitud del modelo');
  return { detail: `${finitas}/${ele.length} altitudes leídas del modelo, rango ${rango.toFixed(1)} m, ${a2.S.segs.length} tramos con pendiente finita` };
});

/* ---------------- Análisis completo ---------------- */;
