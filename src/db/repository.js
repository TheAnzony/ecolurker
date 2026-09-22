const db = require('./index');

const statements = {
  // isJoin (0/1): solo suma al contador de sesiones en una entrada real a voz
  // (vease events/voiceStateUpdate.js). Cambiar de canal o salir actualiza la
  // fecha pero no cuenta como sesion nueva.
  upsertVoiceActivity: db.prepare(`
    INSERT INTO voice_logs (user_id, guild_id, last_voice_activity, display_name, session_count)
    VALUES (@userId, @guildId, @timestamp, @displayName, @isJoin)
    ON CONFLICT (user_id, guild_id)
    DO UPDATE SET last_voice_activity = excluded.last_voice_activity,
                  display_name        = excluded.display_name,
                  session_count       = session_count + @isJoin
  `),

  getVoiceLog: db.prepare(`
    SELECT last_voice_activity AS lastVoiceActivity, session_count AS sessionCount
    FROM voice_logs
    WHERE user_id = @userId AND guild_id = @guildId
  `),

  getAllVoiceLogsForGuild: db.prepare(`
    SELECT user_id AS userId, last_voice_activity AS lastVoiceActivity
    FROM voice_logs
    WHERE guild_id = @guildId
  `),

  getSessionCounts: db.prepare(`
    SELECT user_id AS userId, session_count AS sessionCount
    FROM voice_logs
    WHERE guild_id = @guildId
  `),

  // Propaga los apodos de `members` a `voice_logs`. Sin esto, una fila de
  // voice_logs solo recibiria nombre la proxima vez que esa persona usara voz,
  // y las antiguas se quedarian con el apodo desactualizado.
  syncVoiceLogNames: db.prepare(`
    UPDATE voice_logs
    SET display_name = (
      SELECT m.display_name FROM members m
      WHERE m.user_id = voice_logs.user_id AND m.guild_id = voice_logs.guild_id
    )
    WHERE guild_id = @guildId
      AND EXISTS (
        SELECT 1 FROM members m
        WHERE m.user_id = voice_logs.user_id AND m.guild_id = voice_logs.guild_id
      )
  `),

  getGuildSettings: db.prepare(`
    SELECT inactive_role_id AS inactiveRoleId, inactive_days AS inactiveDays
    FROM guild_settings
    WHERE guild_id = @guildId
  `),

  upsertInactiveRoleId: db.prepare(`
    INSERT INTO guild_settings (guild_id, inactive_role_id)
    VALUES (@guildId, @roleId)
    ON CONFLICT (guild_id)
    DO UPDATE SET inactive_role_id = excluded.inactive_role_id
  `),

  upsertInactiveDays: db.prepare(`
    INSERT INTO guild_settings (guild_id, inactive_days)
    VALUES (@guildId, @days)
    ON CONFLICT (guild_id)
    DO UPDATE SET inactive_days = excluded.inactive_days
  `),

  // first_seen NO se toca en el UPDATE: debe conservar siempre la primera
  // observacion. El apodo si se refresca, porque cambia con el tiempo.
  upsertMember: db.prepare(`
    INSERT INTO members (user_id, guild_id, first_seen, display_name)
    VALUES (@userId, @guildId, @timestamp, @displayName)
    ON CONFLICT (user_id, guild_id)
    DO UPDATE SET display_name = excluded.display_name
  `),

  getAllMembersForGuild: db.prepare(`
    SELECT user_id AS userId, first_seen AS firstSeen
    FROM members
    WHERE guild_id = @guildId
  `),

  getMemberDisplayName: db.prepare(`
    SELECT display_name AS displayName
    FROM members
    WHERE guild_id = @guildId AND user_id = @userId
  `),

  deleteMember: db.prepare(`
    DELETE FROM members WHERE user_id = @userId AND guild_id = @guildId
  `),

  deleteVoiceLog: db.prepare(`
    DELETE FROM voice_logs WHERE user_id = @userId AND guild_id = @guildId
  `),

  getRolePolicies: db.prepare(`
    SELECT role_id AS roleId, inactive_days AS inactiveDays,
           mark_inactive AS markInactive, strip_role AS stripRole,
           recovery_message AS recoveryMessage
    FROM role_policies
    WHERE guild_id = @guildId
  `),

  upsertRolePolicy: db.prepare(`
    INSERT INTO role_policies
      (guild_id, role_id, inactive_days, mark_inactive, strip_role, recovery_message)
    VALUES
      (@guildId, @roleId, @inactiveDays, @markInactive, @stripRole, @recoveryMessage)
    ON CONFLICT (guild_id, role_id) DO UPDATE SET
      inactive_days    = excluded.inactive_days,
      mark_inactive    = excluded.mark_inactive,
      strip_role       = excluded.strip_role,
      recovery_message = excluded.recovery_message
  `),

  deleteRolePolicy: db.prepare(`
    DELETE FROM role_policies WHERE guild_id = @guildId AND role_id = @roleId
  `),

  insertSnapshot: db.prepare(`
    INSERT INTO stats_snapshots (guild_id, taken_at, inactive, active, grace, exempt)
    VALUES (@guildId, @takenAt, @inactive, @active, @grace, @exempt)
  `),

  getSnapshots: db.prepare(`
    SELECT taken_at AS takenAt, inactive, active, grace, exempt
    FROM stats_snapshots
    WHERE guild_id = @guildId AND taken_at >= @since
    ORDER BY taken_at
  `),

  insertModerationAction: db.prepare(`
    INSERT INTO moderation_actions (user_id, guild_id, action, reason, created_at)
    VALUES (@userId, @guildId, @action, @reason, @timestamp)
  `),

  getRecentModerationActions: db.prepare(`
    SELECT user_id AS userId, action, reason, created_at AS createdAt
    FROM moderation_actions
    WHERE guild_id = @guildId
    ORDER BY created_at DESC
    LIMIT @limit
  `),

  insertCommandUsage: db.prepare(`
    INSERT INTO command_log (guild_id, user_id, command, created_at)
    VALUES (@guildId, @userId, @command, @timestamp)
  `),

  getRecentCommandUsage: db.prepare(`
    SELECT user_id AS userId, command, created_at AS createdAt
    FROM command_log
    WHERE guild_id = @guildId
    ORDER BY created_at DESC
    LIMIT @limit
  `),
};

