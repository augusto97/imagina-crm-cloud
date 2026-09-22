# Runbook — Copias completas, restauración y migración de servidor (ADR-S20)

> v0.1.179. Tres escenarios con el MISMO artefacto — el **snapshot completo**
> — y tres comandos. Complementa `runbook-backups.md` (dump lógico diario) y
> `runbook-pitr.md` (restauración a un instante). Aquellos protegen la BASE;
> este protege la APP ENTERA: base + archivos subidos + ajustes de plataforma
> (Redis `platform:*`) + los secretos del `.env` — sin ellos, un restore en
> otro servidor deja logos/adjuntos rotos y contraseñas SMTP y 2FA ilegibles.

## Qué es un snapshot

`imagina-snapshot-<UTC>-v<versión>.tar` (opcionalmente `.gpg`) con:

| Parte | Contenido |
|---|---|
| `manifest.json` | versión de la app, fecha, host, nº de migraciones aplicadas, partes con tamaño y sha256 |
| `db.dump` | `pg_dump` formato custom, **con** privilegios (los GRANT al rol `imagina_app` viajan) |
| `uploads.tar.gz` | `shared/uploads` (storage local). Con `STORAGE_DRIVER=s3` no viaja: los bytes ya viven en el bucket |
| `redis-platform.json` | claves `platform:*` de Redis (SMTP de plataforma, ajustes de copias). Sesiones y colas NO (efímeras) |
| `env.production` | el `.env` del servidor. **Contiene secretos**: guardá el snapshot como tal o cifralo (`BACKUP_GPG_RECIPIENT`) |
| `checksums.sha256` | se verifica antes de restaurar |

Los tres scripts viajan en cada release (`current/deploy/`) y en el repo (`scripts/`):
`snapshot.sh`, `snapshot-restore.sh`, `bootstrap-server.sh`.

## Desde la consola (Plataforma → Copias de seguridad)

El superadmin puede, sin SSH:

- **Crear copia ahora** (la hace el worker in-process, una a la vez, en la
  misma cola que las actualizaciones: nunca se pisan).
- **Copias automáticas**: todos los días a la hora UTC elegida, conservando las
  N más nuevas (tick horario; si el servidor estaba apagado a esa hora, sale
  en el próximo tick del día).
- **Descargar** cualquier copia (para llevarla fuera del servidor — hacelo:
  una copia en el mismo disco que la app no cubre la pérdida del servidor).
- **Restaurar** una copia (escribiendo `RESTAURAR`): detiene el API, guarda una
  copia previa de la base actual (`pre-restore-<ts>.dump`), reemplaza base +
  archivos + ajustes de plataforma, corre migraciones y arranca. ~1 minuto de
  corte. Requiere el layout de releases (`UPDATER_BASE_PATH`); en dev sólo por CLI.
- **Eliminar**.

Las copias viven en `shared/backups/` (o `BACKUPS_DIR`).

## Escenario 1 — Volver a un estado anterior (misma máquina)

```bash
# ver qué copias hay
ls -lh /opt/imagina-base/shared/backups/

# restaurar una (pide escribir RESTAURAR; --dry-run muestra el plan sin tocar nada)
BASE_PATH=/opt/imagina-base HEALTH_URL=http://127.0.0.1:3001/api/v1/health/ready \
  /opt/imagina-base/current/deploy/snapshot-restore.sh \
  /opt/imagina-base/shared/backups/imagina-snapshot-20260914T030500Z-v0.1.179.tar
```

Qué pasa: verifica checksums → compara versiones → `systemctl stop imagina-api`
→ copia previa de la base → `DROP SCHEMA` + `pg_restore` → uploads (los actuales
quedan en `uploads.pre-restore-<ts>`) → Redis `platform:*` → migraciones
pendientes → `systemctl start` → health-check.

