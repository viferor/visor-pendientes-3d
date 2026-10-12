// Arnés de auditoría (SOLO LECTURA del repositorio).
// Extrae el <script> de index.html y el código de sw.js, y los ejecuta en Node
// dentro de un DOM/entorno mínimo, sin modificar el repositorio ni publicar nada.
// Devuelve las funciones internas para poder probarlas con casos conocidos.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { DOMParserStub } from './xml.mjs';

// Raíz del proyecto: se busca un index.html que sea realmente la aplicación (tiene el mapa y los
// controles), porque en el directorio de trabajo puede haber copias antiguas sueltas del archivo.
export const REPO = (() => {
  const esAplicacion = c => {
    const p = path.join(c, 'index.html');
    if (!fs.existsSync(p)) return false;
    try { const t = fs.readFileSync(p, 'utf8'); return t.includes('id="showArrows"') && t.includes('maplibre'); } catch (e) { return false; }
  };
  const candidatos = [
    path.join(import.meta.dirname, '..'),
    path.join(process.cwd(), 'visor-pendientes-3d'),
    process.cwd(),
    path.join(path.dirname(process.cwd()), 'visor-pendientes-3d'),
    path.dirname(process.cwd())
  ];
  for (const c of candidatos) if (esAplicacion(c)) return c;
  return process.cwd();
})();

/* ---------------- DOM mínimo ---------------- */

const VOID = new Set(['meta', 'link', 'br', 'hr', 'img', 'input', 'source', 'area', 'base', 'col', 'embed', 'track', 'wbr']);

// Permite que los elementos <canvas> creados con document.createElement usen el
// contexto sintético configurado en loadApp (necesario para probar el modelo de elevación).
const createCtxRef = { fn: null };

class QNode {
  constructor(tagName, attrs = {}) {
    this.tagName = tagName.toLowerCase();
    this.localName = this.tagName;
    this.attributes = { ...attrs };
    this.children = [];
    this.parentNode = null;
    this.textContent = '';
    this.value = this.attributes.value !== undefined ? this.attributes.value : '';
    this.checked = Object.prototype.hasOwnProperty.call(this.attributes, 'checked');
    this.disabled = Object.prototype.hasOwnProperty.call(this.attributes, 'disabled');
    this.hidden = Object.prototype.hasOwnProperty.call(this.attributes, 'hidden');
    this.open = Object.prototype.hasOwnProperty.call(this.attributes, 'open');
    this.dataset = {};
    this.style = makeStyle();
    this.options = [];
    this.files = [];
    this.classList = {
      _s: new Set(),
      add: (...c) => c.forEach(x => this.classList._s.add(x)),
      remove: (...c) => c.forEach(x => this.classList._s.delete(x)),
      contains: c => this.classList._s.has(c),
      toggle: (c, on) => { if (on === undefined) on = !this.classList._s.has(c); on ? this.classList._s.add(c) : this.classList._s.delete(c); return on; }
    };
    for (const k in this.attributes) {
      if (k.startsWith('data-')) {
        const dk = k.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase());
        this.dataset[dk] = this.attributes[k];
      }
    }
  }
  get id() { return this.attributes.id || ''; }
  get className() { return this.attributes.class || ''; }
  set className(v) { this.attributes.class = v; }
  getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attributes, n) ? this.attributes[n] : null; }
  setAttribute(n, v) { this.attributes[n] = String(v); if (n === 'hidden') this.hidden = true; }
  removeAttribute(n) { delete this.attributes[n]; if (n === 'hidden') this.hidden = false; }
  hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attributes, n); }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter(x => x !== c); return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  addEventListener(t, cb) { (this._ev = this._ev || {})[t] = (this._ev[t] || []).concat(cb); }
  removeEventListener() {}
  dispatchEvent() { return true; }
  setPointerCapture() {}
  releasePointerCapture() {}
  focus() {}
  // Ejecuta los manejadores de «click» de verdad, para que las pruebas comprueben que el botón hace
  // algo y no solo que el código existe. Devuelve cuántos manejadores había.
  click() {
    const lista = (this._ev && this._ev.click) || [];
    for (const cb of lista) cb({ target: this, preventDefault() {}, stopPropagation() {} });
    return lista.length;
  }
  getBoundingClientRect() { return { width: 800, height: 170, left: 0, top: 0, right: 800, bottom: 170, x: 0, y: 0 }; }
  getContext() { return (createCtxRef.fn || makeCanvasCtx)(); }
  toDataURL() { return 'data:,'; }
  closest(sel) {
    let n = this;
    const sels = String(sel).split(',').map(s => s.trim());
    while (n) {
      for (const s of sels) {
        if (s.startsWith('.') ? n.classList.contains(s.slice(1)) : s === n.tagName) return n;
      }
      n = n.parentNode;
    }
    return null;
  }
  matches(sel) { return !!this.closest(sel) && this.closest(sel) === this; }
  getElementsByTagName(t) { return descendants(this).filter(n => t === '*' || n.tagName === t); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) { return queryAll(this, sel); }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get innerHTML() { return this._html || ''; }
  set innerHTML(v) { this._html = String(v); }
  get outerHTML() { return this._html || `<${this.tagName}>`; }
}

