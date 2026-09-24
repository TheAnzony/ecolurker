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
| `session_count` | INTEGER | Cuántas veces ha entrado a voz (ver más abajo) |

`PRIMARY KEY (user_id, guild_id)`. Se actualiza con `UPSERT` en cada evento
`voiceStateUpdate`, tanto al entrar como al salir de un canal.

### Sobre `session_count`

Un contador, no un historial: sube en cada entrada real a voz (transición desde
"fuera de voz" a "en un canal"), pero **no guarda la fecha de cada sesión**,
solo el total acumulado. Cambiar de canal o salir no suma.

Es deliberado no guardar cada sesión con su fecha: el bot solo necesita saber
si alguien está activo, no llevar un diario detallado de sus movimientos. Un
número que sube da la misma información útil ("esta persona usa mucho la voz")
sin el coste de privacidad de un registro completo por evento.

El contador empieza en 0 al añadir esta columna: no cuenta sesiones anteriores
a esta versión del bot, porque esa información nunca se guardó.

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

Auditoría de todo lo que el bot hace sobre un miembro: tanto lo manual
(`/moderar-inactivos`) como lo automático (marcar/desmarcar `@Inactivo`,
retirar un rol especial).

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | INTEGER | Autoincremental |
| `user_id` | TEXT | Miembro afectado |
| `guild_id` | TEXT | Servidor |
| `action` | TEXT | `mark_inactive` \| `unmark_inactive` \| `strip_role` \| `role` \| `warning` \| `kick` |
| `reason` | TEXT | Detalle opcional: `sync` (pasada periódica), `voice_activity` (desmarcado inmediato), o el ID del rol afectado |
| `created_at` | INTEGER | Timestamp en milisegundos |

> **Cambio de criterio**: al principio del proyecto se decidió **no** registrar
> el marcado/desmarcado normal de `@Inactivo` aquí, para no generar ruido. Con
> el bot en uso real esa decisión resultó incómoda: una retirada de rol
> especial (`strip_role`) afectó a 14 personas en un momento dado y nadie del
> staff se enteró salvo consultando la base de datos a mano. Ahora **sí** se
> registra cada `mark_inactive`/`unmark_inactive`, porque solo ocurre en una
> transición real de estado (no en cada comprobación horaria), así que el
> volumen sigue siendo bajo.

Consultarlo desde la terminal: `docker compose exec -T bot node src/tools/auditoria.js acciones` (ver [OPERATION.md](OPERATION.md)). También aparece combinado con `command_log` en el panel web, sección "Actividad reciente".

### `voice_sessions`

Una fila por estancia en un canal de voz. Es la base del [recap
anual](RECAP.md) y la única tabla con historial detallado: el resto del bot
guarda solo estado actual.

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | INTEGER | Autoincremental |
| `guild_id` / `user_id` / `channel_id` | TEXT | Quién, dónde |
| `channel_name` | TEXT | Copia del nombre: los canales se renombran y se borran |
| `started_at` / `ended_at` | INTEGER | Timestamps. `ended_at NULL` = sesión abierta |
| `is_afk` | INTEGER | Sesión en el canal AFK del servidor |
| `from_move` | INTEGER | Empezó por cambio de canal, no por entrada real |
| `joined_empty` / `left_empty` | INTEGER | El canal estaba/quedó vacío |
| `muted_ms` / `deafened_ms` / `video_ms` / `streaming_ms` | INTEGER | Tiempo acumulado en cada estado dentro de esta sesión |
| `muted_since` / `deafened_since` / `video_since` / `streaming_since` | INTEGER | Marca de cuándo empezó el estado actual. Se vuelcan a los acumuladores al cerrar |
| `was_estimated` | INTEGER | `1` = no se cerró con el usuario saliendo, sino que el bot se cayó y se cerró en el último latido conocido |

### `bot_heartbeat`

Una única fila (`id = 1`) con la última vez que el bot dio señales de vida,
actualizada cada minuto. Permite cerrar con honestidad las sesiones que
quedaron abiertas tras una caída, en vez de contar toda la caída como tiempo
de voz. Ver [RECAP.md](RECAP.md#las-sesiones-interrumpidas-se-conservan-no-se-pierden).

Unas 18.000 filas al año con el ritmo actual (~50 entradas diarias):
irrelevante para SQLite.

Los pares de "dúo del año" **no se guardan**: se calculan cuando se pide el
recap, cruzando solapes de sesiones en el mismo canal.

### `command_log`

Quién ejecutó qué comando y cuándo. Solo administradores pueden usar los
comandos (ver [COMMANDS.md](COMMANDS.md#quién-puede-usarlos)), así que esto es
un registro de acciones de staff, no de miembros normales.

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | INTEGER | Autoincremental |
| `guild_id` | TEXT | Servidor |
| `user_id` | TEXT | Quién lo ejecutó |
| `command` | TEXT | Nombre del comando y subcomando, p. ej. `/configurar rol` |
| `created_at` | INTEGER | Timestamp en milisegundos |

**No guarda los parámetros** con los que se invocó el comando (a quién se le
cambió el plazo, qué mensaje se puso, etc.), solo qué comando fue y quién lo
usó. Se registra desde `events/interactionCreate.js`, en el único punto por el
que pasan todos los comandos, así que cualquier comando nuevo queda registrado
sin tener que acordarse.

## Limpieza de datos

**El bot no borra historial por su cuenta.** Ni cuando alguien abandona el
servidor, ni cuando se le expulsa.

Antes sí lo hacía: `guildMemberRemove` borraba las filas de `voice_logs` y
`members`. Se dejó de hacer al añadir el [recap](RECAP.md): borrar el historial
de quien se va deja huecos en las estadísticas **de los demás** — si tu "dúo
del año" abandona el servidor en noviembre, tus horas compartidas con él
desaparecerían.

La purga es manual y deliberada:

```bash
docker compose exec -T bot node src/tools/purgar.js <id-de-usuario>
```

Simula por defecto; requiere `--confirmar` para borrar de verdad. Elimina sus
sesiones de voz y sus datos de inactividad, pero **conserva
`moderation_actions` y `command_log`**: son registros de auditoría, no de
actividad personal, y deben sobrevivir para que quede constancia de lo que
hizo el bot.

## Backups

Al ser un único archivo, un backup es tan simple como copiar `data/bot.db`
(y sus archivos `-wal`/`-shm` si existen) con el bot detenido, o usar
`sqlite3 data/bot.db ".backup data/backup.db"` en caliente.
