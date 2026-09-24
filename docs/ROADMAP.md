# Roadmap / mejoras futuras

Estado actual: en producción, marcando y desmarcando el rol `@Inactivo` de
forma automática, sin expulsiones. Ideas para siguientes iteraciones:

## Recap anual: fases pendientes

La captura de sesiones ya funciona (ver [RECAP.md](RECAP.md)). Falta:

**Cálculo de estadísticas** — horas totales, sesión más larga, racha de días,
mes más activo, franja horaria, tiempo muteado/ensordecido/con cámara,
entradas relámpago, dúo del año (asimétrico: el tuyo puede no tener el mismo
que tú), persona con más gente distinta, más horas en solitario, quién abre y
quién cierra los canales, canal favorito, y los totales del servidor.

**Comando `/recap [año]`** — el primero que podrá usar cualquier miembro, no
solo administradores. Requiere abrir una excepción explícita en el guardia
centralizado de `events/interactionCreate.js`, no desactivarlo. Se activa y
desactiva con un comando de administrador, y arranca apagado.

**Comando de anuncio** — publica en el canal donde se ejecuta que el recap ya
está disponible y que se consulta con `/recap`. Se descartó el envío masivo
por MD: mandar 126 mensajes directos es el patrón que Discord marca como spam.

**Panel web del recap** — página propia, separada del panel de inactividad.

## Período de gracia independiente del umbral

Hoy el margen que se da a un recién llegado es exactamente el mismo que el
umbral de inactividad (2 semanas por defecto). Separarlos en dos valores
(`grace_days` aparte de `inactive_days` en `guild_settings`) permitiría, por
ejemplo, un umbral largo con un margen de bienvenida corto, o al revés.

## Panel web con escritura y acceso remoto

Hoy el panel es de solo lectura y solo accesible en local, a propósito. Darle
capacidad de configurar, o abrirlo al staff, exigiría antes login con OAuth2 de
Discord, comprobar que quien entra es admin del servidor, HTTPS y gestión de
sesiones. Es un salto de complejidad grande: solo merece la pena si el staff
va a usarlo de verdad. Mientras tanto, el túnel SSH cubre el acceso remoto.

## Intervalo de sincronización configurable por servidor

`inactive_days` ya vive en `guild_settings` y se ajusta con `/configurar`.
`SYNC_INTERVAL_HOURS` sigue siendo global en el `.env`, porque el temporizador
es único para todo el proceso. Hacerlo por servidor requeriría un scheduler
por guild en vez de un solo `setInterval`.

## Paginación en `/inactivos`

Actualmente se truncan los resultados a 40 miembros en un solo embed. Con
servidores grandes conviene paginar con botones (`ActionRowBuilder` +
`ButtonBuilder`) o exportar la lista completa como archivo adjunto.

## Canal de auditoría en Discord

Ya se guarda todo lo que hace el bot (`moderation_actions`) y quién ejecuta
qué comando (`command_log`), consultable desde el panel web o con
`src/tools/auditoria.js`. Lo que falta es la parte "empujada": publicar cada
evento en un canal de logs configurable (`AUDIT_CHANNEL_ID`) para que el staff
lo vea sin tener que entrar a mirarlo. Útil sobre todo para las retiradas de
rol especial, que afectan a gente de golpe y hoy solo se notan si alguien
consulta el registro.

## Rate limiting en lotes grandes

`roleSyncService` y `moderationService` iteran secuencialmente, lo que ya
evita ráfagas agresivas (discord.js encola y respeta los rate limits). En
servidores de miles de miembros convendría además un límite máximo de
acciones por pasada para que una sincronización no se alargue horas.

## Tests automatizados

No hay suite de tests todavía. `inactivityService.evaluateGuildInactivity`
es lógica pura y la pieza más valiosa de cubrir: mockeando `repository` y un
`guild` falso se pueden fijar los casos límite de la política ("sin registro
= inactivo", umbral exacto, bots ignorados) para que no se rompan sin querer.

## Internacionalización

Todos los textos están en español, hardcodeados. Si el servidor tiene
miembros de otros idiomas, extraer los strings a un diccionario simple
(`es.json`, `en.json`) sería el siguiente paso natural.

## Reintegración de miembros

Si un miembro se va y vuelve, hoy empieza "de cero" (`guildMemberRemove`
borra sus filas de `voice_logs` y `members`). Si se quisiera distinguir
"nuevo miembro" de "miembro readmitido", `moderation_actions` sí conserva su
historial y podría consultarse antes de tratarlo como nuevo.

## Aviso previo antes de marcar

Enviar un MD unos días antes de aplicar el rol ("te quedan 3 días de
inactividad") daría margen a reaccionar. Requiere una tabla de avisos
enviados para no repetirlos en cada sincronización.
