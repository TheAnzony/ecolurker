# Migrar el bot a un servidor propio (VPS)

Para que el bot esté 24/7 no puede depender de tu PC. La migración es sencilla
porque todo va en Docker: se copia el proyecto, se copia la base de datos, y se
levanta igual que en local.

## 1. Elegir el servidor

El bot consume muy poco: Node + SQLite, sin servidor web ni base de datos
externa. **1 GB de RAM y 1 vCPU sobran.**

Opciones habituales (orientativo):

| Proveedor | Aprox. | Nota |
|---|---|---|
| Hetzner Cloud (CX22) | ~4 €/mes | La mejor relación precio/potencia en Europa |
| Oracle Cloud Free Tier | gratis | Generoso, pero el registro y la disponibilidad son irregulares |
| Contabo / IONOS / OVH | 4-6 €/mes | Alternativas válidas |
| Raspberry Pi en casa | pago único | Sirve perfectamente si tu luz e internet son estables |

Elige **Ubuntu 24.04 LTS** salvo que prefieras otra cosa: es lo más
documentado.

## 2. Preparar el servidor

Conéctate por SSH y instala Docker:

```bash
curl -fsSL https://get.docker.com | sh
```

Comprueba que el servicio arranca solo al reiniciar la máquina (en Ubuntu viene
así por defecto, pero conviene asegurarlo):

```bash
sudo systemctl enable --now docker
```

Con eso y el `restart: unless-stopped` que ya tiene el `docker-compose.yml`, el
bot vuelve solo tras un reinicio del servidor.

## 3. Copiar el proyecto

**Opción A — con Git** (recomendada si vas a seguir tocando el código). Sube el
repo a GitHub *sin el `.env`* (ya está en `.gitignore`) y en el servidor:

```bash
git clone <url-de-tu-repo> ecolurker && cd ecolurker
```

**Opción B — copia directa** desde tu PC, sin Git:

```bash
scp -r "C:\Users\anzon\Desktop\Proyecto discord" usuario@IP:~/ecolurker
```

## 4. Llevar el `.env`

Nunca va en Git. Cópialo aparte:

```bash
scp "C:\Users\anzon\Desktop\Proyecto discord\.env" usuario@IP:~/ecolurker/.env
```

O créalo a mano en el servidor con `nano .env` partiendo de `.env.example`.

## 5. Llevar la base de datos

Aquí está lo único delicado: **no copies `bot.db` a pelo**. Con el modo WAL
activo, parte de los datos recientes viven en `bot.db-wal` y una copia simple
puede quedar incompleta.

En tu PC, con el bot corriendo:

```bash
docker compose exec -T bot node src/tools/backup.js
```

Eso deja un `data/backup-<fecha>.db` consistente. Cópialo al servidor y ponlo
como base de datos activa:

```bash
scp "C:\Users\anzon\Desktop\Proyecto discord\data\backup-XXXX.db" usuario@IP:~/ecolurker/data/bot.db
```

Si prefieres empezar de cero, simplemente no copies nada: el bot creará la base
al arrancar. Perderás el historial de voz acumulado y todo el mundo volverá a
marcarse como inactivo de golpe.

## 6. Apagar el bot de tu PC ⚠️

**Hazlo antes de arrancar el del servidor.** Dos instancias con el mismo token
se pelean por la conexión con Discord y pueden duplicar acciones (mensajes
directos repetidos, cambios de rol en bucle).

En tu PC:

```bash
docker compose down
```

## 7. Arrancar en el servidor

```bash
docker compose build
docker compose up -d
docker compose logs -f
```

Deberías ver `Sesion iniciada como Ecolurker#3615` y el resumen de la
sincronización.

**No hace falta volver a registrar los slash commands**: viven en los
servidores de Discord, no en la máquina. Solo hay que re-registrarlos si
cambias o añades comandos.

## 8. Comprobaciones finales

```bash
docker compose exec -T bot node src/tools/consulta.js
```

Si los números coinciden con los que tenías en local, la migración salió bien.

Prueba también un reinicio completo para confirmar que vuelve solo:

```bash
sudo reboot
```

Al volver a conectarte, `docker compose ps` debe mostrar el contenedor `Up`.

