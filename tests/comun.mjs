// Utilidades compartidas por las pruebas (registro, aserciones y carga del arnés).
import fs from 'node:fs';
import path from 'node:path';
import { loadApp, loadSW, REPO, extractScript, slice } from './harness.mjs';

export { fs, path, REPO, loadApp, loadSW, extractScript, slice };

export const resultados = [];
export async function test(id, name, fn) {
  const t0 = Date.now();
  try {
    const res = await fn();
    resultados.push({ id, name, status: res && res.skip ? 'OMITIDA' : 'PASA', detail: res && res.detail ? res.detail : (typeof res === 'string' ? res : ''), ms: Date.now() - t0 });
  } catch (e) {
    resultados.push({ id, name, status: 'FALLA', detail: e && e.message ? e.message : String(e), ms: Date.now() - t0 });
  }
}
export const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
export const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg}: esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`); };
export const near = (a, b, tol, msg) => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${msg}: esperado ${b}±${tol}, obtenido ${a}`); };

// El arnés carga la aplicación una sola vez por proceso.
export const app = loadApp();
if (!app.ok) {
  console.error('\nNo se pudo cargar index.html en el arnés:\n' + (app.error && app.error.stack) + '\n');
}
export const api = app.ok ? app.api() : null;

export const resumen = () => resultados.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {});

/* ---------------- Utilidades de las pruebas ---------------- */

// GPX de prueba con un track alrededor de un punto.
export const gpxOf = (body, name = 'Prueba') => `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name>${body}</trk></gpx>`;
export const pt = (lat, lon, ele) => `<trkpt lat="${lat}" lon="${lon}">${ele === undefined ? '' : `<ele>${ele}</ele>`}</trkpt>`;

// Ruta de puntos sintética con altitudes.
export const rutaSintetica = (n, { lat = 37, lon = -3, paso = 0.0009, ele0 = 100, dEle = 1 } = {}) => {
  const raw = [];
  for (let i = 0; i < n; i++) raw.push({ lat: lat + i * paso, lon, ele: ele0 + i * dEle, t: NaN });
  return raw;
};

// Aplicación lista para probar el guardado sin cobertura, con las capas de la Junta simuladas
// (el arnés no descarga GetCapabilities) y las capas activas.
export const rutasOffline = async (extra = {}) => {
  const app2 = loadApp(extra);
  const a2 = app2.api();
  Object.assign(a2.prefs, { ovNames: true, ovCat: true, ovVvpp: true, ovMontes: true, ovMtb: true, ovHike: true, ovLite: true, basemap: 'sat' });
  for (const k of ['ovVvpp', 'ovMontes']) {
    a2.WMSOV[k].layers = [k === 'ovVvpp' ? 'vvpp_lineas' : 'montes_pub'];
    a2.WMSOV[k].srs = 'EPSG:3857';
    a2.WMSOV[k].queryable = a2.WMSOV[k].layers;
  }
  const wms = (service, capa) => `https://x/rediam/${service}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=${capa}&STYLES=&SRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=512&HEIGHT=512&FORMAT=image/png&TRANSPARENT=TRUE`;
  app2.mapStub.addSource('vvpp', { type: 'raster', tiles: [wms('REDIAM_Inventario_VVPP', 'vvpp_lineas')] });
  app2.mapStub.addLayer({ id: 'vvpp', type: 'raster' });
  app2.mapStub.addSource('montes', { type: 'raster', tiles: [wms('REDIAM_Montes_Publicos_Andalucia', 'montes_pub')] });
  app2.mapStub.addLayer({ id: 'montes', type: 'raster' });
  await a2.loadTrack('Offline', rutaSintetica(60), false);
  return { app: app2, api: a2, urls: a2.offlineUrlsFor(a2.S.pts) };
};

// Aplicación lista para probar la ficha de consulta cartográfica.
export const appFicha = () => loadApp();
export const gpxSimple = () => rutaSintetica(20);
