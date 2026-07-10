# Runbook — PITR (Point-In-Time Recovery / WAL archiving) (F5)

> Recuperación a un **instante arbitrario** de Imagina Base, no sólo al último
> dump lógico. Cierra el último ítem de F5 y completa STANDALONE §14/§17
> ("archivado continuo de WAL; restore a cualquier punto"). Complementa —no
> reemplaza— al backup lógico de `docs/runbook-backups.md`.

## Por qué, además del dump lógico

El backup lógico (`scripts/backup.sh`, `pg_dump`) restaura al **momento del
dump**: si el dump es de las 03:00 y un `DROP TABLE` accidental (o una
corrupción) ocurre a las 14:30, se pierden esas ~11.5 h. PITR elimina esa
ventana: con un **base backup físico** + el **WAL archivado continuamente** se
puede "viajar" a *cualquier* segundo entre el base backup y el último WAL.

- **Backup lógico** → portátil, selectivo, ideal para migrar/clonar. RPO ~24 h.
- **PITR (físico + WAL)** → recuperación fina ante desastre. **RPO ≤ 5 min**.

Se usan **los dos**: el lógico para portabilidad y el físico/WAL para el DR real.

## Objetivos (RPO / RTO)

- **RPO** (pérdida máxima): **≤ 5 min**. Lo garantiza `archive_timeout=300`:
  aunque haya poca escritura, Postgres corta y archiva un segmento de WAL cada
  5 min. Con escritura activa, el RPO es aún menor (se archiva al llenar 16 MB).
- **RTO** (tiempo de recuperación): **≤ 1 h** — descomprimir el base backup +
  replay del WAL hasta el target. Domina el tamaño de la base y cuánto WAL hay
  que reproducir desde el último base backup (por eso el base backup es
  **diario**: acota el replay).

## Cómo está configurado (producción)

`deploy/docker-compose.prod.yml` levanta Postgres con archivado continuo:

```
wal_level=replica
archive_mode=on
archive_command=test ! -f /wal_archive/%f && cp %p /wal_archive/%f
archive_timeout=300          # fuerza archivar cada 5 min (acota el RPO)
max_wal_senders=3            # habilita pg_basebackup por streaming
```

Cada segmento de WAL se copia al volumen **`walarchive`** (`/wal_archive`),
**separado de `pgdata` a propósito**: si se pierde el disco de datos, el WAL
sobrevive. El `archive_command` es idempotente (`test ! -f …` → no pisa un
segmento ya archivado; devuelve 0 sólo si la copia fue exitosa, condición para
que Postgres marque el segmento como archivado).

## Piezas

| Pieza | Qué hace |
|---|---|
| `deploy/docker-compose.prod.yml` | Postgres con `archive_mode=on` → WAL al volumen `walarchive`. |
| `scripts/basebackup.sh` | Base backup físico (`pg_basebackup -Ft -z -Xs`) + GPG/retención + poda de WAL vencido. |
| `scripts/pitr-restore.sh` | Restaura un base backup + replay del WAL hasta un `--target-time` (o al final). |
| `scripts/pitr-drill.sh` | Drill end-to-end en contenedores throwaway: prueba que el replay a un T elegido trae A y no B. |

## Operación

### 1. Base backup físico (diario, cron)

```bash
PG_CONTAINER=imagina-base-prod-postgres-1 \
BASEBACKUP_DIR=/var/backups/imagina-base/base \
WAL_ARCHIVE_DIR=/var/lib/docker/volumes/imagina-base-prod_walarchive/_data \
BACKUP_GPG_RECIPIENT=ops@imagina.base \
BASEBACKUP_RETENTION_DAYS=14 \
  ./scripts/basebackup.sh
```

Corre `pg_basebackup` **dentro** del contenedor (socket local, sin tocar
`pg_hba`), saca el tar por `docker cp`, opcionalmente lo cifra con GPG, aplica
retención y **poda el WAL** anterior al base backup retenido más viejo (con
`pg_archivecleanup`, best-effort). Frecuencia diaria: acota cuánto WAL hay que
reproducir en un restore (menor RTO).

