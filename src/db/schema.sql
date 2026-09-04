-- Ultima actividad de voz registrada de un usuario en un servidor.
-- Se actualiza tanto al entrar como al salir de un canal de voz.
CREATE TABLE IF NOT EXISTS voice_logs (
  user_id             TEXT NOT NULL,
  guild_id            TEXT NOT NULL,
  last_voice_activity INTEGER NOT NULL,
  display_name        TEXT,   -- solo para poder identificar al usuario a simple vista
  PRIMARY KEY (user_id, guild_id)
);

-- Configuracion por servidor. Cada servidor puede tener su propio umbral de
-- inactividad; si inactive_days es NULL se usa DEFAULT_INACTIVE_DAYS del .env.
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id         TEXT PRIMARY KEY,
  inactive_role_id TEXT,
  inactive_days    INTEGER
);

-- Primera vez que el bot "vio" a un miembro en el servidor. Sirve de referencia
-- de inactividad para quienes nunca han pasado por un canal de voz.
CREATE TABLE IF NOT EXISTS members (
  user_id      TEXT NOT NULL,
  guild_id     TEXT NOT NULL,
  first_seen   INTEGER NOT NULL,
  display_name TEXT,   -- apodo actual en el servidor, para identificarlo a simple vista
  PRIMARY KEY (user_id, guild_id)
);

-- Politicas especificas por rol. Permiten que ciertos roles se traten distinto:
-- plazo propio, quedar exentos del marcado, o perder el rol al quedar inactivos.
CREATE TABLE IF NOT EXISTS role_policies (
  guild_id      TEXT NOT NULL,
  role_id       TEXT NOT NULL,
  inactive_days INTEGER,            -- NULL = usar el umbral del servidor
  mark_inactive INTEGER NOT NULL DEFAULT 1,  -- 0 = nunca recibe @Inactivo
  strip_role    INTEGER NOT NULL DEFAULT 0,  -- 1 = pierde ESTE rol al quedar inactivo
  recovery_message TEXT,                     -- como recuperar el rol (se envia por MD)
  PRIMARY KEY (guild_id, role_id)
);

-- Historial de acciones de moderacion aplicadas por /moderar-inactivos
CREATE TABLE IF NOT EXISTS moderation_actions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  guild_id   TEXT NOT NULL,
  action     TEXT NOT NULL,
  reason     TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_voice_logs_guild ON voice_logs (guild_id);
CREATE INDEX IF NOT EXISTS idx_members_guild ON members (guild_id);
