# Arquitectura

## Capas

```
events / commands  ->  services  ->  db/repository  ->  db (SQLite)
```

- **`events/`** y **`commands/`** son los puntos de entrada: reaccionan a
  eventos de Discord o a interacciones de usuario. No contienen lógica de
  negocio, solo orquestan.
- **`services/`** contiene la lógica de negocio:
  - `inactivityService.js` cruza los miembros actuales del servidor con el
    historial guardado y decide quién está inactivo y quién activo.
  - `roleService.js` resuelve (o crea) el rol `@Inactivo` del servidor.
  - `roleSyncService.js` marca y desmarca ese rol automáticamente.
  - `settingsService.js` resuelve el umbral de días efectivo de cada servidor.
  - `policyService.js` resuelve qué política aplica a cada miembro según sus
    roles (y exime a los administradores).
  - `notificationService.js` avisa por MD al retirar un rol especial.
  - `guildSetupService.js` deja un servidor listo para operar (registrar
    miembros + crear rol + marcar), sin configuración manual.
  - `moderationService.js` aplica una acción manual (rol / aviso / expulsión)
    sobre una lista de miembros inactivos, vía `/moderar-inactivos`.
- **`db/repository.js`** es la única capa que conoce SQL. Expone funciones
  con nombres de dominio (`recordVoiceActivity`, `getVoiceLogsMap`, ...) en vez de
  exponer el objeto `Database` crudo al resto del código.
- **`db/index.js`** abre la conexión SQLite, aplica `PRAGMA journal_mode=WAL`
  (mejor concurrencia lectura/escritura) y ejecuta `schema.sql` de forma
  idempotente (`CREATE TABLE IF NOT EXISTS`) en cada arranque.
- **`handlers/`** cargan dinámicamente todo lo que hay en `commands/` y
  `events/` para que agregar un comando o evento nuevo sea solo "crear el
  archivo", sin tocar `index.js`.
- **`dashboard/`** es un panel web de solo lectura que corre en el mismo
  proceso. Consume el mismo `evaluateGuildInactivity` que el sincronizador, así
  que no puede desviarse de lo que el bot hace de verdad. Ver
  [DASHBOARD.md](DASHBOARD.md).

## Flujo de datos: detección de inactividad

1. Un usuario entra, cambia de canal o sale de un canal de voz → discord.js
   emite `voiceStateUpdate`.
2. `events/voiceStateUpdate.js` llama a
   `repository.recordVoiceActivity(userId, guildId, Date.now())` y acto seguido
   le retira el rol `@Inactivo` si lo tenía.
3. El `UPSERT` en `voice_logs` guarda el timestamp en milisegundos de la
   última actividad de voz.
4. `inactivityService.evaluateGuildInactivity` recorre `guild.members.cache` y
   para cada miembro no-bot decide si está inactivo (sin registro, o registro
   más viejo que el umbral). Lo usan tanto `/inactivos` como el sincronizador
   automático de rol.

## Política de inactividad: "inactivo por defecto"

La decisión central del bot es que **la ausencia de datos cuenta como
inactividad**. Un miembro sin ninguna fila en `voice_logs` se considera
inactivo, sin necesidad de esperar a que pase ningún plazo.

Consecuencia práctica: al desplegar el bot, **todos** los miembros humanos
quedan marcados con el rol `@Inactivo`, y la lista se va depurando sola a
medida que cada persona usa un canal de voz y el bot la desmarca. El estado
converge hacia la realidad en cuestión de días, sin intervención manual.

La alternativa (asumir que todos están activos hasta demostrar lo contrario)
tendría el problema opuesto: nadie aparecería como inactivo hasta pasados
`DEFAULT_INACTIVE_DAYS`, y quien nunca use voz jamás sería detectado.
Partir de "inactivo" y desmarcar es el sentido correcto para este caso de uso,
sobre todo porque la acción asociada es reversible (poner/quitar un rol) y no
destructiva.

### Excepción: período de gracia para recién llegados

Quien se unió al servidor hace menos del umbral de días queda exento aunque
no tenga registro de voz: se le da el mismo plazo que a todos antes de
marcarlo.

