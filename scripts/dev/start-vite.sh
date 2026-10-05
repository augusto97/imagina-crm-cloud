#!/bin/sh
# Front en modo desarrollo (proxy /api → 3001). --force: re-empaqueta las deps
# (si no, un @imagina-base/shared recién compilado no llega al navegador).
. "$(dirname "$0")/env.sh"
cd "$ROOT/apps/web"
exec npx vite --config vite.cloud.config.ts --port 5174 --strictPort --force > "$LOGS/vite.log" 2>&1
