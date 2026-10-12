# Visor de Pendientes 3D

PWA y app Android para ver tracks GPX en 3D sobre imagen satélite, con el trazo coloreado según el
% de pendiente y el número de la pendiente escrito sobre la línea. También permite dibujar rutas a
mano (siguiendo carreteras, pistas o senderos, o en línea recta), consultar la cartografía oficial de
un punto y guardar el mapa de una ruta para usarla sin cobertura.

## Funciones

### Track y pendientes

- Carga de archivos `.gpx` con el botón, arrastrando el archivo al mapa, o abriéndolo desde el sistema
  (PWA en escritorio y selector de archivos en Android).
- Mapa satélite (Esri) con relieve 3D (Terrain Tiles de AWS) y exageración vertical ajustable (1 a 3).
- Trazo y perfil coloreados por pendiente, en tramos automáticos o fijos de **10 m a 1 km**.
- Etiquetas con el **% de pendiente** sobre la línea, y flechas de dirección con los kilómetros.
- Altitud tomada del **GPX** o del **modelo de terreno**, con la fuente siempre indicada.
- Estadísticas: distancia, desnivel + y −, altitud máxima y mínima y pendiente máxima.
- Sensores del GPX cuando existen: pulso, cadencia, potencia y temperatura.
- Perfil de altitud opcional, con opacidad ajustable y sincronizado con el punto marcado en el mapa.
- **Reproductor** tipo vuelo: velocidad real del track (1x = a la velocidad a la que se hizo), hasta
  60x y marcha atrás, con seguimiento de la vista y panel de datos del momento.
- Pantalla completa, modo «Mover controles» para recolocar los paneles, y transparencia regulable.

### Dibujo de rutas

- Puntos tocando el mapa, arrastrar para moverlos, tocarlos para borrarlos, deshacer y cerrar circuito.
- Modos de cálculo: **carretera** (OSRM bike), **pistas** (BRouter trekking), **senderos**
  (BRouter hiking-mountain) y **recta**, con respaldo automático a OSRM si BRouter no responde.
- Dibujo a mano alzada arrastrando el dedo (con dos dedos se mueve el mapa).
- Exportación a GPX y uso de la hoja de compartir del móvil.

### Capas cartográficas

- Satélite, híbrido (carreteras y nombres) y CyclOSM, con CyclOSM sobre el satélite y opacidad regulable.
- Pistas, sendas, nombres y cimas de OpenStreetMap (capa vectorial de OpenFreeMap).
- Sendas y caminos (CyclOSM lite).
- Rutas MTB señalizadas y rutas de senderismo GR, PR y SL (Waymarked Trails).
- **Parcelas del Catastro**, con opacidad y consulta al tocar el mapa.
- **Vías pecuarias** y **montes públicos de Andalucía** (REDIAM, Junta de Andalucía).
- Ficha conjunta al tocar el mapa: reúne Catastro, vías pecuarias y montes en una sola consulta visual.

### Sin cobertura

- La app se instala como PWA y abre sin conexión con las zonas ya visitadas.
- **Guardar mapa de esta ruta**: descarga el mapa elegido, las capas activas y el relieve en un pasillo
  alrededor de la ruta, en una caché aparte que **no se recorta** con el uso normal.
- Antes de descargar se muestra el tamaño estimado y el desglose por capas; al terminar, lo que se ha
  guardado de verdad. La lista de zonas guardadas permite abrirlas, ver ese desglose y borrarlas
  (solo se borran las teselas que no usa otra zona guardada).
- El **cálculo de rutas necesita conexión**: OSRM y BRouter son servicios externos.

## Estructura

```
index.html             la app completa (interfaz, mapa, cálculo y cachés)
manifest.webmanifest   datos de instalación de la PWA
sw.js                  service worker: caché de la app, de las teselas visitadas,
                       de las tipografías y de los mapas guardados a propósito
offline.html           pantalla que muestra la app Android si no hay conexión al abrir
lib/                   MapLibre GL JS 4.7.1
icons/                 iconos de la app
tests/                 pruebas automatizadas (ver más abajo)
scripts/copy-www.mjs   copia la web a www/ para empaquetarla con Capacitor
scripts/compilar-apk.bat  compila y firma el APK en Windows
android/               proyecto Android (Capacitor 8): manifiesto, recursos y firma
.github/workflows/android.yml  ejecuta las pruebas y comprueba que el APK compila
vercel.json            cabeceras de caché y rewrites de los servicios cartográficos
package.json           dependencias de Capacitor y script de pruebas
capacitor.config.json  configuración de la app Android (carga la web publicada)
```

