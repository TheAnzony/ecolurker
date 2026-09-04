/**
 * Consulta rapida de la base de datos desde la terminal.
 *
 *   docker compose exec -T bot node src/tools/consulta.js            -> resumen
 *   docker compose exec -T bot node src/tools/consulta.js fernando   -> busca por apodo
 *
 * Existe para no tener que escribir SQL con comillas anidadas en la terminal,
 * que en PowerShell es una fuente constante de errores de escapado.
 */
const db = require('../db');

const term = process.argv.slice(2).join(' ').trim();

function fecha(ms) {
  return new Date(ms).toLocaleString('es-ES');
}

if (term) {
  const rows = db
    .prepare(
      `SELECT m.display_name AS nombre, m.user_id AS id, m.first_seen AS visto,
              v.last_voice_activity AS voz
       FROM members m
       LEFT JOIN voice_logs v ON v.user_id = m.user_id AND v.guild_id = m.guild_id
       WHERE m.display_name LIKE ? COLLATE NOCASE
       ORDER BY m.display_name`
    )
    .all(`%${term}%`);

  if (rows.length === 0) {
    console.log(`Sin resultados para "${term}".`);
  } else {
    console.log(`${rows.length} resultado(s) para "${term}":\n`);
    for (const r of rows) {
      console.log(`  ${r.nombre}`);
      console.log(`    id:            ${r.id}`);
      console.log(`    visto desde:   ${fecha(r.visto)}`);
      console.log(`    ultima voz:    ${r.voz ? fecha(r.voz) : 'nunca registrada'}`);
      console.log('');
    }
  }
} else {
  const count = (sql) => db.prepare(sql).get().c;

  console.log('=== Resumen ===');
  console.log(`  miembros registrados: ${count('SELECT COUNT(*) c FROM members')}`);
  console.log(`  con actividad de voz: ${count('SELECT COUNT(*) c FROM voice_logs')}`);
  console.log(`  politicas de rol:     ${count('SELECT COUNT(*) c FROM role_policies')}`);
  console.log(`  acciones registradas: ${count('SELECT COUNT(*) c FROM moderation_actions')}`);

  const voz = db
    .prepare('SELECT display_name AS nombre, last_voice_activity AS voz FROM voice_logs ORDER BY voz DESC')
    .all();

  if (voz.length > 0) {
    console.log('\n=== Ultima actividad de voz ===');
    for (const r of voz) {
      console.log(`  ${(r.nombre || '(sin apodo)').padEnd(24)} ${fecha(r.voz)}`);
    }
  }

  console.log('\nBuscar a alguien:  node src/tools/consulta.js <apodo>');
}
