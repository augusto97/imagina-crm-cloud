# Runbook — Backups y restore drill (F5)

> Operación de respaldo y recuperación de Imagina Base. Cumple la promesa de
> ADR-S09 (los datos del cliente nunca se pierden) y STANDALONE §14
> ("backups cifrados; restore drill mensual").

## Objetivos (RPO / RTO)

- **RPO** (pérdida máxima aceptable): ≤ 24 h con backup lógico diario; ≤ 5 min
  con PITR (WAL archiving) — ya implementado, ver **`docs/runbook-pitr.md`**.
- **RTO** (tiempo de recuperación): ≤ 1 h para restaurar el último dump en una
  instancia nueva.

## Qué se respalda

Backup lógico con `pg_dump` en **formato custom** (comprimido, restaurable de
forma selectiva). Incluye todo el schema `public`: `tenants`, `users`,
`memberships`, `lists`, `fields`, `records`, `saved_views`, `comments`,
`activity`, `automations`, `portal_links` — con sus políticas RLS y datos.

Redis (sesiones, colas BullMQ, magic links) **no** se respalda: es estado
efímero/reconstruible. Las sesiones caídas se re-crean con login; los job
schedulers de BullMQ persisten en Redis pero se re-siembran al bootear.

## Scripts

| Script | Qué hace |
|---|---|
| `scripts/backup.sh` | `pg_dump` custom + gzip, timestamp UTC, cifrado GPG opcional, retención por días. |
| `scripts/restore.sh` | Restaura un `.dump`/`.dump.gpg` en `TARGET_DATABASE_URL` (`--clean --if-exists`). |
| `scripts/backup-restore-drill.sh` | Backup → restore en base scratch efímera → verificación → limpieza. Falla si el backup no es restaurable. |

### Backup diario (cron)

```bash
DATABASE_URL=postgres://user:pass@host:5432/imagina_base \
BACKUP_DIR=/var/backups/imagina-base \
BACKUP_GPG_RECIPIENT=ops@imagina.base \
BACKUP_RETENTION_DAYS=30 \
  ./scripts/backup.sh
```

Recomendado: subir el `.dump.gpg` a almacenamiento off-site (S3/GCS) con
versionado y lifecycle. **Nunca** guardar la llave GPG privada junto a los
backups.

### Restore

```bash
TARGET_DATABASE_URL=postgres://user:pass@host:5432/imagina_base_restore \
  ./scripts/restore.sh /var/backups/imagina-base/imagina-base-XXXX.dump.gpg
```

⚠️ Verificá dos veces el `TARGET_DATABASE_URL`: `--clean` sobrescribe objetos.
Nunca apuntes a producción salvo en un DR real y planificado.

## Restore drill (mensual)

Un backup sin restore probado no es un backup. Correr **mensualmente** (cron o
CI):

```bash
DATABASE_URL=postgres://user:pass@host:5432/imagina_base \
  ./scripts/backup-restore-drill.sh
```

Verifica: (1) el dump se crea y no está vacío; (2) el restore en una base
scratch termina sin error; (3) coincide el set de tablas del schema public;
(4) coincide el conteo exacto de `users`; (5) el total estimado de tuplas
coincide ±2%. Sale con código ≠ 0 ante cualquier discrepancia y borra la base
scratch al terminar (incluso si falla).

## Post-restauración (checklist)

1. Correr migraciones pendientes: `pnpm --filter @imagina-base/api db:migrate`.
2. Verificar `GET /health/ready` → 200.
3. Revisar `GET /metrics` (errores/latencia) tras encender tráfico.
4. Confirmar que el worker de automatizaciones re-sembró los schedulers
   (los repeatable jobs de BullMQ viven en Redis, no en el dump).