No necesita compilación: la web es un sitio estático.

## Pruebas

```bash
npm test
```

Ejecutan `index.html` y `sw.js` **reales** en un entorno simulado, sin navegador y sin dependencias
(el propio arnés implementa el DOM mínimo, el `DOMParser`, `caches` e IndexedDB). Cubren:

- GPX: válido, sin altitudes, mal formado, vacío, multisegmento, coordenadas imposibles, puntos
  repetidos, sensores `gpxtpx`, y un archivo real de más de 10.000 puntos.
- Cálculo: distancias geodésicas con casos conocidos, cruce del antimeridiano, tramos automáticos y
  fijos, rampas del ±10 %, pendiente nula, altitudes ausentes y desnivel acumulado.
- Altitud del terreno: descodificación Terrarium, teselas de control, fallo de red y cambio de fuente.
- Estado: cargar otra ruta no mezcla datos, protección frente a respuestas tardías de OSRM/BRouter.
- Service worker: precache, versión de caché, activación sin borrar las zonas guardadas, navegación
  sin conexión y prioridad de la caché de mapas guardados.
- Sin cobertura: composición exacta de lo que se guarda por capas y guardado real en la caché.
- Ficha cartográfica: Catastro y capas de la Junta con datos, sin datos, servicio caído y excepción XML.

El workflow de GitHub Actions las ejecuta **antes** de comprobar la compilación del APK.

## Desarrollo local

```bash
npx serve .
# o
python3 -m http.server 8000
```

El service worker solo se registra al servir la app por http(s); abriendo `index.html` con doble clic
funciona, pero no se instala.

## Despliegue

- **Web:** conectado a Vercel. Cada push a `main` publica en https://visor-pendientes-3d.vercel.app.
  Las demás ramas generan un *preview deployment* (con protección de Vercel: hay que iniciar sesión
  para abrirlo).
- **Caché:** `sw.js` guarda la app en `pendientes3d-app-<VERSION>`. **Al cambiar `index.html`, sube
  `VERSION`** para que los móviles con la app instalada reciban la actualización; al activarse se borran
  solo las cachés de app antiguas. Las teselas visitadas están en `pendientes3d-tiles` (se recortan a
  8.000) y los mapas guardados a propósito en `pendientes3d-offline`, que **nunca se borra**.
- **Android:** la app carga la web publicada (`server.url` en `capacitor.config.json`), así que los
  cambios de la web **no necesitan APK nueva**. Solo hay que recompilar si cambia algo nativo (icono,
  nombre, permisos, plugins o la configuración de Capacitor): ver [LEEME-ANDROID.md](LEEME-ANDROID.md).

## Límites que conviene conocer

- **El cálculo de rutas necesita conexión** (OSRM y BRouter son servicios externos).
- **Sin cobertura** se ve lo que se guardó: satélite, relieve, y las capas que estuvieran activadas al
  guardar (Catastro, vías pecuarias, montes, pistas y nombres). La consulta al tocar el mapa necesita red.
- **La ficha cartográfica es orientativa**: la referencia catastral y las capas de la Junta son
  información de sus fuentes originales y **no acreditan** titularidad, deslinde ni derechos de paso.
  En el Catastro, las parcelas numeradas a partir de 9000 se señalan como **indicio cartográfico** de
  dominio público (caminos, arroyos, carreteras o vías pecuarias), no como una determinación jurídica.
- Las altitudes del modelo de terreno tienen el detalle de las Terrain Tiles (hasta zoom 15); para
  tramos muy cortos (10-15 m) conviene usar la altitud del propio GPX, y la app lo avisa.

## Datos y créditos

- Imágenes satélite: © Esri, Maxar, Earthstar Geographics. Carreteras y nombres (híbrido): © Esri.
- Mapa ciclista: CyclOSM · © colaboradores de OpenStreetMap.
- Rutas MTB y de senderismo señalizadas: Waymarked Trails (CC BY-SA).
- Pistas, sendas, nombres y cimas (capa vectorial): OpenFreeMap · © colaboradores de OpenStreetMap.
- Parcelas catastrales y consulta de referencias: © Dirección General del Catastro (servicios WMS y de
  coordenadas, a través de Vercel).
- Vías pecuarias y montes públicos de Andalucía: REDIAM, Junta de Andalucía (WMS, a través de Vercel).
- Relieve: Terrain Tiles (Mapzen / AWS Open Data).
- Cálculo de rutas: OSRM (servidor público de FOSSGIS) y BRouter (brouter.de) · datos © colaboradores
  de OpenStreetMap.
- Mapa: MapLibre GL JS.
