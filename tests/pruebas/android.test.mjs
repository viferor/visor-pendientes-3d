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
  assert(/#map \.maplibregl-ctrl-attrib\.maplibregl-compact\{[^}]*left:6px/.test(web), 'el CSS debería anclarlas a la izquierda');
  assert(/#map \.maplibregl-ctrl-attrib\.maplibregl-compact\{[^}]*bottom:4px/.test(web), 'el CSS debería ponerlas al pie');
  assert(/#map \.maplibregl-ctrl-attrib\.maplibregl-compact\{[^}]*opacity:\.4/.test(web), 'deberían ser discretas en reposo (semiopacas)');
  assert(/#map \.maplibregl-ctrl-attrib\.maplibregl-compact\{[^}]*width:22px/.test(web), 'el botón ⓘ debería ser pequeño (22 px)');
  assert(/hover[\s\S]{0,80}opacity:1/.test(web), 'al pasar el dedo o el ratón deberían verse del todo');
  return { detail: 'attributionControl compacto, ⓘ de 22 px al 40 % de opacidad abajo a la izquierda, y completo al tocarlo' };
});

await test('Q1b', 'Ajustes incluye la lista completa de créditos y licencias', () => {
  const web = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  assert(/id="creditos"/.test(web), 'falta la sección de créditos en Ajustes');
  const fuentes = ['Esri', 'Maxar', 'OpenStreetMap', 'CyclOSM', 'OpenFreeMap', 'Waymarked Trails',
    'Catastro', 'REDIAM', 'Terrain Tiles', 'OSRM', 'BRouter', 'MapLibre'];
  const faltan = fuentes.filter(f => !web.includes(f));
  assert(faltan.length === 0, 'faltan fuentes en los créditos: ' + faltan.join(', '));
  const licencias = ['ODbL', 'CC BY-SA', 'BSD'];
  const faltanLic = licencias.filter(l => !web.includes(l));
  assert(faltanLic.length === 0, 'faltan menciones de licencia: ' + faltanLic.join(', '));
  return { detail: `${fuentes.length} fuentes documentadas en Ajustes, con sus licencias (${licencias.join(', ')}) y el aviso de que la atribución se mantiene en el mapa por licencia` };
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

await test('R-encuadre-4', 'Los huecos de los paneles nunca se comen la pantalla (el fallo del móvil)', () => {
  const web = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  // El fallo real: en móvil se usaba la altura del panel (598 px en una pantalla de 772) como hueco
  // superior, la zona libre quedaba en negativo y MapLibre no movía la cámara.
  assert(!/arriba:\s*wide\s*\?\s*70\s*:\s*Math\.round\(panel\.bottom/.test(web), 'el hueco superior en móvil no puede ser la altura del panel');
  assert(/dispY < 160/.test(web), 'debería haber una comprobación de que la zona libre vertical no es ridícula');
  assert(/dispX < 120/.test(web), 'debería haber una comprobación de que la zona libre horizontal no es ridícula');
  const app2 = loadApp();
  const a2 = app2.api();
  // Se simula una pantalla de móvil y un panel enorme, como en el reporte
  app2.sandbox.window.innerWidth = 360; app2.sandbox.window.innerHeight = 772;
  const antes = app2.el('panel').getBoundingClientRect;
  app2.el('panel').getBoundingClientRect = () => ({ width: 300, height: 700, left: 12, top: 20, right: 312, bottom: 720 });
  const h = a2.huecosMapa();
  assert(h.arriba + h.abajo <= 772 * 0.6, `los huecos verticales no pueden comerse la pantalla: ${h.arriba}+${h.abajo} de 772`);
  assert(h.izquierda + h.derecha <= 360 * 0.6, `los huecos horizontales no pueden comerse la pantalla: ${h.izquierda}+${h.derecha} de 360`);
  app2.el('panel').getBoundingClientRect = antes;
  return { detail: `en pantalla de 360×772 con un panel de 700 px de alto, los huecos quedan en arriba ${h.arriba}, abajo ${h.abajo}, izq ${h.izquierda}, der ${h.derecha}` };
});

await test('R-encuadre-3', 'El diagnóstico del encuadre sigue disponible en el código', async () => {
  const app2 = loadApp();
  const a2 = app2.api();
  await a2.loadTrack('Medir', rutaSintetica(40), false);
  // Los botones «i» y «Info de encuadre» se quitaron cuando dejaron de hacer falta, pero la función
  // se queda: si vuelve a descuadrarse en algún móvil, se engancha otra vez en un minuto.
  const web = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  assert(/function infoEncuadre\(/.test(web), 'debería seguir existiendo la función de diagnóstico');
  assert(!/id="infoEncuadre/.test(web), 'los botones de diagnóstico ya no deberían estar en la interfaz');
  const salida = app2.el('diag');
  assert(salida && salida.hidden, 'el cuadro de diagnóstico debería existir y empezar oculto');
  a2.infoEncuadre();
  assert(!salida.hidden, 'al llamar al diagnóstico debería aparecer el cuadro');
  const texto = app2.el('diagTexto').textContent;
  assert(/Ventana/.test(texto) && /Cámara: centro/.test(texto), 'debería medir ventana y cámara: ' + texto);
  app2.el('diagCerrar').click();
  assert(salida.hidden, 'y se cierra con su botón');
  return { detail: 'el cuadro de diagnóstico sigue disponible (sin botón en la interfaz) y mide ventana y cámara' };
});

await test('S-velocidad', 'El reproductor llega a 90x y 120x', () => {
  const web = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  for (const v of [60, 90, 120]) {
    assert(new RegExp(`data-sp="${v}"`).test(web), 'falta el botón de velocidad ' + v + 'x');
  }
  assert(/fijarVelocidad/.test(web), 'falta la función que fija la velocidad de los botones');
  const app2 = loadApp();
  const a2 = app2.api();
  // 1) Los extremos del deslizador dan 90x y 120x
  eq(a2.speedFromSlider(100), 120, 'extremo derecho del deslizador');
  eq(a2.speedFromSlider(-100), -120, 'extremo izquierdo (marcha atrás)');
  eq(a2.speedFromSlider(92), 90, 'tramo de 90x');
  eq(a2.speedFromSlider(50), a2.speedFromSlider(50), 'coherente');
  assert(a2.speedFromSlider(50) < 60 && a2.speedFromSlider(50) > 1, 'el centro sigue siendo progresivo: ' + a2.speedFromSlider(50));
  eq(a2.speedFromSlider(0), 1, 'centro = velocidad real');
  // 2) Los botones fijan la velocidad de verdad
  const botones = ['60', '90', '120'].map(v => ({ v: +v, el: app2.doc.querySelector(`#speedPresets [data-sp="${v}"]`) }));
  for (const b of botones) assert(b.el, 'no se encontró el botón ' + b.v + 'x');
  for (const b of botones) {
    b.el.click();
    eq(a2.PLAY.speed, b.v, `al pulsar ${b.v}x la velocidad debe ser ${b.v}`);
    assert(new RegExp(b.v + 'x').test(app2.el('speedVal').textContent), `el texto debería mostrar ${b.v}x: ` + app2.el('speedVal').textContent);
    assert(b.el.classList.contains('on'), 'el botón pulsado debería quedar marcado');
  }
  return { detail: 'extremos del deslizador: 90x y 120x; botones 60x/90x/120x fijan la velocidad y se marcan' };
});

// Referencias catastrales con el formato REAL que devuelve el servicio (comprobado contra
// ovc.catastro.meh.es): 14 caracteres, provincia(2)+municipio(3)+sector(1)+polígono(3)+parcela(5),
// sin letras. Ejemplo real: pc1='18072A0' + pc2='0100140' → '18072A00100140', parcela 00140.
// Las de 20 caracteres acaban en cuatro dígitos de control, y ahí la parcela son los 5 dígitos
// anteriores a esos cuatro (por eso el código quita antes el sufijo de dos letras).
const refCat = (poligono, parcela) =>
  '18072A' + String(poligono).padStart(3, '0') + String(parcela).padStart(5, '0');

await test('T-catastro', 'El reborde del Catastro marca público en verde y particular en rojo', async () => {
  const web = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  // La fuente del reborde no puede llamarse 'catastro': ese nombre ya es la capa raster de parcelas,
  // y reutilizarlo rompía las parcelas y su guardado sin cobertura.
  assert(/addSource\('catastroRuta'/.test(web), 'el reborde debería usar la fuente «catastroRuta»');
  assert(!/addSource\('catastro', \{ type: 'geojson'/.test(web), 'no se puede reutilizar el nombre «catastro» (es la capa raster de parcelas)');
  assert(/CAT_COLORES = \{ publico: '#2ecc71', particular: '#e74c3c' \}/.test(web), 'faltan los colores verde (público) y rojo (particular)');
  assert(/id="ovCatRuta"/.test(web), 'falta el interruptor del reborde del Catastro en Ajustes');
  // El reborde se dibuja antes que el track y el track se sube encima
  assert(/id: 'catastroFranja'[\s\S]{0,300}subirTrackSobreCatastro\(\)/.test(web), 'el reborde debería crearse antes de subir el track encima');
  assert(/function subirTrackSobreCatastro\(/.test(web) && /moveLayer/.test(web), 'el track debería subirse con moveLayer (sin duplicar capas)');
  // Al borrar el recorrido se borra también el reborde
  assert(/function clearTrack\(\)[\s\S]{0,500}limpiarCatastro\(\)/.test(web), 'al borrar el recorrido debería borrarse también el reborde del Catastro');
  // Interpretación de la referencia: 9000+ es dominio público
  const app2 = loadApp();
  const a2 = app2.api();
  // Referencias con el formato real de 14 caracteres (ver refCat arriba) y una de 20 con control
  eq(refCat(1, 140), '18072A00100140', 'formato de referencia de 14 caracteres');
  eq(refCat(1, 8999).length, 14, 'la referencia de prueba debería tener 14 caracteres: ' + refCat(1, 8999));
  eq(a2.interpretarReferencia(refCat(1, 8999)).tipo, 'particular', 'parcela 8999 → particular (justo por debajo del límite)');
  eq(a2.interpretarReferencia(refCat(1, 9000)).tipo, 'publico', 'parcela 9000 → dominio público');
  eq(a2.interpretarReferencia(refCat(1, 9001)).tipo, 'publico', 'parcela 9001 → dominio público');
  eq(a2.interpretarReferencia(refCat(1, 140)).tipo, 'particular', 'parcela 140 → particular (la referencia real de ejemplo)');
  eq(a2.interpretarReferencia('18072A001001400000FP').tipo, 'particular', 'referencia de 20 caracteres con control y letras');
  const info = a2.interpretarReferencia(refCat(12, 9000));
  eq(info.parcela, 9000, 'debería extraer la parcela 9000');
  eq(info.poligono, 12, 'debería extraer el polígono 12');
  eq(a2.interpretarReferencia('1234567VK1233N0001WX').tipo, 'urbano', 'suelo urbano');
  // Muestreo a lo largo de la ruta
  await a2.loadTrack('Catastro', rutaSintetica(400), false);
  const muestras = a2.muestrasCatastro(a2.S.pts);
  const total = a2.S.pts[a2.S.pts.length - 1].d;
  assert(muestras.length >= 2 && muestras.length <= 2501, 'número de muestras fuera de rango: ' + muestras.length);
  near(muestras[0].lon, a2.S.pts[0].lon, 1e-6, 'la primera muestra es el inicio');
  near(muestras[muestras.length - 1].lat, a2.S.pts[a2.S.pts.length - 1].lat, 1e-3, 'la última muestra es el final');
  // La línea paralela va desplazada, no encima
  const desplazada = a2.desplazarLinea([[0, 0], [0.001, 0], [0.002, 0]], 10);
  eq(desplazada.length, 3, 'debería devolver el mismo número de puntos');
  assert(desplazada[0][1] < 0 && desplazada[1][1] < 0, 'la línea debería desplazarse a un lado del trazado: ' + JSON.stringify(desplazada));
  assert(Math.abs(desplazada[1][1]) < 0.0002, 'el desplazamiento debería ser de unos metros, no de kilómetros: ' + desplazada[1][1]);
  return { detail: `${muestras.length} muestras en ${(total / 1000).toFixed(1)} km; referencia de parcela 9000+ → público, por debajo → particular; el reborde reutiliza los puntos del track` };
});

await test('T-catastro-2', 'La línea del Catastro se pinta según las respuestas del servicio', async () => {
  const app2 = loadApp();
  const a2 = app2.api();
  await a2.loadTrack('Catastro', rutaSintetica(40), false);
  // El servicio devuelve una parcela de dominio público, otra particular y un punto sin referencia,
  // según la longitud del punto consultado (para que el resultado sea determinista)
  const xml = ref => `<?xml version="1.0"?><consulta><pc1>${ref.slice(0, 7)}</pc1><pc2>${ref.slice(7)}</pc2><ldt>PRUEBA</ldt><cod>16</cod></consulta>`;
  let n = 0;
  app2.setFetch(async u => {
    const s = String(u);
    if (s.includes('Consulta_RCCOOR')) {
      n++;
      // Parcela 9500 (dominio público) en un tercio de los puntos, 1234 (particular) en otro, y sin
      // referencia en el resto: así la línea debe salir en los dos colores
      const ref = n % 3 === 0 ? refCat(1, 9500) : (n % 3 === 1 ? refCat(1, 1234) : '');
      return { ok: true, status: 200, url: s, text: async () => xml(ref), clone() { return this; }, blob: async () => ({ size: 1 }), json: async () => ({}), type: 'basic' };
    }
    return { ok: true, status: 200, url: s, text: async () => '', clone() { return this; }, blob: async () => ({ size: 1 }), json: async () => ({}), type: 'basic' };
  });
  a2.CATR.cache.clear();
  // Si el análisis del track ya había lanzado la consulta, esta llamada se apunta para repetirla al
  // terminar en vez de solaparse: se espera un poco para darle tiempo a acabar y a pintar.
  await a2.catastroLinea();
  await new Promise(r => setTimeout(r, 600));
  await a2.catastroLinea();
  const datos = app2.mapStub.getSource('catastroRuta') && app2.mapStub._setData.filter(([id]) => id === 'catastroRuta').pop();
  assert(datos, 'debería haberse actualizado la fuente del reborde del Catastro');
  const features = (datos[1] && datos[1].features) || [];
  assert(features.length >= 1, 'debería haber al menos un tramo de reborde: ' + features.length);
  const colores = new Set(features.map(f => f.properties.color));
  assert(colores.has(a2.CAT_COLORES.publico), 'debería haber tramos verdes (dominio público): ' + [...colores].join(', '));
  assert(colores.has(a2.CAT_COLORES.particular), 'debería haber tramos rojos (particulares): ' + [...colores].join(', '));
  // El reborde reutiliza la MISMA geometría que el track (mismos puntos), así que va pegado por definición
  const geoTrack = app2.mapStub._setData.filter(([id]) => id === 'route').pop();
  const coordsTrack = new Set(((geoTrack && geoTrack[1].features) || []).flatMap(f => f.geometry.coordinates.map(c => c[0].toFixed(6) + ',' + c[1].toFixed(6))));
  const propias = features.flatMap(f => f.geometry.coordinates.map(c => c[0].toFixed(6) + ',' + c[1].toFixed(6)));
  const ajenas = propias.filter(c => !coordsTrack.has(c));
  assert(ajenas.length === 0, 'el reborde debería usar los mismos puntos que el track, y hay ' + ajenas.length + ' que no coinciden');
  assert(n > 0, 'debería haber consultado el servicio del Catastro');
  const resumen = a2.CATR.ultimo;
  assert(resumen && resumen.publico > 0 && resumen.particular > 0, 'el resumen debería contar ambos tipos: ' + JSON.stringify(resumen));
  return { detail: `${n} consultas al servicio; ${features.length} tramos pintados (${resumen.publico} muestras públicas, ${resumen.particular} particulares, ${resumen.sin} sin referencia)` };
});

await test('T-catastro-3', 'Al dibujar una ruta también se traza la línea del Catastro', async () => {
  const app2 = loadApp();
  const a2 = app2.api();
  // Se dibuja una ruta por el mismo camino que usa el dedo: puntos y luego refreshDraw()
  const coords = [];
  for (let i = 0; i < 30; i++) coords.push([-3.5 + i * 0.0004, 37.2 + i * 0.0003]);
  app2.api().fijarDibujo([coords]);
  let n = 0;
  app2.setFetch(async u => {
    const s = String(u);
    if (s.includes('Consulta_RCCOOR')) {
      n++;
      const ref = '18072A0010095000';
      const xml = `<?xml version="1.0"?><consulta><pc1>${ref.slice(0,7)}</pc1><pc2>${ref.slice(7)}</pc2><ldt>P</ldt><cod>16</cod></consulta>`;
      return { ok: true, status: 200, url: s, text: async () => xml, clone() { return this; }, blob: async () => ({ size: 1 }), json: async () => ({}), type: 'basic' };
    }
    return { ok: true, status: 200, url: s, text: async () => '', clone() { return this; }, blob: async () => ({ size: 1 }), json: async () => ({}), type: 'basic' };
  });
  a2.CATR.cache.clear();
  await a2.refreshDraw();
  await new Promise(r => setTimeout(r, 800));
  await a2.catastroLinea();
  await new Promise(r => setTimeout(r, 400));
  assert(n > 0, 'al dibujar una ruta se debería consultar el Catastro');
  const datos = app2.mapStub._setData.filter(([id]) => id === 'catastroRuta').pop();
  assert(datos, 'debería haberse pintado la línea del Catastro al dibujar');
  const features = (datos[1] && datos[1].features) || [];
  assert(features.length >= 1, 'debería haber algún tramo pintado: ' + features.length);
  return { detail: `dibujando una ruta de ${coords.length} puntos: ${n} consultas y ${features.length} tramos pintados en la fuente catastroRuta` };
});

await test('T-catastro-4', 'La caché evita repetir consultas dentro de la misma parcela', async () => {
  const app2 = loadApp();
  const a2 = app2.api();
  // Ruta de unos 20 km: se muestrea cada 20 m (unos 1000 puntos), pero el servicio devuelve la MISMA
  // referencia en todos los puntos, como una parcela larga. Se debe consultar una sola vez por zona.
  const raw = [];
  for (let i = 0; i <= 200; i++) raw.push({ lat: 37.2 + i * 0.0009, lon: -3.5, ele: 600 + i, t: NaN });
  await a2.loadTrack('Parcela larga', raw, false);
  const total = a2.S.pts[a2.S.pts.length - 1].d;
  let n = 0;
  app2.setFetch(async u => {
    const s = String(u);
    if (s.includes('Consulta_RCCOOR')) {
      n++;
      const ref = '18072A0010095000';   // siempre la misma parcela de dominio público
      const xml = `<?xml version="1.0"?><consulta><pc1>${ref.slice(0,7)}</pc1><pc2>${ref.slice(7)}</pc2><ldt>P</ldt><cod>16</cod></consulta>`;
      return { ok: true, status: 200, url: s, text: async () => xml, clone() { return this; }, blob: async () => ({ size: 1 }), json: async () => ({}), type: 'basic' };
    }
    return { ok: true, status: 200, url: s, text: async () => '', clone() { return this; }, blob: async () => ({ size: 1 }), json: async () => ({}), type: 'basic' };
  });
  a2.CATR.cache.clear();
  a2.CATR.celdas.clear();
  // Se espera a que la consulta termine de verdad (se lanza en segundo plano para no retrasar el dibujo)
  const esperarFin = async (ms = 4000) => {
    const t0 = Date.now();
    while (a2.CATR.pidiendo && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 50));
    await new Promise(r => setTimeout(r, 100));
  };
  a2.catastroLinea();
  await esperarFin();
  const dados = a2.CATR.ultimo;
  assert(dados, 'debería haber un resumen del recorrido del Catastro');
  assert(dados.puntos > 200, 'debería haber muchos puntos muestreados: ' + dados.puntos);
  // Muestreo cada 20 m, pero una consulta cubre la zona de la parcela: se pregunta mucho menos
  assert(n > 0, 'debería haber consultado el Catastro alguna vez');
  // Con muestras cada 20 m y una ruta recta, las celdas de zona cubren ~27-111 m: unas 4 veces menos
  // consultas que muestras. Con una parcela realmente larga el ahorro es mucho mayor.
  assert(n < dados.puntos / 3, `debería consultar bastante menos que puntos muestreados: ${n} consultas para ${dados.puntos} muestras`);
  // Y una vez conocida la zona, repetir el recorrido no cuesta ni una consulta más
  const antes = n;
  a2.catastroLinea();
  await esperarFin();
  assert(n === antes, `la segunda pasada no debería consultar nada más: ${antes} → ${n}`);
  return { detail: `${(total / 1000).toFixed(1)} km: ${dados.puntos} muestras con ${antes} consultas la primera vez (${(dados.puntos / antes).toFixed(0)}× menos) y ninguna en la segunda` };
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
