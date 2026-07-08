# Runbook — Instalar en un VPS Ubuntu 24 con ServerAvatar

> **Respuesta corta a "¿PHP o OpenLiteSpeed?": ninguna de las dos.** Imagina Base
> es **Node.js + un SPA estático**, no PHP. En ServerAvatar:
> - **Web server del servidor: Nginx** (no OpenLiteSpeed — el vhost que damos es
>   Nginx; OLS complica el proxy + los rewrites del SPA).
> - **Aplicación: Sitio estático** (document root → `current/web`), NO "PHP App".
> - La **API Node corre aparte por systemd**; Postgres/Redis por Docker.
>   ServerAvatar se encarga del servidor, el vhost Nginx, el SSL y el firewall.

## 1. Crear el servidor en ServerAvatar

1. Provisioná un VPS **Ubuntu 24.04** (2 vCPU / 4 GB) en tu proveedor.
2. En ServerAvatar → **Create Server** → conectá ese VPS (por IP + credenciales
   o el script de conexión). Elegí **Nginx** como web server.
3. Esperá a que termine el aprovisionamiento.

## 2. DNS

Apuntá `app.tu-dominio.com` (registro **A**) a la IP del VPS y esperá a que
propague (necesario antes de emitir el SSL).

## 3. Crear la aplicación (para dominio + SSL)

1. ServerAvatar → tu servidor → **Applications → Create Application**.
2. Tipo: **Static HTML** (o "Custom"/"Reverse Proxy" si tu plan lo ofrece).
3. Dominio primario: `app.tu-dominio.com`.
4. **Document Root**: dejalo por defecto por ahora; lo cambiamos a
   `/opt/imagina-base/current/web` en el paso 6 (o directamente ahí si te deja).
5. Cuando la app exista, entrá a **SSL** → emití **Let's Encrypt** para el dominio.

## 4. SSH: dependencias, datos y build

Conectate por SSH (o usá la Web Terminal de ServerAvatar). Los comandos asumen
un usuario con sudo; ajustá `deploy` por tu usuario del sistema.

```bash
# Node 22 + pnpm + Docker
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs
sudo corepack enable && corepack prepare pnpm@10.33.0 --activate
curl -fsSL https://get.docker.com | sh

# Código
sudo mkdir -p /opt/imagina-base && sudo chown -R "$USER" /opt/imagina-base
git clone https://github.com/augusto97/imagina-crm-cloud /tmp/imagina-src
cd /tmp/imagina-src && git checkout v0.1.0    # el tag de la primera versión
```

**Postgres + Redis (Docker):**
```bash
cp deploy/.env.production.example /opt/imagina-base/shared/.env.production 2>/dev/null || \
  { mkdir -p /opt/imagina-base/shared/backups; cp deploy/.env.production.example /opt/imagina-base/shared/.env.production; }
nano /opt/imagina-base/shared/.env.production   # ver "Config" abajo
docker compose -f deploy/docker-compose.prod.yml --env-file /opt/imagina-base/shared/.env.production up -d
```

**Config mínima en `/opt/imagina-base/shared/.env.production`:**
```
POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB / REDIS_PASSWORD   # passwords fuertes
DATABASE_URL=postgres://<user>:<pass>@127.0.0.1:5432/<db>          # repetí las de arriba
REDIS_URL=redis://:<pass>@127.0.0.1:6379
COOKIE_SECURE=true
APP_BASE_URL=https://app.tu-dominio.com
PLATFORM_SUPERADMINS=vos@tu-dominio.com          # quién puede auto-actualizar
UPDATER_BASE_PATH=/opt/imagina-base
# (SMTP, PayPal/Mercado Pago: opcionales, cuando los tengas)
```

**Build + primer release (layout de releases atómicos):**
```bash
BASE=/opt/imagina-base; TS=$(date -u +%Y%m%d%H%M%S); REL="$BASE/releases/${TS}_0.1.0"
pnpm install --frozen-lockfile
pnpm --filter @imagina-base/shared build
pnpm --filter @imagina-base/api build
pnpm --filter @imagina-base/web build:cloud
mkdir -p "$REL/apps" "$REL/deploy"
pnpm --filter @imagina-base/api --legacy deploy --prod "$REL/apps/api"
cp -r apps/api/dist "$REL/apps/api/dist"
cp -r apps/web/dist-cloud "$REL/web"
cp deploy/deploy.sh deploy/finalize.sh scripts/backup.sh scripts/restore.sh "$REL/deploy/"
chmod +x "$REL"/deploy/*.sh
echo "0.1.0" > "$REL/VERSION"
set -a; . "$BASE/shared/.env.production"; set +a
( cd "$REL/apps/api" && node dist/db/migrate.js )   # schema + RLS + rol imagina_app
ln -sfn "$REL" "$BASE/current"
```

## 5. API como servicio (systemd)

```bash
sudo cp /tmp/imagina-src/deploy/imagina-api.service /etc/systemd/system/imagina-api.service
sudo nano /etc/systemd/system/imagina-api.service    # ajustá User= a tu usuario
sudo systemctl daemon-reload && sudo systemctl enable --now imagina-api
curl -s http://127.0.0.1:3001/api/v1/health/ready     # {"status":"ready",...}

# Para la auto-actualización: permitir reiniciar el API sin password.
echo "$USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart imagina-api" | sudo tee /etc/sudoers.d/imagina
```

## 6. Nginx en ServerAvatar (servir SPA + proxy al API)

1. Cambiá el **Document Root** de la app a `/opt/imagina-base/current/web`
   (Applications → tu app → Settings/General).
2. Abrí la config Nginx de la app (**Nginx Config** / "Vhost" / "Custom Config").
   Pegá los bloques `location` de `deploy/nginx.conf` (API, socket.io, /assets,
   /portal, /). ServerAvatar ya pone el `server {}`, `listen 443 ssl` y el
   `server_name` — vos sólo agregás los `location`.
3. Guardá → ServerAvatar recarga Nginx.

> Si el panel no te deja pegar `location` sueltos, reemplazá el vhost completo por
> `deploy/nginx.conf` (ajustando dominio y rutas de certificados que ya emitió
> ServerAvatar en `/etc/letsencrypt/live/<dominio>/`).

## 7. Primer uso

Abrí `https://app.tu-dominio.com` → registrá el primer usuario (crea el workspace
y su admin). Ese email, si está en `PLATFORM_SUPERADMINS`, ve **Ajustes → Sistema ·
Actualizaciones**.

## 8. Auto-actualización

Taggeá `vX.Y.Z` en GitHub → el workflow publica el bundle → en el panel
(superadmin) apretás *Buscar* y *Actualizar*: descarga+verifica+flip atómico+
health-check+rollback. Detalle en `docs/runbook-updates.md`.

## Post-instalación

- **Backups**: cron diario con `scripts/backup.sh` + restore drill mensual
  (`docs/runbook-backups.md`).
- **Pagos/Email**: completá credenciales cuando las tengas
  (`docs/runbook-payments.md`).
- **Monitoreo**: uptime check a `/api/v1/health/ready`; métricas en `/api/v1/metrics`.

## Notas

- **¿Y si preferís la app Node de ServerAvatar (PM2) en vez de systemd?** Podés,
  pero entonces el reinicio de la auto-actualización debe usar PM2: seteá en el
  env `RESTART_CMD="pm2 restart imagina-api"` (finalize.sh lo respeta). Con
  systemd no toques nada.
- **¿Postgres administrado en vez de Docker?** Cambiá sólo `DATABASE_URL` y, si el
  usuario no es superuser, corré `GRANT imagina_app TO <user>;` tras migrar.
