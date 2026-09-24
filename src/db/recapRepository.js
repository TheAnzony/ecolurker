const db = require('./index');

/**
 * Acceso a datos del modulo de recap. Separado de `repository.js` a proposito:
 * el sistema de inactividad guarda lo minimo (una fecha por persona), mientras
 * que el recap necesita historial detallado. Mantenerlos en archivos distintos
 * deja claro que dato pertenece a que funcionalidad y permite apagar el recap
 * sin tocar la moderacion.
 */

const ESTADOS = ['muted', 'deafened', 'video', 'streaming'];

const statements = {
  openSession: db.prepare(`
    INSERT INTO voice_sessions (
      guild_id, user_id, channel_id, channel_name, started_at,
      is_afk, from_move, joined_empty,
      muted_since, deafened_since, video_since, streaming_since
    ) VALUES (
      @guildId, @userId, @channelId, @channelName, @startedAt,
      @isAfk, @fromMove, @joinedEmpty,
      @mutedSince, @deafenedSince, @videoSince, @streamingSince
    )
  `),

  getOpenSession: db.prepare(`
    SELECT * FROM voice_sessions
    WHERE guild_id = @guildId AND user_id = @userId AND ended_at IS NULL
    ORDER BY started_at DESC LIMIT 1
  `),

  closeSession: db.prepare(`
    UPDATE voice_sessions SET
      ended_at        = @endedAt,
      left_empty      = @leftEmpty,
      muted_ms        = @mutedMs,
      deafened_ms     = @deafenedMs,
      video_ms        = @videoMs,
      streaming_ms    = @streamingMs,
      muted_since     = NULL,
      deafened_since  = NULL,
      video_since     = NULL,
      streaming_since = NULL
    WHERE id = @id
  `),

  updateSessionState: db.prepare(`
    UPDATE voice_sessions SET
      muted_ms        = @mutedMs,
      deafened_ms     = @deafenedMs,
      video_ms        = @videoMs,
      streaming_ms    = @streamingMs,
      muted_since     = @mutedSince,
      deafened_since  = @deafenedSince,
      video_since     = @videoSince,
      streaming_since = @streamingSince
    WHERE id = @id
  `),

  getAllOpenSessions: db.prepare(`
    SELECT * FROM voice_sessions WHERE ended_at IS NULL
  `),

  closeEstimated: db.prepare(`
    UPDATE voice_sessions SET
      ended_at        = @endedAt,
      was_estimated   = 1,
      muted_ms        = @mutedMs,
      deafened_ms     = @deafenedMs,
      video_ms        = @videoMs,
      streaming_ms    = @streamingMs,
      muted_since     = NULL,
      deafened_since  = NULL,
      video_since     = NULL,
      streaming_since = NULL
    WHERE id = @id
  `),

  getHeartbeat: db.prepare(`SELECT beat_at AS beatAt FROM bot_heartbeat WHERE id = 1`),

  setHeartbeat: db.prepare(`
    INSERT INTO bot_heartbeat (id, beat_at) VALUES (1, @beatAt)
    ON CONFLICT (id) DO UPDATE SET beat_at = excluded.beat_at
  `),

  countSessions: db.prepare(`
    SELECT COUNT(*) AS total FROM voice_sessions WHERE guild_id = @guildId
  `),

  deleteUserSessions: db.prepare(`
    DELETE FROM voice_sessions WHERE guild_id = @guildId AND user_id = @userId
  `),

  countUserSessions: db.prepare(`
    SELECT COUNT(*) AS total FROM voice_sessions WHERE guild_id = @guildId AND user_id = @userId
  `),
};

function openSession(data) {
  const now = data.startedAt;
  return statements.openSession.run({
    guildId: data.guildId,
    userId: data.userId,
    channelId: data.channelId,
    channelName: data.channelName ?? null,
    startedAt: now,
    isAfk: data.isAfk ? 1 : 0,
    fromMove: data.fromMove ? 1 : 0,
    joinedEmpty: data.joinedEmpty ? 1 : 0,
    // Si entra ya muteado (o en el canal AFK), el cronometro arranca al entrar
    mutedSince: data.muted ? now : null,
    deafenedSince: data.deafened ? now : null,
    videoSince: data.video ? now : null,
    streamingSince: data.streaming ? now : null,
  }).lastInsertRowid;
}

function getOpenSession(guildId, userId) {
  return statements.getOpenSession.get({ guildId, userId }) ?? null;
}

/**
 * Cierra los cronometros abiertos y devuelve los acumuladores finales.
 * Un estado que seguia activo al cerrar suma desde su marca hasta `at`.
 */
function flushTimers(session, at) {
  const totals = {};
  for (const estado of ESTADOS) {
    const acumulado = session[`${estado}_ms`] ?? 0;
    const desde = session[`${estado}_since`];
    totals[`${estado}Ms`] = desde ? acumulado + Math.max(0, at - desde) : acumulado;
  }
  return totals;
}

