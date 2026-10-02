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
 * Se guarda el estado REAL tambien en el canal AFK. El tiempo en AFK se trata
 * como una categoria aparte y no entra en las estadisticas de muteado, asi que
 * no hace falta falsearlo aqui: guardar la realidad mantiene la decision
 * reversible.
 */
function leerEstado(voiceState) {
  const ensordecido = voiceState.selfDeaf || voiceState.serverDeaf || false;

  return {
    // Muteado y ensordecido son EXCLUYENTES. Discord mutea automaticamente a
    // quien se ensordece, asi que contar ambos haria que el ranking de muteado
    // fuese una copia del de ensordecido (alguien tenia 1839 min "muteado" de los
    // que 1764 eran en realidad sordera).
    //
    // Con esto cada estado mide lo suyo:
    //   muteado    -> esta escuchando pero no habla  (el oyente)
    //   ensordecido-> ni habla ni escucha            (el fantasma)
    muted: (voiceState.selfMute || voiceState.serverMute || false) && !ensordecido,
    deafened: ensordecido,
    video: voiceState.selfVideo || false,
    streaming: voiceState.streaming || false,
  };
}

/** Cuenta humanos en un canal, ignorando bots. */
function humanosEn(channel, excluirId = null) {
  if (!channel) return 0;
  return channel.members.filter((m) => !m.user.bot && m.id !== excluirId).size;
}

function abrirSesion(member, voiceState, { fromMove = false, fromRestart = false } = {}) {
  const channel = voiceState.channel;
  if (!channel) return;

  const guild = member.guild;

  // Nadie puede estar en dos canales a la vez: como mucho hay UNA sesion
  // abierta por persona. Si queda otra, es que se perdio su evento de salida
  // (un corte del gateway, por ejemplo). Sin cerrarla aqui se quedaria abierta
  // acumulando horas, porque al salir solo se cierra la mas reciente: asi es
  // como una sesion de hora y media acabo registrada como de casi 25 horas.
  const huerfana = recapRepository.getOpenSession(guild.id, member.id);
  if (huerfana) {
    recapRepository.closeSession(huerfana, Date.now(), false, { estimada: true });
    logger.warn(
      `${member.user.tag} tenia una sesion sin cerrar en "${huerfana.channel_name}" ` +
        '(evento de salida perdido). Cerrada antes de abrir la nueva.'
    );
  }

  const enAfk = esCanalAfk(guild, channel.id);

  recapRepository.openSession({
    guildId: guild.id,
    userId: member.id,
    channelId: channel.id,
    channelName: channel.name,
    startedAt: Date.now(),
    isAfk: enAfk,
    fromMove,
    fromRestart,
    // Al entrar, el canal estaba vacio si el unico humano es el que acaba de entrar
    joinedEmpty: humanosEn(channel, member.id) === 0,
    ...leerEstado(voiceState),
  });
}

function cerrarSesion(guildId, userId, canalQueDeja, userIdQueSale) {
  const sesion = recapRepository.getOpenSession(guildId, userId);
  if (!sesion) return;

  // Al salir, deja el canal vacio si no queda ningun humano aparte de el mismo.
  // Vaciar el canal AFK no cuenta: nadie "apaga la luz" de un sitio al que te
  // manda Discord por estar quieto.
  const dejaVacio = sesion.is_afk ? false : humanosEn(canalQueDeja, userIdQueSale) === 0;
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

  recapRepository.applyStateChange(sesion, leerEstado(newState), Date.now());
}

/**
 * Al arrancar: descarta lo que quedo a medias y empieza a contar a quien ya
 * estuviera conectado.
 *
 * Sin esto, quien llevase horas en un canal antes del arranque no se contaria
 * hasta que se moviera, y las sesiones de la ejecucion anterior quedarian
 * abiertas para siempre falseando las consultas.
 */
const HEARTBEAT_MS = 60 * 1000;

/**
 * Si el bot vuelve antes de esto y la persona sigue en el mismo canal, se
 * entiende que nunca se fue: se retoma su sesion anterior en vez de abrir una
 * nueva, para que una estancia de 2 horas partida por un reinicio siga
 * contando como 2 horas y no como dos trozos.
 *
 * Pasado el plazo se asume que es una estancia distinta. Una hora es un
 * compromiso: lo bastante largo para cubrir reinicios y cortes de luz, lo
 * bastante corto para no unir la sesion de anoche con la de esta manana.
 */
const VENTANA_REANUDACION_MS = 60 * 60 * 1000;