La referencia es **`member.joinedTimestamp`** (cuándo entró realmente al
servidor, dato que da Discord), no `members.first_seen`. La distinción es
crítica: en el arranque inicial `first_seen` vale "hoy" para todo el mundo, así
que usarlo dejaría exento al servidor entero y desharía el marcado inicial.
`joinedTimestamp` refleja la antigüedad real y deja intactos a los miembros
veteranos.

Si `joinedTimestamp` no está disponible (caso raro), el miembro se trata como
antiguo, que es el comportamiento conservador y coherente con el marcado
inicial.

La tabla `members` guarda `first_seen` (la primera vez que el bot vio a ese
miembro, vía `guildSetupService` o `guildMemberAdd`). No decide quién es
inactivo — solo sirve como fecha de referencia informativa al listar. El
`INSERT ... ON CONFLICT DO NOTHING` garantiza que nunca se sobrescriba.

### Administradores exentos

Quien tenga `Administrator` o `Manage Server` queda fuera del sistema
automáticamente, sin configurar nada. Marcar como inactivo a quien administra
el servidor no aporta nada, y además Discord impide al bot modificar a miembros
con rol superior, así que intentarlo solo genera ruido.

Para eximir a moderadores u otros roles se usa `/configurar rol` con
`marcar:false`.