**Versiones.** Un snapshot MÁS VIEJO que el código instalado es normal: las
migraciones que faltan se aplican al final. Un snapshot MÁS NUEVO que el
código se rechaza (el esquema tendría migraciones que ese código no conoce):
primero actualizá el código (Plataforma → Actualizaciones, o rollback al
release correcto) y después restaurá. `--force-version` sólo si sabés lo que
hacés.

**Deshacer el restore**: `TARGET_DATABASE_URL=$DATABASE_URL ./restore.sh shared/backups/pre-restore-<ts>.dump`
(+ mover `uploads.pre-restore-<ts>` de vuelta).

## Escenario 2 — Migrar la app entera a otro servidor

En el servidor **viejo**:

```bash
BASE_PATH=/opt/imagina-base /opt/imagina-base/current/deploy/snapshot.sh
scp /opt/imagina-base/shared/backups/imagina-snapshot-<ts>-v<ver>.tar nuevo:/tmp/
```

En el servidor **nuevo** (Node 22, Docker, `unzip`, `curl`; Postgres + Redis
levantados con `deploy/docker-compose.prod.yml` y el MISMO `.env` — el
snapshot lo trae, `bootstrap-server.sh` lo instala en `shared/.env.production`;
si cambian dominio o URLs, editalo después):

```bash
mkdir -p /opt/imagina-base && cd /opt/imagina-base
# Postgres + Redis (una vez). El .env sale del snapshot:
tar -xOf /tmp/imagina-snapshot-<ts>-v<ver>.tar --wildcards '*/env.production' > shared/.env.production 2>/dev/null || true
docker compose -f <ruta>/docker-compose.prod.yml --env-file shared/.env.production up -d

# Todo lo demás en un comando: descarga el release de la MISMA versión desde
# GitHub Releases (verifica su .sha256), lo instala como release activo,
# restaura base + archivos + Redis y (con --install-service) deja el API
# corriendo por systemd.
BASE_PATH=/opt/imagina-base ./bootstrap-server.sh --snapshot /tmp/imagina-snapshot-<ts>-v<ver>.tar --install-service --yes
```

> `bootstrap-server.sh` está en el release (`current/deploy/`) y en el repo
> (`scripts/`); usa el `snapshot-restore.sh` y el `redis-kv.mjs` que estén
> **junto a él**, así que copiá los tres juntos. Repo privado:
> `UPDATER_GITHUB_TOKEN=...`. Otra versión: `--version x.y.z` (nunca más vieja
> que la del snapshot).
>
> Este escenario se ensayó completo en v0.1.180 (snapshot → servidor limpio →
> bundle real de GitHub → restore → API arriba con los mismos datos). Antes de
> una migración de verdad, hacé el mismo ensayo en una VM descartable con TU
> snapshot: es la única forma de saber que tu `.env` y tus datos pasan.

Después: Caddy/nginx (`docs/runbook-deploy.md` §6, una vez por servidor),
`sudoers` para el updater, y **apuntar el DNS** al servidor nuevo. Como el
snapshot lleva los mismos secretos, las sesiones del portal, las URLs
firmadas y los SMTP/2FA siguen funcionando; los usuarios del admin vuelven a
iniciar sesión (las sesiones viven en Redis y son efímeras a propósito).

Con `STORAGE_DRIVER=s3` los archivos no viajan en el snapshot: apuntá el
servidor nuevo al mismo bucket (o replicalo).

## Escenario 3 — Migrar UNA empresa (tenant) a otra instancia

Para partir un servidor en dos, venderle una empresa a otro operador o sacar a
un cliente de la nube compartida a la suya. Todo desde **Plataforma → Migrar
empresas** (superadmin). ADR-S23.

1. **En el servidor de ORIGEN**: elegí la empresa y tocá **Exportar**. Deja un
   `imagina-tenant-<slug>-<fecha>.tar` con sus listas, campos, registros
   (incluidas subtareas y descripciones), vistas, tableros, automatizaciones,
   comentarios, actividad, archivos subidos y miembros. Descargalo.
