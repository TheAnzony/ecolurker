const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const config = require('../config');
const logger = require('../utils/logger');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Migracion: voice_logs.last_voice_left -> last_voice_activity.
// La columna paso a registrar tanto entradas como salidas de voz, no solo salidas.
const voiceCols = db.prepare('PRAGMA table_info(voice_logs)').all().map((c) => c.name);
if (voiceCols.includes('last_voice_left') && !voiceCols.includes('last_voice_activity')) {
  db.exec('ALTER TABLE voice_logs RENAME COLUMN last_voice_left TO last_voice_activity');
  logger.info('Migracion aplicada: voice_logs.last_voice_left -> last_voice_activity');
}

// Migracion: umbral de inactividad configurable por servidor
const settingsCols = db.prepare('PRAGMA table_info(guild_settings)').all().map((c) => c.name);
if (!settingsCols.includes('inactive_days')) {
  db.exec('ALTER TABLE guild_settings ADD COLUMN inactive_days INTEGER');
  logger.info('Migracion aplicada: guild_settings.inactive_days');
}

// Migracion: apodo legible junto al ID, para poder identificar a un miembro
// mirando la base de datos sin tener que resolver el ID en Discord.
if (!voiceCols.includes('display_name')) {
  db.exec('ALTER TABLE voice_logs ADD COLUMN display_name TEXT');
  logger.info('Migracion aplicada: voice_logs.display_name');
}

const memberCols = db.prepare('PRAGMA table_info(members)').all().map((c) => c.name);
if (!memberCols.includes('display_name')) {
  db.exec('ALTER TABLE members ADD COLUMN display_name TEXT');
  logger.info('Migracion aplicada: members.display_name');
}

// Migracion: mensaje de recuperacion en las politicas por rol
const policyCols = db.prepare('PRAGMA table_info(role_policies)').all().map((c) => c.name);
if (policyCols.length > 0 && !policyCols.includes('recovery_message')) {
  db.exec('ALTER TABLE role_policies ADD COLUMN recovery_message TEXT');
  logger.info('Migracion aplicada: role_policies.recovery_message');
}

// Migracion: contador de sesiones de voz (sin fechas individuales, solo un total)
if (!voiceCols.includes('session_count')) {
  db.exec('ALTER TABLE voice_logs ADD COLUMN session_count INTEGER NOT NULL DEFAULT 0');
  logger.info('Migracion aplicada: voice_logs.session_count');
}

// Migracion: marca de sesion cerrada por caida del bot en vez de por salida real
const sessionCols = db.prepare('PRAGMA table_info(voice_sessions)').all().map((c) => c.name);
if (sessionCols.length > 0 && !sessionCols.includes('was_estimated')) {
  db.exec('ALTER TABLE voice_sessions ADD COLUMN was_estimated INTEGER NOT NULL DEFAULT 0');
  logger.info('Migracion aplicada: voice_sessions.was_estimated');
}

// Migracion: marca de sesion reanudada al arrancar, para poder volver a unir
// los trozos en que un reinicio parte una misma estancia en el canal.
if (sessionCols.length > 0 && !sessionCols.includes('from_restart')) {
  db.exec('ALTER TABLE voice_sessions ADD COLUMN from_restart INTEGER NOT NULL DEFAULT 0');
  logger.info('Migracion aplicada: voice_sessions.from_restart');
}

// Migracion: hueco de bot caido a descontar de la duracion de una sesion reanudada
if (sessionCols.length > 0 && !sessionCols.includes('gap_ms')) {
  db.exec('ALTER TABLE voice_sessions ADD COLUMN gap_ms INTEGER NOT NULL DEFAULT 0');
  logger.info('Migracion aplicada: voice_sessions.gap_ms');
}

/** Ejecuta una correccion de datos una sola vez en la vida de la base. */
function unaVez(nombre, descripcion, fn) {
  const yaEsta = db.prepare('SELECT 1 FROM applied_migrations WHERE name = ?').get(nombre);
  if (yaEsta) return;

  const cambios = db.transaction(fn)();
  db.prepare('INSERT INTO applied_migrations (name, applied_at) VALUES (?, ?)').run(
    nombre,
    Date.now()
  );
  logger.info(`Correccion de datos aplicada: ${descripcion} (${cambios} filas)`);
}

// Ensordecerse en Discord mutea automaticamente, asi que todo el tiempo
// ensordecido se estaba sumando TAMBIEN al muteado y los dos rankings salian
// casi identicos. Ahora se capturan excluyentes; esto corrige lo ya guardado.
//
// Se puede restar porque el tiempo ensordecido estaba contenido dentro del
// muteado. El MAX(...,0) cubre los casos de sordera impuesta por un moderador
// sin mute, donde la contencion no se cumple.
unaVez('muted_sin_deafened', 'separar tiempo muteado de ensordecido', () => {
  const r = db
    .prepare('UPDATE voice_sessions SET muted_ms = MAX(muted_ms - deafened_ms, 0) WHERE deafened_ms > 0')
    .run();
  // En las sesiones aun abiertas con los dos cronometros corriendo, se para el
  // de muteado: a partir de ahora ese rato solo cuenta como ensordecido.
  db.prepare(
    'UPDATE voice_sessions SET muted_since = NULL WHERE ended_at IS NULL AND deafened_since IS NOT NULL'
  ).run();
  return r.changes;
});

// Durante un tiempo una persona podia acabar con dos sesiones abiertas a la vez
// (si se perdia su evento de salida), y al salir solo se cerraba la mas
// reciente: la vieja seguia creciendo hasta que otro evento la cerraba por
// casualidad. Asi una sesion de hora y media quedo registrada como de 25 horas.
//
// Nadie puede estar en dos canales a la vez, asi que una sesion no puede durar
// mas alla del inicio de la siguiente de esa misma persona: ese es el tope que
// se aplica. Sigue siendo una cota superior (pudo irse antes), por eso quedan
// marcadas como estimadas.
unaVez('sesiones_solapadas', 'recortar sesiones que invadian a la siguiente', () => {
  const sobrantes = db
    .prepare(
      `SELECT a.id, a.started_at, a.ended_at,
              (SELECT MIN(b.started_at) FROM voice_sessions b
                WHERE b.user_id = a.user_id AND b.guild_id = a.guild_id
                  AND b.started_at > a.started_at) AS siguiente
       FROM voice_sessions a
       WHERE a.ended_at IS NOT NULL`
    )
    .all()
    .filter((r) => r.siguiente && r.ended_at > r.siguiente);

  const recortar = db.prepare(
    `UPDATE voice_sessions SET
       ended_at      = @fin,
       was_estimated = 1,
       -- Un estado no puede haber durado mas que la propia sesion
       muted_ms      = MIN(muted_ms, @dur),
       deafened_ms   = MIN(deafened_ms, @dur),
       video_ms      = MIN(video_ms, @dur),
       streaming_ms  = MIN(streaming_ms, @dur)
     WHERE id = @id`
  );

  for (const r of sobrantes) {
    recortar.run({ id: r.id, fin: r.siguiente, dur: r.siguiente - r.started_at });
  }
  return sobrantes.length;
});

logger.info(`Base de datos lista en ${config.dbPath}`);

module.exports = db;
