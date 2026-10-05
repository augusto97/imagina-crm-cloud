#!/bin/sh
# Reinicia API + vite (después de un build del API o de tocar packages/shared).
. "$(dirname "$0")/env.sh"
for p in $(ps -eo pid,args | awk '$2=="node" && $3=="dist/main.js" {print $1}'); do kill $p; done
for p in $(ps -eo pid,args | grep "vite.cloud.config" | grep -v grep | awk '{print $1}'); do kill $p 2>/dev/null; done
sleep 1
rm -rf "$ROOT/apps/web/node_modules/.vite"
(setsid nohup sh "$ROOT/scripts/dev/start-api.sh" >/dev/null 2>&1 &)
(setsid nohup sh "$ROOT/scripts/dev/start-vite.sh" >/dev/null 2>&1 &)
for i in $(seq 1 40); do curl -s -o /dev/null -w "%{http_code}" localhost:3001/api/v1/health/live 2>/dev/null | grep -q 200 && break; sleep 1; done
curl -s localhost:3001/api/v1/health/ready; echo
for i in $(seq 1 40); do curl -s -o /dev/null localhost:5174/ && break; sleep 1; done
echo "API → http://localhost:3001  ·  app → http://localhost:5174  ·  logs en $LOGS"
