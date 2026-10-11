// Copia la web a www/, que es lo que empaqueta Capacitor.
// La app Android carga la web publicada en Vercel (server.url en capacitor.config.json);
// la copia local solo se usa para offline.html cuando no hay conexión la primera vez.
import { cpSync, rmSync, mkdirSync } from 'node:fs';
const files = ['index.html', 'offline.html', 'manifest.webmanifest', 'sw.js', 'lib', 'icons'];
rmSync('www', { recursive: true, force: true });
mkdirSync('www');
for (const f of files) cpSync(f, `www/${f}`, { recursive: true });
console.log('www/ listo');