function makeStyle() {
  const props = {};
  return new Proxy(props, {
    get(t, p) {
      if (p === 'setProperty') return (k, v) => { t[k] = v; };
      if (p === 'getPropertyValue') return k => t[k] || '';
      if (p === 'removeProperty') return k => { delete t[k]; };
      if (p in t) return t[p];
      return '';
    },
    set(t, p, v) { t[p] = v; return true; }
  });
}

function makeCanvasCtx() {
  const noop = () => {};
  return new Proxy({
    measureText: t => ({ width: String(t).length * 7 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    createLinearGradient: () => ({ addColorStop: noop }),
    canvas: { width: 800, height: 170 }
  }, {
    get(t, p) { if (p in t) return t[p]; return noop; },
    set(t, p, v) { t[p] = v; return true; }
  });
}

function descendants(n) {
  const out = [];
  const walk = x => { for (const c of x.children) { out.push(c); walk(c); } };
  walk(n);
  return out;
}

function queryAll(root, sel) {
  const sels = String(sel).split(',').map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const n of descendants(root)) {
    for (const s of sels) {
      if (s.startsWith('.') && n.classList.contains(s.slice(1))) { out.push(n); break; }
      if (s.startsWith('#') && n.id === s.slice(1)) { out.push(n); break; }
      if (/^[a-z]+$/i.test(s) && n.tagName === s.toLowerCase()) { out.push(n); break; }
      if (s.includes('.') && !s.startsWith('.')) {
        const [tag, cls] = s.split('.');
        if (n.tagName === tag.toLowerCase() && n.classList.contains(cls)) { out.push(n); break; }
      }
    }
  }
  return out;
}

function parseHTML(html) {
  const root = new QNode('#document');
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!')) continue;
    const closing = m[1] === '/', name = m[2].toLowerCase(), selfClose = m[4] === '/';
    if (closing) {
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].tagName === name) { stack.length = k; break; }
      continue;
    }
    const attrs = {};
    const attrRe = /([^\s=/>]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let a;
    while ((a = attrRe.exec(m[3] || ''))) attrs[a[1].toLowerCase()] = a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : a[5] !== undefined ? a[5] : '';
    const node = new QNode(name, attrs);
    if (node.tagName === 'option' && stack[stack.length - 1].tagName === 'select') stack[stack.length - 1].options.push(node);
    stack[stack.length - 1].appendChild(node);
    if (!selfClose && !VOID.has(name)) stack.push(node);
  }
  return root;
}

/* ---------------- Entorno ---------------- */

function makeLocalStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
    get length() { return m.size; },
    key: i => [...m.keys()][i],
    _dump: () => Object.fromEntries(m)
  };
}

function makeCacheStorage() {
  const caches = new Map();
  const store = name => {
    if (!caches.has(name)) {
      const entries = new Map();
      caches.set(name, {
        _name: name, _entries: entries,
        match: async req => entries.get(typeof req === 'string' ? req : req.url) || undefined,
        put: async (req, res) => { entries.set(typeof req === 'string' ? req : req.url, res); },
        add: async req => { entries.set(typeof req === 'string' ? req : req.url, { ok: true, url: req }); },
        addAll: async list => { for (const r of list) entries.set(r, { ok: true, url: r }); },
        delete: async req => entries.delete(typeof req === 'string' ? req : req.url),
        keys: async () => [...entries.keys()].map(url => ({ url })),
        _count: () => entries.size
      });
    }
    return caches.get(name);
  };
  return {
    open: async n => store(n),
    match: async req => { for (const c of caches.values()) { const h = await c.match(req); if (h) return h; } return undefined; },
    keys: async () => [...caches.keys()],
    delete: async n => caches.delete(n),
    has: async n => caches.has(n),
    _all: () => [...caches.entries()].map(([n, c]) => [n, c._count()])
  };
}

