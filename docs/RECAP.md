# Recap anual

Módulo independiente que registra la actividad en canales de voz para poder
generar estadísticas anuales por persona (horas, tiempo muteado, con quién
coincide, canal favorito...).

> **Estado**: la captura de datos está implementada y funcionando. El cálculo
> de las estadísticas, el comando `/recap` y su panel web son la siguiente
> fase — ver [ROADMAP.md](ROADMAP.md).

## Por qué es un módulo aparte

El sistema de inactividad se diseñó para guardar **lo mínimo**: una fecha por
persona. El recap necesita justo lo contrario, historial detallado. Son
filosofías opuestas, así que viven separados:

- Tablas propias (`voice_sessions`), sin mezclarse con `voice_logs`.
- Código propio (`services/recap/`, `db/recapRepository.js`).
- Interruptor propio (`RECAP_ENABLED`): apagarlo no afecta a la moderación.
- **Aislamiento de fallos**: la captura se invoca dentro de un `try/catch` en
  `events/voiceStateUpdate.js`. Un error en las estadísticas nunca puede
  impedir que el bot registre actividad o gestione roles, que es su función
  principal.

Van en el mismo bot, y no en uno aparte, porque **es el mismo dato**: ambos
consumen el evento `voiceStateUpdate`. Dos bots significarían dos conexiones
escuchando lo mismo y dos bases de datos con información de voz de la misma
gente — peor para la privacidad, no mejor.

## Qué se guarda

Una fila en `voice_sessions` por cada estancia en un canal de voz: cuándo
entró, cuándo salió, en qué canal, y cuánto tiempo pasó muteado, ensordecido,
con cámara o compartiendo pantalla. Esquema completo en
[DATABASE.md](DATABASE.md#voice_sessions).

**Cambiar de canal cierra una sesión y abre otra.** Es necesario: el "dúo del
año" y las estadísticas por canal necesitan saber quién coincidió con quién
**en el mismo canal**, y una sesión que abarcase varios canales no permitiría
calcularlo. Las sesiones que nacen de un cambio quedan marcadas (`from_move`)
para poder distinguirlas de las entradas reales.

No se guarda ningún contenido: ni mensajes, ni audio, ni quién dijo qué. Solo
presencia y estado del micrófono.

## Decisiones tomadas

### El canal AFK cuenta como tiempo muteado

Quien está en el canal AFK del servidor no participa, aunque tenga el micro
abierto. Esas sesiones se marcan con `is_afk` y su tiempo cuenta como muteado.

La marca se guarda **aparte** a propósito: permite decidir al construir los
rankings si esas horas suman al total de voz o no. Sin ella, quien se deje el
PC encendido toda la noche dominaría el ranking de horas sin haber hablado con
nadie, y no habría forma de corregirlo sin volver a capturar los datos.

### Las sesiones interrumpidas se descartan

Si el bot se cae con gente dentro de un canal, esas sesiones quedan abiertas
(`ended_at NULL`). Al arrancar se **borran**, y queda un aviso en el log con
cuántas se perdieron.

Es una decisión explícita: no hay forma honesta de saber cuándo salió esa
persona. Estimarlo daría números inventados, y se prefiere un hueco a un dato
falso.

> **Consecuencia a tener en cuenta**: las sesiones largas son las que más
> probabilidad tienen de ser interrumpidas por un reinicio, así que los
> reinicios frecuentes sesgan las cifras **a la baja y justo contra la gente
> más activa**. Cuanto más estable sea el alojamiento, más fiables las
> estadísticas — ver [DEPLOY.md](DEPLOY.md).

Al arrancar, el bot también abre sesión para quien ya estuviera conectado, de
modo que no haya que esperar a que se mueva para empezar a contarlo.

### Los datos ya no se borran solos

Antes, cuando alguien abandonaba el servidor, el bot borraba automáticamente
sus filas. Se dejó de hacer al añadir el recap: si alguien se va en noviembre,
borrar su historial dejaría huecos en las estadísticas **de los demás** (su
"dúo del año" se evaporaría). Lo mismo aplica a las expulsiones.

La purga pasa a ser manual y deliberada:

```bash
docker compose exec -T bot node src/tools/purgar.js <id-de-usuario>
```

Por defecto solo simula y muestra qué se borraría. Para ejecutarlo de verdad
hay que añadir `--confirmar`.

### Zona horaria

`docker-compose.yml` fija `TZ=Europe/Madrid`. Sin esto el contenedor corre en
UTC y las estadísticas por franja horaria, día y mes saldrían desplazadas 1-2
horas: "el club de las 3am" contaría a quien entra a la 1am real.

## Desactivarlo

```
RECAP_ENABLED=false
```

Y `docker compose up -d`. Deja de registrarse cualquier sesión nueva; lo ya
guardado se conserva. El sistema de inactividad sigue funcionando igual.