### 2. Off-site (obligatorio)

Un backup en el mismo host no sobrevive a la pérdida del host. Sincronizar
**off-site** (S3/GCS con versionado + lifecycle), **juntos**:

- los base backups (`basebackups/base-*`), y
- el WAL archivado (volumen `walarchive`).

```bash
# ejemplo con rclone/aws — correr tras basebackup.sh
aws s3 sync /var/backups/imagina-base/base       s3://imagina-base-dr/base/
aws s3 sync /var/lib/docker/volumes/imagina-base-prod_walarchive/_data \
                                                 s3://imagina-base-dr/wal/
```

El WAL debe subirse **continuamente** (o en intervalos ≤ RPO), no sólo con el
base backup: es lo que baja el RPO a 5 min. **Nunca** guardar la llave GPG
privada junto a los backups.

### 3. Restore a un instante (DR)

```bash
# Traé el base backup + el WAL desde off-site primero, luego:
WAL_ARCHIVE_DIR=/restore/wal \
  ./scripts/pitr-restore.sh /restore/base-20260710T030000Z /srv/pg-restore \
      --target-time "2026-07-10 14:29:55+00"
```

- Sin `--target-time` → replay hasta el **final** del WAL disponible (máxima
  recuperación posible ante un desastre "recuperá todo lo que haya").
- Con `--target-time` → replay hasta ESE instante (p.ej. un segundo **antes**
  del `DROP TABLE` accidental) y **promote**.

El script **no toca el `pgdata` de producción**: restaura en un data-dir NUEVO
y levanta un contenedor efímero para el replay. Verificá ahí antes de promover:

```bash
docker exec -it imagina-pitr-restore psql -U postgres -c '\dt'
docker exec -it imagina-pitr-restore psql -U postgres -c 'SELECT count(*) FROM users;'
```

### 4. Promover el cluster restaurado

Una vez verificado, con el **API detenido** (`systemctl stop imagina-api`):

1. `docker rm -f imagina-pitr-restore` (soltá el data-dir restaurado).
2. Respaldá el pgdata viejo y apuntá el volumen `pgdata` al data-dir
   restaurado (o `docker cp`/`rsync` el contenido), luego
   `docker compose -f deploy/docker-compose.prod.yml up -d postgres`.
3. Post-restauración (igual que backups): correr migraciones pendientes
   (`pnpm --filter @imagina-base/api db:migrate`), `GET /health/ready` → 200,
   revisar `/metrics`, confirmar que el worker re-sembró los schedulers de
   BullMQ (viven en Redis, no en el WAL).
4. Reanudá el API (`systemctl start imagina-api`).

> Tras promover, el `walarchive` viejo contiene WAL posterior al punto de
> recuperación (la "línea de tiempo" anterior). Postgres arranca una timeline
> nueva; archivá/rotá el WAL viejo para no mezclar timelines en un restore
> futuro.

## Drill (mensual)

Un PITR sin probar no es PITR. Correr **mensualmente** (cron/CI):

```bash
./scripts/pitr-drill.sh
```

Levanta Postgres efímero con archivado, toma un base backup, inserta A →
`pg_switch_wal()` → anota T1, inserta B, y restaura a T1: verifica que el
cluster restaurado tiene **A pero no B**. Sale ≠ 0 si el replay no aterriza
exacto en T1. Todo en contenedores throwaway; no toca datos reales.

## Límites conocidos

- El `walarchive` **debe** sincronizarse off-site tan seguido como el RPO que
  se promete. Sin off-site del WAL, el RPO real es el del base backup diario.
- La poda de WAL (`basebackup.sh`) es best-effort; si falla, el WAL sólo crece
  (sin riesgo de pérdida). Monitorear el tamaño del volumen `walarchive`.
- PITR es **por-cluster**, no por-tenant: recupera toda la base. Para "deshacer"
  el error de un solo tenant sin revertir a los demás, restaurar a un cluster
  aparte (este runbook) y re-importar sólo ese tenant con el export JSON
  (STANDALONE §16).
