# Ecolurker

Bot de Discord que detecta la inactividad en canales de voz y mantiene un rol
`@Inactivo` sincronizado automáticamente, corriendo contenerizado con Docker.

La imagen y el contenedor Docker se llaman `ecolurker`, igual que el bot.

## Cómo se comporta

- **Todos empiezan inactivos.** Quien no tenga actividad de voz registrada se
  marca como inactivo. La lista se depura sola conforme la gente use los
  canales de voz.
- **Salvo los recién llegados.** Quien lleve menos del plazo en el servidor
  queda exento: se le da el mismo margen que a todos antes de marcarlo.
- **Marca y desmarca solo.** El bot añade el rol `@Inactivo` a quien lleve
  **2 semanas** sin voz, y se lo quita **al instante** en cuanto detecta que
  esa persona entra a un canal. Además revisa todo el servidor cada hora, así
  que el rol cae muy cerca del momento en que se cumple el plazo.
- **El plazo se ajusta con `/configurar dias`**, por servidor y sin reiniciar
  nada.
- **Los administradores quedan exentos** automáticamente, sin configurar nada.
- **Roles con trato especial.** Con `/configurar rol` se le da a un rol su
  propio plazo, se le exime del marcado, o se hace que **pierda ese rol** al
  quedar inactivo — en cuyo caso el bot avisa por MD explicando por qué y cómo
  recuperarlo. Estas políticas **siempre las crea una persona**: el bot no
  configura ninguna por su cuenta, en ningún servidor.
- **No expulsa a nadie.** La sincronización automática solo toca el rol.
  Las expulsiones están bloqueadas por `ALLOW_KICK=false` y, aun
  habilitándolas, requieren ejecutar un comando a mano con confirmación.
- **Se autoconfigura en cualquier servidor.** Al añadirlo a uno nuevo, crea el
  rol `Inactivo`, registra a los miembros y aplica el marcado inicial él solo.
  No hay que configurar `INACTIVE_ROLE_ID` ni ejecutar ningún comando.

## Stack

- Node.js 20 + [discord.js](https://discord.js.org/) v14
- SQLite local vía [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3)
- Docker / Docker Compose para el despliegue

## Documentación

| Documento | Contenido |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | Configurar la app en el Discord Developer Portal, intents, invitar el bot, variables de entorno |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Estructura del proyecto, flujo de datos, decisiones de diseño |
| [docs/DATABASE.md](docs/DATABASE.md) | Esquema SQLite, tablas y su ciclo de vida |
| [docs/COMMANDS.md](docs/COMMANDS.md) | Referencia de los slash commands |
| [docs/OPERATION.md](docs/OPERATION.md) | Operación diaria: ajustar el umbral, revertir, backups, troubleshooting |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Migrar el bot a un VPS para tenerlo 24/7 |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Casos pendientes y mejoras futuras |

## Quick start (Docker)

```bash
cp .env.example .env
# completar DISCORD_TOKEN, CLIENT_ID, (GUILD_ID opcional) en .env
docker compose build
docker compose run --rm bot npm run deploy   # registra los slash commands
docker compose up -d
```

Ver logs:

```bash
docker compose logs -f
```

La base de datos SQLite persiste en `./data/bot.db` en el host (montada como
volumen), por lo que sobrevive a reconstrucciones del contenedor.

## Desarrollo local (sin Docker)

Requiere Node.js >= 20 y las herramientas de compilación nativas de tu SO
(better-sqlite3 compila un binding nativo si no hay un prebuild disponible
para tu versión de Node). En Windows esto normalmente significa tener
Python 3 instalado y accesible en el PATH (`npm install --global windows-build-tools`
o instalar Python + Visual Studio Build Tools manualmente); en Linux/macOS
basta con `python3`, `make` y un compilador de C++. Si `npm install` falla
por esto, la alternativa más simple es usar directamente Docker (sección
anterior), que ya trae todo lo necesario en la imagen.

```bash
npm install
cp .env.example .env
npm run deploy
npm run dev
```

## Estructura del proyecto

```
src/
  commands/     Slash commands (/configurar, /inactivos, /sincronizar-roles, /moderar-inactivos)
  events/       Listeners de discord.js (voiceStateUpdate, ready, ...)
  handlers/     Carga dinámica de comandos y eventos
  services/     Lógica de negocio (inactividad, rol, sincronización, moderación)
  db/           Conexión SQLite, esquema y capa de acceso a datos
  tools/        Utilidades de terminal (consulta.js)
  config.js     Lectura y validación de variables de entorno
  index.js      Punto de entrada del bot
  deploy-commands.js   Script para registrar los slash commands en Discord
data/           Volumen persistente para la base de datos (Docker)
```

Detalle completo en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
