#!/bin/sh
# Crea el usuario de pruebas e2e@test.local (superadmin por PLATFORM_SUPERADMINS
# en start-api.sh) con su empresa. En una base nueva queda como tenant 1, que
# es el que asumen los scripts E2E (X-Tenant-Id: 1).
#
# v0.1.273 — Directo en la base: el alta pública RECHAZA los emails de
# superadmin a propósito (SEC-04), así que el viejo `POST /auth/register`
# respondía 409 en una base nueva y el entorno quedaba sin usuario.
# Idempotente: si ya existe, no toca nada.
. "$(dirname "$0")/env.sh"
EMAIL=e2e@test.local
PASS=Superadmin-pass-1
PG=${IMAGINA_DEV_PG_CONTAINER:-imagina-base-postgres-1}
HASH=$(cd "$ROOT/apps/api" && node -e "require('argon2').hash(process.argv[1]).then((h) => process.stdout.write(h))" "$PASS")
docker exec -i "$PG" psql -q -U imagina -d imagina_base -v ON_ERROR_STOP=1 -v email="$EMAIL" -v hash="$HASH" <<'SQL'
with u as (
    insert into users (email, password_hash, name, email_verified_at)
    select :'email', :'hash', 'E2E', now()
    where not exists (select 1 from users where lower(email) = lower(:'email'))
    returning id
), t as (
    insert into tenants (slug, name)
    select 'empresa-e2e', 'Empresa E2E' from u
    returning id
)
insert into memberships (user_id, tenant_id, role)
select u.id, t.id, 'admin' from u, t;
SQL
echo "usuario de pruebas: $EMAIL / $PASS"
