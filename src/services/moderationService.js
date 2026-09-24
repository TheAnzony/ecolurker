const repository = require('../db/repository');
const config = require('../config');
const logger = require('../utils/logger');
const { ensureInactiveRole } = require('./roleService');

async function applyRole(entries, guild) {
  const role = await ensureInactiveRole(guild);
  if (!role) {
    throw new Error(
      'No se pudo resolver el rol Inactivo. Revisa que el bot tenga el permiso "Gestionar roles".'
    );
  }

  const results = { ok: 0, failed: [] };
  for (const { member } of entries) {
    try {
      await member.roles.add(role, 'Inactividad en canales de voz');
      repository.logModerationAction(member.id, guild.id, 'role', role.id);
      results.ok += 1;
    } catch (err) {
      logger.warn(`No se pudo asignar rol a ${member.id}:`, err.message);
      results.failed.push(member.id);
    }
  }
  return results;
}

async function sendWarning(entries, guild) {
  const results = { ok: 0, failed: [] };
  for (const { member } of entries) {
    try {
      await member.send(config.inactiveWarningMessage);
      repository.logModerationAction(member.id, guild.id, 'warning', null);
      results.ok += 1;
    } catch (err) {
      logger.warn(`No se pudo enviar MD a ${member.id}:`, err.message);
      results.failed.push(member.id);
    }
  }
  return results;
}

async function kickMembers(entries, guild) {
  if (!config.allowKick) {
    throw new Error(
      'Las expulsiones estan desactivadas. Para habilitarlas, pon ALLOW_KICK=true en el .env y reinicia el bot.'
    );
  }

  const results = { ok: 0, failed: [] };
  for (const { member } of entries) {
    try {
      await member.kick('Inactividad prolongada en canales de voz');
      repository.logModerationAction(member.id, guild.id, 'kick', null);
      // No se borra su historial: la regla del bot es que los datos solo se
      // purgan manualmente. Borrarlos aqui dejaria huecos en las estadisticas
      // del recap de los demas (su "duo del año" se evaporaria).
      results.ok += 1;
    } catch (err) {
      logger.warn(`No se pudo expulsar a ${member.id}:`, err.message);
      results.failed.push(member.id);
    }
  }
  return results;
}

const ACTIONS = {
  rol: applyRole,
  aviso: sendWarning,
  expulsar: kickMembers,
};

async function applyAction(actionName, entries, guild) {
  const handler = ACTIONS[actionName];
  if (!handler) {
    throw new Error(`Accion desconocida: ${actionName}`);
  }
  return handler(entries, guild);
}

module.exports = { applyAction };
