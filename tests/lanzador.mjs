// Lanzador de las pruebas del repositorio: importa las familias y presenta el resultado.
// Uso: npm test   (o node tests/lanzador.mjs)
import { resultados, resumen } from './comun.mjs';
import './pruebas/gpx.test.mjs';
import './pruebas/calculo.test.mjs';
import './pruebas/app.test.mjs';
import './pruebas/android.test.mjs';
import './pruebas/servicio.test.mjs';
import './pruebas/offline.test.mjs';
import fs from 'node:fs';
import path from 'node:path';

const pad = (s, n) => String(s).padEnd(n);
console.log('\n=== Pruebas de Visor de Pendientes 3D ===\n');
for (const r of resultados) {
  console.log(`[${pad(r.status, 7)}] ${pad(r.id, 4)} ${r.name}`);
  if (r.detail) console.log(`            ??? ${String(r.detail).replace(/\n/g, '\n              ')}`);
}
const cuenta = resumen();
console.log('\nResumen: ' + JSON.stringify(cuenta));
const fallos = resultados.filter(r => r.status === 'FALLA');
try {
  fs.writeFileSync(path.join(process.cwd(), 'tests', 'resultados.json'), JSON.stringify({ fecha: new Date().toISOString(), cuenta, resultados }, null, 2));
} catch (e) { /* el informe es opcional */ }
if (fallos.length) {
  console.error(`\n${fallos.length} prueba(s) han fallado.`);
  process.exit(1);
}
console.log('\nTodas las pruebas han pasado.');
