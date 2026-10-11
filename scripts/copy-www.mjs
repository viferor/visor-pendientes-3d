// Copia la web (que vive en la raíz para Vercel) a www/, que es lo que empaqueta Capacitor.
import { cpSync, rmSync, mkdirSync } from 'node:fs';
const files = ['index.html', 'manifest.webmanifest', 'sw.js', 'lib', 'icons'];
rmSync('www', { recursive: true, force: true });
mkdirSync('www');
for (const f of files) cpSync(f, `www/${f}`, { recursive: true });
console.log('www/ listo');
