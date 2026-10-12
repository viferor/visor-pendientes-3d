package com.viferor.pendientes3d;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;

import com.getcapacitor.BridgeActivity;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * Actividad principal.
 *
 * Además de cargar la web publicada (server.url en capacitor.config.json), permite abrir un archivo
 * .gpx enviado desde otra aplicación (Correo, WhatsApp, Archivos, un explorador de ficheros…).
 *
 * Cómo funciona:
 *  - El manifiesto declara los intent-filter de ACTION_VIEW (abrir con) y ACTION_SEND (compartir).
 *  - Aquí se comprueba que el archivo sea un GPX, se lee y se guarda en memoria.
 *  - La web lo recoge con el puente de JavaScript "AndroidGpx" (ver index.html, cargarGpxNativo),
 *    tanto al arrancar como si la app ya estaba abierta (onNewIntent).
 */
public class MainActivity extends BridgeActivity {

    /** Nombre del puente que ve la web: window.AndroidGpx */
    public static final String PUENTE = "AndroidGpx";

    /** Contenido del último .gpx recibido, pendiente de que la web lo recoja. */
    private static volatile String gpxPendiente = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (this.bridge != null) {
            this.bridge.getWebView().addJavascriptInterface(new PuenteGpx(), PUENTE);
        }
        // Al arrancar en frío hay que leer el intent aquí: onNewIntent no se llama en ese caso.
        leerIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        leerIntent(intent);
    }

    /** Extrae el .gpx del intent (ACTION_VIEW o ACTION_SEND) y lo deja disponible para la web. */
    private void leerIntent(final Intent intent) {
        if (intent == null) return;
        final String accion = intent.getAction();
        final boolean esVista = Intent.ACTION_VIEW.equals(accion);
        final boolean esEnvio = Intent.ACTION_SEND.equals(accion);
        if (!esVista && !esEnvio) return;
        final Uri uri = esVista ? intent.getData() : (Uri) intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (uri == null) return;
        // Se lee fuera del hilo principal: el contenido puede venir de otra aplicación o de la nube.
        new Thread(new Runnable() {
            @Override
            public void run() {
                // Con «Abrir con» la app se ofrece para cualquier archivo (ver el manifiesto), así
                // que aquí se descartan los que no son GPX mirando primero el nombre, que es barato,
                // y solo después un poco de contenido. Así no se descarga un archivo grande.
                String nombre = nombreDe(uri);
                boolean nombreEsGpx = nombre != null && nombre.toLowerCase(java.util.Locale.ROOT).endsWith(".gpx");
                if (esVista && !nombreEsGpx) {
                    String cabeza = leerCabeza(uri, 512);
                    if (cabeza == null || !(cabeza.contains("<gpx") || cabeza.contains("<GPX"))) return;
                }
                if (nombreEsGpx || esEnvio) {
                    String texto = leerTexto(uri);
                    if (texto == null || !texto.contains("<")) return;
                    if (!nombreEsGpx && !(texto.contains("<gpx") || texto.contains("<GPX"))) return;
                    gpxPendiente = texto;
                } else {
                    gpxPendiente = leerTexto(uri);
                }
            }
        }, "leer-gpx").start();
    }

    /** Nombre real del archivo según el proveedor de contenido (o el último tramo de la ruta). */
    private String nombreDe(Uri uri) {
        try {
            android.database.Cursor c = getContentResolver().query(uri, null, null, null, null);
            if (c != null) {
                int col = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                if (c.moveToFirst() && col >= 0) {
                    String n = c.getString(col);
                    c.close();
                    if (n != null && !n.trim().isEmpty()) return n;
                } else {
                    c.close();
                }
            }
        } catch (Exception ignorado) { }
        return uri.getLastPathSegment();
    }

    /** Lee solo los primeros bytes: sirve para comprobar el tipo sin descargar el archivo entero. */
    private String leerCabeza(Uri uri, int maximo) {
        InputStream entrada = null;
        try {
            entrada = getContentResolver().openInputStream(uri);
            if (entrada == null) return null;
            byte[] cabeza = new byte[maximo];
            int leidos = entrada.read(cabeza);
            return leidos > 0 ? new String(cabeza, 0, leidos, StandardCharsets.UTF_8) : null;
        } catch (Exception e) {
            return null;
        } finally {
            try { if (entrada != null) entrada.close(); } catch (Exception ignorado) { }
        }
    }

    private String leerTexto(Uri uri) {
        InputStream entrada = null;
        try {
            entrada = getContentResolver().openInputStream(uri);
            if (entrada == null) return null;
            java.io.ByteArrayOutputStream salida = new ByteArrayOutputStream();
            byte[] trozo = new byte[16384];
            int leidos;
            while ((leidos = entrada.read(trozo)) > 0) salida.write(trozo, 0, leidos);
            return salida.size() > 0 ? new String(salida.toByteArray(), StandardCharsets.UTF_8) : null;
        } catch (Exception e) {
            return null;
        } finally {
            try { if (entrada != null) entrada.close(); } catch (Exception ignorado) { }
        }
    }

    /** Puente que consulta la web. Devuelve el .gpx una sola vez y null mientras no haya nada. */
    private class PuenteGpx {
        @JavascriptInterface
        public String pendiente() {
            String texto = gpxPendiente;
            gpxPendiente = null;
            return texto;
        }
    }
}
