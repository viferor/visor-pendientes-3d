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

await test('O1', 'La web recoge sola el .gpx que le pasa Android y lo carga', async () => {
  let pedidos = 0;
  const app2 = loadApp({ AndroidGpx: { pendiente: () => (++pedidos === 3 ? GPX_PRUEBA : null) } });
  const a2 = app2.api();
  // Se le da tiempo a que llegue el archivo (el puente pregunta cada 500 ms, hasta 20 veces)
  const t0 = Date.now();
  while (a2.S.name !== 'Recibido de Android' && Date.now() - t0 < 6000) await new Promise(r => setTimeout(r, 100));
  eq(a2.S.name, 'Recibido de Android', 'nombre del track recibido');
  eq(a2.S.pts.length, 2, 'puntos cargados');
  assert(pedidos >= 3, 'debería haber preguntado varias veces hasta que llegara el archivo');
  return { detail: `cargado solo, tras ${pedidos} consultas al puente: «${a2.S.name}» con ${a2.S.pts.length} puntos` };
});

await test('O2', 'Si el archivo recibido no es un GPX válido, se avisa sin romper la app', async () => {
  const app2 = loadApp({ AndroidGpx: { pendiente: () => 'esto no es un gpx' } });
  const a2 = app2.api();
  // El aviso puede quedar tapado después por el estado del análisis del track de ejemplo, así que
  // se muestrea durante unos segundos en lugar de mirar solo el estado final.
  let aviso = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 3000) {
    const st = app2.el('status').textContent;
    if (/no se pudo abrir/i.test(st)) { aviso = st; break; }
    await new Promise(r => setTimeout(r, 50));
  }
  assert(aviso !== null, 'debería avisar de que el archivo recibido no se pudo abrir');
  // La app debe quedar utilizable: con el recorrido que ya tenía o, si aún estaba arrancando, con
  // el de ejemplo. Nunca con la pantalla en blanco ni con un error permanente.
  await esperarArranque(a2);
  assert(a2.S.pts && a2.S.pts.length > 1, 'la app debe seguir utilizable con un recorrido cargado');
  assert(a2.S.segs && a2.S.segs.length > 0, 'el recorrido debe estar analizado (perfil y pendientes)');
  return { detail: 'aviso mostrado: ' + aviso + ' · la app sigue con «' + a2.S.name + '» (' + a2.S.pts.length + ' puntos, ' + a2.S.segs.length + ' tramos)' };
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
