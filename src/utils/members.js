/**
 * Rellena la cache de miembros solo si hace falta.
 *
 * `guild.members.fetch()` usa el opcode 8 del gateway, que tiene un rate limit
 * agresivo: llamarlo dos veces seguidas (p. ej. en el arranque y acto seguido
 * en la sincronizacion de roles) provoca un error de rate limit. Con esto,
 * quien ya encuentre la cache completa no vuelve a pedirla.
 */
async function ensureMembersCached(guild) {
  if (guild.members.cache.size >= guild.memberCount) return;
  await guild.members.fetch();
}

module.exports = { ensureMembersCached };
