# Panel web

Panel de **solo lectura** para ver de un vistazo el estado del servidor: quién
está inactivo, desde cuándo, y cómo evoluciona el reparto con el tiempo.

## Abrirlo

Con el bot corriendo, en la máquina donde esté:

```
http://localhost:3000
```

No hace falta arrancar nada aparte: el panel vive dentro del mismo proceso del
bot y se levanta solo al iniciar sesión en Discord.

## Qué muestra

- **Contadores** de inactivos, activos, en gracia y exentos.
- **Configuración vigente**: plazo, cada cuánto revisa, rol usado, si las
  expulsiones están activadas y las políticas por rol que haya.
- **Gráfica de evolución** de los últimos 30 días.
- **Actividad reciente**: los últimos comandos ejecutados (quién y cuándo) y
  las últimas acciones automáticas del bot (marcar/desmarcar `@Inactivo`,
  retirar un rol especial), mezclados en una sola línea de tiempo. Ver
  [DATABASE.md](DATABASE.md#command_log) y
  [DATABASE.md](DATABASE.md#moderation_actions).
- **Tabla de miembros** con apodo, estado, última actividad de voz (fecha y
  hora exactas, con "hace cuánto" al lado), número de sesiones de voz,
  antigüedad en el servidor y el plazo que se le aplica. Ordenable por
  cualquier columna (clic en la cabecera) y con buscador por apodo y filtro por
  estado.

> La columna **Sesiones** cuenta veces que ha entrado a voz, no sesiones con
> fecha individual: empieza en 0 para todo el mundo al desplegar esta versión,
> porque ese dato no se guardaba antes. Sube a partir de ahora.

Se refresca solo cada 60 segundos.

## Por qué es de solo lectura

No expone ninguna ruta que escriba: no puede cambiar plazos, ni políticas, ni
tocar roles. Toda la configuración sigue pasando por los slash commands.

Es deliberado. Un panel sin autenticación que además pudiera modificar el
servidor sería un riesgo desproporcionado para lo que aporta: quien tuviera
acceso a la máquina podría vaciar roles sin dejar rastro en Discord. Como solo
lee, lo peor que puede pasar es que alguien vea datos que ya son visibles en el
propio servidor.

## Seguridad: solo accesible en local

En `docker-compose.yml` el puerto se publica así:

```yaml
ports:
  - "127.0.0.1:3000:3000"
```

Ese `127.0.0.1:` es lo que impide que el panel sea accesible desde la red.
**Quitarlo lo expondría a internet**, y el panel no tiene ningún tipo de
autenticación.

Dentro del contenedor el servidor sí escucha en `0.0.0.0`, y tiene que ser así:
el `localhost` del contenedor no es el de tu máquina, de modo que escuchar allí
en loopback lo dejaría inalcanzable. El aislamiento lo hace el mapeo de
puertos, no el binding.

## Verlo desde otro sitio (si migras a un VPS)

No abras el puerto. Usa un túnel SSH, que reenvía el panel a tu PC por la misma
conexión cifrada que ya usas para administrar:

```bash
ssh -L 3000:localhost:3000 usuario@IP-DEL-SERVIDOR
```

Mientras esa sesión SSH esté abierta, `http://localhost:3000` en tu navegador
muestra el panel del servidor. Nada queda expuesto públicamente.

## Desactivarlo

```
DASHBOARD_ENABLED=false
```

Y `docker compose up -d`. También puedes cambiar `DASHBOARD_PORT`, pero si lo
haces acuérdate de ajustar el mapeo en `docker-compose.yml`.

## Sobre la gráfica de evolución

Los datos salen de la tabla `stats_snapshots`, que guarda una medición del
reparto en **cada sincronización** (por defecto una por hora).

Esto significa que el histórico empieza a existir desde que se desplegó esta
versión: la gráfica aparece en cuanto hay dos mediciones y gana valor con los
días. No hay forma de reconstruir el pasado anterior, porque esa información no
se guardaba.

## Detalle de implementación

Sin framework ni build: el servidor son unas pocas líneas sobre el módulo `http`
de Node ([server.js](../src/dashboard/server.js)) y la página es un único HTML
autocontenido, sin dependencias externas ni CDN.

Los datos los compone [data.js](../src/dashboard/data.js) llamando al **mismo**
`evaluateGuildInactivity` que usa el sincronizador. Es a propósito: así el panel
no puede desviarse de lo que el bot hace de verdad. Si cambia la política, el
panel la refleja sin tocar nada.

### Cuidado al modificar la página

El armazón de la página se construye una sola vez y después solo se repintan
las partes que cambian. **No lo conviertas en un repintado completo**: al
reconstruir el HTML se destruye el `<input>` del buscador, el cursor vuelve a la
posición 0 y el texto se escribe al revés (`fernando` → `odnanref`). Además, el
refresco automático de cada 60 segundos robaría el foco mientras escribes.
