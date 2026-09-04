const { Events } = require('discord.js');
const config = require('../config');
const logger = require('../utils/logger');
const { initializeGuild } = require('../services/guildSetupService');
const { syncAllGuilds } = require('../services/roleSyncService');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    logger.info(`Sesion iniciada como ${client.user.tag}`);

    for (const guild of client.guilds.cache.values()) {
      try {
        await initializeGuild(guild);
      } catch (err) {
        logger.error(`Fallo al inicializar "${guild.name}":`, err.message);
      }
    }

    const intervalMs = config.syncIntervalHours * 60 * 60 * 1000;
    setInterval(() => {
      syncAllGuilds(client).catch((err) =>
        logger.error('Fallo la sincronizacion periodica:', err.message)
      );
    }, intervalMs);

    logger.info(`Sincronizacion de rol programada cada ${config.syncIntervalHours}h`);
  },
};
