#!/bin/sh
# Arranca el API compilado (apps/api/dist) con la config de desarrollo.
# Las variables de aquí pisan las de apps/api/.env.
. "$(dirname "$0")/env.sh"
cd "$ROOT/apps/api"
set -a; . ./.env; set +a
export NODE_ENV=development \
    DEV_ALLOW_PRIVATE_EGRESS=1 \
    SMTP_ALLOW_PRIVATE_HOSTS=true \
    RATE_LIMIT_AUTH_MAX=500 \
    PLATFORM_SUPERADMINS=${PLATFORM_SUPERADMINS:-e2e@test.local} \
    BACKUPS_DIR="$LOGS/backups" \
    SECRETS_KEY=clave-dev-para-secretos-32bytes \
    FILES_SIGNING_SECRET=firma-dev-para-archivos \
    MERCADOPAGO_API_URL=http://127.0.0.1:4898/mp \
    WOMPI_API_URL=http://127.0.0.1:4898/wompi \
    WOMPI_CHECKOUT_URL=http://127.0.0.1:4898/wompi-pay/
# El proxy de salida del contenedor usa su propia CA.
[ -f /root/.ccr/ca-bundle.crt ] && export NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt
exec node dist/main.js > "$LOGS/api.log" 2>&1