function makeIndexedDB() {
  const data = new Map();
  const db = {
    transaction: () => {
      const tx = { oncomplete: null, onerror: null, objectStore: () => store, error: null };
      setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0);
      return tx;
    }
  };
  const store = {
    put: (v, k) => { data.set(k, v); return { onsuccess: null, onerror: null }; },
    get: k => { const q = { onsuccess: null, onerror: null, result: data.get(k) }; setTimeout(() => { if (q.onsuccess) q.onsuccess(); else store._cb && store._cb(); }, 0); return q; }
  };
  return {
    open: () => {
      const req = { onupgradeneeded: null, onsuccess: null, onerror: null, result: { createObjectStore: () => ({}), transaction: db.transaction } };
      setTimeout(() => { if (req.onsuccess) req.onsuccess(); }, 0);
      return req;
    },
    _data: data
  };
}

// Proxy que absorbe cualquier API del navegador no implementada y evita que el
// código de la app falle por dependencias irrelevantes para las pruebas de cálculo.
const missing = (what, target) => () => {
  throw new Error('[harness] dependencia no simulada: ' + what + ' (target=' + target + ')');
};

function safeGlobal(name, real) {
  return new Proxy(real || {}, {
    get(t, p) {
      if (p in t) return t[p];
      if (typeof p === 'symbol') return undefined;
      if (p === 'then') return undefined;
      return undefined;
    },
    set(t, p, v) { t[p] = v; return true; },
    has() { return true; }
  });
}

/* ---------------- Extracción de regiones ---------------- */

export function extractScript(html) {
  const m = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!m) throw new Error('no se encontró el <script> en línea de index.html');
  return m[1];
}

export function slice(source, from, to) {
  const i = source.indexOf(from);
  if (i < 0) throw new Error('no se encontró el marcador inicial: ' + from);
  const j = to ? source.indexOf(to, i) : -1;
  if (to && j < 0) throw new Error('no se encontró el marcador final: ' + to);
  return source.slice(i, to ? j : undefined);
}

/* ---------------- Carga de index.html ---------------- */