> No confundir con quién puede **usar los comandos**, que exige `Administrator`
> a secas (ver [COMMANDS.md](COMMANDS.md#quién-puede-usarlos)). La exención del
> rol es algo más amplia a propósito: incluye `Manage Server` porque el bot
> tampoco podría gestionar a esos miembros aunque quisiera.

### Políticas por rol

`services/policyService.js` resuelve, para cada miembro, qué reglas se le
aplican: plazo propio, si puede recibir `@Inactivo`, si pierde su rol especial
al quedar inactivo, y con qué mensaje se le avisa.

> **Invariante: el bot nunca crea políticas por su cuenta.** Ni al arrancar, ni
> al entrar en un servidor nuevo, ni en ninguna sincronización. La tabla
> `role_policies` solo se escribe desde `/configurar rol`, es decir, siempre por
> decisión explícita de una persona. Un servidor recién añadido arranca sin
> ninguna política, con las reglas generales para todo el mundo.
>
> Los `DEFAULT` de las columnas en `schema.sql` no contradicen esto: son los
> valores que toma una fila **cuando el comando la crea** omitiendo opciones, no
> filas que aparezcan solas.
>
> La única excepción automática es la exención de administradores, que no es una
> política guardada sino una comprobación de permisos en tiempo de ejecución
> (`policyService.isAdmin`). No hay nada que borrar ni configurar para ella.

Si un miembro tiene varios roles con política, gana el de **posición más alta**
en la jerarquía. Es la regla más predecible: coincide con cómo Discord resuelve
otros conflictos entre roles (el color, por ejemplo) y basta con mover un rol
arriba o abajo para cambiar la prioridad.

Como el plazo deja de ser único para todo el servidor, el umbral se calcula
**dentro** del bucle de miembros en `inactivityService.js`, no una sola vez
fuera de él.

### Umbral configurable por servidor

`DEFAULT_INACTIVE_DAYS` (2 semanas) es solo el valor de arranque. Cada servidor
puede fijar el suyo con `/configurar dias`, que se guarda en
`guild_settings.inactive_days`. `services/settingsService.js` resuelve el valor
efectivo (el del servidor si existe, si no el del `.env`), y todo el código
consulta esa función en vez de leer `config` directamente. Así el bot puede
operar en varios servidores con políticas distintas sin reiniciar nada.

## Marcado y desmarcado automático del rol

`services/roleSyncService.js` mantiene el rol `@Inactivo` alineado con el
estado real, en dos vías complementarias:

- **Periódica** (`SYNC_INTERVAL_HOURS`, por defecto 1h, más una pasada al
  arrancar): recalcula todo el servidor, añade el rol a quien esté inactivo y
  se lo quita a quien haya vuelto a usar voz o siga en período de gracia. Con
  el intervalo en 1h, el rol cae como mucho una hora después de cumplirse el
  plazo. Cada pasada solo hace llamadas a la API por los miembros que cambian
  de estado, así que es barata aunque corra a menudo.
- **Inmediata** (`events/voiceStateUpdate.js`): en cuanto alguien entra,
  cambia de canal o sale de voz, se le retira el rol al instante sin esperar
  al siguiente ciclo. Así el desmarcado se siente instantáneo para el usuario.

El rol se resuelve en `services/roleService.js` con este orden: `INACTIVE_ROLE_ID`
del `.env` → ID guardado en `guild_settings` → un rol existente llamado
`Inactivo` → y si no hay ninguno, **el bot lo crea** y persiste su ID. Por eso
no hace falta configurar nada a mano.

## Auto-configuración en servidores nuevos

`services/guildSetupService.js` expone `initializeGuild(guild)`, que registra a
los miembros, crea el rol y aplica el marcado inicial. Lo invocan dos caminos:

- `events/ready.js`, para cada servidor donde el bot ya está al arrancar.
- `events/guildCreate.js`, cuando alguien añade el bot a un servidor nuevo.

Que ambos usen la **misma** función es lo que garantiza que un servidor recién
añadido quede exactamente en el mismo estado que uno veterano, sin que nadie
tenga que ejecutar comandos de configuración.

### `last_voice_activity`, no `last_voice_left`

La columna registra actividad tanto al **entrar** como al **salir** de voz.
Registrar solo la salida tenía un fallo: alguien conectado a voz durante horas
que aún no ha salido no tendría registro y sería marcado como inactivo. Ver la
migración en `db/index.js`.

## Retirada de roles especiales y aviso por MD

Una política puede pedir que el miembro **pierda su rol especial** al quedar
inactivo (`retirar:true`). Cuando ocurre:

1. Se le quita el rol.
2. Se registra en `moderation_actions` (acción `strip_role`) para auditoría.
3. `services/notificationService.js` le envía un MD explicando **por qué** lo
   perdió y **cómo recuperarlo** (texto configurable por rol).

El aviso es informativo: si falla (MDs cerrados, no comparte servidores) se
registra un warning y **no se revierte** la retirada. Deshacer un cambio ya
aplicado por un fallo de notificación dejaría el estado incoherente y volvería
a intentarse en la siguiente pasada.

El bot **no devuelve** el rol automáticamente cuando la persona vuelve a usar
voz: recuperar un rol de privilegio es una decisión humana, y por eso el MD
explica a quién dirigirse. Lo único que se retira solo es `@Inactivo`.

Activar `retirar` en una política requiere `confirmar:true`, y sin él el
comando solo muestra a cuánta gente afectaría sin guardar nada. Es la misma
lógica de dry-run que `/moderar-inactivos`: toda acción masiva y difícil de
deshacer pasa por una vista previa antes de ejecutarse.

## Por qué el bot nunca expulsa

El sincronizador automático solo añade y quita un rol: ninguna acción
destructiva ocurre sin que una persona la ejecute a mano. Además,
`ALLOW_KICK` (por defecto `false`) hace que `/moderar-inactivos accion:expulsar`
se rechace aunque se confirme explícitamente, como red de seguridad frente a
una expulsión masiva accidental.

## Moderación: por qué dry-run por defecto

`/moderar-inactivos` no ejecuta ninguna acción destructiva a menos que se
pase explícitamente `confirmar: true`. Sin ese flag, el comando solo muestra
una vista previa de a quién afectaría. Esto evita expulsiones o asignaciones
de rol masivas por accidente (parámetro por defecto o mal-entendido). El
comando, como todos, solo lo pueden usar administradores (ver
[COMMANDS.md](COMMANDS.md#quién-puede-usarlos)).

Cada acción ejecutada (no en dry-run) se registra en `moderation_actions`
para dejar un historial auditable de qué se hizo y cuándo.

## Por qué SQLite + volumen Docker (y no Postgres/Mongo)

El caso de uso es de bajo volumen de escritura (un `voiceStateUpdate` por
usuario que sale de voz) y consultas simples sobre un solo servidor o unos
pocos. SQLite con `better-sqlite3` (síncrono, sin overhead de red) es
suficiente y elimina la necesidad de un servicio de base de datos aparte en
`docker-compose.yml`. El único requisito es persistir el archivo fuera del
contenedor, resuelto montando `./data` como volumen.
