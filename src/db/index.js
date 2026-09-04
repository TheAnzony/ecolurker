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

logger.info(`Base de datos lista en ${config.dbPath}`);

module.exports = db;
