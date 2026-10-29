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
| **Archivo de WAL de Postgres** (PITR) | volumen Docker `imagina-base-prod_walarchive` | Desde v0.1.278 el `archive_command` borra lo de más de 3 días. **Antes no lo podaba nadie**: cada segmento pesa 16 MB y con `archive_timeout=300` son hasta ~4,5 GB por día. Desde v0.1.337 va comprimido (~16 KB por segmento casi vacío). |
| **WAL pendiente** (`pg_wal`) | dentro de `imagina-base-prod_pgdata` | Postgres lo borra solo **después de archivarlo**. Si el archivado se traba, crece sin límite — ver §7. |
| Base de datos | volumen Docker `imagina-base-prod_pgdata` | — |

## 2. Sin consola (desde v0.1.278)

**Plataforma → Diagnóstico → Disco**: espacio libre y total, cuánto ocupan
versiones, copias y archivos, y **«Liberar espacio»**. Ese botón borra lo
mismo que borra solo el actualizador cuando le falta lugar:

- lo que dejó una actualización cortada (zip, carpeta a medio extraer);
- versiones viejas (quedan la activa y las anteriores que se conservan);
- copias previas a cada actualización salvo las 5 más nuevas.

Nunca toca los datos, los archivos subidos ni las copias diarias.

Desde v0.1.337 la tarjeta además separa **Base de datos**, **Registro de cambios
(WAL)** y **Archivo del registro de cambios** (antes todo era «Base de datos,
sistema y otros»), dice si el archivado funciona y, si está trabado, ofrece
**«Liberar y reparar»** (§7). La revisión cada 15 minutos avisa por correo a los
superadmins si el archivado se traba o si el disco baja de 2 GB (o del 5 %).

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
#    Si lo grande es pg_wal (no /wal_archive), el archivado está trabado: §7.

# e) Docker y el log del sistema
sudo docker system prune -f
sudo journalctl --vacuum-size=200M
```

## 4. Aplicar la configuración nueva de Postgres (una vez, en servidores existentes)

La poda (v0.1.278), la compresión y el permiso de la carpeta (v0.1.337) viven en
el `docker-compose.prod.yml`. La auto-actualización trae el archivo nuevo pero
**no recrea el contenedor de Postgres** (eso corta la base unos segundos y no lo
hace sola). Mientras no se recree, la app repara el permiso, comprime el archivo
cada 15 minutos y avisa si algo se traba — así que esto es opcional. Para
dejarlo definitivo, una vez:

```bash
BASE=/opt/imagina-base
sudo docker compose -f "$BASE/current/deploy/docker-compose.prod.yml" \
  --env-file "$BASE/shared/.env.production" up -d postgres
