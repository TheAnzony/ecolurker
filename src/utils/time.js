const MS_DAY = 24 * 60 * 60 * 1000;

function daysAgo(days) {
  return Date.now() - days * MS_DAY;
}

function formatRelativeDays(timestamp) {
  const days = Math.floor((Date.now() - timestamp) / MS_DAY);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'hace 1 dia';
  return `hace ${days} dias`;
}

/** Fecha y hora exactas, en la zona horaria del servidor donde corre el bot. */
function formatExact(timestamp) {
  return new Date(timestamp).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

module.exports = { MS_DAY, daysAgo, formatRelativeDays, formatExact };
