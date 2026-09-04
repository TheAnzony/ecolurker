const logger = require('../utils/logger');
const { ensureMembersCached } = require('../utils/members');
const { refreshMemberNames } = require('./memberDirectoryService');
const { syncGuild } = require('./roleSyncService');

/**
 * Deja un servidor listo para operar, sin intervencion manual:
 *   1. Registra a los miembros actuales (first_seen + apodo).
 *   2. Crea el rol Inactivo si no existe (dentro de syncGuild).
 *   3. Marca como inactivo a quien corresponda.
 *
 * Se usa tanto al arrancar el bot (para los servidores donde ya esta) como al
 * ser aniadido a un servidor nuevo (evento guildCreate). Que sea el mismo
 * camino garantiza que un servidor nuevo quede configurado exactamente igual.
 *
 * No crea ninguna politica de rol: esas solo se configuran a mano con
 * /configurar rol.
 */
async function initializeGuild(guild) {
  await ensureMembersCached(guild);

  const seeded = refreshMemberNames(guild);
  logger.info(`Registrados ${seeded} miembros de "${guild.name}" (${guild.id})`);

  return syncGuild(guild);
}

module.exports = { initializeGuild };