# Comprobar que el comando nuevo está activo y archivando sin fallos:
sudo docker exec imagina-base-prod-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d postgres -tc "show archive_command" -tc "select archived_count, failed_count from pg_stat_archiver"'
```

Los datos no se tocan: `pgdata` y `walarchive` son volúmenes y sobreviven a
recrear el contenedor. La ventana de restauración a un instante (PITR) pasa a
ser de 3 días; para restaurar más atrás están las copias diarias. Con la
configuración nueva, `show archive_command` incluye `gzip` y los archivos de
`/wal_archive` terminan en `.gz`.

## 5. Sin inodos («No space left on device» con GB libres)

Un disco tiene dos límites: **bytes** y **cantidad de archivos** (inodos). Una
versión de la app trae ~36.000 archivos (`node_modules`), así que un servidor
puede quedarse sin inodos con decenas de GB libres — y el error es el mismo:
`No space left on device` (típicamente `checkdir error: cannot create …` al
descomprimir). El panel del proveedor (ServerAvatar) muestra sólo los bytes.

Desde v0.1.278 el actualizador mide también los inodos antes de descargar,
limpia lo que sobra y, si no alcanza, lo dice; y **Plataforma → Diagnóstico →
Disco** muestra la línea «Archivos». Pero la versión que está corriendo es la
que instala la siguiente: si el servidor ya se quedó sin inodos con una versión
anterior, hay que liberarlos una vez por consola.

Medir:

```bash
df -i /                                  # IUse% al 100% = sin inodos
sudo du --inodes -x -d 3 / 2>/dev/null | sort -n | tail -25   # quién los usa
ls -1d /opt/imagina-base/releases/*/ | wc -l                  # versiones guardadas
```

Liberar: los pasos **a**, **b** y **e** de la §3 (versiones viejas y lo que
dejó una actualización cortada son, de lejos, lo que más archivos tiene en la
app: ~36.000 cada una). Si `du --inodes` señala otra carpeta fuera de
`/opt/imagina-base` (cachés de npm/pnpm, sesiones de PHP, colas de correo,
capas de Docker), se limpia ahí. Después, «Actualizar» desde la app.

## 6. Por qué se juntaban versiones (y `KillMode=process`)

`finalize.sh` borraba las versiones viejas DESPUÉS de reiniciar el API, pero
`systemctl restart` mata todos los procesos del servicio (también ese script):
la poda nunca corría y un servidor juntó 173 versiones. Desde v0.1.278 la poda
la hace la versión nueva al arrancar, así que no hace falta nada más.

Opcional: el health-check con vuelta atrás automática de `finalize.sh` tampoco
llegaba a correr por el mismo motivo. Para que corra, una vez por consola:

```bash
sudo sed -i '/^\[Service\]/a KillMode=process' /etc/systemd/system/imagina-api.service
sudo systemctl daemon-reload
```

(No reinicia el API; aplica desde la próxima actualización.)

## 7. El archivado del WAL trabado (v0.1.337)

**Síntoma**: el disco se llena sin que la app crezca; en la consola,
`/var/lib/docker/volumes` pesa decenas de GB y casi todo es
`/var/lib/postgresql/data` (el `pg_wal`), mientras `/wal_archive` está vacío o
viejo. `pg_stat_archiver` muestra `failed_count` subiendo y `archived_count`
quieto.

**Por qué pasa**: Postgres borra un segmento de WAL recién después de
archivarlo. Si el `archive_command` falla, guarda todo — unos 2 a 4,5 GB por
día. Las dos causas conocidas:

- **la carpeta del archivo es de root** (todas las instalaciones anteriores a
  v0.1.337: Docker crea así el punto de montaje de un volumen nombrado y Postgres
  no puede escribir). Pasó en producción: 45 GB en 20 días, 0 archivados;
- **un archivo a medias** de un intento cortado: el comando viejo
  (`test ! -f …`) fallaba para siempre en ese segmento.

**Sin consola**: Plataforma → Diagnóstico → Disco lo muestra en rojo con el
motivo y el botón **«Liberar y reparar»**. Si el atraso entra holgado en el
disco libre, la revisión de cada 15 minutos repara el permiso sola.

**Con consola** (si la app no puede usar Docker, o el disco ya está lleno). EL
ORDEN IMPORTA: si se repara el permiso primero, Postgres copia el atraso entero
de golpe al mismo disco (700 MB por segundo, medido) y lo llena.

```bash
C=imagina-base-prod-postgres-1

# 1) Dar por archivados los pendientes (no copia nada)
sudo docker exec -u postgres $C sh -c 'cd /var/lib/postgresql/data/pg_wal/archive_status && n=0; for r in *.ready; do [ -e "$r" ] || continue; mv "$r" "${r%.ready}.done"; n=$((n+1)); done; echo "marcados: $n"'

# 2) Punto de control: Postgres borra lo que ya no necesita
sudo docker exec $C sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "checkpoint"'

# 3) Recién ahora, devolverle la carpeta a postgres
sudo docker exec $C chown postgres:postgres /wal_archive

# 4) Comprobar: pg_wal baja a ~1 GB (max_wal_size) y, en un par de minutos,
#    archived_count sube y failed_count se queda quieto
df -h /
sudo docker exec $C du -sh /var/lib/postgresql/data/pg_wal /wal_archive
sudo docker exec $C sh -c 'psql -U "$POSTGRES_USER" -d postgres -c "select archived_count, failed_count, last_archived_time from pg_stat_archiver"'
```

Se pierde sólo poder restaurar a un minuto exacto (PITR) del período trabado;
las copias de seguridad no se tocan. Si el archivado falla por otro motivo, el
detalle está en `sudo docker logs --tail 50 imagina-base-prod-postgres-1`.

**Para que no vuelva**: recrear el contenedor una vez (§4) deja el `entrypoint`
que arregla la carpeta en cada arranque y el comando comprimido, atómico e
idempotente. `scripts/pitr-drill.sh` prueba esa configuración tal cual.