function recordVoiceActivity(userId, guildId, displayName = null, timestamp = Date.now(), isJoin = false) {
  statements.upsertVoiceActivity.run({ userId, guildId, displayName, timestamp, isJoin: isJoin ? 1 : 0 });
}

function getLastVoiceActivity(userId, guildId) {
  const row = statements.getVoiceLog.get({ userId, guildId });
  return row ? row.lastVoiceActivity : null;
}

function getVoiceLogsMap(guildId) {
  const rows = statements.getAllVoiceLogsForGuild.all({ guildId });
  return new Map(rows.map((row) => [row.userId, row.lastVoiceActivity]));
}

/** Solo el contador de sesiones, sin fechas individuales por sesion. */
function getSessionCountsMap(guildId) {
  const rows = statements.getSessionCounts.all({ guildId });
  return new Map(rows.map((row) => [row.userId, row.sessionCount]));
}

function getInactiveRoleId(guildId) {
  const row = statements.getGuildSettings.get({ guildId });
  return row ? row.inactiveRoleId : null;
}

function setInactiveRoleId(guildId, roleId) {
  statements.upsertInactiveRoleId.run({ guildId, roleId });
}

function getStoredInactiveDays(guildId) {
  const row = statements.getGuildSettings.get({ guildId });
  return row?.inactiveDays ?? null;
}

function setInactiveDays(guildId, days) {
  statements.upsertInactiveDays.run({ guildId, days });
}

function recordMemberFirstSeen(userId, guildId, displayName = null, timestamp = Date.now()) {
  statements.upsertMember.run({ userId, guildId, displayName, timestamp });
}

/**
 * Refresca de golpe los apodos de una lista de miembros. Se llama en cada
 * sincronizacion para que los nombres guardados no envejezcan.
 * En una sola transaccion: son cientos de escrituras triviales.
 */
const refreshDisplayNames = db.transaction((entries, guildId) => {
  for (const entry of entries) {
    statements.upsertMember.run(entry);
  }
  if (guildId) statements.syncVoiceLogNames.run({ guildId });
});

function getMembersFirstSeenMap(guildId) {
  const rows = statements.getAllMembersForGuild.all({ guildId });
  return new Map(rows.map((row) => [row.userId, row.firstSeen]));
}

/** Para mostrar quien es alguien en un log, aunque ya no este en el servidor. */
function getMemberDisplayName(guildId, userId) {
  return statements.getMemberDisplayName.get({ guildId, userId })?.displayName ?? null;
}

function forgetMember(userId, guildId) {
  statements.deleteMember.run({ userId, guildId });
  statements.deleteVoiceLog.run({ userId, guildId });
}

function getRolePolicies(guildId) {
  const rows = statements.getRolePolicies.all({ guildId });
  return rows.map((row) => ({
    roleId: row.roleId,
    inactiveDays: row.inactiveDays,
    // SQLite guarda los booleanos como 0/1
    markInactive: row.markInactive === 1,
    stripRole: row.stripRole === 1,
    recoveryMessage: row.recoveryMessage,
  }));
}

function setRolePolicy(guildId, roleId, { inactiveDays, markInactive, stripRole, recoveryMessage }) {
  statements.upsertRolePolicy.run({
    guildId,
    roleId,
    inactiveDays: inactiveDays ?? null,
    markInactive: markInactive ? 1 : 0,
    stripRole: stripRole ? 1 : 0,
    recoveryMessage: recoveryMessage ?? null,
  });
}

function deleteRolePolicy(guildId, roleId) {
  return statements.deleteRolePolicy.run({ guildId, roleId }).changes > 0;
}

function recordSnapshot(guildId, counts, takenAt = Date.now()) {
  statements.insertSnapshot.run({ guildId, takenAt, ...counts });
}

function getSnapshots(guildId, sinceDays = 30) {
  const since = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  return statements.getSnapshots.all({ guildId, since });
}

function logModerationAction(userId, guildId, action, reason, timestamp = Date.now()) {
  statements.insertModerationAction.run({ userId, guildId, action, reason: reason ?? null, timestamp });
}

function getRecentModerationActions(guildId, limit = 20) {
  return statements.getRecentModerationActions.all({ guildId, limit });
}

function logCommandUsage(guildId, userId, command, timestamp = Date.now()) {
  statements.insertCommandUsage.run({ guildId, userId, command, timestamp });
}

function getRecentCommandUsage(guildId, limit = 20) {
  return statements.getRecentCommandUsage.all({ guildId, limit });
}

module.exports = {
  recordVoiceActivity,
  getLastVoiceActivity,
  getVoiceLogsMap,
  getSessionCountsMap,
  getInactiveRoleId,
  setInactiveRoleId,
  getStoredInactiveDays,
  setInactiveDays,
  getRolePolicies,
  setRolePolicy,
  deleteRolePolicy,
  recordSnapshot,
  getSnapshots,
  recordMemberFirstSeen,
  refreshDisplayNames,
  getMembersFirstSeenMap,
  getMemberDisplayName,
  forgetMember,
  logModerationAction,
  getRecentModerationActions,
  logCommandUsage,
  getRecentCommandUsage,
};
