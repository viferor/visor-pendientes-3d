# Visor de Pendientes 3D

PWA para ver tracks GPX en 3D sobre imagen satelital, con el trazo coloreado según el % de pendiente y el número de la pendiente escrito sobre la línea. También permite dibujar rutas a mano y exportarlas como GPX para el ciclocomputador.

## Funciones

- Carga de archivos `.gpx` (botón o arrastrando el archivo al mapa).
- Mapa satélite (Esri) con relieve 3D (Terrain Tiles de AWS) y exageración ajustable.
- Trazo y perfil coloreados por pendiente, en tramos de 50 m a 1 km.
- Altitud tomada del GPX o del modelo de terreno.
- Perfil de altitud opcional, con opacidad ajustable.
- Pantalla completa.
- Dibujo de rutas siguiendo carreteras, caminos o en línea recta (OSRM de FOSSGIS), con exportación a GPX y opción de compartir en el móvil.
- Instalable como app y usable sin conexión con las zonas ya visitadas.

## Estructura

```
index.html             la app completa
manifest.webmanifest   datos de instalación de la PWA
sw.js                  service worker (caché de la app y de las teselas)
lib/                   MapLibre GL JS 4.7.1
icons/                 iconos de la app
vercel.json            cabeceras para el despliegue en Vercel
```

No necesita compilación: es un sitio estático.

## Desarrollo local

```bash
npx serve .
# o
python3 -m http.server 8000
```

El service worker solo se registra al servir la app por http(s); abriendo `index.html` con doble clic funciona, pero no se instala.

## Despliegue

Conectado a Vercel: cada `git push` a `main` publica una versión nueva de la web.
La app Android se compila en local: ver [LEEME-ANDROID.md](LEEME-ANDROID.md).
Al cambiar la app, sube el número de `VERSION` en `sw.js` para que los móviles con la app instalada reciban la actualización.

## Datos y créditos

- Imágenes satélite: © Esri, Maxar, Earthstar Geographics. Carreteras y nombres (híbrido): © Esri.
- Mapa ciclista: CyclOSM · © colaboradores de OpenStreetMap.
- Rutas MTB y de senderismo señalizadas: Waymarked Trails (CC BY-SA).
- Relieve: Terrain Tiles (Mapzen / AWS Open Data).
- Cálculo de rutas: OSRM (servidor público de FOSSGIS) y BRouter (brouter.de) · datos © colaboradores de OpenStreetMap.
- Mapa: MapLibre GL JS.
