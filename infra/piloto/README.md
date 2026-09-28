# Instalación del PC del local (piloto JCB)

Runbook de `tasks/lanzamiento.md` 1.3 y 1.5. Ubuntu Desktop LTS, un solo PC, uso por `localhost`.
Lo que se decide en el momento (contraseñas, correo, servidor de respaldo) no va acá.

## 1. Sistema

```bash
# Docker Engine (no Docker Desktop): https://docs.docker.com/engine/install/ubuntu/
sudo usermod -aG docker "$USER"
sudo timedatectl set-timezone America/Santiago
sudo apt install unattended-upgrades cups
```

- **Cifrado del disco** (LUKS con desbloqueo por TPM, decidido el 2026-09-25): se elige al instalar
  Ubuntu ("Cifrado con TPM"). Protege si sacan el disco.
- **Actualizaciones fuera del horario**: en `/etc/apt/apt.conf.d/50unattended-upgrades`, `Unattended-Upgrade::Automatic-Reboot "false";`
  y que corran de noche o al encender (`systemctl edit apt-daily-upgrade.timer` con `OnCalendar=*-*-* 07:00`
  y `Persistent=true`). Nunca reiniciar solo en horario de atención.
- **Impresora térmica** por CUPS, con el driver del fabricante. En sus opciones, "cortar al final de
  cada página": el ticket trae una página por copia y así corta entre la copia cliente y la cedible.

## 2. Torn y dte-torn

```bash
sudo git clone https://github.com/AstralMoonlight/torn.git /opt/torn && sudo chown -R "$USER" /opt/torn
cp /opt/torn/.env.example /opt/torn/.env                     # y completar
cp /opt/torn/dte-torn/.env.example /opt/torn/dte-torn/.env   # y completar
```

En los `.env`, todo nuevo: `SECRET_KEY`, `TORN_DB_PASSWORD`, `POSTGRES_PASSWORD`, `MINIO_ROOT_USER`,
`MINIO_ROOT_PASSWORD`, `DTE_INTERNAL_API_KEY` (= `TORN_DTE_API_KEY`) y `DTE_MASTER_KEY` (se genera una
vez: ver `dte-torn/README.md`). **Sin** `TORN_ADMIN_EMAIL`/`TORN_ADMIN_PASSWORD`.
`DTE_MASTER_KEY` se guarda también fuera del PC: sin ella el certificado y los CAF no se pueden leer.

dte-torn primero: su red es externa para Torn.

```bash
cd /opt/torn/dte-torn && docker compose -f docker-compose.yml -f docker-compose.piloto.yml up -d --build
cd /opt/torn && docker compose -f docker-compose.yml -f docker-compose.piloto.yml up -d --build
docker ps    # todos Up; con `restart` vuelven solos al encender
```

Ningún puerto queda a la vista de la red del local: `ss -tlnp` solo muestra `127.0.0.1:3000` y
`127.0.0.1:8000`.

## 3. El POS se abre solo al encender

`factureando-pos.desktop` va en `~/.config/autostart/` del usuario del local. Abre Chrome en pantalla
completa con impresión directa (`--kiosk-printing`: imprime en la impresora predeterminada sin mostrar
el diálogo). Espera a que el frontend responda antes de abrir.

```bash
mkdir -p ~/.config/autostart && cp /opt/torn/infra/piloto/factureando-pos.desktop ~/.config/autostart/
```

- Inicio de sesión automático de Ubuntu (Configuración > Usuarios) para que el personal no tenga pasos
  extra, **con** contraseña en el usuario y bloqueo de pantalla: la contraseña de Linux es la barrera si
  se roban el PC entero.
- La impresora térmica tiene que ser la predeterminada del sistema.

## 4. Soporte remoto

Tailscale (o un túnel equivalente): nada de puertos abiertos en el router del local.

```bash
curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up --ssh
```

SSH solo por llave: en `/etc/ssh/sshd_config`, `PasswordAuthentication no`.

## 5. Respaldo

`infra/respaldo/README.md`. Probar una restauración completa en otra máquina antes del primer día.

## 6. Actualizar el PC (fuera del horario)

```bash
sudo systemctl start torn-respaldo.service            # respaldo primero
cd /opt/torn && git pull
(cd dte-torn && docker compose -f docker-compose.yml -f docker-compose.piloto.yml up -d --build)
docker compose -f docker-compose.yml -f docker-compose.piloto.yml up -d --build
```

Después, una venta de prueba en modo Desarrollador (saas-admin) y volver al modo de la empresa.
