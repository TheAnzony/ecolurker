# Base de datos

SQLite, un único archivo (`DB_PATH`, por defecto `./data/bot.db`), modo
`WAL`. Esquema definido en [`src/db/schema.sql`](../src/db/schema.sql) y
aplicado automáticamente al arrancar (`CREATE TABLE IF NOT EXISTS`, no
requiere herramienta de migraciones).

## Tablas

### `voice_logs`

Última actividad de voz de cada usuario, por servidor.

| Columna | Tipo | Descripción |
|---|---|---|
| `user_id` | TEXT | ID de Discord del usuario |
| `guild_id` | TEXT | ID de Discord del servidor |
| `last_voice_activity` | INTEGER | Timestamp en milisegundos (`Date.now()`) |
| `display_name` | TEXT | Apodo en el servidor, **solo para poder identificar a alguien de un vistazo** |

`PRIMARY KEY (user_id, guild_id)`. Se actualiza con `UPSERT` en cada evento
`voiceStateUpdate`, tanto al entrar como al salir de un canal.

> **Nota de migración**: esta columna se llamaba `last_voice_left` y solo
> registraba salidas. `db/index.js` aplica un `ALTER TABLE RENAME COLUMN`
> automático en bases de datos antiguas.

**La ausencia de fila aquí significa "inactivo"**, salvo que el miembro lleve
poco tiempo en el servidor (período de gracia, calculado con
`member.joinedTimestamp` de Discord, no con datos de esta base). Ver
[ARCHITECTURE.md](ARCHITECTURE.md#política-de-inactividad-inactivo-por-defecto).

### `guild_settings`

Configuración por servidor, para no depender del `.env` (que es global a toda
la instancia del bot).

| Columna | Tipo | Descripción |
|---|---|---|
| `guild_id` | TEXT | ID del servidor (PK) |
| `inactive_role_id` | TEXT | ID del rol `@Inactivo` que el bot resolvió o creó |
| `inactive_days` | INTEGER | Umbral fijado con `/configurar`. `NULL` = usar `DEFAULT_INACTIVE_DAYS` |

`services/settingsService.js` resuelve el valor efectivo; el resto del código
nunca lee el umbral directamente de `config`.

### `stats_snapshots`

Una fila por sincronización con el reparto de miembros en ese momento. Es lo
que alimenta la gráfica de evolución del [panel web](DASHBOARD.md).

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | INTEGER | Autoincremental |
| `guild_id` | TEXT | Servidor |
| `taken_at` | INTEGER | Timestamp en milisegundos |
| `inactive` / `active` / `grace` / `exempt` | INTEGER | Cuántos miembros había en cada estado |

A una medición por hora son unas 8.800 filas al año por servidor: irrelevante
para SQLite. Es la única tabla que crece con el tiempo en vez de tener una fila
por miembro.

### `role_policies`

Trato especial para roles concretos. Ver
[ARCHITECTURE.md](ARCHITECTURE.md#políticas-por-rol).

| Columna | Tipo | Descripción |
|---|---|---|
| `guild_id` | TEXT | Servidor |
| `role_id` | TEXT | Rol al que aplica |
| `inactive_days` | INTEGER | Plazo propio. `NULL` = usar el del servidor |
| `mark_inactive` | INTEGER | `0` = nunca recibe `@Inactivo` |
| `strip_role` | INTEGER | `1` = pierde este rol al quedar inactivo |
| `recovery_message` | TEXT | Cómo recuperarlo; se envía por MD al perderlo |

`PRIMARY KEY (guild_id, role_id)`. Los booleanos se guardan como `0`/`1`
porque SQLite no tiene tipo booleano; `repository.js` los convierte.

### `members`

Primera vez que el bot observó a un miembro en el servidor. **No** decide
quién es inactivo; solo se usa como fecha de referencia informativa al listar.

| Columna | Tipo | Descripción |
|---|---|---|
| `user_id` | TEXT | ID de Discord del usuario |
| `guild_id` | TEXT | ID de Discord del servidor |
| `first_seen` | INTEGER | Timestamp en milisegundos de la primera observación |
| `display_name` | TEXT | Apodo actual en el servidor |

`PRIMARY KEY (user_id, guild_id)`. Se inserta con `ON CONFLICT DO NOTHING`
para que el valor nunca se sobrescriba una vez fijado. Se puebla desde:


- `services/guildSetupService.js`: registra a todos los miembros actuales, al
  arrancar el bot y al ser añadido a un servidor nuevo.
- `events/guildMemberAdd.js`: registra a cada nuevo miembro al unirse.

## Sobre `display_name`

El apodo se guarda **solo como etiqueta legible**: sirve para saber quién es
alguien al mirar la base de datos, sin tener que resolver su ID en Discord. El
`user_id` sigue siendo el dato autoritativo; nada de la lógica del bot depende
del nombre.

Se refresca en cada sincronización (por defecto cada hora), así que sigue los
cambios de apodo con poco retraso. Los apodos se propagan de `members` a
`voice_logs` en la misma transacción, para que una fila antigua de `voice_logs`
no se quede con un nombre viejo hasta que esa persona vuelva a usar voz.

Las migraciones de esquema se aplican solas en `db/index.js` al arrancar
(`ALTER TABLE` idempotentes tras comprobar `PRAGMA table_info`), así que
actualizar el bot sobre una base de datos existente no requiere ningún paso
manual.

### `moderation_actions`

Auditoría de acciones puntuales: las manuales de `/moderar-inactivos` y las
retiradas automáticas de roles especiales (`strip_role`).

El marcado/desmarcado de `@Inactivo` **no** se registra aquí: sería mucho ruido
y su estado real siempre es consultable en Discord mirando quién tiene el rol.
Retirar un rol de privilegio sí se registra, porque es una acción poco
frecuente y con consecuencias para el usuario.

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | INTEGER | Autoincremental |
| `user_id` | TEXT | Miembro afectado |
| `guild_id` | TEXT | Servidor |
| `action` | TEXT | `role` \| `warning` \| `kick` \| `strip_role` |
| `reason` | TEXT | Detalle opcional (p. ej. ID del rol asignado) |
| `created_at` | INTEGER | Timestamp en milisegundos |

## Limpieza de datos

Cuando un miembro abandona el servidor (`guildMemberRemove`), sus filas en
`voice_logs` y `members` se eliminan (`repository.forgetMember`) para no
acumular datos de usuarios que ya no están. El historial en
`moderation_actions` **no** se borra: es un log de auditoría y debe
sobrevivir a la salida del usuario.

## Backups

Al ser un único archivo, un backup es tan simple como copiar `data/bot.db`
(y sus archivos `-wal`/`-shm` si existen) con el bot detenido, o usar
`sqlite3 data/bot.db ".backup data/backup.db"` en caliente.
