# App Android de Pendientes 3D

El APK se compila **en tu ordenador**, porque la clave con la que se firma solo existe ahí. GitHub Actions únicamente comprueba que el proyecto compila; no publica ningún APK.

## Compilar el APK (Windows)

Necesitas Android Studio instalado (aporta Java y el SDK de Android). Node.js es opcional.

1. Haz doble clic en `scripts\compilar-apk.bat`.
2. Cuando termine, se abre el Explorador con el APK seleccionado: `Pendientes3D-<versión>.apk`, en la carpeta principal del proyecto.
3. Pásalo al móvil e instálalo.

Si falla, el registro completo queda en `compilar-apk.log`.

Con Android Studio también puedes hacerlo a mano: abre la carpeta `android` y usa *Build → Generate Signed App Bundle / APK*, con la clave descrita abajo.

## La clave de firma

La primera vez, el script crea dos archivos:

- `android\app\pendientes3d-privada.jks`, que es la clave.
- `android\keystore.properties`, con su contraseña.

**Guarda una copia de los dos** en un pendrive o en tu gestor de contraseñas. Android solo instala una actualización encima de la app si está firmada con la misma clave. Si los pierdes, tendrás que desinstalar la app y volver a instalarla.

Los dos archivos están en `.gitignore`: nunca se suben a GitHub.

## Cuándo hay que recompilar

La app carga la web publicada en Vercel (`server.url` en `capacitor.config.json`). Por eso **los cambios en `index.html` no necesitan un APK nuevo**: basta con subirlos a `main` y Vercel los publica. La app los muestra la próxima vez que se abra.

Solo hay que volver a compilar si cambia algo de Android: el icono, el nombre, los permisos, los plugins o `capacitor.config.json`. En ese caso:

```
git pull
scripts\compilar-apk.bat
```

La primera vez que se abre, la app necesita conexión. Si no la hay, muestra `offline.html` con un botón para reintentar.

## Google Play

Para publicar en Play necesitarías un bundle `.aab` en lugar del APK: ejecuta `gradlew bundleRelease` dentro de `android`. La misma clave privada te sirve como clave de subida.
