# Configuración inicial

## 1. Crear la aplicación en el Discord Developer Portal

1. Ir a https://discord.com/developers/applications y pulsar **New Application**.
2. En la pestaña **Bot**, pulsar **Add Bot** (o ya viene creado por defecto).
3. Copiar el **Token** del bot — se usará como `DISCORD_TOKEN`. Tratarlo como
   un secreto: nunca commitear el `.env`.
4. En la pestaña **General Information**, copiar el **Application ID** — se
   usará como `CLIENT_ID`.

## 2. Activar los Privileged Gateway Intents

En la pestaña **Bot**, sección **Privileged Gateway Intents**, activar:

- **Server Members Intent** — obligatorio. Sin él, `GatewayIntentBits.GuildMembers`
  no funciona y el bot no puede listar ni sincronizar miembros del servidor.

`Presence Intent` y `Message Content Intent` **no** son necesarios para este
bot (no lee mensajes ni presencia).

Los intents que el bot solicita en el código (`src/index.js`) son:

- `Guilds` — necesario para operar con el cache de servidores/canales.
- `GuildVoiceStates` — necesario para recibir `voiceStateUpdate` y detectar
  cuándo un usuario sale de un canal de voz.
- `GuildMembers` — necesario para listar todos los miembros del servidor y
  detectar altas/bajas (`guildMemberAdd` / `guildMemberRemove`).

## 3. Invitar el bot al servidor

En la pestaña **OAuth2 > URL Generator**:

- **Scopes**: `bot`, `applications.commands`
- **Bot Permissions**:
  - `View Channels`
  - `Send Messages`
  - `Manage Roles` — **obligatorio**. El bot crea el rol `@Inactivo` si no
    existe y lo añade/quita automáticamente.
  - `Kick Members` — opcional, solo si algún día se habilita `ALLOW_KICK`.

> **Jerarquía de roles**: en Ajustes del servidor → Roles, el rol del bot debe
> quedar **por encima** de `@Inactivo`. Discord no permite que un bot asigne
> un rol que esté a su mismo nivel o por encima. Si el bot crea el rol él
> mismo, queda correctamente por debajo; si lo creas tú a mano, revisa el
> orden.

Abrir la URL generada y seleccionar el servidor.

Al entrar a un servidor nuevo el bot se configura solo: crea el rol
`Inactivo`, registra a los miembros y aplica el marcado inicial. No hay que
ejecutar ningún comando de configuración.

## 4. Variables de entorno

Copiar `.env.example` a `.env` y completar:

```bash
cp .env.example .env
```

| Variable | Obligatoria | Descripción |
|---|---|---|
| `DISCORD_TOKEN` | Sí | Token del bot (paso 1) |
| `CLIENT_ID` | Sí | Application ID (paso 1) |
| `GUILD_ID` | No | Si se define, los slash commands se registran solo en ese servidor (instantáneo, ideal para desarrollo). Si se omite, el registro es global y tarda hasta 1 hora en propagarse |
| `DB_PATH` | No | Ruta del archivo SQLite. Por defecto `./data/bot.db` |
| `DEFAULT_INACTIVE_DAYS` | No | Días sin voz tras los que se marca inactivo (por defecto 14). Es solo el valor inicial: cada servidor puede cambiarlo con `/configurar` |
| `SYNC_INTERVAL_HOURS` | No | Cada cuántas horas se re-sincroniza el rol (por defecto 1) |
| `INACTIVE_ROLE_ID` | No | ID del rol `@Inactivo`. Si se deja vacío, el bot busca uno llamado `Inactivo`, lo crea si no existe, y guarda su ID en la base de datos |
| `ALLOW_KICK` | No | `false` por defecto. Mientras no sea `true`, la acción `expulsar` se rechaza aunque se confirme |
| `INACTIVE_WARNING_MESSAGE` | No | Texto del MD enviado por la acción `aviso` |

## 5. Registrar los slash commands

Cada vez que se agregue o modifique un comando, hay que re-registrarlo:

```bash
# Docker
docker compose run --rm bot npm run deploy

# Local
npm run deploy
```

## 6. Levantar el bot

```bash
docker compose up -d
docker compose logs -f
```
