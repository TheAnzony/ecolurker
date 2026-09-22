const repository = require('../db/repository');
const config = require('../config');
const { evaluateGuildInactivity } = require('../services/inactivityService');
const { getInactiveDays } = require('../services/settingsService');
const { ensureMembersCached } = require('../utils/members');

/**
 * Compone todo lo que muestra el dashboard para un servidor.
 *
 * Lee del mismo `evaluateGuildInactivity` que usa el sincronizador, para que la
 * web no pueda desviarse de lo que el bot hace de verdad: si algun dia cambia la
 * politica, el dashboard la refleja sin tocarlo.
 */
async function buildGuildSnapshot(guild) {
  await ensureMembersCached(guild);

  const { inactive, active, newMembers, exempt } = evaluateGuildInactivity(guild);
  const days = getInactiveDays(guild.id);
  const roleId = repository.getInactiveRoleId(guild.id);
  const role = roleId ? guild.roles.cache.get(roleId) : null;
  const sesiones = repository.getSessionCountsMap(guild.id);

  const toRow = (entry, estado) => ({
    id: entry.member.id,
    nombre: entry.member.displayName,
    estado,
    ultimaVoz: entry.source === 'voice' ? entry.lastActivity : null,
    sesiones: sesiones.get(entry.member.id) ?? 0,
    desde: entry.member.joinedTimestamp,
    plazo: entry.policy.days,
    plazoPropio: Boolean(entry.policy.roleId),
    llevaRol: role ? entry.member.roles.cache.has(role.id) : false,
  });

  const miembros = [
    ...inactive.map((e) => toRow(e, 'inactivo')),
    ...active.map((e) => toRow(e, 'activo')),
    ...newMembers.map((e) => toRow(e, 'gracia')),
    ...exempt.map((e) => toRow(e, 'exento')),
  ];

  const politicas = repository.getRolePolicies(guild.id).map((p) => {
    const r = guild.roles.cache.get(p.roleId);
    return {
      rol: r ? r.name : `(rol borrado ${p.roleId})`,
      dias: p.inactiveDays ?? days,
      marca: p.markInactive,
      retira: p.stripRole,
    };
  });

  return {
    servidor: {
      nombre: guild.name,
      id: guild.id,
      icono: guild.iconURL({ size: 128 }),
      miembros: miembros.length,
    },
    config: {
      dias: days,
      intervaloHoras: config.syncIntervalHours,
      rol: role ? role.name : null,
      expulsionesActivas: config.allowKick,
    },
    totales: {
      inactivo: inactive.length,
      activo: active.length,
      gracia: newMembers.length,
      exento: exempt.length,
    },
    miembros,
    politicas,
    historico: repository.getSnapshots(guild.id, 30),
    actividad: buildActivityLog(guild),
    generadoEn: Date.now(),
  };
}

const ETIQUETAS_ACCION = {
  mark_inactive: 'marcó @Inactivo a',
  unmark_inactive: 'desmarcó @Inactivo a',
  strip_role: 'retiró un rol especial a',
  role: 'asignó un rol a',
  warning: 'avisó por MD a',
  kick: 'expulsó a',
};

/** Nombre a mostrar para un ID: primero la cache en vivo, si no la ultima guardada. */
function resolverNombre(guild, userId) {
  return guild.members.cache.get(userId)?.displayName ?? repository.getMemberDisplayName(guild.id, userId) ?? userId;
}

/**
 * Mezcla comandos usados y acciones del bot en una sola linea de tiempo, para
 * el panel "Actividad reciente". Cada fuente vive en su propia tabla
 * (command_log / moderation_actions) porque son datos de naturaleza distinta;
 * aqui solo se combinan para mostrarlos juntos.
 */
function buildActivityLog(guild, limit = 20) {
  const comandos = repository.getRecentCommandUsage(guild.id, limit).map((r) => ({
    cuando: r.createdAt,
    texto: `${resolverNombre(guild, r.userId)} ejecutó ${r.command}`,
    tipo: 'comando',
  }));

  const acciones = repository.getRecentModerationActions(guild.id, limit).map((r) => ({
    cuando: r.createdAt,
    texto: `El bot ${ETIQUETAS_ACCION[r.action] || r.action} ${resolverNombre(guild, r.userId)}`,
    tipo: 'accion',
  }));

  return [...comandos, ...acciones].sort((a, b) => b.cuando - a.cuando).slice(0, limit);
}

async function buildPayload(client) {
  const guilds = [];
  for (const guild of client.guilds.cache.values()) {
    guilds.push(await buildGuildSnapshot(guild));
  }
  return { servidores: guilds };
}

module.exports = { buildPayload, buildGuildSnapshot };
