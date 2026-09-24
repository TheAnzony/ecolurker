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

  deleteOpenSessions: db.prepare(`
    DELETE FROM voice_sessions WHERE ended_at IS NULL
  `),

  countOpenSessions: db.prepare(`
    SELECT COUNT(*) AS total FROM voice_sessions WHERE ended_at IS NULL
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

/**
 * Descarta las sesiones que quedaron abiertas de una ejecucion anterior.
 * Decision explicita: si el bot se cayo, no sabemos cuando salio esa persona,
 * y es preferible perder la medicion a inventarla. Devuelve cuantas se fueron.
 */
function discardOpenSessions() {
  const { total } = statements.countOpenSessions.get();
  if (total > 0) statements.deleteOpenSessions.run();
  return total;
}

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
  discardOpenSessions,
  countSessions,
  countUserSessions,
  deleteUserSessions,
};
