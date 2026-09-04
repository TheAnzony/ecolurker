const { REST, Routes } = require('discord.js');
const config = require('./config');
const loadCommands = require('./handlers/loadCommands');
const logger = require('./utils/logger');

async function main() {
  const commands = loadCommands();
  const body = commands.map((command) => command.data.toJSON());

  const rest = new REST().setToken(config.token);

  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);

  logger.info(
    `Registrando ${body.length} comando(s) ${config.guildId ? `en el servidor ${config.guildId}` : 'globalmente'}...`
  );

  await rest.put(route, { body });

  logger.info('Comandos registrados correctamente.');
}

main().catch((err) => {
  logger.error('Fallo al registrar comandos:', err);
  process.exit(1);
});
