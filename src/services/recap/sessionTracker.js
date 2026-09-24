const config = require('../../config');
const logger = require('../../utils/logger');
const recapRepository = require('../../db/recapRepository');

/**
 * Captura de sesiones de voz para el recap anual.
 *
 * Cada estancia en un canal es una sesion. Cambiar de canal cierra una y abre
 * otra: las estadisticas por canal y el "duo del año" necesitan saber quien
 * coincidio con quien en el MISMO canal, y una sesion que abarcase varios
 * canales no permitiria calcularlo.
 *
 * Todo lo de aqui es puramente observacional: no toca roles, no envia mensajes
 * y no altera el sistema de inactividad. Si falla, falla solo (ver el try/catch
 * de events/voiceStateUpdate.js).
 */

/** El canal AFK cuenta como tiempo muteado, pero queda marcado aparte. */
function esCanalAfk(guild, channelId) {
  return Boolean(guild.afkChannelId && channelId === guild.afkChannelId);
}

/**
 * Estado "de micro" de un miembro. Mutearse a uno mismo y que te mutee un
 * moderador cuentan igual: a efectos de estadistica, no estaba hablando.
 *
 * En el canal AFK se considera muteado siempre, tal y como se decidio: quien
 * esta ahi no participa aunque tenga el micro abierto.
 */
function leerEstado(voiceState, enAfk) {
  return {
    muted: enAfk || voiceState.selfMute || voiceState.serverMute || false,
    deafened: voiceState.selfDeaf || voiceState.serverDeaf || false,
    video: voiceState.selfVideo || false,
    streaming: voiceState.streaming || false,
  };
}

/** Cuenta humanos en un canal, ignorando bots. */
function humanosEn(channel, excluirId = null) {
  if (!channel) return 0;
  return channel.members.filter((m) => !m.user.bot && m.id !== excluirId).size;
}

function abrirSesion(member, voiceState, { fromMove }) {
  const channel = voiceState.channel;
  if (!channel) return;

  const guild = member.guild;
  const enAfk = esCanalAfk(guild, channel.id);

  recapRepository.openSession({
    guildId: guild.id,
    userId: member.id,
    channelId: channel.id,
    channelName: channel.name,
    startedAt: Date.now(),
    isAfk: enAfk,
    fromMove,
    // Al entrar, el canal estaba vacio si el unico humano es el que acaba de entrar
    joinedEmpty: humanosEn(channel, member.id) === 0,
    ...leerEstado(voiceState, enAfk),
  });
}

function cerrarSesion(guildId, userId, canalQueDeja, userIdQueSale) {
  const sesion = recapRepository.getOpenSession(guildId, userId);
  if (!sesion) return;

  // Al salir, deja el canal vacio si no queda ningun humano aparte de el mismo
  const dejaVacio = humanosEn(canalQueDeja, userIdQueSale) === 0;
  recapRepository.closeSession(sesion, Date.now(), dejaVacio);
}

/**
 * Punto de entrada unico: recibe la transicion de estado de voz y decide.
 *
 * Los cuatro casos posibles:
 *   fuera -> canal    : entrada real
 *   canal -> fuera    : salida
 *   canal A -> canal B: cierra en A, abre en B (marcada como movimiento)
 *   canal -> mismo    : cambio de mute/sordera/camara/pantalla
 */
function handleVoiceStateUpdate(oldState, newState) {
  if (!config.recapEnabled) return;

  const member = newState.member ?? oldState.member;
  if (!member || member.user.bot) return;

  const guildId = (newState.guild ?? oldState.guild).id;
  const antes = oldState.channelId;
  const ahora = newState.channelId;

  if (!antes && ahora) {
    abrirSesion(member, newState, { fromMove: false });
    return;
  }

  if (antes && !ahora) {
    cerrarSesion(guildId, member.id, oldState.channel, member.id);
    return;
  }

  if (antes && ahora && antes !== ahora) {
    cerrarSesion(guildId, member.id, oldState.channel, member.id);
    abrirSesion(member, newState, { fromMove: true });
    return;
  }

  // Sigue en el mismo canal: solo ha cambiado su estado de micro/camara
  const sesion = recapRepository.getOpenSession(guildId, member.id);
  if (!sesion) return;

  const enAfk = esCanalAfk(member.guild, ahora);
  recapRepository.applyStateChange(sesion, leerEstado(newState, enAfk), Date.now());
}

/**
 * Al arrancar: descarta lo que quedo a medias y empieza a contar a quien ya
 * estuviera conectado.
 *
 * Sin esto, quien llevase horas en un canal antes del arranque no se contaria
 * hasta que se moviera, y las sesiones de la ejecucion anterior quedarian
 * abiertas para siempre falseando las consultas.
 */
function initializeTracking(client) {
  if (!config.recapEnabled) {
    logger.info('Captura de sesiones de voz desactivada (RECAP_ENABLED=false)');
    return;
  }

  const descartadas = recapRepository.discardOpenSessions();
  if (descartadas > 0) {
    logger.warn(
      `Descartadas ${descartadas} sesion(es) de voz sin cerrar de la ejecucion anterior ` +
        '(no se puede saber cuando terminaron)'
    );
  }

  let reanudadas = 0;
  for (const guild of client.guilds.cache.values()) {
    for (const voiceState of guild.voiceStates.cache.values()) {
      const member = voiceState.member;
      if (!member || member.user.bot || !voiceState.channelId) continue;
      abrirSesion(member, voiceState, { fromMove: false });
      reanudadas += 1;
    }
  }

  logger.info(
    `Captura de sesiones activa. ${reanudadas} persona(s) ya estaban en voz al arrancar`
  );
}

module.exports = { handleVoiceStateUpdate, initializeTracking };
