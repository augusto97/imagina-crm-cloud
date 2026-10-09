# Runbook — Espacio en disco del servidor

> v0.1.278. Nació de un servidor que se llenó: la actualización a v0.1.276
> falló con `No space left on device` mientras se descomprimía.

## 1. Qué ocupa lugar

| Qué | Dónde | Quién lo poda |
|---|---|---|
| Versiones de la app (cada una con sus `node_modules`) | `/opt/imagina-base/releases/` | El actualizador deja la activa + 2 anteriores (`UPDATER_KEEP_RELEASES`, default 3). |
| Copia de la base previa a cada actualización | `/opt/imagina-base/shared/backups/imagina-base-*.dump` | Quedan las 5 más nuevas (antes: 30 días → cientos). |
| Copias de seguridad diarias / manuales (ADR-S20) | `/opt/imagina-base/shared/backups/imagina-snapshot-*` | Su propia retención (Plataforma → Copias de seguridad). |
| Archivos subidos | `/opt/imagina-base/shared/uploads/` | Nadie: son datos de los clientes. |
| **Archivo de WAL de Postgres** (PITR) | volumen Docker `imagina-base-prod_walarchive` | Desde v0.1.278 el `archive_command` borra lo de más de 3 días. **Antes no lo podaba nadie**: cada segmento pesa 16 MB y con `archive_timeout=300` son hasta ~4,5 GB por día. |
| Base de datos | volumen Docker `imagina-base-prod_pgdata` | — |

## 2. Sin consola (desde v0.1.278)

**Plataforma → Diagnóstico → Disco**: espacio libre y total, cuánto ocupan
versiones, copias y archivos, y **«Liberar espacio»**. Ese botón borra lo
mismo que borra solo el actualizador cuando le falta lugar:

- lo que dejó una actualización cortada (zip, carpeta a medio extraer);
- versiones viejas (quedan la activa y las anteriores que se conservan);
- copias previas a cada actualización salvo las 5 más nuevas.

Nunca toca los datos, los archivos subidos ni las copias diarias.

Además, antes de cada actualización el actualizador mira el espacio libre
(mínimo `UPDATER_MIN_FREE_MB`, default 1024): si falta, limpia lo anterior y,
si igual no alcanza, corta con un mensaje que dice cuánto hay y cuánto hace
falta — sin descargar ni descomprimir nada.

## 3. Con consola (disco ya lleno, o el WAL)

Medir:

```bash
df -h /
sudo du -sh /opt/imagina-base/releases /opt/imagina-base/shared/backups /opt/imagina-base/shared/uploads
sudo docker system df -v | grep -i -E "walarchive|pgdata"
```

Liberar (nada de esto toca los datos de la base ni los archivos de clientes):

```bash
# a) Lo que dejó una actualización cortada
cur=$(readlink -f /opt/imagina-base/current)
sudo rm -f /opt/imagina-base/releases/*.zip
for d in /opt/imagina-base/releases/*/; do d=${d%/}; [ "$d" = "$cur" ] && continue; [ -d "$d/apps/api/dist" ] || sudo rm -rf "$d"; done

# b) Versiones viejas: quedan la actual y las 2 anteriores
ls -1dt /opt/imagina-base/releases/*/ | grep -v "$cur" | tail -n +3 | xargs -r sudo rm -rf

# c) Copias previas a cada actualización: quedan las 5 más nuevas
ls -1t /opt/imagina-base/shared/backups/imagina-base-*.dump* 2>/dev/null | tail -n +6 | xargs -r sudo rm -f

# d) Archivo de WAL: lo de más de 2 días (los datos viven en la base)
sudo docker exec imagina-base-prod-postgres-1 find /wal_archive -type f -mtime +2 -delete

# e) Docker y el log del sistema
sudo docker system prune -f
sudo journalctl --vacuum-size=200M
```

## 4. Activar la poda automática del WAL (una vez, en servidores existentes)

La poda vive en el `archive_command` del `docker-compose.prod.yml`. La
auto-actualización trae el archivo nuevo pero **no recrea el contenedor de
Postgres** (eso corta la base unos segundos y no lo hace sola). Una vez:

```bash
BASE=/opt/imagina-base
sudo docker compose -f "$BASE/current/deploy/docker-compose.prod.yml" \
  --env-file "$BASE/shared/.env.production" up -d postgres
# Comprobar que el comando nuevo está activo y archivando sin fallos:
sudo docker exec imagina-base-prod-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d postgres -tc "show archive_command" -tc "select archived_count, failed_count from pg_stat_archiver"'
```

Los datos no se tocan: `pgdata` y `walarchive` son volúmenes y sobreviven a
recrear el contenedor. La ventana de restauración a un instante (PITR) pasa a
ser de 3 días; para restaurar más atrás están las copias diarias.