export function loadApp({ fetchImpl, imageMode, AndroidGpx } = {}) {
  const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const src = extractScript(html);
  const doc = parseHTML(html);
  const byId = new Map();
  for (const n of descendants(doc)) if (n.id && !byId.has(n.id)) byId.set(n.id, n);

  const selectSeglen = byId.get('seglen');
  selectSeglen.options = [new QNode('option', { value: 'auto' })];
  byId.get('showLabels').checked = true;
  byId.get('showArrows').checked = true;
  byId.get('followProfile').checked = true;
  byId.get('exag').value = '1.5';
  byId.get('catAlpha').value = '80';
  byId.get('cyclosmAlpha').value = '100';
  byId.get('seglen').value = 'auto';
  byId.get('arrowStep').value = 'auto';
  byId.get('playAlpha').value = '86';
  byId.get('profileAlpha').value = '86';
  byId.get('playSpeed').value = '0';

  const localStorage = makeLocalStorage();
  const caches = makeCacheStorage();
  const indexedDB = makeIndexedDB();
  // getImageData sintético con el terreno del patrón de prueba (ver auditoria/pruebas.mjs, D4)
  const ELEV_PATTERN = { R0: 98, cxf: 0.04, cyf: 0.04, z0: 15 };
  const syntheticData = i => {
    const px = Math.floor((i / 4) % 256), py = Math.floor((i / 4) / 256);
    const e = Math.round(ELEV_PATTERN.R0 + ELEV_PATTERN.cxf * px + ELEV_PATTERN.cyf * py);
    const n = e + 32768;
    const R = Math.floor(n / 256) % 256, G = Math.floor(n % 256), B = Math.round((n - Math.floor(n)) * 256);
    return (i % 4 === 0) ? R : (i % 4 === 1) ? G : (i % 4 === 2) ? B : 255;
  };
  const makeImageData = (w, h) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i++) data[i] = syntheticData(i);
    return { data, width: w, height: h };
  };
  const makeCtx = () => {
    const noop = () => {};
    return new Proxy({
      measureText: t => ({ width: String(t).length * 7 }),
      getImageData: (x, y, w, h) => makeImageData(w, h),
      createLinearGradient: () => ({ addColorStop: noop })
    }, { get(t, p) { if (p in t) return t[p]; return noop; }, set(t, p, v) { t[p] = v; return true; } });
  };
  const canvasProto = new QNode('canvas');
  canvasProto.width = 800; canvasProto.height = 170;
  canvasProto.getContext = () => makeCtx();
  createCtxRef.fn = makeCtx;

  const fetchLog = [];
  let fetchResponder = () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '', clone() { return this; }, blob: async () => ({ size: 1024 }), type: 'basic' });
  if (fetchImpl) fetchResponder = fetchImpl;

  const sourceRefs = {};
  const mapSources = new Map();
  const mapLayers = new Map();
  // Opciones del constructor de maplibregl.Map (incluye los estilos con sus fuentes y capas):
  // se guardan para poder inspeccionar las plantillas de teselas desde las pruebas.
  const mapCtorOpts = {};
  const mapStub = {
    _sources: mapSources, _layers: mapLayers, _setData: [], _ctor: mapCtorOpts,
    addControl() { return this; }, removeControl() { return this; },
    on(ev, cb) { if (ev === 'load') setTimeout(cb, 0); return this; },
    once(ev, cb) { if (ev === 'load') setTimeout(cb, 0); return this; },
    getSource(id) {
      if (!mapSources.has(id)) mapSources.set(id, { setData: d => mapStub._setData.push([id, d]) });
      return mapSources.get(id);
    },
    addSource(id, cfg) { mapSources.set(id, { ...cfg, setData: d => mapStub._setData.push([id, d]) }); },
    getLayer(id) { return mapLayers.get(id); },
    addLayer(l) { mapLayers.set(l.id, l); return this; },
    addImage() {}, hasImage() { return false; },
    setLayoutProperty(id, k, v) { const l = mapLayers.get(id); if (l) (l.layout = l.layout || {})[k] = v; },
    setPaintProperty(id, k, v) { const l = mapLayers.get(id); if (l) (l.paint = l.paint || {})[k] = v; },
    setTerrain() {}, setSky() {}, jumpTo() {}, fitBounds() { return this; },
    // Espías: se cuentan las llamadas y se guardan los destinos para poder comprobarlos
    easeTo(o) { this._easeTo = (this._easeTo || []).concat([o]); },
    getCenter: () => mapStub._centro || { lat: 37.075, lng: -3.38 }, getZoom: () => 13, getBearing: () => 0, getPitch: () => 60,
    getBounds: () => ({ getWest: () => -3.45, getEast: () => -3.30, getSouth: () => 37.0, getNorth: () => 37.15 }),
    getCanvasContainer: () => canvasProto, getCanvas: () => canvasProto, getContainer: () => canvasProto, unproject: () => ({ lng: -3.38, lat: 37.07 }),
    resize() { this._resize = (this._resize || 0) + 1; },
    dragPan: { enable() {}, disable() {} }, queryRenderedFeatures: () => []
  };

  const maplibregl = {
    Map: function (opts) {
      Object.assign(mapCtorOpts, opts || {});
      const style = (opts && opts.style) || {};
      for (const id in (style.sources || {})) mapSources.set(id, { ...style.sources[id], setData: d => mapStub._setData.push([id, d]) });
      for (const l of (style.layers || [])) mapLayers.set(l.id, { ...l });
      return mapStub;
    },
    Marker: class { constructor(o) { this.o = o; } setLngLat() { return this; } addTo() { return this; } remove() { return this; } on() { return this; } getLngLat() { return { lng: 0, lat: 0 }; } },
    Popup: class { constructor() {} setLngLat() { return this; } setHTML() { return this; } addTo() { return this; } remove() {} },
    LngLat: class { constructor(lng, lat) { this.lng = lng; this.lat = lat; } },
    LngLatBounds: class { constructor() { this._p = []; } extend(p) { this._p.push(p); return this; } getCenter() { return new maplibregl.LngLat(0, 0); } },
    NavigationControl: class { }, FullscreenControl: class { }, ScaleControl: class { },
    setRTLTextPlugin: () => {}
  };

  const windowStub = {
    innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
    addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
    location: { protocol: 'https:', hostname: 'visor-pendientes-3d.vercel.app', search: '', href: 'https://visor-pendientes-3d.vercel.app/' },
    navigator: { onLine: true, serviceWorker: null, canShare: null, share: null, storage: { estimate: async () => ({ usage: 0, quota: 0 }), persist: async () => true } },
    Capacitor: undefined,
    requestAnimationFrame: cb => setTimeout(() => cb(Date.now()), 0),
    cancelAnimationFrame: id => clearTimeout(id),
    setTimeout, clearTimeout, setInterval, clearInterval,
    performance: { now: () => 0 },
    console,
    URL, URLSearchParams, TextEncoder, TextDecoder, Blob: class { constructor(p) { this.parts = p; this.size = 1; } text() { return Promise.resolve(''); } },
    File: class { constructor(p, n, o) { this.parts = p; this.name = n; this.type = (o && o.type) || ''; this.size = 1; } text() { return Promise.resolve(String(this.parts[0] || '')); } },
    Image: class {
      constructor() { this.crossOrigin = ''; this._src = ''; }
      set src(v) {
        this._src = v;
        if (imageMode === 'offline') { setTimeout(() => this.onerror && this.onerror(new Error('sin red')), 0); return; }
        setTimeout(() => this.onload && this.onload(), 0);
      }
      get src() { return this._src; }
    },
    MutationObserver: class { observe() {} disconnect() {} },
    localStorage, caches, indexedDB,
    document: {
      documentElement: { classList: new QNode('html').classList, style: makeStyle() },
      body: new QNode('body'),
      getElementById: id => byId.get(id) || null,
      querySelector: s => doc.querySelector(s),
      querySelectorAll: s => doc.querySelectorAll(s),
      createElement: tag => new QNode(tag),
      addEventListener() {}, removeEventListener() {},
      hidden: false, visibilityState: 'visible'
    }
  };
  windowStub.self = windowStub;
  windowStub.window = windowStub;
  windowStub.addEventListener = () => {};
  windowStub.navigator = windowStub.navigator;
  windowStub.fetch = (url, opt) => {
    fetchLog.push(String(url));
    const s = String(url);
    if (s.includes('terrarium')) return Promise.reject(new Error('sin red (harness)'));
    return Promise.resolve(fetchResponder(s, opt));
  };
  windowStub.DOMParser = DOMParserStub;

  const sandbox = {
    window: windowStub, self: windowStub, document: windowStub.document, navigator: windowStub.navigator,
    location: windowStub.location, localStorage, caches, indexedDB, fetch: windowStub.fetch,
    DOMParser: DOMParserStub, maplibregl, console, performance: windowStub.performance,
    requestAnimationFrame: windowStub.requestAnimationFrame, cancelAnimationFrame: windowStub.cancelAnimationFrame,
    setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams, Blob: windowStub.Blob, File: windowStub.File,
    Image: windowStub.Image, MutationObserver: windowStub.MutationObserver, Math, JSON, Date, Promise, Object, Array, String, Number,
    isFinite, isNaN, parseFloat, parseInt, encodeURIComponent, decodeURIComponent, navigator_: undefined,
    Uint8ClampedArray, Uint8Array, Int32Array, Float64Array, Map, Set, WeakMap, Error, TypeError, RangeError,
    getComputedStyle: () => ({ display: 'block' })
  };
  sandbox.globalThis = sandbox;
  sandbox.window.navigator = windowStub.navigator;
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  // Puente de Android (MainActivity expone window.AndroidGpx en la app nativa)
  if (AndroidGpx !== undefined) { sandbox.AndroidGpx = AndroidGpx; windowStub.AndroidGpx = AndroidGpx; }

  const ctx = vm.createContext(sandbox);

  // Instrumentación: al final del script se exponen las funciones y el estado
  // (el script no se modifica en disco, solo el texto que se evalúa).
  const exportsBlock = `
;globalThis.__api = { S, D, PLAY, PREF, OFF, prefs, BINS, parseGPX, buildGPX, haversine, autoLength, smooth,
  buildSegments, analyze, computeTimeData, render, clearTrack, arrowFeatures, bearingBetween, densify,
  terrainElevations, tileXY, tileUrls, offlineUrlsFor, fmtMB, fmtGrade, fmtInt, fmtTime, avgOf, textOn,
  gradeColor, loadTrack, openFile, fitRoute, updateLabels, clearLabels, saveOffline, deleteOffline,
  updateOfflineButton, map, idxAt, segAt, applyBasemap, applyWmsOverlays, applyProfilePrefs, loadTile, tileCache, gpxFile,
  queryWms, catastroHtml, queryPoint, loadGpxText, cargarGpxNativo, indiceMasCercano, initToqueTrack,
  leerVersionPublicada, buscarActualizacion, mostrarVersion, huecosMapa, encuadrarRuta };
for (const n of ['WMSOV','MAP_NAMES','offlineBreakdown','offlineTileKind','OFFLINE_VT','OFM_MAXZOOM','TILE_CACHE_MAX','tileCacheSize','tileCacheKeys','stopPrefetch','repetirEncuadreSiToca','revisarEncuadrePendiente']) {
  try { globalThis.__api[n] = eval(n); } catch (e) { globalThis.__api[n] = undefined; }
}
// Permite a las pruebas simular que el service worker tiene una versión esperando a activarse
globalThis.__api.fijarRegistroSW = reg => { swReg = reg; };
globalThis.__ready = true;
`;

  let ok = true, error = null;
  try {
    vm.runInContext(src + exportsBlock, ctx, { filename: 'index.html<script>', timeout: 30000 });
  } catch (e) { ok = false; error = e; }

  return {
    ok, error, ctx, sandbox, html, src, doc, byId, mapStub, localStorage, caches, indexedDB, fetchLog,
    setFetch(fn) { fetchResponder = fn; },
    api: () => {
      if (!ok) throw new Error('no se pudo cargar index.html: ' + (error && error.message));
      return sandbox.__api;
    },
    // Campos controlables desde las pruebas
    el: id => byId.get(id),
    setSeglen(v) { byId.get('seglen').value = v; },
    setMode(m) { sandbox.__api.S.mode = m; }
  };
}

