require('dotenv').config();
const path = require('node:path');

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno obligatoria: ${name}`);
  }
  return value;
}

module.exports = {
  token: required('DISCORD_TOKEN'),
  clientId: required('CLIENT_ID'),
  guildId: process.env.GUILD_ID || null,
  dbPath: path.resolve(process.cwd(), process.env.DB_PATH || './data/bot.db'),
  // 2 semanas. Es solo el valor de arranque: cada servidor puede ajustarlo
  // con /configurar y su valor queda guardado en guild_settings.
  defaultInactiveDays: Number(process.env.DEFAULT_INACTIVE_DAYS) || 14,
  syncIntervalHours: Number(process.env.SYNC_INTERVAL_HOURS) || 1,
  inactiveRoleId: process.env.INACTIVE_ROLE_ID || null,
  // Interruptor de seguridad: mientras sea false, /moderar-inactivos rechaza
  // la accion "expulsar" aunque se confirme explicitamente.
  allowKick: process.env.ALLOW_KICK === 'true',
  inactiveWarningMessage:
    process.env.INACTIVE_WARNING_MESSAGE ||
    'No se ha detectado actividad tuya en los canales de voz del servidor durante un tiempo prolongado.',
};