2. **En el servidor de DESTINO**: **Subir archivo (.tar)**, después
   **Importar acá**. Podés cambiarle el nombre y el identificador; si el
   identificador ya está ocupado se usa el siguiente libre (`acme` → `acme-2`).
3. **Revisá los avisos del import.** Son acciones pendientes, no ruido:
   - El **enlace público** de cada lista es nuevo → hay que volver a repartirlo.
   - La **URL de los webhooks entrantes** es nueva → actualizá el sistema que
     los llama.
   - El **dominio propio** no viaja (es único global y apunta al servidor
     anterior): configuralo en Ajustes → Marca y movele el DNS.
   - Si el destino tiene otra `SECRETS_KEY`, **no viajaron** la contraseña
     SMTP, la clave de IA, las credenciales de los conectores ni los segundos
     factores: hay que volver a cargarlos.
4. **Las personas se deduplican por email**: quien ya tenía cuenta en el
   destino se vincula (conserva su contraseña y su 2FA); el resto se crea con
   su hash, así que entran con la misma contraseña de siempre. Las **sesiones
   abiertas no viajan**: todos vuelven a iniciar sesión.
5. **La empresa de origen queda intacta.** Migrar es COPIAR: si algo sale mal,
   el cliente sigue operando donde estaba. Recién cuando verificaste el destino
   (entrar, ver listas y registros, descargar un adjunto) dás de baja la
   original desde Plataforma → Empresas.

> Con `STORAGE_DRIVER=s3` los bytes de los adjuntos igual viajan DENTRO del
> archivo: el import los vuelve a subir al storage del destino con claves
> nuevas. No hace falta compartir el bucket.

**Por CLI** (mismo efecto, útil para automatizar):

```bash
curl -sS -X POST "$API/api/v1/platform/tenants/$ID/export" \
  -H 'content-type: application/json' -b cookies.txt \
  -d '{"include_runs":true,"include_files":true}'
curl -sS "$API/api/v1/platform/transfers/$NOMBRE/download" -b cookies.txt -o empresa.tar
# en el destino
curl -sS -X POST "$API2/api/v1/platform/transfers/upload" -b cookies2.txt -F file=@empresa.tar
curl -sS -X POST "$API2/api/v1/platform/transfers/$NOMBRE/import" \
  -H 'content-type: application/json' -b cookies2.txt -d '{"slug":"acme"}'
```

## Cadencia recomendada

| Qué | Cuándo | Dónde queda |
|---|---|---|
| Snapshot completo automático | diario (Plataforma → Copias, 03:05 UTC) | `shared/backups/`, conservar 14 |
| Copia fuera del servidor | diario, después del snapshot | S3/GCS/rsync a otra máquina (`BACKUP_GPG_RECIPIENT` para cifrar) |
| PITR (WAL) | continuo | ver `runbook-pitr.md` |
| Restore drill | mensual | restaurar el último snapshot en una VM/base scratch (`--no-service` contra otra `DATABASE_URL`) |

## Variables útiles

| Variable | Para qué |
|---|---|
| `BASE_PATH` | raíz del layout (`releases/ shared/ current`). Deriva todo lo demás |
| `BACKUPS_DIR` | guardar las copias en otro disco (el panel también lo usa) |
| `TRANSFERS_DIR` | dónde viven los archivos de migración por empresa (default: `<BACKUPS_DIR>/transfers`, o `shared/transfers`) |
| `BACKUP_GPG_RECIPIENT` | cifrar cada snapshot (`.tar.gpg`; se restaura por CLI con la clave) |
| `SNAPSHOT_KEEP` / `SNAPSHOT_INCLUDE_ENV` | retención y si viaja el `.env` (CLI; el panel usa sus ajustes) |
| `PG_CONTAINER` | sin `pg_dump`/`psql` en el host, se usan por `docker exec`. Redis no necesita CLI: los scripts hablan RESP con `redis-kv.mjs` (Node puro, viaja junto a ellos) |
| `STOP_CMD` / `START_CMD` / `SERVICE` | otro supervisor que no sea systemd (`pm2 stop …`) |
