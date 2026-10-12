package com.viferor.pendientes3d;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;

import com.getcapacitor.BridgeActivity;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

/**
 * Actividad principal.
 *
 * Además de cargar la web publicada (server.url en capacitor.config.json), permite abrir un archivo
 * .gpx enviado desde otra aplicación (Correo, WhatsApp, Archivos, un explorador de ficheros…).
 *
 * Cómo funciona:
 *  - El manifiesto declara un intent-filter para ACTION_VIEW y ACTION_SEND con archivos .gpx.
 *  - Aquí se lee el contenido del archivo y se guarda en memoria.
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
                if (!pareceGpx(uri)) return;
                gpxPendiente = leerTexto(uri);
            }
        }, "leer-gpx").start();
    }

    /**
     * Comprueba que el archivo recibido es un GPX antes de cargarlo, porque el intent-filter de
     * «compartir» acepta también XML y binarios genéricos. Se mira la extensión y, si no la hay,
     * las primeras letras del contenido.
     */
    private boolean pareceGpx(Uri uri) {
        String nombre = null;
        try {
            android.database.Cursor c = getContentResolver().query(uri, null, null, null, null);
            if (c != null) {
                int col = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                if (c.moveToFirst() && col >= 0) nombre = c.getString(col);
                c.close();
            }
        } catch (Exception ignorado) { }
        if (nombre == null) nombre = uri.getLastPathSegment();
        if (nombre != null && nombre.toLowerCase(java.util.Locale.ROOT).endsWith(".gpx")) return true;
        // Sin extensión fiable: se comprueba que el contenido empiece como un GPX.
        InputStream entrada = null;
        try {
            entrada = getContentResolver().openInputStream(uri);
            if (entrada == null) return false;
            byte[] cabeza = new byte[512];
            int leidos = entrada.read(cabeza);
            if (leidos <= 0) return false;
            String inicio = new String(cabeza, 0, leidos, StandardCharsets.UTF_8);
            return inicio.contains("<gpx") || inicio.contains("<?xml");
        } catch (Exception e) {
            return false;
        } finally {
            try { if (entrada != null) entrada.close(); } catch (Exception ignorado) { }
        }
    }

    private String leerTexto(Uri uri) {
        InputStream entrada = null;
        try {
            entrada = getContentResolver().openInputStream(uri);
            if (entrada == null) return null;
            BufferedReader lector = new BufferedReader(new InputStreamReader(entrada, StandardCharsets.UTF_8));
            StringBuilder texto = new StringBuilder();
            char[] trozo = new char[8192];
            int leidos;
            while ((leidos = lector.read(trozo)) > 0) texto.append(trozo, 0, leidos);
            return texto.length() > 0 ? texto.toString() : null;
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
