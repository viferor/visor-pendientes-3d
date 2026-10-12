// Pruebas de la integración con Android: apertura de un .gpx enviado desde otra aplicación.
// Se ejecutan con: npm test
import { test, eq, near, assert, slice, fs, path, REPO, loadApp, loadSW } from '../comun.mjs';
import { rutaSintetica } from '../comun.mjs';

const GPX_PRUEBA = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Recibido de Android</name>
<trkpt lat="37.000" lon="-3.000"><ele>100</ele></trkpt>
<trkpt lat="37.010" lon="-3.000"><ele>200</ele></trkpt>
</trk></gpx>`;

// El arranque de la app carga el track de ejemplo (o el último guardado) de forma asíncrona.
// En la app real el archivo llega con la app ya arrancada, así que las pruebas esperan primero a que
// el estado se ESTABILICE (el mismo nombre durante un rato), no a un tiempo fijo: si no, se
// mezclarían las dos cargas y la prueba sería inestable.
const esperarArranque = async (a2, limite = 6000) => {
  const t0 = Date.now();
  let ultimo = null, desde = Date.now();
  while (Date.now() - t0 < limite) {
    const actual = a2.S.name;
    if (actual && actual !== ultimo) { ultimo = actual; desde = Date.now(); }
    else if (actual && Date.now() - desde > 400) return actual;
    await new Promise(r => setTimeout(r, 100));
  }
  return a2.S.name;
};

await test('O1', 'La web recoge el .gpx que le pasa Android y lo carga', async () => {
  // Se espera a que termine el arranque (que carga el ejemplo o tu último track) y solo entonces
  // se simula la llegada del archivo, que es lo que pasa cuando Android lo lee y llama a la app.
  const app2 = loadApp({ AndroidGpx: { pendiente: () => null } });
  const a2 = app2.api();
  await esperarArranque(a2);
  const nombreAntes = a2.S.name;
  let consultas = 0;
  app2.sandbox.AndroidGpx.pendiente = () => { consultas++; return GPX_PRUEBA; };
  a2.cargarGpxNativo();
  const t0 = Date.now();
  while (a2.S.name !== 'Recibido de Android' && Date.now() - t0 < 5000) await new Promise(r => setTimeout(r, 50));
  eq(a2.S.name, 'Recibido de Android', 'nombre del track recibido');
  eq(a2.S.pts.length, 2, 'puntos cargados');
  assert(a2.S.segs.length > 0, 'el recorrido recibido debe quedar analizado');
  assert(consultas >= 1, 'debería haber consultado el puente');
  return { detail: `estando cargado «${nombreAntes}», llegó el archivo y quedó «${a2.S.name}» (${a2.S.pts.length} puntos, ${consultas} consultas al puente)` };
});

await test('O1b', 'El .gpx que llega mientras la app aún arranca no lo pisa el track de ejemplo', async () => {
  // Esta es la carrera real: Android entrega el archivo en cuanto abre la app, mientras todavía se
  // está cargando el ejemplo o el último track guardado. El archivo debe ganar siempre.
  const inicio = Date.now();
  let consultas = 0;
  const app2 = loadApp({ AndroidGpx: { pendiente: () => { consultas++; return Date.now() - inicio > 300 ? GPX_PRUEBA : null; } } });
  const a2 = app2.api();
  const t0 = Date.now();
  while (a2.S.name !== 'Recibido de Android' && Date.now() - t0 < 10000) await new Promise(r => setTimeout(r, 100));
  eq(a2.S.name, 'Recibido de Android', 'el archivo recibido debe ganar al track de ejemplo');
  eq(a2.S.pts.length, 2, 'puntos del archivo recibido');
  assert(consultas >= 2, 'el sondeo del arranque debería haber preguntado varias veces: ' + consultas);
  return { detail: `el archivo llegó en el arranque y ganó: «${a2.S.name}» con ${a2.S.pts.length} puntos (${consultas} consultas)` };
});

await test('O2', 'Si el archivo recibido no es un GPX válido, se avisa y el aviso no se pierde', async () => {
  const app2 = loadApp({ AndroidGpx: { pendiente: () => 'esto no es un gpx' } });
  const a2 = app2.api();
  // El aviso debe aparecer Y seguir ahí cuando termina el análisis del track de fondo: antes lo
  // pisaba el mensaje del análisis, así que el usuario podía no llegar a leerlo.
  let aviso = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 4000) {
    const st = app2.el('status').textContent;
    if (/no se pudo abrir/i.test(st)) { aviso = st; break; }
    await new Promise(r => setTimeout(r, 50));
  }
  assert(aviso !== null, 'debería avisar de que el archivo recibido no se pudo abrir');
  await new Promise(r => setTimeout(r, 2500));   // tiempo de sobra para que acabe el análisis
  const despues = app2.el('status').textContent;
  assert(/no se pudo abrir/i.test(despues), 'el aviso no debe borrarse cuando termina el análisis: ' + JSON.stringify(despues));
  await esperarArranque(a2);
  assert(a2.S.pts && a2.S.pts.length > 1, 'la app debe seguir utilizable con un recorrido cargado');
  assert(a2.S.segs && a2.S.segs.length > 0, 'el recorrido debe estar analizado (perfil y pendientes)');
  return { detail: 'aviso: ' + aviso + ' · sigue visible tras el análisis · app con «' + a2.S.name + '» (' + a2.S.pts.length + ' puntos)' };
});

await test('O3', 'Sin puente nativo (navegador, PWA) no pasa nada', () => {
  const app2 = loadApp();
  const a2 = app2.api();
  let excepcion = null;
  try { a2.cargarGpxNativo(); } catch (e) { excepcion = e.message; }
  assert(excepcion === null, 'no debería lanzar nada: ' + excepcion);
  return { detail: 'en navegador la función sale sin hacer nada (el puente window.AndroidGpx no existe)' };
});

await test('O4', 'El manifiesto de Android declara la apertura de .gpx y el puente existe en el código', () => {
  const manifest = fs.readFileSync(path.join(REPO, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  assert(/android\.intent\.action\.VIEW/.test(manifest), 'falta el filtro ACTION_VIEW');
  assert(/android\.intent\.action\.SEND/.test(manifest), 'falta el filtro ACTION_SEND');
  assert(/pathPattern="\.\*\\\\\.gpx"/.test(manifest), 'falta el filtro por extensión .gpx');
  assert(/application\/gpx\+xml/.test(manifest), 'falta el tipo MIME de GPX');
  // «Abrir con» no ofrecía la app porque los exploradores no declaran bien el tipo del archivo:
  // hay que aceptar octet-stream (lo que mandan Archivos y Gmail) y, para los proveedores que
  // mandan un tipo genérico, cualquier MIME. La comprobación real la hace MainActivity.
  assert((manifest.match(/application\/octet-stream/g) || []).length >= 2, 'ACTION_VIEW debería aceptar también application/octet-stream');
  assert(/android:mimeType="\*\/\*"/.test(manifest), 'falta el filtro amplio para el «Abrir con» de los proveedores que no declaran el tipo');
  assert(/android:launchMode="singleTask"/.test(manifest), 'se necesita singleTask para recibir el archivo con la app ya abierta');
  const java = fs.readFileSync(path.join(REPO, 'android/app/src/main/java/com/viferor/pendientes3d/MainActivity.java'), 'utf8');
  assert(/addJavascriptInterface\(new PuenteGpx\(\), PUENTE\)/.test(java), 'MainActivity no expone el puente a la web');
  assert(/onNewIntent/.test(java) && /leerIntent/.test(java), 'MainActivity no atiende los intents (arranque y app ya abierta)');
  assert(/endsWith\("\.gpx"\)/.test(java), 'MainActivity no comprueba que el archivo sea un .gpx');
  assert(/nombreDe\(/.test(java), 'debería leer el nombre real del archivo (OpenableColumns) y no solo la ruta');
  assert(/leerCabeza\(/.test(java), 'debería mirar solo los primeros bytes antes de leer el archivo entero');
  const web = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  assert(/window\.AndroidGpx/.test(web), 'la web no consulta el puente de Android');
  assert(/cargarGpxNativo\(\);/.test(web), 'la web no llama a la carga de GPX nativo al arrancar');
  return { detail: 'manifiesto (VIEW con octet-stream y comodín, SEND y extensión .gpx), MainActivity (puente, onNewIntent, nombre real y cabecera) y web (consulta al arrancar)' };
});

/* ---------------- P: áreas seguras (edge-to-edge de Android 15) ----------------
   El plugin SystemBars viene DENTRO del núcleo de Capacitor 8 y está activado por defecto:
   escucha los insets del sistema e inyecta --safe-area-inset-* en el documento (insetsHandling
   «css»). Por eso la app se aparta de las barras sin ningún plugin externo ni APK nueva; lo que
   NO puede faltar es el viewport-fit=cover ni el uso de esas variables. Estas pruebas lo vigilan. */

await test('P1', 'La app está preparada para las áreas seguras del sistema (edge-to-edge)', () => {
  const web = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  assert(/name="viewport"[^>]*viewport-fit=cover/.test(web), 'falta viewport-fit=cover: sin él Capacitor pone padding nativo y no inyecta las variables');
  const cfg = JSON.parse(fs.readFileSync(path.join(REPO, 'capacitor.config.json'), 'utf8'));
  eq(cfg.plugins?.SystemBars?.insetsHandling, 'css', 'insetsHandling debe ser «css» para que se inyecten --safe-area-inset-*');
  const usos = (web.match(/--safe-area-inset-(top|right|bottom|left)/g) || []);
  assert(new Set(usos).size >= 3, 'la interfaz debería usar las variables de área segura en varios bordes: ' + JSON.stringify([...new Set(usos)]));
  for (const borde of ['top', 'bottom']) {
    assert(usos.some(u => u.endsWith(borde)), 'no se usa el área segura de «' + borde + '»');
  }
  return { detail: `viewport-fit=cover, insetsHandling=${cfg.plugins.SystemBars.insetsHandling}, ${usos.length} usos de las variables (${[...new Set(usos)].join(', ')})` };
});

await test('P2', 'Los colores de las barras del sistema casan con el fondo de la app', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(REPO, 'capacitor.config.json'), 'utf8'));
  const web = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  const fondoWeb = /--panel-solid:\s*(#[0-9a-fA-F]{6})/.exec(web);
  assert(fondoWeb, 'no se encuentra el color de fondo en el CSS');
  eq(cfg.android?.backgroundColor?.toLowerCase(), fondoWeb[1].toLowerCase(), 'el fondo de la app Android debería ser el mismo que el de la web');
  assert(/SystemBars'\)[^)]*setStyle/.test(web) || /plugin\('SystemBars'\)/.test(web), 'la app ajusta el estilo de las barras (iconos claros sobre fondo oscuro)');
  return { detail: `fondo ${cfg.android.backgroundColor} en ambos lados y estilo de barras ajustado desde la app` };
});

/* ---------------- Q: interfaz (atribuciones, panel plegado, toque en el track, versión) ---------------- */

await test('Q1', 'Las atribuciones salen cerradas por defecto y abajo a la izquierda', () => {
  const web = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  assert(/attributionControl:\s*\{\s*compact:\s*true\s*\}/.test(web), 'el control de atribuciones debería ser compacto (el botón ⓘ, cerrado)');
  assert(/function colocarAtribuciones\(/.test(web), 'falta la función que recoloca las atribuciones');
  assert(/maplibregl-ctrl-bottom-left/.test(web), 'debería colocarlas en el contenedor de abajo a la izquierda');
  assert(/classList\.remove\('maplibregl-compact-show'\)/.test(web), 'deberían empezar cerradas (sin la clase de desplegado)');
  assert(/#map \.maplibregl-ctrl-attrib\.maplibregl-compact\{[^}]*left:8px/.test(web), 'el CSS debería anclarlas a la izquierda');
  assert(/#map \.maplibregl-ctrl-attrib\.maplibregl-compact\{[^}]*bottom:8px/.test(web), 'el CSS debería ponerlas al pie');
  return { detail: 'attributionControl compacto, recolocadas a bottom-left y el CSS las ancla abajo a la izquierda' };
});

await test('Q2', 'El panel plegado se queda solo con el botón «+»', () => {
  const web = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  assert(/#panel\.plegado h1\{display:none\}/.test(web), 'plegado, el título del panel debería ocultarse');
  assert(/#panel\.plegado\{[^}]*width:auto/.test(web), 'plegado, el panel debería encogerse');
  assert(/#panel\.plegado\{[^}]*background:none/.test(web), 'plegado, el recuadro del panel debería desaparecer (solo el botón)');
  const app2 = loadApp();
  const panel = app2.el('panel'), cuerpo = app2.el('body'), btn = app2.el('collapse');
  const abrirCerrar = () => {
    const open = cuerpo.hidden;
    cuerpo.hidden = !open;
    panel.classList.toggle('plegado', !open);
    btn.textContent = open ? '–' : '+';
    btn.setAttribute('aria-expanded', open);
  };
  abrirCerrar();
  assert(panel.classList.contains('plegado'), 'el panel debería quedar marcado como plegado');
  assert(cuerpo.hidden, 'el cuerpo del panel debería ocultarse');
  eq(btn.textContent, '+', 'plegado, el botón debe mostrar «+»');
  abrirCerrar();
  assert(!panel.classList.contains('plegado'), 'al desplegar debería quitarse la marca');
  eq(btn.textContent, '–', 'desplegado, el botón vuelve a «–»');
  return { detail: 'la clase «plegado» oculta el título y encoge el panel; el botón alterna + y –' };
});

await test('Q3', 'Tocar el track señala el punto correspondiente en el perfil', async () => {
  const app2 = loadApp();
  const a2 = app2.api();
  await a2.loadTrack('Toque', rutaSintetica(120), false);
  a2.initToqueTrack();
  const pts = a2.S.pts, objetivo = 60;
  eq(a2.indiceMasCercano({ lng: pts[objetivo].lon, lat: pts[objetivo].lat }), objetivo, 'el punto más cercano debería ser el consultado');
  eq(a2.indiceMasCercano({ lng: pts[objetivo].lon + 0.5, lat: pts[objetivo].lat }), null, 'un toque lejos de la ruta no debe marcar nada');
  return { detail: `índice más cercano correcto (${objetivo}) y un toque a 50 km no marca nada; el toque real queda enganchado al lienzo del mapa` };
});

await test('Q4', 'Ajustes muestra la versión y permite buscar actualización', () => {
  const web = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  assert(/id="versionTxt"/.test(web), 'falta el texto de la versión en Ajustes');
  assert(/id="buscarAct"/.test(web), 'falta el botón de buscar actualización');
  assert(/function leerVersionPublicada\(/.test(web), 'falta leer la versión publicada del sw.js');
  assert(/visibilitychange/.test(web), 'debería buscar actualizaciones al volver a primer plano');
  assert(/\$\('buscarAct'\)\.addEventListener\('click'/.test(web), 'el botón debería disparar la búsqueda manual');
  const v = /const VERSION = '(v\d+)'/.exec(fs.readFileSync(path.join(REPO, 'sw.js'), 'utf8'));
  assert(v, 'no se pudo leer la versión de sw.js');
  return { detail: `leída la versión ${v[1]} del sw.js; en Ajustes hay versión y botón, y se busca sola al arrancar y al volver a la app` };
});

/* ---------------- R: encuadre de la ruta (el móvil se quedaba mirando a otro sitio) ---------------- */

await test('R-encuadre', 'Al cargar una ruta se pide encuadrarla y queda registrado', async () => {
  const app2 = loadApp();
  const a2 = app2.api();
  // Se espera a que el arranque de la app termine (carga el ejemplo y lo encuadra): si no, esa carga
  // escribiría su propio encuadre encima del que queremos comprobar.
  const t0 = Date.now();
  let ultimo = null, desde = Date.now();
  while (Date.now() - t0 < 6000) {
    const actual = a2.S.name;
    if (actual && actual !== ultimo) { ultimo = actual; desde = Date.now(); }
    else if (actual && Date.now() - desde > 400) break;
    await new Promise(r => setTimeout(r, 100));
  }
  a2.S.ultimoEncuadre = null;
  app2.mapStub._easeTo = [];
  const lejana = [{ lat: 40.0, lon: -4.0, ele: 600, t: NaN }, { lat: 40.01, lon: -4.0, ele: 620, t: NaN }];
  await a2.loadTrack('Lejana', lejana, false);
  await new Promise(r => setTimeout(r, 300));
  const llamadas = app2.mapStub._easeTo || [];
  assert(llamadas.length >= 1, 'debería haberse pedido encuadrar la ruta al cargarla (easeTo)');
  eq(llamadas[0].duration, 1600, 'el encuadre inicial debería ir animado: ' + llamadas[0].duration);
  near(llamadas[0].center[0], -4, 0.001, 'centro en longitud que se pide al mapa');
  near(llamadas[0].center[1], 40.005, 0.001, 'centro en latitud que se pide al mapa');
  assert(llamadas[0].zoom > 3 && llamadas[0].zoom <= 16, 'zoom fuera de rango: ' + llamadas[0].zoom);
  const u = a2.S.ultimoEncuadre;
  assert(u && u.puntos === 2, 'debería quedar registrado el encuadre de ESTA ruta: ' + JSON.stringify(u));
  return { detail: `easeTo animado 1600 ms al centro ${llamadas[0].center.join(', ')} con zoom ${u.zoom}` };
});

await test('R-encuadre-2', 'Si el encuadre se queda a medias, se repite sin animación', async () => {
  const app2 = loadApp();
  const a2 = app2.api();
  // Se espera al arranque, como en la prueba anterior
  const t0 = Date.now();
  let ultimo = null, desde = Date.now();
  while (Date.now() - t0 < 6000) {
    const actual = a2.S.name;
    if (actual && actual !== ultimo) { ultimo = actual; desde = Date.now(); }
    else if (actual && Date.now() - desde > 400) break;
    await new Promise(r => setTimeout(r, 100));
  }
  const lejana = [{ lat: 40.0, lon: -4.0, ele: 600, t: NaN }, { lat: 40.01, lon: -4.0, ele: 620, t: NaN }];
  await a2.loadTrack('Lejana', lejana, false);
  await new Promise(r => setTimeout(r, 300));
  app2.mapStub._easeTo = [];
  // 1) El usuario toca el mapa con el encuadre aún pendiente → se repite sin animación
  a2.repetirEncuadreSiToca();
  const llamadas = app2.mapStub._easeTo || [];
  assert(llamadas.length === 1, 'debería repetirse el encuadre al tocar el mapa: ' + llamadas.length);
  eq(llamadas[0].duration, 0, 'la repetición debe ser sin animación (para que no se corte otra vez)');
  // 2) Si la vista no se parece a lo pedido (la animación se cortó) → también se repite
  a2.fitRoute(true);
  app2.mapStub._easeTo = [];
  app2.mapStub.getBounds = () => ({ getWest: () => -70, getEast: () => -60, getSouth: () => 10, getNorth: () => 20 });
  a2.revisarEncuadrePendiente();
  assert((app2.mapStub._easeTo || []).length === 1, 'si la vista quedó lejos de la ruta, debería reencuadrarse al terminar el movimiento');
  return { detail: 'repite el encuadre al tocar el mapa y al ver que la vista quedó en otro sitio, las dos veces sin animación' };
});

await test('R-encuadre-3', 'El botón «i» del panel muestra las medidas al pulsarlo de verdad', async () => {
  const app2 = loadApp();
  const a2 = app2.api();
  await a2.loadTrack('Medir', rutaSintetica(40), false);
  const boton = app2.el('infoEncuadre2');
  assert(boton, 'debería existir el botón «i» en el panel');
  const manejadores = boton.click();   // se ejecutan los manejadores reales de «click»
  assert(manejadores >= 1, 'el botón «i» no tiene ningún manejador de click enganchado');
  const salida = app2.el('actEstado');
  assert(!salida.hidden, 'debería mostrarse el panel de medidas');
  const texto = (salida.children || []).map(c => c.textContent).join(' | ');
  assert(/Ventana/.test(texto), 'debería decir el tamaño de la ventana: ' + texto);
  assert(/Cámara: centro/.test(texto), 'debería decir dónde está la cámara: ' + texto);
  assert(/Último encuadre|ninguno/.test(texto), 'debería decir el último encuadre: ' + texto);
  return { detail: texto.slice(0, 160) };
});

await test('Q5', 'Si hay versión nueva se avisa y se ofrece recargar (sin recargar sola)', async () => {
  const app2 = loadApp();
  const a2 = app2.api();
  const sw = loadSW();
  const fuente = sw.source.replace(/const VERSION = 'v\d+'/, "const VERSION = 'v99'");
  app2.setFetch(u => {
    const esSw = String(u).includes('sw.js');
    return { ok: true, status: 200, url: String(u), text: async () => (esSw ? fuente : ''), clone() { return this; }, blob: async () => ({ size: 1 }), json: async () => ({}), type: 'basic' };
  });
  eq(await a2.leerVersionPublicada(), 'v99', 'debería leer la versión publicada');
  a2.fijarRegistroSW({ waiting: { postMessage() {} }, update: async () => {} });
  const hay = await a2.buscarActualizacion(false);
  assert(hay === true, 'debería detectar que hay actualización');
  const aviso = app2.el('actEstado');
  assert(!aviso.hidden, 'debería mostrarse el aviso de versión nueva');
  const boton = (aviso.children || []).find(c => c.tagName === 'button');
  assert(boton && /recargar/i.test(boton.textContent), 'el aviso debería ofrecer un botón para recargar');
  return { detail: 'versión publicada v99 detectada; aviso visible con el botón «' + (boton ? boton.textContent : '') + '»' };
});
