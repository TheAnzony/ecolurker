const { PermissionFlagsBits } = require('discord.js');
const repository = require('../db/repository');
const config = require('../config');
const logger = require('../utils/logger');

const ROLE_NAME = 'Inactivo';

// Evita resolver/crear el rol en cada sincronizacion
const cache = new Map();

/**
 * Devuelve el rol "Inactivo" del servidor, resolviendolo en este orden:
 *   1. INACTIVE_ROLE_ID del .env (si esta definido)
 *   2. ID guardado en guild_settings (creado por el bot en un arranque previo)
 *   3. Un rol existente llamado "Inactivo"
 *   4. Lo crea
 *
 * Devuelve null si el bot no puede gestionar roles, en vez de lanzar: la
 * sincronizacion debe degradar limpiamente, no tumbar el bot.
 */
async function ensureInactiveRole(guild) {
  if (cache.has(guild.id)) return cache.get(guild.id);

  const me = guild.members.me ?? (await guild.members.fetchMe());
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    logger.warn(
      `El bot no tiene el permiso "Gestionar roles" en "${guild.name}". ` +
        'No se puede marcar/desmarcar el rol Inactivo.'
    );
    return null;
  }

  const roles = await guild.roles.fetch();

  const knownId = config.inactiveRoleId || repository.getInactiveRoleId(guild.id);
  let role = knownId ? roles.get(knownId) : null;

  if (!role) {
    role = roles.find((r) => r.name === ROLE_NAME && !r.managed) ?? null;
  }

  if (!role) {
    try {
      role = await guild.roles.create({
        name: ROLE_NAME,
        colors: { primaryColor: 0x99aab5 },
        mentionable: false,
        hoist: false,
        reason: 'Rol usado para marcar inactividad en canales de voz',
      });
      logger.info(`Rol "${ROLE_NAME}" creado en "${guild.name}" (${role.id})`);
    } catch (err) {
      logger.error(`No se pudo crear el rol "${ROLE_NAME}" en "${guild.name}":`, err.message);
      return null;
    }
  }

  // El bot solo puede asignar roles por debajo de su rol mas alto
  if (role.position >= me.roles.highest.position) {
    logger.warn(
      `El rol "${role.name}" esta por encima (o al mismo nivel) del rol del bot en ` +
        `"${guild.name}". Muevelo por debajo en Ajustes > Roles para que el bot pueda asignarlo.`
    );
  }

  repository.setInactiveRoleId(guild.id, role.id);
  cache.set(guild.id, role);
  return role;
}

function invalidate(guildId) {
  cache.delete(guildId);
}

module.exports = { ensureInactiveRole, invalidate, ROLE_NAME };
