const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config');
const loadCommands = require('./handlers/loadCommands');
const loadEvents = require('./handlers/loadEvents');
const logger = require('./utils/logger');
const { shutdownTracking } = require('./services/recap/sessionTracker');

require('./db');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

client.commands = loadCommands();
loadEvents(client);

process.on('unhandledRejection', (err) => {
  logger.error('Promesa rechazada sin manejar:', err);
});

/**
 * Docker manda SIGTERM antes de parar el contenedor (y da unos segundos de
 * margen). Aprovecharlo para cerrar las sesiones de voz abiertas con la hora
 * exacta hace que un reinicio voluntario no pierda ni invente nada; solo las
 * caidas bruscas tienen que recurrir al ultimo latido.
 */
let apagando = false;
function apagar(senal) {
  if (apagando) return;
  apagando = true;
  logger.info(`Recibida ${senal}, cerrando...`);

  try {
    const cerradas = shutdownTracking();
    if (cerradas > 0) logger.info(`Cerradas ${cerradas} sesion(es) de voz abiertas`);
  } catch (err) {
    logger.error('Fallo al cerrar las sesiones de voz:', err.message);
  }

  client.destroy().finally(() => process.exit(0));
}

process.on('SIGTERM', () => apagar('SIGTERM'));
process.on('SIGINT', () => apagar('SIGINT'));

client.login(config.token);
