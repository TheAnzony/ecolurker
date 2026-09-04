const { Events } = require('discord.js');
const logger = require('../utils/logger');
const { initializeGuild } = require('../services/guildSetupService');

module.exports = {
  name: Events.GuildCreate,
  once: false,
  async execute(guild) {
    logger.info(`Aniadido a un servidor nuevo: "${guild.name}" (${guild.id})`);

    try {
      // Mismo camino que al arrancar: crea el rol Inactivo y marca a quien
      // corresponda, sin que nadie tenga que configurar nada.
      await initializeGuild(guild);
    } catch (err) {
      logger.error(`Fallo la configuracion inicial de "${guild.name}":`, err.message);
    }
  },
};
