const db = require('./index');

const statements = {
  upsertVoiceActivity: db.prepare(`
    INSERT INTO voice_logs (user_id, guild_id, last_voice_activity, display_name)
    VALUES (@userId, @guildId, @timestamp, @displayName)
    ON CONFLICT (user_id, guild_id)
    DO UPDATE SET last_voice_activity = excluded.last_voice_activity,
                  display_name        = excluded.display_name
  `),

  getVoiceLog: db.prepare(`
    SELECT last_voice_activity AS lastVoiceActivity
    FROM voice_logs
    WHERE user_id = @userId AND guild_id = @guildId
  `),

  getAllVoiceLogsForGuild: db.prepare(`
    SELECT user_id AS userId, last_voice_activity AS lastVoiceActivity
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

  insertModerationAction: db.prepare(`
    INSERT INTO moderation_actions (user_id, guild_id, action, reason, created_at)
    VALUES (@userId, @guildId, @action, @reason, @timestamp)
  `),
};

function recordVoiceActivity(userId, guildId, displayName = null, timestamp = Date.now()) {
  statements.upsertVoiceActivity.run({ userId, guildId, displayName, timestamp });
}

function getLastVoiceActivity(userId, guildId) {
  const row = statements.getVoiceLog.get({ userId, guildId });
  return row ? row.lastVoiceActivity : null;
}

function getVoiceLogsMap(guildId) {
  const rows = statements.getAllVoiceLogsForGuild.all({ guildId });
  return new Map(rows.map((row) => [row.userId, row.lastVoiceActivity]));
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

function logModerationAction(userId, guildId, action, reason, timestamp = Date.now()) {
  statements.insertModerationAction.run({ userId, guildId, action, reason, timestamp });
}

module.exports = {
  recordVoiceActivity,
  getLastVoiceActivity,
  getVoiceLogsMap,
  getInactiveRoleId,
  setInactiveRoleId,
  getStoredInactiveDays,
  setInactiveDays,
  getRolePolicies,
  setRolePolicy,
  deleteRolePolicy,
  recordMemberFirstSeen,
  refreshDisplayNames,
  getMembersFirstSeenMap,
  forgetMember,
  logModerationAction,
};
