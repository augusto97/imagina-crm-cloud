#!/bin/sh
# Crea el usuario de pruebas e2e@test.local (superadmin por PLATFORM_SUPERADMINS
# en start-api.sh) con su empresa. En una base nueva queda como tenant 1, que
# es el que asumen los scripts E2E (X-Tenant-Id: 1).
curl -s -X POST localhost:3001/api/v1/auth/register -H 'content-type: application/json' \
    -d '{"email":"e2e@test.local","password":"Superadmin-pass-1","name":"E2E","workspace_name":"Empresa E2E"}' \
    -o /dev/null -w "registro superadmin: HTTP %{http_code} (409 = ya existía)\n"
