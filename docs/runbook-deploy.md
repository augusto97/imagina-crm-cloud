# Runbook — Despliegue en un VPS (producción)

> Un solo VPS Linux (Ubuntu 22.04/24.04): **Postgres 16 + Redis 7** en Docker,
> el **API NestJS** nativo por systemd, y **Caddy** sirviendo los dos SPA +
> proxy del API con HTTPS automático. Mismo origen → sin CORS, cookie de sesión
> directa. Archivos de apoyo en `deploy/`.

## 0. Requisitos

- VPS con Ubuntu, 2 vCPU / 4 GB RAM mínimo (holgado según los benchmarks §13).
- Un dominio, p. ej. `app.tu-dominio.com`, con un registro **DNS A/AAAA → IP del
  VPS** ya propagado (Caddy lo necesita para emitir el certificado).
- Puertos **80** y **443** abiertos; **22** para SSH.

## 1. Paquetes base

```bash
# Docker (para Postgres + Redis)
curl -fsSL https://get.docker.com | sh

# Node 22 + pnpm
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs
sudo corepack enable && corepack prepare pnpm@10.33.0 --activate

# Caddy
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy

# Firewall
sudo ufw allow 22 && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw --force enable
```

## 2. Código y configuración

```bash
sudo mkdir -p /opt/imagina-base && sudo chown "$USER" /opt/imagina-base
git clone <URL_DEL_REPO> /opt/imagina-base
cd /opt/imagina-base
git checkout <rama-o-tag>

# Config: copiá el ejemplo y completá TODOS los secrets.
cp deploy/.env.production.example .env.production
openssl rand -hex 32   # generá passwords para Postgres/Redis y pegalos
nano .env.production    # ajustá dominio, DB/Redis creds, SMTP, pagos…
```

> `DATABASE_URL` y `REDIS_URL` deben repetir las credenciales de
> `POSTGRES_*` / `REDIS_PASSWORD` (los env files no interpolan). `COOKIE_SECURE=true`
> y `APP_BASE_URL=https://app.tu-dominio.com`.

## 3. Datos: Postgres + Redis

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file .env.production up -d
docker compose -f deploy/docker-compose.prod.yml ps   # healthy
```
Ambos quedan escuchando **sólo en 127.0.0.1** (no expuestos a internet).

## 4. Build

```bash
pnpm install --frozen-lockfile
pnpm --filter @imagina-base/shared build
pnpm --filter @imagina-base/api build
pnpm --filter @imagina-base/web build:cloud
```

## 5. Migraciones

```bash
cd apps/api
node dist/db/migrate.js        # aplica el schema + RLS + rol imagina_app
cd /opt/imagina-base
```

> **Postgres administrado (no el de Docker):** si el usuario de conexión NO es
> superuser, otorgale el rol de aplicación para que pueda `SET ROLE`:
> `GRANT imagina_app TO <db_user>;` (con el Postgres de Docker el usuario es
> superuser y esto no hace falta).

## 6. API por systemd

```bash
sudo cp deploy/imagina-api.service /etc/systemd/system/imagina-api.service
# Revisá User=, WorkingDirectory=, EnvironmentFile= y la ruta de node en el unit.
sudo systemctl daemon-reload
sudo systemctl enable --now imagina-api
curl -s http://127.0.0.1:3001/api/v1/health/ready   # {"status":"ready",...}
```

## 7. Front + Caddy

```bash
# Publicá el build del SPA donde lo sirve Caddy.
sudo mkdir -p /var/www/imagina-base
sudo cp -r apps/web/dist-cloud/* /var/www/imagina-base/

# Config de Caddy (ajustá el dominio dentro del archivo).
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile        # reemplazá app.tu-dominio.com
sudo systemctl reload caddy
```

Abrí `https://app.tu-dominio.com` → cae en el login. Registrá el primer usuario:
ese registro crea el **workspace y su admin**.

## 8. Post-despliegue

- **Backups**: programá el diario y el restore drill (ver `docs/runbook-backups.md`).
  Cron ejemplo (diario 03:00):
  `0 3 * * * cd /opt/imagina-base && DATABASE_URL=... BACKUP_GPG_RECIPIENT=... ./scripts/backup.sh /var/backups/imagina-base`
- **Pagos**: registrá los webhooks a `https://app.tu-dominio.com/api/v1/billing/webhook/{paypal|mercadopago}`
  y completá credenciales (ver `docs/runbook-payments.md`).
- **Email**: verificá el SMTP mandando un magic link de portal a tu correo.
- **Monitoreo**: `GET /api/v1/health/ready` (uptime check externo) y
  `GET /api/v1/metrics` (latencias/errores).

## 9. Actualizar a una versión nueva

```bash
cd /opt/imagina-base
git pull
pnpm install --frozen-lockfile
pnpm --filter @imagina-base/shared build
pnpm --filter @imagina-base/api build
pnpm --filter @imagina-base/web build:cloud
cd apps/api && node dist/db/migrate.js && cd /opt/imagina-base
sudo cp -r apps/web/dist-cloud/* /var/www/imagina-base/
sudo systemctl restart imagina-api
```

Rollback: `git checkout <tag-anterior>` y repetir el bloque (las migraciones son
aditivas; revisá antes si alguna es destructiva).

## Notas de arquitectura

- **Una sola instancia** de API alcanza para la beta; el realtime usa el adapter
  Redis de Socket.io, así que escalar a N nodos detrás de un balanceador con
  sticky sessions es directo cuando haga falta (ADR-S05: monolito modular).
- Las colas **BullMQ** (emails, automatizaciones, webhooks) corren **in-process**
  en el API — no hay worker aparte que administrar.
- RLS: el pool se conecta como dueño de las tablas pero cada transacción hace
  `SET LOCAL ROLE imagina_app` (no-superuser) para que las policies apliquen.
