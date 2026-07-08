# Runbook — Auto-actualización desde GitHub (ADR-S13)

> CI empaqueta cada release como un ZIP autocontenido → la app lo detecta → el
> **superadmin de plataforma** lo instala desde el panel con un flip de symlink
> atómico, health-check y **rollback automático**. Sin SSH.

## Las 3 etapas

1. **BUILD** — al taggear `vX.Y.Z`, `.github/workflows/release.yml` compila
   (shared → api → web), arma un bundle autocontenido (API + `node_modules` de
   prod vía `pnpm deploy` + SPA + migraciones + scripts + `VERSION`), genera su
   `.sha256` y publica ambos como assets del GitHub Release.
2. **DETECT** — un job horario (BullMQ) consulta `releases/latest` de GitHub y
   guarda el último release en `app_releases`. También a demanda (*Buscar*).
3. **INSTALL** — el superadmin aprieta *Actualizar* → un job (in-process)
   descarga+verifica+extrae el ZIP al lado del release vivo, migra, hace el
   **flip** del symlink `current`, marca el resultado en Redis y delega el
   reinicio a `finalize.sh` (desacoplado). Éste reinicia el API, verifica el
   `/health/ready` y, si falla, **revierte** (flip atrás + restore del último
   dump). La app reconcilia el estado final al bootear.

## Configuración

En `shared/.env.production` (ver `deploy/.env.production.example`):

```
PLATFORM_SUPERADMINS=vos@tu-dominio.com   # quién puede actualizar (coma-sep)
UPDATER_GITHUB_REPO=augusto97/imagina-crm-cloud
UPDATER_CHANNEL=stable
UPDATER_GITHUB_TOKEN=                       # SÓLO si el repo es privado (repo:read)
UPDATER_BASE_PATH=/opt/imagina-base         # raíz del layout de releases atómicos
UPDATER_KEEP_RELEASES=5
```

Requisitos del SO:
- Layout de releases atómicos (ver `docs/runbook-deploy.md` §4): `releases/`,
  `shared/`, `current ->`.
- El usuario del servicio puede reiniciar el API sin password
  (`/etc/sudoers.d/imagina`: `deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart imagina-api`).
- `curl`, `unzip`, `sha256sum` disponibles (estándar en Ubuntu).

## Repo privado (a futuro)

Cuando el repo pase a privado: creá un token de solo-lectura (fine-grained,
`Contents: read`) y ponelo en `UPDATER_GITHUB_TOKEN`. El DETECT lo manda como
`Authorization: Bearer` y la descarga del asset usa `Accept: application/octet-stream`.
Sin token, con repo privado, `releases/latest` da 404 y no se detecta nada.

## Endpoints (superadmin)

```
GET  /api/v1/system/update/status     # versión actual/disponible + estado del run
POST /api/v1/system/update/check      # fuerza el DETECT ahora
POST /api/v1/system/update/run        # encola la instalación (202)
POST /api/v1/system/update/rollback   # vuelve al release anterior
```

## Garantías (gotchas resueltos)

- **Fail-closed**: un release sin `.sha256` se rechaza; hash que no coincide, se
  aborta. Nunca se instala código sin verificar.
- **El worker que actualiza es el propio API**: se marca `done`+estado en Redis
  **antes** de reiniciar, y el reinicio lo hace `finalize.sh` desacoplado — así
  no se pierde el resultado al morir el proceso.
- **Re-entrancia**: lock en Redis + marker `done:<version>` + `lockDuration`
  del worker > duración del deploy → sin doble-deploy.
- **Estado en Redis** (no en disco del release): sobrevive al flip y lo comparten
  web y worker.
- **Auto-sanación**: un run colgado (>20 min, o la web ya sirve la versión nueva)
  se resuelve solo — la UI nunca queda pegada en "Instalando…".
- **Rollback de datos por restore** del dump previo (las migraciones son
  forward-only), no por `migrate:down`.

## Prueba de humo

1. Taggeá un `vX.Y.Z` de prueba y esperá a que el workflow publique el Release.
2. En el panel: *Buscar* → debe aparecer la versión disponible.
3. *Actualizar* → seguí el estado (`queued → running → restarting → success`).
4. Verificá `GET /system/update/status` → `current_version` = la nueva.
5. Probá *Rollback* → vuelve a la anterior y `update_available` reaparece.
