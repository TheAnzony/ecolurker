const logger = require('../utils/logger');
const repository = require('../db/repository');
const { evaluateGuildInactivity } = require('./inactivityService');
const { ensureInactiveRole } = require('./roleService');
const { getInactiveDays } = require('./settingsService');
const { notifyRoleStripped } = require('./notificationService');
const { refreshMemberNames } = require('./memberDirectoryService');
const { ensureMembersCached } = require('../utils/members');

/**
 * Sincroniza el rol "Inactivo" con el estado real del servidor:
 * lo aniade a quien esta inactivo y se lo quita a quien volvio a usar voz,
 * este en periodo de gracia o quede exento por su politica.
 *
 * Ademas, a quien tenga un rol "especial" con la opcion de retirada activada,
 * se le quita ese rol y se le avisa por MD explicando el motivo y como
 * recuperarlo.
 *
 * Nunca expulsa.
 */
async function syncGuild(guild, days = null) {
  const role = await ensureInactiveRole(guild);
  if (!role) return null;

  await ensureMembersCached(guild);

  // Aprovecha que ya tenemos a todos los miembros en cache para mantener al dia
  // los apodos guardados, que si no envejecerian entre reinicios.
  refreshMemberNames(guild);

  const { inactive, active, newMembers, exempt } = evaluateGuildInactivity(guild, days);

  const result = {
    added: 0,
    removed: 0,
    stripped: 0,
    failed: 0,
    days: days ?? getInactiveDays(guild.id),
  };

  for (const entry of inactive) {
    const { member, policy } = entry;

    if (policy.markInactive && !member.roles.cache.has(role.id)) {
      try {
        await member.roles.add(role, 'Inactividad en canales de voz');
        result.added += 1;
      } catch (err) {
        result.failed += 1;
        logger.warn(`No se pudo aniadir el rol a ${member.user.tag}:`, err.message);
      }
    }

    // La politica puede pedir que ademas pierda su rol especial
    if (policy.stripRole && policy.roleId && member.roles.cache.has(policy.roleId)) {
      await stripSpecialRole(member, policy, result);
    }
  }

  // Quien tiene actividad reciente, esta en gracia, es admin, o cuya politica
  // dice que nunca se marque, no debe llevar el rol.
  const shouldNotBeMarked = [
    ...active,
    ...newMembers,
    ...exempt,
    ...inactive.filter((e) => !e.policy.markInactive),
  ];

  for (const { member } of shouldNotBeMarked) {
    if (!member.roles.cache.has(role.id)) continue;
    try {
      await member.roles.remove(role, 'Actividad reciente, periodo de gracia o exento');
      result.removed += 1;
    } catch (err) {
      result.failed += 1;
      logger.warn(`No se pudo quitar el rol a ${member.user.tag}:`, err.message);
    }
  }

  // Foto del reparto para poder ver la evolucion en el dashboard
  repository.recordSnapshot(guild.id, {
    inactive: inactive.length,
    active: active.length,
    grace: newMembers.length,
    exempt: exempt.length,
  });

  logger.info(
    `Sync de rol en "${guild.name}": ${result.added} marcados, ` +
      `${result.removed} desmarcados, ${result.stripped} roles retirados, ` +
      `${result.failed} fallidos (umbral ${result.days} dias | ` +
      `${inactive.length} inactivos, ${active.length} activos, ` +
      `${newMembers.length} en gracia, ${exempt.length} exentos)`
  );

  return result;
}

async function stripSpecialRole(member, policy, result) {
  const special = member.guild.roles.cache.get(policy.roleId);
  if (!special) return;

  try {
    await member.roles.remove(special, 'Inactividad prolongada en canales de voz');
    repository.logModerationAction(member.id, member.guild.id, 'strip_role', special.id);
    result.stripped += 1;
    logger.info(`Rol "${special.name}" retirado a ${member.user.tag} por inactividad`);

    // El aviso es informativo: si falla (MDs cerrados) no revertimos nada.
    await notifyRoleStripped(member, special, policy);
  } catch (err) {
    result.failed += 1;
    logger.warn(`No se pudo retirar "${special.name}" a ${member.user.tag}:`, err.message);
  }
}

/**
 * Quita el rol Inactivo a un miembro concreto. Se usa en cuanto se detecta
 * actividad de voz, para que el desmarcado sea inmediato y no haya que esperar
 * a la siguiente sincronizacion periodica.
 */
async function clearInactiveRole(member) {
  const role = await ensureInactiveRole(member.guild);
  if (!role || !member.roles.cache.has(role.id)) return false;

  try {
    await member.roles.remove(role, 'Actividad detectada en canales de voz');
    logger.info(`Rol Inactivo retirado a ${member.user.tag} por actividad de voz`);
    return true;
  } catch (err) {
    logger.warn(`No se pudo quitar el rol a ${member.user.tag}:`, err.message);
    return false;
  }
}

async function syncAllGuilds(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      await syncGuild(guild);
    } catch (err) {
      logger.error(`Fallo la sincronizacion de rol en "${guild.name}":`, err.message);
    }
  }
}

module.exports = { syncGuild, clearInactiveRole, syncAllGuilds };