function closeSession(session, endedAt, leftEmpty = false) {
  const totals = flushTimers(session, endedAt);
  statements.closeSession.run({
    id: session.id,
    endedAt,
    leftEmpty: leftEmpty ? 1 : 0,
    mutedMs: totals.mutedMs,
    deafenedMs: totals.deafenedMs,
    videoMs: totals.videoMs,
    streamingMs: totals.streamingMs,
  });
}

/**
 * Aplica un cambio de estado (mute/sordera/camara/pantalla) a una sesion viva.
 * Los estados que se apagan vuelcan su tiempo al acumulador; los que se
 * encienden arrancan su marca.
 */
function applyStateChange(session, nuevoEstado, at) {
  const valores = { id: session.id };

  for (const estado of ESTADOS) {
    const acumulado = session[`${estado}_ms`] ?? 0;
    const desde = session[`${estado}_since`];
    const activoAhora = Boolean(nuevoEstado[estado]);

    if (desde && !activoAhora) {
      valores[`${estado}Ms`] = acumulado + Math.max(0, at - desde);
      valores[`${estado}Since`] = null;
    } else if (!desde && activoAhora) {
      valores[`${estado}Ms`] = acumulado;
      valores[`${estado}Since`] = at;
    } else {
      valores[`${estado}Ms`] = acumulado;
      valores[`${estado}Since`] = desde ?? null;
    }
  }

  statements.updateSessionState.run(valores);
}

function recordHeartbeat(at = Date.now()) {
  statements.setHeartbeat.run({ beatAt: at });
}

function getLastHeartbeat() {
  return statements.getHeartbeat.get()?.beatAt ?? null;
}

/**
 * Cierra las sesiones que quedaron abiertas de una ejecucion anterior,
 * usando el ultimo latido del bot como hora de salida.
 *
 * No se descartan: se prefiere un dato aproximado (bueno hasta el ultimo
 * minuto) a perderlo. Pero tampoco se cierran "ahora", porque eso contaria
 * toda la caida como tiempo de voz: una noche de apagon regalaria horas a
 * quien estuviera conectado en ese momento y volveria el ranking una loteria.
 *
 * Quedan marcadas con `was_estimated` para poder decirlo en el recap.
 */
const closeOrphanSessions = db.transaction(() => {
  const abiertas = statements.getAllOpenSessions.all();
  if (abiertas.length === 0) return { total: 0, cierre: null };

  // Sin latido previo (primera ejecucion con esta funcion) se usa "ahora":
  // no hay informacion mejor disponible.
  const cierre = getLastHeartbeat() ?? Date.now();

  for (const sesion of abiertas) {
    // Nunca antes de empezar: si el latido es mas viejo que la sesion, la
    // sesion dura cero en vez de un negativo.
    const endedAt = Math.max(sesion.started_at, cierre);
    const totals = flushTimers(sesion, endedAt);
    statements.closeEstimated.run({
      id: sesion.id,
      endedAt,
      mutedMs: totals.mutedMs,
      deafenedMs: totals.deafenedMs,
      videoMs: totals.videoMs,
      streamingMs: totals.streamingMs,
    });
  }

  return { total: abiertas.length, cierre };
});

/**
 * Cierre limpio al apagar el bot: las sesiones se cierran con la hora exacta,
 * sin estimar. Docker manda SIGTERM antes de parar el contenedor, asi que un
 * reinicio voluntario no pierde ni un segundo.
 */
const closeAllSessionsGracefully = db.transaction((at = Date.now()) => {
  const abiertas = statements.getAllOpenSessions.all();
  for (const sesion of abiertas) {
    const totals = flushTimers(sesion, at);
    statements.closeSession.run({
      id: sesion.id,
      endedAt: at,
      leftEmpty: 0,
      mutedMs: totals.mutedMs,
      deafenedMs: totals.deafenedMs,
      videoMs: totals.videoMs,
      streamingMs: totals.streamingMs,
    });
  }
  return abiertas.length;
});

function countSessions(guildId) {
  return statements.countSessions.get({ guildId }).total;
}

function countUserSessions(guildId, userId) {
  return statements.countUserSessions.get({ guildId, userId }).total;
}

/** Purga manual: el bot nunca borra historial por su cuenta. */
function deleteUserSessions(guildId, userId) {
  return statements.deleteUserSessions.run({ guildId, userId }).changes;
}

module.exports = {
  openSession,
  getOpenSession,
  closeSession,
  applyStateChange,
  closeOrphanSessions,
  closeAllSessionsGracefully,
  recordHeartbeat,
  getLastHeartbeat,
  countSessions,
  countUserSessions,
  deleteUserSessions,
};
