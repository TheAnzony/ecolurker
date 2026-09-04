const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const logger = require('../utils/logger');
const { buildPayload } = require('./data');

const INDEX = path.join(__dirname, 'public', 'index.html');

/**
 * Dashboard de solo lectura.
 *
 * Sin framework: son dos rutas (la pagina y un JSON), y una dependencia mas
 * seria peso y superficie de ataque sin ganancia.
 *
 * No expone ninguna ruta que escriba: el dashboard no puede modificar roles ni
 * configuracion, solo mostrar lo que hay. Toda la configuracion sigue pasando
 * por los slash commands.
 *
 * Escucha en 0.0.0.0 dentro del contenedor a proposito: es docker-compose quien
 * publica el puerto solo en 127.0.0.1 del host. Escuchar aqui en localhost lo
 * haria inalcanzable, porque el localhost del contenedor no es el del host.
 */
function startDashboard(client) {
  if (!config.dashboardEnabled) {
    logger.info('Dashboard desactivado (DASHBOARD_ENABLED=false)');
    return null;
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET') {
        res.writeHead(405).end('Method Not Allowed');
        return;
      }

      const url = new URL(req.url, 'http://localhost');

      if (url.pathname === '/' || url.pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(INDEX).pipe(res);
        return;
      }

      if (url.pathname === '/api/estado') {
        const payload = await buildPayload(client);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(payload));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('No encontrado');
    } catch (err) {
      logger.error('Error en el dashboard:', err);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Error interno');
    }
  });

  server.listen(config.dashboardPort, '0.0.0.0', () => {
    logger.info(`Dashboard disponible en http://localhost:${config.dashboardPort}`);
  });

  server.on('error', (err) => {
    logger.error('El dashboard no pudo arrancar:', err.message);
  });

  return server;
}

module.exports = { startDashboard };
