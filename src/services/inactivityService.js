const repository = require('../db/repository');
const { buildPolicyContext } = require('./policyService');

/**
 * Cruza los miembros actuales del servidor con el historial de voz y con las
 * politicas por rol.
 *
 * Politica base:
 *
 * - Sin registro en `voice_logs` = inactivo, sin esperar plazo. Al desplegar el
 *   bot TODOS arrancan inactivos y se van "limpiando" segun cada uno use un
 *   canal de voz. Es mas seguro partir de "inactivo" y desmarcar que asumir una
 *   actividad que el bot nunca observo.
 *
 * - EXCEPCION, recien llegados: quien se unio al servidor hace menos del plazo
 *   queda exento aunque no tenga registro de voz.
 *
 *   La referencia es `member.joinedTimestamp` (cuando entro realmente al
 *   servidor) y NO `members.first_seen` (cuando el bot lo vio por primera vez):
 *   en el arranque inicial first_seen es "hoy" para todos, asi que usarlo
 *   dejaria exento al servidor entero y desharia el marcado inicial.
 *
 * - Con registro de voz: inactivo si su ultima actividad supera su plazo.
 *
 * El plazo NO es unico: cada miembro puede tener el suyo segun sus roles (ver
 * policyService). Por eso el umbral se calcula dentro del bucle y no fuera.
 *
 * Devuelve cuatro listas para que el sincronizador sepa a quien poner el rol
 * (`inactive`) y a quien quitarselo (el resto).
 */
function evaluateGuildInactivity(guild, overrideDays = null) {
  const context = buildPolicyContext(guild);
  const voiceLogs = repository.getVoiceLogsMap(guild.id);
  const firstSeen = repository.getMembersFirstSeenMap(guild.id);
  const now = Date.now();

  const inactive = [];
  const active = [];
  const newMembers = [];
  const exempt = [];

  for (const member of guild.members.cache.values()) {
    if (member.user.bot) continue;

    const policy = context.forMember(member);

    if (policy.exempt) {
      exempt.push({ member, policy, lastActivity: null, source: 'admin' });
      continue;
    }

    // Un umbral pasado por comando pisa el de la politica, para poder simular
    // "que pasaria si el plazo fuese N" sin cambiar la configuracion.
    const days = overrideDays ?? policy.days;
    const threshold = now - days * 24 * 60 * 60 * 1000;

    const lastVoiceActivity = voiceLogs.get(member.id);

    if (lastVoiceActivity === undefined) {
      const joinedAt = member.joinedTimestamp;

      // Periodo de gracia. Si joinedTimestamp no esta disponible (caso raro) se
      // trata como miembro antiguo, que es lo conservador y coherente con el
      // marcado inicial.
      if (joinedAt && joinedAt >= threshold) {
        newMembers.push({ member, policy, lastActivity: joinedAt, source: 'grace_period' });
        continue;
      }

      inactive.push({
        member,
        policy,
        lastActivity: firstSeen.get(member.id) ?? null,
        source: 'never_voice',
      });
      continue;
    }

    if (lastVoiceActivity < threshold) {
      inactive.push({ member, policy, lastActivity: lastVoiceActivity, source: 'voice' });
    } else {
      active.push({ member, policy, lastActivity: lastVoiceActivity, source: 'voice' });
    }
  }

  inactive.sort((a, b) => (a.lastActivity ?? 0) - (b.lastActivity ?? 0));

  return { inactive, active, newMembers, exempt };
}

module.exports = { evaluateGuildInactivity };
