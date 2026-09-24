/**
 * Borra manualmente todos los datos de una persona.
 *
 *   docker compose exec -T bot node src/tools/purgar.js <id>            -> simulacion
 *   docker compose exec -T bot node src/tools/purgar.js <id> --confirmar -> borra
 *
 * El bot no borra historial por su cuenta, ni siquiera cuando alguien se va del
 * servidor: hacerlo dejaria huecos en las estadisticas del recap de los demas.
 * Esta herramienta existe para poder purgar cuando se decida, y por defecto
 * solo simula, igual que /moderar-inactivos.
 */
const db = require('../db');
const repository = require('../db/repository');
const recapRepository = require('../db/recapRepository');

const [userId, flag] = process.argv.slice(2);
const confirmar = flag === '--confirmar';

if (!userId) {
  console.log('Uso: node src/tools/purgar.js <id-de-usuario> [--confirmar]');
  process.exit(1);
}

const guild = db.prepare('SELECT guild_id FROM guild_settings LIMIT 1').get();
if (!guild) {
  console.log('No hay ningun servidor registrado en la base de datos.');
  process.exit(1);
}

const guildId = guild.guild_id;
const miembro = db
  .prepare('SELECT display_name FROM members WHERE guild_id = ? AND user_id = ?')
  .get(guildId, userId);

const sesiones = recapRepository.countUserSessions(guildId, userId);
const acciones = db
  .prepare('SELECT COUNT(*) c FROM moderation_actions WHERE guild_id = ? AND user_id = ?')
  .get(guildId, userId).c;
const comandos = db
  .prepare('SELECT COUNT(*) c FROM command_log WHERE guild_id = ? AND user_id = ?')
  .get(guildId, userId).c;

console.log(`Usuario: ${miembro?.display_name || '(sin registro en members)'}  [${userId}]`);
console.log('');
console.log('Se borraria:');
console.log(`  sesiones de voz:      ${sesiones}`);
console.log(`  fila en members y voice_logs (ultima actividad, contador de sesiones)`);
console.log('');
console.log('Se conservaria (es auditoria, no dato personal de actividad):');
console.log(`  acciones de moderacion: ${acciones}`);
console.log(`  comandos ejecutados:    ${comandos}`);
console.log('');

if (!confirmar) {
  console.log('SIMULACION: no se ha borrado nada.');
  console.log(`Para borrar de verdad: node src/tools/purgar.js ${userId} --confirmar`);
  process.exit(0);
}

const borradas = recapRepository.deleteUserSessions(guildId, userId);
repository.forgetMember(userId, guildId);

console.log(`Borrado: ${borradas} sesion(es) y sus datos de inactividad.`);
