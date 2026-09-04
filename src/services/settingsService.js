const repository = require('../db/repository');
const config = require('../config');

const MIN_DAYS = 1;
const MAX_DAYS = 365;

/**
 * Umbral de inactividad efectivo de un servidor: el configurado con
 * /configurar si existe, y si no el valor por defecto del .env.
 *
 * Se resuelve por servidor (no global) para que el bot pueda estar en varios
 * servidores con politicas distintas sin reiniciar nada.
 */
function getInactiveDays(guildId) {
  return repository.getStoredInactiveDays(guildId) ?? config.defaultInactiveDays;
}

function setInactiveDays(guildId, days) {
  if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) {
    throw new Error(`El umbral debe ser un numero entero entre ${MIN_DAYS} y ${MAX_DAYS} dias.`);
  }
  repository.setInactiveDays(guildId, days);
}

function isCustomised(guildId) {
  return repository.getStoredInactiveDays(guildId) !== null;
}

module.exports = { getInactiveDays, setInactiveDays, isCustomised, MIN_DAYS, MAX_DAYS };
