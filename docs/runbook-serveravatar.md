# Runbook — Instalar en un VPS Ubuntu 24 con ServerAvatar

> **Qué stack elegir en ServerAvatar:** **Nginx** + activá el toggle **"Install
> Node.js"**. NO uses el tipo PHP ni OpenLiteSpeed: Imagina Base es **Node.js +
> un SPA estático**, no PHP.
>
> **Ojo con la base de datos:** ningún stack de ServerAvatar trae PostgreSQL
> (todos traen MySQL/MariaDB, o MongoDB en el "Node Stack"). Imagina Base
> **requiere PostgreSQL 16** → lo instalamos por **Docker**. El MariaDB del stack
> queda sin usar (inofensivo). El **Redis** del stack **sí lo usamos**.

## 1. Crear el servidor

1. VPS **Ubuntu 24.04** (2 vCPU / 4 GB) en tu proveedor.
2. ServerAvatar → **Create Server** → conectá el VPS.
3. **Tech Stack: Nginx.** Database: dejá **MariaDB** (no lo vamos a usar).
   Activá **"Install Node.js"** (nos da Node + Nginx + Redis; PHP/MariaDB quedan
   de adorno).

## 2. DNS

Apuntá `app.tu-dominio.com` (registro **A**) a la IP del VPS y esperá a que
propague (necesario antes del SSL).

## 3. Crear la aplicación (dominio + SSL)

1. ServerAvatar → tu server → **Applications → Create Application**.
2. Tipo: **Static HTML**. Dominio: `app.tu-dominio.com`.
3. Emití el **SSL** (Let's Encrypt) para el dominio.
4. El **Document Root** lo apuntamos a `/opt/imagina-base/current/web` en el paso 6.

## 4. SSH: Postgres, Redis y el release

Entrá por SSH o la Web Terminal. Node ya lo instaló el toggle; verificá:
`node -v` (debe ser ≥ 22). Instalá Docker para Postgres:

```bash
curl -fsSL https://get.docker.com | sh
sudo mkdir -p /opt/imagina-base/shared/backups && sudo chown -R "$USER" /opt/imagina-base
```

**Traer el release v0.1.0** (el mismo bundle que usa la auto-actualización — ya
trae `node_modules` de prod con `argon2` compilado, así NO hace falta compilar en
el server):

```bash
BASE=/opt/imagina-base; VER=0.1.0
cd "$BASE/releases" 2>/dev/null || { mkdir -p "$BASE/releases"; cd "$BASE/releases"; }
BURL="https://github.com/augusto97/imagina-crm-cloud/releases/download/v${VER}"
curl -fL -o bundle.zip        "${BURL}/imagina-base-${VER}.zip"
curl -fL -o bundle.zip.sha256 "${BURL}/imagina-base-${VER}.zip.sha256"
echo "$(cat bundle.zip.sha256)  bundle.zip" | sha256sum -c -   # verificar integridad
TS=$(date -u +%Y%m%d%H%M%S); REL="$BASE/releases/${TS}_${VER}"
mkdir -p "$REL" && unzip -q bundle.zip -d "$REL" && rm bundle.zip bundle.zip.sha256
```

**Config** (el bundle trae el ejemplo y el compose en `deploy/`):

```bash
cp "$REL/deploy/.env.production.example" "$BASE/shared/.env.production"
nano "$BASE/shared/.env.production"     # ver "Config mínima" abajo
```

Config mínima en `/opt/imagina-base/shared/.env.production`:
```
POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB      # passwords fuertes
DATABASE_URL=postgres://<user>:<pass>@127.0.0.1:5432/<db>
# Redis del stack de ServerAvatar (ya corre en 127.0.0.1:6379). Si el panel le
# puso password, usá redis://:<pass>@127.0.0.1:6379 ; si no, sin credenciales:
REDIS_URL=redis://127.0.0.1:6379
COOKIE_SECURE=true
APP_BASE_URL=https://app.tu-dominio.com
PLATFORM_SUPERADMINS=vos@tu-dominio.com
UPDATER_BASE_PATH=/opt/imagina-base
```

**Postgres por Docker** (sólo Postgres; el Redis lo pone el stack, así que NO
levantamos el de Docker para no chocar en el 6379):

```bash
docker compose -f "$REL/deploy/docker-compose.prod.yml" \
  --env-file "$BASE/shared/.env.production" up -d postgres
```

**Migraciones + FLIP inicial:**
```bash
set -a; . "$BASE/shared/.env.production"; set +a
( cd "$REL/apps/api" && node dist/db/migrate.js )    # schema + RLS + rol imagina_app
ln -sfn "$REL" "$BASE/current"
```

## 5. API como servicio (systemd)

```bash
sudo cp "$BASE/current/deploy/imagina-api.service" /etc/systemd/system/imagina-api.service
sudo nano /etc/systemd/system/imagina-api.service     # ajustá User= a tu usuario
sudo systemctl daemon-reload && sudo systemctl enable --now imagina-api
curl -s http://127.0.0.1:3001/api/v1/health/ready      # {"status":"ready",...}

# Auto-actualización: permitir reiniciar el API sin password.
echo "$USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart imagina-api" | sudo tee /etc/sudoers.d/imagina
```

## 6. Nginx (servir SPA + proxy al API) en ServerAvatar

1. Applications → tu app → poné **Document Root** = `/opt/imagina-base/current/web`.
2. Abrí la **config Nginx** de la app y pegá los bloques `location` de
   `deploy/nginx.conf` (API, socket.io, /assets, /portal, /). ServerAvatar ya
   pone el `server{}`, `listen 443 ssl` y `server_name`; vos sólo agregás los
   `location`. Guardá → recarga Nginx.

Abrí `https://app.tu-dominio.com` → login. Registrá el primer usuario (crea el
workspace y su admin). Si su email está en `PLATFORM_SUPERADMINS`, ve **Ajustes →
Sistema · Actualizaciones**.

## 7. Auto-actualización

Taggeás `vX.Y.Z` en GitHub → el workflow publica el bundle → en el panel
(superadmin) *Buscar* + *Actualizar*: descarga+verifica+flip atómico+health+
rollback. Detalle en `docs/runbook-updates.md`.

## Alternativas / notas

- **Instalar compilando en el server (en vez del bundle):** necesitás
  `sudo apt-get install -y build-essential python3` (para compilar `argon2`) y
  seguir el bootstrap "desde el repo" de `docs/runbook-deploy.md` §4. El bundle
  del Release evita todo esto.
- **App Node de ServerAvatar (PM2) en vez de systemd:** poné en el env
  `RESTART_CMD="pm2 restart imagina-api"` (lo respeta `finalize.sh`).
- **Postgres administrado** en vez de Docker: cambiá `DATABASE_URL` y, si el
  usuario no es superuser, `GRANT imagina_app TO <user>;` tras migrar.
- **Redis con password en el panel:** copiá la credencial que muestre ServerAvatar
  en su sección de Redis y armá el `REDIS_URL` con ella.
