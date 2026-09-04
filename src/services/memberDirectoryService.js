const repository = require('../db/repository');

/**
 * Mantiene al dia la tabla `members`: registra a los miembros actuales y
 * refresca sus apodos guardados.
 *
 * `first_seen` solo se fija la primera vez (el UPSERT no lo toca al actualizar);
 * el apodo si se sobrescribe, porque cambia con el tiempo y su unico proposito
 * es poder identificar a alguien mirando la base de datos sin resolver su ID.
 *
 * Los apodos se propagan tambien a `voice_logs` en la misma transaccion.
 *
 * Vive en su propio modulo (y no dentro de guildSetupService) porque lo usan
 * tanto el arranque como el sincronizador horario, y hacerlo al reves crearia
 * un ciclo de imports entre ambos.
 *
 * Devuelve cuantos miembros humanos se han registrado.
 */
function refreshMemberNames(guild) {
  const now = Date.now();
  const entries = [];

  for (const member of guild.members.cache.values()) {
    if (member.user.bot) continue;
    entries.push({
      userId: member.id,
      guildId: guild.id,
      displayName: member.displayName,
      timestamp: now,
    });
  }

  repository.refreshDisplayNames(entries, guild.id);
  return entries.length;
}

module.exports = { refreshMemberNames };
