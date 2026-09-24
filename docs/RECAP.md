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

### El canal AFK va completamente aparte

**Regla única: el tiempo en el canal AFK solo cuenta para dos cosas.**

1. **Tiempo en AFK** — su propia categoría.
2. **Tiempo total en el servidor** — la presencia total, esté donde esté.

Queda **fuera de todo lo demás**: tiempo de voz real, sesión más larga, racha
de días, mes más activo, franja horaria, canal favorito, entradas relámpago,
tiempo muteado o ensordecido, dúo del año, más sociable, horas en solitario,
y abrir o cerrar canal.

El motivo es que ese tiempo **no es voluntario**: casi siempre viene de que
Discord aparta a alguien por inactividad. Mezclar tiempo involuntario con
estadísticas de comportamiento las vacía de sentido — el *dúo del año* se lo
llevarían dos personas dormidas en el AFK, y *el que abre el bar* quien se
quedó quieto.

Una regla de una línea, además, es mucho más difícil de romper que una tabla
de excepciones por categoría, donde cada estadística nueva obliga a acordarse.

Solo hay que medir **dos** cantidades; la tercera es su suma:

```
tiempo total en el servidor = tiempo de voz real + tiempo en AFK
```

Se cumple exactamente porque `is_afk` solo vale 0 o 1: las dos consultas
reparten todas las sesiones sin solaparse ni dejarse ninguna.

```sql
-- Tiempo de voz real (el ranking principal)
SELECT SUM(ended_at - started_at - gap_ms) FROM voice_sessions
WHERE user_id = ? AND is_afk = 0 AND ended_at IS NOT NULL

-- Tiempo en AFK (su categoría)
SELECT SUM(ended_at - started_at - gap_ms) FROM voice_sessions
WHERE user_id = ? AND is_afk = 1 AND ended_at IS NOT NULL
```

Además queda bien al presentarlo: *"40 horas en el servidor — 32 hablando y 8
tirado en el AFK"*.

### El estado del micro se guarda tal cual, también en el AFK

Durante un tiempo el bot forzaba `muted = true` en las sesiones de AFK. Se
quitó: eso metía una interpretación dentro del dato. Como el AFK ya no entra
en las estadísticas de muteado, no hace falta falsearlo, y guardar la realidad
mantiene la decisión reversible.

Es el mismo criterio que hizo útil a `is_afk`: **capturar lo que pasa, decidir
al calcular**.

### Las sesiones interrumpidas se conservan, no se pierden

Si el bot se para con gente dentro de un canal, esas sesiones quedan abiertas
(`ended_at NULL`). Hay dos caminos según cómo se haya parado:

**Apagado ordenado** (`docker compose restart`, `stop`, `up -d`): Docker manda
`SIGTERM` y da unos segundos de margen. El bot lo aprovecha para cerrar todas
las sesiones abiertas **con la hora exacta**. No se pierde ni se inventa nada.
Es el caso habitual.

**Caída brusca** (corte de luz, `kill`, cuelgue): no hay aviso previo. Al
arrancar de nuevo, esas sesiones se cierran **en el último latido conocido** y
se marcan con `was_estimated = 1`.

El bot escribe un latido en `bot_heartbeat` cada minuto. Eso acota la pérdida
a 60 segundos como mucho por caída.

> **Por qué no se cierran simplemente "al arrancar de nuevo"**: eso contaría
> toda la caída como tiempo de voz. Con 11 personas conectadas y un apagón
> nocturno de 10 horas, cada una se llevaría +10 horas por el azar de estar en
> voz en ese momento — una sola noche generaría más horas que un mes de uso
> real y el ranking anual lo ganaría quien tuvo mala suerte. El latido evita
> eso conservando el dato real hasta donde se conoce.

> **Detalle de implementación**: el latido se escribe **después** de abrir las
> sesiones al arrancar, no antes. Si se escribiera primero quedaría por delante
> de ellas, y una caída en el primer minuto las cerraría con duración cero al
> no poder terminar antes de empezar.

Al arrancar, el bot también empieza a contar a quien ya estuviera conectado,
de modo que no haya que esperar a que se mueva.

### Un reinicio no parte una sesión en dos

Si el bot vuelve **en menos de una hora** y la persona sigue en el **mismo
canal**, se entiende que nunca se fue: se continúa su sesión anterior en la
misma fila en vez de abrir una nueva. Una estancia de 2 horas partida por un
reinicio a los 10 minutos sigue contando como una sesión de 2 horas.

Pasada la hora, o si volvió a otro canal, se considera una estancia distinta y
se abre una sesión nueva (marcada con `from_restart`, porque tampoco fue una
entrada real: esa persona ya estaba dentro).

**El tiempo que el bot estuvo caído no cuenta.** Se acumula en `gap_ms` y se
descuenta:

```
DURACION REAL = ended_at - started_at - gap_ms
```

> **Cualquier cálculo de duración debe restar `gap_ms`.** Si no, una sesión
> reanudada regala como tiempo de voz el rato que el bot no estuvo mirando.

Sin esto, las estadísticas afectadas por los reinicios serían:

| Estadística | Sin reanudar | Con reanudación |
|---|---|---|
| Horas totales | Correcta (la suma cuadra) | Correcta |
| Sesión más larga | **Truncada** por cada reinicio | Correcta |
| Entradas relámpago (*yo-yo*) | **Inflada**: cada reinicio añade una entrada falsa | Correcta |
| *El que abre el bar* | **Falseada**: quien esté solo al reiniciar figura como que abrió el canal | Correcta |

El límite de una hora es un compromiso: lo bastante largo para cubrir
reinicios y cortes de luz, lo bastante corto para no unir la sesión de anoche
con la de esta mañana. Si alguien sale y vuelve al mismo canal durante la
caída, se contará como si no se hubiera ido — es el precio de no perder el
dato, y para un recap entre amigos compensa.

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
