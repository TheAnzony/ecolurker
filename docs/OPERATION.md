# Operación diaria

## Qué esperar los primeros días

Al desplegar, el bot marcó a **todos** los miembros humanos con `@Inactivo`.
Eso es lo esperado, no un error: la política es "inactivo por defecto" (ver
[ARCHITECTURE.md](ARCHITECTURE.md#política-de-inactividad-inactivo-por-defecto)).

Excepción: los miembros que llevaban menos del plazo en el servidor quedan
exentos y no reciben el rol.

A partir de ahí, cada vez que alguien entre a un canal de voz el bot le quita
el rol en segundos. La lista de inactivos se va depurando sola. Después de
una o dos semanas, quienes sigan con el rol son con bastante confianza gente
que realmente no usa la voz del servidor.

Para ver el estado en cualquier momento:

```
/inactivos
```

## Ajustar el umbral de días

Lo normal es hacerlo **desde Discord**, sin tocar archivos ni reiniciar:

```
/configurar dias dias:21
```

El valor se guarda por servidor en la base de datos y se aplica al momento.
Para ver la configuración vigente, `/configurar ver`.

Para dar trato especial a un rol concreto (plazo propio, eximirlo, o que pierda
ese rol al quedar inactivo), ver `/configurar rol` en
[COMMANDS.md](COMMANDS.md#configurar-rol-rolrol-dias-marcar-retirar-mensaje).

Probar un umbral puntual sin guardarlo:

```
/inactivos dias:60
/sincronizar-roles dias:60
```

`DEFAULT_INACTIVE_DAYS` en el `.env` solo define el valor inicial para
servidores que nunca hayan usado `/configurar`. Si lo cambias, aplica con
`docker compose up -d` (no hace falta reconstruir la imagen).

## Revertir: quitar el rol a todo el mundo

Si quieres deshacer el marcado masivo, la vía más rápida es borrar el rol
`@Inactivo` desde Ajustes del servidor → Roles → Eliminar. Discord lo retira
de todos sus miembros de golpe.

Luego, si quieres que el bot deje de recrearlo, párale antes:

```bash
docker compose down
```

Si lo dejas corriendo, volverá a crear el rol y a marcar en la siguiente
sincronización. Para conservar el bot pero sin marcado automático, sube
mucho `SYNC_INTERVAL_HOURS` o para el contenedor.

## Añadir el bot a otro servidor

No requiere ninguna preparación: usa la misma URL de invitación de
[SETUP.md](SETUP.md#3-invitar-el-bot-al-servidor). Al entrar, el bot crea el
rol `Inactivo`, registra a los miembros y aplica el marcado inicial por su
cuenta, con el umbral por defecto de 2 semanas. Ajústalo allí con
`/configurar dias` si ese servidor necesita otra política — la
configuración es independiente por servidor.

Recuerda registrar los slash commands también para ese servidor, o hacer el
registro global dejando `GUILD_ID` vacío en el `.env`.

## ¿Y si pongo o quito el rol a mano?

**El bot es la fuente de la verdad, no tú.** Si asignas `@Inactivo` a mano a
alguien que el bot considera activo, se lo quitará: en cuanto esa persona entre
a un canal de voz (segundos), o como muy tarde en la siguiente pasada horaria.
Al revés funciona igual: si se lo quitas a alguien realmente inactivo, se lo
volverá a poner en la siguiente pasada.

El marcado manual solo "aguanta" si coincide con lo que el bot habría decidido,
en cuyo caso era innecesario.

Si quieres que alguien no lleve nunca el rol, la vía correcta es una política:

```
/configurar rol rol:@ElRolQueTenga marcar:false
```

Los administradores ya están exentos automáticamente.

## ¿Comprueba la inactividad cada vez que alguien entra a voz?

No exactamente, y la diferencia importa:

- **Al entrar/salir/cambiar de canal de voz**: el bot anota la actividad y le
  **quita** `@Inactivo` si lo llevaba. No re-evalúa nada más, porque estar en
  voz ya significa "activo" por definición. Es inmediato.
- **Cada hora**: ahí sí re-evalúa a todo el servidor y decide a quién poner y
  quitar el rol.

O sea: **quitar** el rol es instantáneo, **ponerlo** ocurre en la pasada
horaria. Es la asimetría correcta — nadie se queda marcado injustamente
mientras está usando el servidor.

Ojo: volver a voz **no devuelve** un rol especial retirado (ver
`retirar` en [COMMANDS.md](COMMANDS.md)). Eso es deliberado: recuperar un rol de
privilegio es decisión humana, y el MD que recibe la persona explica a quién
pedirlo.

## Ver qué está pasando

```bash
docker compose logs -f
```

Líneas relevantes:

- `Sync de rol en "...": N marcados, M desmarcados, S roles retirados, K
  fallidos (umbral D dias | X inactivos, Y activos, Z en gracia, E exentos)` —
  resultado de cada pasada, al arrancar y cada `SYNC_INTERVAL_HOURS`.
- `Rol Inactivo retirado a <usuario> por actividad de voz` — desmarcado
  inmediato al detectar a alguien en voz.
- `Rol "<X>" retirado a <usuario> por inactividad` — retirada de un rol
  especial (política con `retirar:true`).

## Consultar la base de datos

Resumen y quién ha usado la voz, con apodos en vez de IDs:

```bash
docker compose exec -T bot node src/tools/consulta.js
```

Buscar a alguien por su apodo (no distingue mayúsculas, busca por partes):

```bash
docker compose exec -T bot node src/tools/consulta.js fernando
```

Devuelve su ID, desde cuándo lo conoce el bot, su última actividad de voz y
cuántas sesiones lleva.

> Existe esta herramienta en vez de documentar comandos SQL sueltos porque
> escribir SQL con comillas anidadas en PowerShell falla constantemente por el
> escapado.

## Ver el registro de actividad (comandos y acciones del bot)

Quién ha usado qué comando y cuándo, más las acciones automáticas del bot
(marcar/desmarcar `@Inactivo`, retirar un rol especial):

```bash
docker compose exec -T bot node src/tools/auditoria.js
```

Solo una de las dos partes, y con más de 20 resultados:

```bash
docker compose exec -T bot node src/tools/auditoria.js comandos 50
docker compose exec -T bot node src/tools/auditoria.js acciones 50
```

Lo mismo se ve mezclado en orden cronológico en el panel web, sección
"Actividad reciente".

## Backups

La base vive en `./data/bot.db` (bind mount, sobrevive a `docker compose down`
y a reconstrucciones de la imagen). Para una copia en caliente, con el bot
funcionando:

```bash
docker compose exec -T bot node src/tools/backup.js
```

Deja un `data/backup-<fecha>.db` consistente. **No copies `bot.db` a pelo**: con
el modo WAL, parte de los datos recientes están en `bot.db-wal` y una copia
simple puede quedar incompleta.

Para llevarte el bot a un servidor 24/7, ver [DEPLOY.md](DEPLOY.md).

## Troubleshooting

**El bot no marca a nadie / "no se pudo resolver el rol Inactivo"**

Falta el permiso `Gestionar roles`, o el rol `@Inactivo` está por encima del
rol del bot en la jerarquía. En Ajustes → Roles, arrastra el rol del bot
(`Ecolurker`) por encima de `@Inactivo`. El log lo avisa explícitamente.

**"No puedo retirar @X porque está por encima de mi rol"**

Para que `retirar:true` funcione sobre un rol, el rol del bot tiene que estar
**por encima** de ese rol en Ajustes → Roles. Poner `@Inactivo` sí funciona
(está abajo del todo), pero *quitar* un rol de privilegio requiere que el bot
esté por encima de él.

La solución es arrastrar el rol del bot hacia arriba, por encima de todos los
roles sobre los que quieras que pueda actuar. El comando comprueba esto antes
de guardar, así que no llega a quedar una política rota.

**"Request with opcode 8 was rate limited"**

Rate limit del gateway por pedir la lista de miembros demasiadas veces
seguidas. `utils/members.js` evita el caso normal reutilizando la caché; si
aparece, espera el tiempo indicado y reintenta con `/sincronizar-roles`.

**Algunos miembros salen como "fallidos" en el sync**

Normalmente son miembros con un rol por encima del rol del bot: Discord no
permite modificarlos. Es esperable con administradores y moderadores.

**Los comandos no aparecen en Discord**

Vuelve a registrarlos y reinicia:

```bash
docker compose run --rm bot npm run deploy
```

Con `GUILD_ID` definido en el `.env` el registro es instantáneo; sin él es
global y tarda hasta 1 hora.
