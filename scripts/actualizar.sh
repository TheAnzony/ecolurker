#!/usr/bin/env bash
#
# Actualiza el bot en el servidor de forma segura.
#
#   ./scripts/actualizar.sh
#
# Hace, en orden: copia de seguridad -> descarga cambios -> reconstruye ->
# reinicia -> comprueba que ha arrancado bien.
#
# Si algo falla, se detiene y te dice como volver a la version anterior en vez
# de dejar el bot a medias.

set -euo pipefail

cd "$(dirname "$0")/.."

VERSION_ANTERIOR="$(git rev-parse --short HEAD)"

echo "==> Copia de seguridad de la base de datos"
if docker compose ps --status running --quiet bot | grep -q .; then
  docker compose exec -T bot node src/tools/backup.js
else
  echo "    (el bot no esta corriendo, me salto la copia)"
fi

echo
echo "==> Descargando cambios"
git pull

VERSION_NUEVA="$(git rev-parse --short HEAD)"
if [ "$VERSION_ANTERIOR" = "$VERSION_NUEVA" ]; then
  echo "    Ya estabas en la ultima version ($VERSION_NUEVA). Nada que hacer."
  exit 0
fi

echo
echo "==> Reconstruyendo la imagen"
docker compose build

echo
echo "==> Reiniciando el bot"
docker compose up -d

echo
echo "==> Comprobando que arranca (15s)"
sleep 15

if ! docker compose ps --status running --quiet bot | grep -q .; then
  echo
  echo "!! El contenedor no esta corriendo. Ultimos logs:"
  docker compose logs --no-color --tail 30
  echo
  echo "!! Para volver a la version anterior:"
  echo "     git reset --hard $VERSION_ANTERIOR && docker compose build && docker compose up -d"
  exit 1
fi

if docker compose logs --no-color --tail 40 | grep -q "Sesion iniciada como"; then
  echo "    Bot conectado correctamente."
else
  echo "    Aviso: el contenedor corre pero aun no veo el inicio de sesion."
  echo "    Revisa con: docker compose logs -f"
fi

echo
echo "==> Actualizado: $VERSION_ANTERIOR -> $VERSION_NUEVA"
echo
echo "Si has aniadido o cambiado comandos, registralos ademas con:"
echo "  docker compose run --rm bot npm run deploy"
