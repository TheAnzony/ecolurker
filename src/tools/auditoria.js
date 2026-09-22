/**
 * Muestra el registro de actividad del bot desde la terminal.
 *
 *   docker compose exec -T bot node src/tools/auditoria.js               -> ambos, 20 c/u
 *   docker compose exec -T bot node src/tools/auditoria.js comandos 50   -> solo comandos, 50
 *   docker compose exec -T bot node src/tools/auditoria.js acciones 50   -> solo acciones, 50
 *
 * Junta dos fuentes distintas:
 *   - command_log:        que comando ejecuto cada administrador y cuando.
 *   - moderation_actions: que hizo el bot (marcar/desmarcar @Inactivo, retirar
 *     un rol especial, o una accion manual de /moderar-inactivos) y a quien.
 */
const db = require('../db');

const ACCIONES = {
  mark_inactive: 'marco @Inactivo a',
  unmark_inactive: 'desmarco @Inactivo a',
  strip_role: 'retiro un rol especial a',
  role: 'asigno un rol a',
  warning: 'aviso por MD a',
  kick: 'expulso a',
};

const [modo, limiteArg] = process.argv.slice(2);
const limite = Number(limiteArg) || 20;

function fecha(ms) {
  return new Date(ms).toLocaleString('es-ES');
}

function nombreDe(userId) {
  const row = db
    .prepare('SELECT display_name FROM members WHERE user_id = ? ORDER BY first_seen DESC LIMIT 1')
    .get(userId);
  return row?.display_name || userId;
}

function mostrarComandos() {
  const rows = db
    .prepare('SELECT user_id, command, created_at FROM command_log ORDER BY created_at DESC LIMIT ?')
    .all(limite);

  console.log(`=== Comandos usados (ultimos ${rows.length}) ===`);
  if (rows.length === 0) console.log('  (ninguno todavia)');
  for (const r of rows) {
    console.log(`  ${fecha(r.created_at).padEnd(20)} ${nombreDe(r.user_id).padEnd(20)} ${r.command}`);
  }
}

function mostrarAcciones() {
  const rows = db
    .prepare('SELECT user_id, action, reason, created_at FROM moderation_actions ORDER BY created_at DESC LIMIT ?')
    .all(limite);

  console.log(`=== Acciones del bot (ultimas ${rows.length}) ===`);
  if (rows.length === 0) console.log('  (ninguna todavia)');
  for (const r of rows) {
    const texto = ACCIONES[r.action] || r.action;
    const detalle = r.reason && r.reason !== 'sync' && r.reason !== 'voice_activity' ? ` (${r.reason})` : '';
    console.log(`  ${fecha(r.created_at).padEnd(20)} ${texto} ${nombreDe(r.user_id)}${detalle}`);
  }
}

if (modo === 'comandos') {
  mostrarComandos();
} else if (modo === 'acciones') {
  mostrarAcciones();
} else {
  mostrarComandos();
  console.log('');
  mostrarAcciones();
}
