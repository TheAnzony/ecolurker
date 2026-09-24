-- Ultima actividad de voz registrada de un usuario en un servidor.
-- Se actualiza tanto al entrar como al salir de un canal de voz.
CREATE TABLE IF NOT EXISTS voice_logs (
  user_id             TEXT NOT NULL,
  guild_id            TEXT NOT NULL,
  last_voice_activity INTEGER NOT NULL,
  display_name        TEXT,   -- solo para poder identificar al usuario a simple vista
  session_count       INTEGER NOT NULL DEFAULT 0,  -- veces que ha entrado a voz, sin fechas individuales
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

-- Foto del reparto de miembros en cada sincronizacion. Permite ver la evolucion
-- en el dashboard; sin esto solo se conoceria el estado actual.
CREATE TABLE IF NOT EXISTS stats_snapshots (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  taken_at INTEGER NOT NULL,
  inactive INTEGER NOT NULL,
  active   INTEGER NOT NULL,
  grace    INTEGER NOT NULL,
  exempt   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshots_guild ON stats_snapshots (guild_id, taken_at);

-- Historial de acciones sobre un miembro: tanto manuales (/moderar-inactivos)
-- como automaticas (marcado/desmarcado de @Inactivo, retirada de rol especial).
-- action: 'mark_inactive' | 'unmark_inactive' | 'strip_role' | 'role' | 'warning' | 'kick'
CREATE TABLE IF NOT EXISTS moderation_actions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  guild_id   TEXT NOT NULL,
  action     TEXT NOT NULL,
  reason     TEXT,
  created_at INTEGER NOT NULL
);

-- ============================================================================
-- MODULO RECAP (independiente del sistema de inactividad, ver docs/RECAP.md)
-- ============================================================================

-- Una fila por estancia en un canal de voz. Cambiar de canal cierra la sesion
-- y abre otra, porque las estadisticas por canal y el "duo del año" necesitan
-- saber quien coincidio con quien EN EL MISMO canal.
--
-- ended_at NULL = sesion abierta. Al arrancar el bot se descartan las que
-- quedaron abiertas de una ejecucion anterior: si el bot se cayo no hay forma
-- honesta de saber cuando salio esa persona, y se prefiere perder el dato
-- antes que inventarlo.
CREATE TABLE IF NOT EXISTS voice_sessions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id        TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  channel_id      TEXT NOT NULL,
  channel_name    TEXT,            -- copia del nombre: los canales se renombran y borran
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,

  is_afk          INTEGER NOT NULL DEFAULT 0,  -- sesion en el canal AFK del servidor
  from_move       INTEGER NOT NULL DEFAULT 0,  -- empezo por cambio de canal, no por entrada real
  from_restart    INTEGER NOT NULL DEFAULT 0,  -- la abrio el bot al arrancar: esa persona ya estaba
                                               -- dentro. No es una entrada real; permite volver a
                                               -- unir los trozos que parte un reinicio.
  joined_empty    INTEGER NOT NULL DEFAULT 0,  -- el canal estaba vacio al entrar
  left_empty      INTEGER NOT NULL DEFAULT 0,  -- el canal quedo vacio al salir

  -- Tiempo acumulado en cada estado DENTRO de esta sesion
  muted_ms        INTEGER NOT NULL DEFAULT 0,
  deafened_ms     INTEGER NOT NULL DEFAULT 0,
  video_ms        INTEGER NOT NULL DEFAULT 0,
  streaming_ms    INTEGER NOT NULL DEFAULT 0,

  -- Marca de cuando empezo el estado actual (NULL = no esta en ese estado).
  -- Al cerrar la sesion se vuelcan a los acumuladores de arriba.
  muted_since     INTEGER,
  deafened_since  INTEGER,
  video_since     INTEGER,
  streaming_since INTEGER,

  -- 1 = la sesion no se cerro con el usuario saliendo, sino que el bot murio y
  -- se cerro al ultimo latido conocido. El dato es bueno hasta ese punto, pero
  -- se marca para poder ser transparente en el recap.
  was_estimated   INTEGER NOT NULL DEFAULT 0,

  -- Tiempo que el bot estuvo caido mientras esta sesion seguia viva. Una sesion
  -- reanudada tras un reinicio corto continua en la misma fila, asi que hay que
  -- descontar el hueco para no regalar como tiempo de voz el rato que el bot
  -- no estuvo mirando.
  --
  --   DURACION REAL = ended_at - started_at - gap_ms
  --
  -- Cualquier calculo de duracion DEBE restar esta columna.
  gap_ms          INTEGER NOT NULL DEFAULT 0
);

-- Una unica fila: la ultima vez que el bot dio senales de vida. Permite cerrar
-- con honestidad las sesiones que quedaron abiertas tras una caida, en vez de
-- contar toda la caida como tiempo de voz (una noche de apagon regalaria horas
-- a quien estuviera conectado en ese momento y falsearia el ranking entero).
CREATE TABLE IF NOT EXISTS bot_heartbeat (
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  beat_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON voice_sessions (guild_id, user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_channel ON voice_sessions (guild_id, channel_id, started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_open ON voice_sessions (guild_id, ended_at);

-- Uso de los slash commands: quien ejecuto que comando y cuando. No guarda los
-- parametros con los que se invoco, solo el nombre del comando (y subcomando).
CREATE TABLE IF NOT EXISTS command_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  command    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_voice_logs_guild ON voice_logs (guild_id);
CREATE INDEX IF NOT EXISTS idx_members_guild ON members (guild_id);
CREATE INDEX IF NOT EXISTS idx_moderation_actions_guild ON moderation_actions (guild_id, created_at);
CREATE INDEX IF NOT EXISTS idx_command_log_guild ON command_log (guild_id, created_at);
