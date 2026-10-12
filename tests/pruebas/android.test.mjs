// Pruebas de la integración con Android: apertura de un .gpx enviado desde otra aplicación.
// Se ejecutan con: npm test
import { test, eq, assert, slice, fs, path, REPO, loadApp } from '../comun.mjs';

const GPX_PRUEBA = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Recibido de Android</name>
<trkpt lat="37.000" lon="-3.000"><ele>100</ele></trkpt>
<trkpt lat="37.010" lon="-3.000"><ele>200</ele></trkpt>
</trk></gpx>`;

// El arranque de la app ya consulta el puente de Android (cargarGpxNativo se llama al final del
// arranque), así que estas pruebas comprueban lo que ve el usuario: la app se abre y, unos segundos
// después, el recorrido recibido está cargado. No se llama a cargarGpxNativo a mano para no crear
// un segundo sondeo que competiría con el de la propia app.
const esperarArranque = async (a2, ms = 2500) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (a2.S.pts && a2.S.segs && a2.S.name) return a2.S.name;
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
  assert(/android:launchMode="singleTask"/.test(manifest), 'se necesita singleTask para recibir el archivo con la app ya abierta');
  const java = fs.readFileSync(path.join(REPO, 'android/app/src/main/java/com/viferor/pendientes3d/MainActivity.java'), 'utf8');
  assert(/addJavascriptInterface\(new PuenteGpx\(\), PUENTE\)/.test(java), 'MainActivity no expone el puente a la web');
  assert(/onNewIntent/.test(java) && /leerIntent/.test(java), 'MainActivity no atiende los intents (arranque y app ya abierta)');
  assert(/endsWith\("\.gpx"\)/.test(java), 'MainActivity no comprueba que el archivo sea un .gpx');
  const web = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
  assert(/window\.AndroidGpx/.test(web), 'la web no consulta el puente de Android');
  assert(/cargarGpxNativo\(\);/.test(web), 'la web no llama a la carga de GPX nativo al arrancar');
  return { detail: 'manifiesto (VIEW + SEND + extensión), MainActivity (puente, onNewIntent y comprobación .gpx) y web (consulta al arrancar)' };
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
