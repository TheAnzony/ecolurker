const { PermissionFlagsBits } = require('discord.js');
const repository = require('../db/repository');
const { getInactiveDays } = require('./settingsService');

/**
 * Politica que se aplica a un miembro concreto:
 *   - days:         plazo de inactividad en dias
 *   - markInactive: si puede recibir el rol @Inactivo
 *   - stripRole:    si al quedar inactivo pierde el rol que le dio esta politica
 *   - roleId:       rol del que proviene la politica (null = politica por defecto)
 *   - recoveryMessage: texto que se le envia por MD al perder el rol
 *   - exempt:       queda fuera del sistema por completo
 */

/**
 * Los administradores quedan exentos automaticamente, sin configurar nada.
 * Marcar como inactivo a quien administra el servidor no tiene sentido, y
 * ademas Discord no permite al bot modificar a miembros con rol superior, asi
 * que intentarlo solo genera errores.
 *
 * Para eximir a moderadores u otros roles, se usa /configurar rol con
 * marcar:false.
 */
function isAdmin(member) {
  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild)
  );
}

function loadPolicies(guildId) {
  const map = new Map();
  for (const policy of repository.getRolePolicies(guildId)) {
    map.set(policy.roleId, policy);
  }
  return map;
}

/**
 * Resuelve la politica de un miembro.
 *
 * Si tiene varios roles con politica, gana el de posicion mas alta en la
 * jerarquia del servidor. Es la regla mas predecible: coincide con como Discord
 * resuelve otros conflictos entre roles (p. ej. el color), y basta con mover un
 * rol arriba o abajo para cambiar la prioridad.
 */
function resolveMemberPolicy(member, policies, guildDays) {
  if (isAdmin(member)) {
    return {
      days: guildDays,
      markInactive: false,
      stripRole: false,
      roleId: null,
      recoveryMessage: null,
      exempt: true,
    };
  }

  let winner = null;
  let winnerPosition = -1;

  for (const [roleId, policy] of policies) {
    const role = member.roles.cache.get(roleId);
    if (!role) continue;
    if (role.position > winnerPosition) {
      winner = policy;
      winnerPosition = role.position;
    }
  }

  if (!winner) {
    return {
      days: guildDays,
      markInactive: true,
      stripRole: false,
      roleId: null,
      recoveryMessage: null,
      exempt: false,
    };
  }

  return {
    days: winner.inactiveDays ?? guildDays,
    markInactive: winner.markInactive,
    stripRole: winner.stripRole,
    roleId: winner.roleId,
    recoveryMessage: winner.recoveryMessage,
    exempt: false,
  };
}

/** Contexto reutilizable para recorrer todos los miembros de un servidor. */
function buildPolicyContext(guild) {
  const guildDays = getInactiveDays(guild.id);
  const policies = loadPolicies(guild.id);
  return {
    guildDays,
    policies,
    forMember: (member) => resolveMemberPolicy(member, policies, guildDays),
  };
}

module.exports = { buildPolicyContext, resolveMemberPolicy, loadPolicies, isAdmin };