function initializeTracking(client) {
  if (!config.recapEnabled) {
    logger.info('Captura de sesiones de voz desactivada (RECAP_ENABLED=false)');
    return;
  }

  const { total, cierre } = recapRepository.closeOrphanSessions();
  if (total > 0) {
    const hueco = Math.round((Date.now() - cierre) / 60000);
    logger.warn(
      `Cerradas ${total} sesion(es) que quedaron abiertas por una caida, al ultimo ` +
        `latido conocido (hace ${hueco} min). Marcadas como estimadas.`
    );
  }

  let retomadas = 0;
  let nuevas = 0;
  for (const guild of client.guilds.cache.values()) {
    for (const voiceState of guild.voiceStates.cache.values()) {
      const member = voiceState.member;
      if (!member || member.user.bot || !voiceState.channelId) continue;

      // Si seguia en el mismo canal y el bot volvio pronto, se entiende que no
      // se fue: se continua su sesion anterior en la misma fila.
      const retomada = recapRepository.resumeSession({
        guildId: guild.id,
        userId: member.id,
        channelId: voiceState.channelId,
        ventanaMs: VENTANA_REANUDACION_MS,
        estado: leerEstado(voiceState),
      });

      if (retomada) {
        retomadas += 1;
      } else {
        // Marcada como reanudada: no es una entrada real, esa persona ya estaba
        // dentro antes del reinicio, y contarla como entrada falsearia las
        // estadisticas de entradas y de quien abre los canales.
        abrirSesion(member, voiceState, { fromRestart: true });
        nuevas += 1;
      }
    }
  }
  const reanudadas = retomadas + nuevas;

  // El latido va DESPUES de abrir las sesiones, no antes: si se escribiera
  // primero quedaria por delante de ellas, y una caida en el primer minuto
  // las cerraria con duracion cero al no poder terminar antes de empezar.
  recapRepository.recordHeartbeat();
  setInterval(() => {
    try {
      const retroceso = recapRepository.recordHeartbeat();
      // Un reloj que retrocede solo o falsea duraciones. Avisar permite saber
      // que las sesiones de ese rato pueden no ser de fiar.
      if (retroceso > 5000) {
        logger.warn(
          `El reloj del sistema ha retrocedido ${Math.round(retroceso / 1000)}s. ` +
            'Las duraciones medidas en este rato pueden no ser exactas.'
        );
      }
    } catch (err) {
      logger.error('Fallo al escribir el latido:', err.message);
    }
  }, HEARTBEAT_MS).unref();

  logger.info(
    `Captura de sesiones activa. ${reanudadas} persona(s) ya estaban en voz al arrancar ` +
      `(${retomadas} continuan su sesion anterior, ${nuevas} empiezan una nueva)`
  );
}

/**
 * Cierra las sesiones abiertas de quien ya no esta en ese canal.
 *
 * Hace falta porque un evento de salida puede perderse (corte del gateway,
 * reconexion) y entonces la sesion se queda abierta creciendo sin limite. La
 * invariante de "una sesion abierta por persona" ya corrige el caso en que esa
 * persona vuelve a entrar, pero si no vuelve, nadie la cerraria.
 *
 * El momento exacto de salida es desconocido, asi que se cierra al detectarlo y
 * se marca como estimada; corriendo cada hora, el error queda acotado a eso.
 */
function reconciliarSesiones(client) {
  if (!config.recapEnabled) return 0;

  let cerradas = 0;
  for (const guild of client.guilds.cache.values()) {
    for (const sesion of recapRepository.getOpenSessionsForGuild(guild.id)) {
      const estado = guild.voiceStates.cache.get(sesion.user_id);
      const sigueAhi = estado?.channelId === sesion.channel_id;
      if (sigueAhi) continue;

      recapRepository.closeSession(sesion, Date.now(), false, { estimada: true });
      cerradas += 1;
      logger.warn(
        `Sesion huerfana cerrada: ${sesion.display_name || sesion.user_id} ya no esta en ` +
          `"${sesion.channel_name}" (se perdio su evento de salida)`
      );
    }
  }
  return cerradas;
}

/**
 * Cierre ordenado al apagar el bot. Docker manda SIGTERM antes de parar el
 * contenedor, asi que un reinicio voluntario (el caso habitual) cierra las
 * sesiones con la hora exacta y no pierde nada.
 */
function shutdownTracking() {
  if (!config.recapEnabled) return 0;

  const cerradas = recapRepository.closeAllSessionsGracefully(Date.now());
  recapRepository.recordHeartbeat();
  return cerradas;
}

module.exports = {
  handleVoiceStateUpdate,
  initializeTracking,
  reconciliarSesiones,
  shutdownTracking,
};
