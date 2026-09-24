const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const logger = require('../utils/logger');
const { buildPayload } = require('./data');
const { resumenGeneral } = require('../services/recap/stats');

const PUBLIC = path.join(__dirname, 'public');

const PAGINAS = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/recap': 'recap.html',
  '/recap.html': 'recap.html',
};

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

/**
 * Sirve un archivo de `public/`. El nombre nunca viene del usuario sin filtrar:
 * o sale de PAGINAS, o se comprueba que el resultado siga dentro de la carpeta,
 * para que un `../` no pueda sacar archivos de fuera.
 */
function servirArchivo(res, nombre) {
  const destino = path.join(PUBLIC, nombre);
  if (!destino.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403).end('Prohibido');
    return;
  }
  if (!fs.existsSync(destino)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
    return;
  }
  res.writeHead(200, {
    'Content-Type': TIPOS[path.extname(destino)] || 'text/plain',
    // Sin esto el navegador se queda con la version vieja de la pagina tras
    // actualizar el bot, y el panel parece no haber cambiado.
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(destino).pipe(res);
}

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

      if (PAGINAS[url.pathname]) {
        servirArchivo(res, PAGINAS[url.pathname]);
        return;
      }

      if (url.pathname === '/estilo.css') {
        servirArchivo(res, 'estilo.css');
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

      if (url.pathname === '/api/recap') {
        const guild = client.guilds.cache.first();
        if (!guild) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'El bot no esta en ningun servidor' }));
          return;
        }
        const anio = Number(url.searchParams.get('anio')) || new Date().getFullYear();
        const payload = resumenGeneral(guild.id, anio);
        payload.servidor = { nombre: guild.name, icono: guild.iconURL({ size: 128 }) };
        payload.recapActivo = config.recapEnabled;
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
