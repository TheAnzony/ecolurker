const fs = require('node:fs');
const path = require('node:path');
const { Collection } = require('discord.js');
const logger = require('../utils/logger');

function loadCommands() {
  const commands = new Collection();
  const commandsDir = path.join(__dirname, '..', 'commands');

  for (const file of fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'))) {
    const command = require(path.join(commandsDir, file));
    if (!command?.data || !command?.execute) {
      logger.warn(`El archivo de comando ${file} no exporta { data, execute }, se omite.`);
      continue;
    }
    commands.set(command.data.name, command);
  }

  return commands;
}

module.exports = loadCommands;