## Mantenimiento

**Copias de seguridad.** La base entera son unos pocos cientos de KB:

```bash
docker compose exec -T bot node src/tools/backup.js
```

Y descargarla a tu PC de vez en cuando:

```bash
scp usuario@IP:~/ecolurker/data/backup-*.db .
```

**Actualizar el bot**: ver [la sección siguiente](#actualizar-el-bot-ya-desplegado).

**Seguridad básica del servidor**: usa claves SSH en vez de contraseña,
desactiva el login de root por contraseña, y no abras ningún puerto — este bot
no necesita ninguno abierto, solo salida a internet.

**El panel web tampoco necesita puerto abierto.** Para verlo desde tu PC, usa
un túnel SSH:

```bash
ssh -L 3000:localhost:3000 usuario@IP
```

Con esa sesión abierta, `http://localhost:3000` en tu navegador muestra el panel
del servidor. Ver [DASHBOARD.md](DASHBOARD.md).

---

# Actualizar el bot ya desplegado

## El flujo recomendado

Desarrollas en tu PC → subes a GitHub → el servidor se descarga los cambios.

En tu PC:

```bash
git add -A && git commit -m "lo que hayas cambiado" && git push
```

En el servidor, un solo comando:

```bash
./scripts/actualizar.sh
```

Ese script hace copia de seguridad, `git pull`, reconstruye, reinicia y
**comprueba que ha arrancado bien**. Si algo falla, se para y te dice el comando
exacto para volver a la versión anterior.

## Qué hace falta según lo que cambies

No todo requiere reconstruir la imagen. Reconstruir tarda ~40s; reiniciar, 5s:

| Cambio | Qué hacer |
|---|---|
| Código (`src/`) | `build` + `up -d` — el script |
| Solo `.env` | `docker compose up -d` (sin build) |
| Solo documentación | nada |
| Comandos nuevos o modificados | lo anterior **+** `docker compose run --rm bot npm run deploy` |
| Esquema de base de datos | lo mismo que código: las migraciones se aplican solas al arrancar |

## Qué NO se pierde al actualizar

- **La base de datos.** Vive en `./data` del host (bind mount), no dentro de la
  imagen. Reconstruir el contenedor no la toca.
- **La configuración de los servidores.** Umbrales y políticas de rol están en
  la base, no en el código.
- **Los slash commands.** Están registrados en Discord. Solo hay que
  re-registrarlos si los cambias.

## Migraciones de esquema

`db/index.js` aplica los `ALTER TABLE` que hagan falta al arrancar, después de
comprobar con `PRAGMA table_info` si ya están puestos. Son idempotentes: puedes
reiniciar mil veces y no pasa nada.

Esto significa que **actualizar no requiere ningún paso manual de base de
datos**. Verás en los logs líneas tipo:

```
[INFO] Migracion aplicada: voice_logs.display_name
```

## Cuánto tiempo está caído

Entre 30 y 60 segundos, lo que tarda `build` + arranque. Durante ese rato el bot
está desconectado: no registra actividad de voz ni responde a comandos.

Para este caso de uso es irrelevante — si alguien entra a voz justo en esa
ventana, su actividad se registrará la próxima vez que entre o salga, y como
mucho aguanta una hora de más con el rol.

## Volver atrás si algo sale mal

```bash
git log --oneline -5
```

```bash
git reset --hard <commit-anterior> && docker compose build && docker compose up -d
```

Si el problema fuese de datos (no de código), restaura una copia:

```bash
docker compose down
cp data/backup-<fecha>.db data/bot.db
docker compose up -d
```

> Antes de sobrescribir `bot.db`, párate a comprobar que la copia es la que
> crees. Restaurar una antigua revierte también umbrales y políticas.

## Sin GitHub

Si prefieres no usar Git, sube los archivos por `scp` y reconstruye a mano:

```bash
scp -r src usuario@IP:~/ecolurker/
```

```bash
docker compose build && docker compose up -d
```

Funciona, pero pierdes el historial y el rollback en un comando. Con Git, volver
a la versión de ayer es instantáneo; con `scp`, tienes que acordarte de qué
cambiaste.
