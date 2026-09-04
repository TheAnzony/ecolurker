const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config');
const loadCommands = require('./handlers/loadCommands');
const loadEvents = require('./handlers/loadEvents');
const logger = require('./utils/logger');

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

client.login(config.token);
