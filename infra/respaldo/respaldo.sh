#!/usr/bin/env bash
# Respaldo diario del PC del local (tasks/lanzamiento.md 1.4).
#
# Una sola foto de restic con las dos bases (Torn y dte-torn) y los XML firmados
# de MinIO, tomados en la misma pasada. Las bases van primero: un XML guardado
# después del volcado sobra en la foto, pero no falta ninguno de los que la base
# nombra. restic cifra en el PC antes de mandar nada.
#
# La limpieza (`restic forget --prune`) NO corre acá: el repositorio es
# append-only y la hace el servidor (ver README.md).
#
# Configuración (/etc/torn/respaldo.env, lo carga el servicio de systemd):
#   RESTIC_REPOSITORY      rest:https://usuario:clave@servidor/<RUT>/  (uno por empresa)
#   RESTIC_PASSWORD_FILE   archivo con la clave del repositorio (guardarla también fuera del PC)
# Opcionales: TORN_DB, DTE_DB, DTE_MINIO (nombres de los contenedores),
#   TRABAJO (carpeta temporal), MARCA (archivo con la hora del último respaldo bueno).
set -euo pipefail

: "${RESTIC_REPOSITORY:?falta RESTIC_REPOSITORY}"
: "${RESTIC_PASSWORD_FILE:?falta RESTIC_PASSWORD_FILE}"
RESTIC=${RESTIC:-restic}
TORN_DB=${TORN_DB:-torn_db}
DTE_DB=${DTE_DB:-dte-torn-db-1}
DTE_MINIO=${DTE_MINIO:-dte-torn-minio-1}
# Carpeta fija: restic compara cada foto con la anterior del mismo camino.
TRABAJO=${TRABAJO:-/var/tmp/torn-respaldo}
MARCA=${MARCA:-/var/lib/torn/ultimo-respaldo-ok}

rm -rf "$TRABAJO"
mkdir -p "$TRABAJO"
trap 'rm -rf "$TRABAJO"' EXIT

# Las credenciales de cada base ya están en su contenedor (POSTGRES_USER/DB).
volcar() {
    docker exec "$1" sh -c 'pg_dump -U "$POSTGRES_USER" --format=custom "$POSTGRES_DB"' > "$TRABAJO/$2"
    # Un volcado vacío es un error aunque pg_dump haya salido bien.
    test -s "$TRABAJO/$2"
}
volcar "$TORN_DB" torn.dump
volcar "$DTE_DB" dte.dump
docker cp "$DTE_MINIO:/data" "$TRABAJO/minio"

"$RESTIC" backup --tag diario --host "$(hostname)" "$TRABAJO"

mkdir -p "$(dirname "$MARCA")"
date --iso-8601=seconds > "$MARCA"