/* ---------------- Carga de sw.js ---------------- */

export function loadSW({ fetchImpl, fuente } = {}) {
  const source = fuente || fs.readFileSync(path.join(REPO, 'sw.js'), 'utf8');
  const listeners = {};
  const deleted = [];
  const caches = makeCacheStorage();
  const self = {
    addEventListener: (t, cb) => { (listeners[t] = listeners[t] || []).push(cb); },
    skipWaiting: async () => { self._skipped = true; },
    clients: { claim: async () => { self._claimed = true; } },
    location: { origin: 'https://visor-pendientes-3d.vercel.app' }
  };
  const logger = { log: [], warn: [], error: [] };
  const sandbox = {
    self, caches: {
      ...caches,
      open: async n => caches.open(n),
      keys: async () => caches.keys(),
      delete: async n => { deleted.push(n); return caches.delete(n); },
      match: async r => caches.match(r)
    },
    URL, Request: class { constructor(u) { this.url = String(u); this.method = 'GET'; this.mode = 'no-cors'; } },
    Response: class { constructor(b, i) { this._b = b; Object.assign(this, i || {}); this.ok = (i && i.status ? i.status : 200) < 400; this.status = (i && i.status) || 200; } clone() { return this; } },
    fetch: fetchImpl || (async () => new sandbox.Response('', { status: 200 })),
    console: { log: (...a) => logger.log.push(a.join(' ')), warn: (...a) => logger.warn.push(a.join(' ')), error: (...a) => logger.error.push(a.join(' ')) },
    setTimeout, clearTimeout, Promise, Object, Array, String, Number, Math, JSON, RegExp, Date,
    isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(source + '\n;globalThis.__swExports = { VERSION, APP_CACHE, TILE_CACHE, FONT_CACHE, OFFLINE_CACHE, MAX_TILES, APP_FILES, isTile, isFont, trimTiles };', ctx, { filename: 'sw.js', timeout: 10000 });
  const fire = async (type, event) => {
    const ev = { ...event, waitUntil: p => { ev._p = Promise.resolve(p); return p; }, respondWith: p => { ev._response = p; return p; } };
    for (const cb of listeners[type] || []) cb(ev);
    if (ev._p) await ev._p;
    if (ev._response) ev._response = await ev._response;
    return ev;
  };
  return { listeners, fire, caches, deleted, self, logger, exports: sandbox.__swExports, source };
}
