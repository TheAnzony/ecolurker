/**
 * Copia de seguridad consistente de la base de datos.
 *
 *   docker compose exec -T bot node src/tools/backup.js
 *
 * Genera /app/data/backup-<fecha>.db, que aparece en ./data del host.
 *
 * Usa la API .backup() de SQLite en vez de copiar el archivo: con el modo WAL
 * activo, `cp bot.db` puede llevarse una copia sin los cambios que aun estan en
 * bot.db-wal. .backup() consolida todo en un unico archivo coherente, y puede
 * hacerlo con el bot funcionando.
 */
const path = require('node:path');
const db = require('../db');

const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const target = path.join('/app/data', `backup-${stamp}.db`);

db.backup(target)
  .then(() => {
    const { size } = require('node:fs').statSync(target);
    console.log(`Copia creada: ${path.basename(target)} (${(size / 1024).toFixed(1)} KB)`);
    console.log('En el host la tienes en ./data/');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Fallo al crear la copia:', err.message);
    process.exit(1);
  });
