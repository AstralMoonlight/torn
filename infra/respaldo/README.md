# Respaldo del PC del local

Diseño aprobado el 2026-09-25 (`tasks/lanzamiento.md` 1.4): restic, cifrado en el PC antes de salir, un
repositorio por empresa y el servidor en modo append-only.

## Qué se respalda

Una foto diaria con:

- `torn.dump`: la base de Torn (`pg_dump` en formato custom).
- `dte.dump`: la base de dte-torn.
- `minio/`: los XML firmados y PDF de MinIO (`/data` del contenedor), que hay que guardar por años.

Las bases se vuelcan antes que MinIO: así ningún documento de la base queda sin su XML.

**No va en la foto** y hay que guardarlo aparte, fuera del PC y fuera del servidor de respaldo:

- `DTE_MASTER_KEY` del `.env` de dte-torn: sin ella los certificados y CAF cifrados no se pueden leer.
- La clave del repositorio restic (`RESTIC_PASSWORD_FILE`): sin ella el respaldo no se puede abrir.

## Instalación en el PC (Ubuntu)

```bash
sudo apt install restic
sudo mkdir -p /etc/torn && sudo chmod 700 /etc/torn
sudo sh -c 'head -c 32 /dev/urandom | base64 > /etc/torn/restic.clave' && sudo chmod 600 /etc/torn/restic.clave
sudo tee /etc/torn/respaldo.env <<'EOF'
RESTIC_REPOSITORY=rest:https://USUARIO:CLAVE@SERVIDOR/76398956-9/
RESTIC_PASSWORD_FILE=/etc/torn/restic.clave
EOF
sudo chmod 600 /etc/torn/respaldo.env
sudo -E sh -c 'set -a; . /etc/torn/respaldo.env; restic init'
sudo cp /opt/torn/infra/respaldo/torn-respaldo.service /opt/torn/infra/respaldo/torn-respaldo.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now torn-respaldo.timer
sudo systemctl start torn-respaldo.service && journalctl -u torn-respaldo -n 20
```

`/var/lib/torn/ultimo-respaldo-ok` guarda la hora del último respaldo bueno; la alerta de respaldo
fallido (`lanzamiento.md` 0.2) puede mirar ese archivo.

## Servidor (VPS propio)

`rest-server --append-only --private-repos`: el PC agrega fotos pero no puede borrarlas, así que un PC
comprometido no se lleva los respaldos. La limpieza corre en el servidor, con la retención aprobada:

```bash
restic -r /srv/respaldos/76398956-9 forget --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --keep-yearly 6 --prune
```

## Restaurar (probarlo en otra máquina antes del piloto)

```bash
restic restore latest --target /tmp/r      # deja la foto en /tmp/r/var/tmp/torn-respaldo/
cd /opt/torn && docker compose up -d db && (cd dte-torn && docker compose up -d db minio)
docker exec -i torn_db sh -c 'pg_restore -U "$POSTGRES_USER" --clean --if-exists --no-owner -d "$POSTGRES_DB"' < /tmp/r/var/tmp/torn-respaldo/torn.dump
docker exec -i dte-torn-db-1 sh -c 'pg_restore -U "$POSTGRES_USER" --clean --if-exists --no-owner -d "$POSTGRES_DB"' < /tmp/r/var/tmp/torn-respaldo/dte.dump
docker cp /tmp/r/var/tmp/torn-respaldo/minio/. dte-torn-minio-1:/data
```

Después, el resto de los servicios, con el mismo `.env` de dte-torn (la llave maestra) que tenía el PC.
