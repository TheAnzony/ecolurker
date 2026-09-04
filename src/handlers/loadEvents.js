const fs = require('node:fs');
const path = require('node:path');
const logger = require('../utils/logger');

function loadEvents(client) {
  const eventsDir = path.join(__dirname, '..', 'events');

  for (const file of fs.readdirSync(eventsDir).filter((f) => f.endsWith('.js'))) {
    const event = require(path.join(eventsDir, file));
    if (!event?.name || !event?.execute) {
      logger.warn(`El archivo de evento ${file} no exporta { name, execute }, se omite.`);
      continue;
    }

    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args));
    } else {
      client.on(event.name, (...args) => event.execute(...args));
    }
  }
}

module.exports = loadEvents;
