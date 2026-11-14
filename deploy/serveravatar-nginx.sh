#!/usr/bin/env bash
# Repone la configuración de Nginx de Imagina Base en un servidor de ServerAvatar.
#
# ServerAvatar vuelve a escribir el archivo de Nginx de la app cada vez que se
# emite el certificado (por ejemplo, al sumar el dominio de una tienda o de una
# empresa) y se pierden los `location` de la app: la raíz da 403 y /api deja de
# llegar al API. Este script:
#   1. deja los `location` en un archivo aparte que el panel no toca
#      (/etc/nginx/imagina-base.locations);
#   2. en el archivo del sitio cambia el `location /` del panel por una línea
#      `include` hacia ese archivo;
#   3. guarda una copia, prueba con `nginx -t` (si falla, deja todo como estaba)
#      y recarga Nginx.
# Se puede correr las veces que haga falta.
#
# Uso:  sudo bash serveravatar-nginx.sh base.tu-dominio.com
set -euo pipefail

DOMAIN="${1:-}"
API="${IMAGINA_API:-127.0.0.1:3001}"
SNIPPET="${IMAGINA_NGINX_SNIPPET:-/etc/nginx/imagina-base.locations}"
BACKUPS="${IMAGINA_NGINX_BACKUPS:-/var/backups/imagina-base-nginx}"
TS=$(date -u +%Y%m%d%H%M%S)

fail() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "córrelo con sudo."
[ -n "$DOMAIN" ] || fail "falta el dominio de la app. Ejemplo: sudo bash $0 base.tu-dominio.com"
command -v nginx >/dev/null 2>&1 || fail "no encontré nginx en este servidor."

# 1. Archivos que Nginx carga y que declaran el dominio en server_name.
mapfile -t FOUND < <(nginx -T 2>/dev/null | awk -v d="$DOMAIN" '
  /^# configuration file / { f = $4; sub(/:$/, "", f); next }
  $1 == "server_name" {
    for (i = 2; i <= NF; i++) { n = $i; sub(/;$/, "", n); if (n == d) print f }
  }' | sort -u)
[ "${#FOUND[@]}" -gt 0 ] || fail "Nginx no tiene ningún sitio con server_name $DOMAIN."

FILES=()
for f in "${FOUND[@]}"; do FILES+=("$(readlink -f "$f")"); done
mapfile -t FILES < <(printf '%s\n' "${FILES[@]}" | sort -u)

echo "Sitio de $DOMAIN:"
printf '  %s\n' "${FILES[@]}"

# 2. Copias de seguridad (fuera de las carpetas que Nginx carga).
mkdir -p "$BACKUPS"
for f in "${FILES[@]}"; do cp -a "$f" "$BACKUPS/$(basename "$f").$TS"; done
[ -f "$SNIPPET" ] && cp -a "$SNIPPET" "$BACKUPS/imagina-base.locations.$TS"

restore() {
  for f in "${FILES[@]}"; do cat "$BACKUPS/$(basename "$f").$TS" > "$f"; done
  if [ -f "$BACKUPS/imagina-base.locations.$TS" ]; then
    cat "$BACKUPS/imagina-base.locations.$TS" > "$SNIPPET"
  fi
}

# 3. Los `location` de la app.
cat > "$SNIPPET.tmp" <<'NGINX'
# Imagina Base — lo incluye el sitio de la app. Lo escribe deploy/serveravatar-nginx.sh.

# API REST, webhooks y archivos.
location ^~ /api/ {
    proxy_pass http://__API__;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    client_max_body_size 25m;
}

# Descubrimiento OAuth del MCP (en la raíz del host).
location ^~ /.well-known/oauth- {
    proxy_pass http://__API__;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
}

# Tiempo real (Socket.io).
location ^~ /socket.io/ {
    proxy_pass http://__API__;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
}

# Tiendas con dominio propio: en el dominio de una tienda responde la tienda;
# en cualquier otro el API contesta 404 y se sirve la app.
location = / {
    proxy_pass http://__API__;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_intercept_errors on;
    error_page 404 502 503 504 = /cloud/index.html;
}
location ~ ^/(?:p/|sitemap\.xml$|robots\.txt$|_imagina/) {
    proxy_pass http://__API__;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_intercept_errors on;
    error_page 404 502 503 504 = /cloud/index.html;
}

# La app.
location ^~ /assets/ {
    try_files $uri =404;
    expires 30d;
    access_log off;
}
location /portal {
    try_files $uri /cloud-portal/index.html;
}
location / {
    try_files $uri /cloud/index.html;
}
NGINX
sed -i "s#__API__#$API#g" "$SNIPPET.tmp"
cat "$SNIPPET.tmp" > "$SNIPPET"
rm -f "$SNIPPET.tmp"

# 4. En el sitio: el `location /` del panel (y su `location = /robots.txt`)
#    se cambian por el include. Si ya está el include, no hay nada que cambiar.
for f in "${FILES[@]}"; do
  if grep -q "include $SNIPPET;" "$f" && ! grep -Eq '^[[:space:]]*location[[:space:]]+/[[:space:]]*\{' "$f"; then
    echo "  $f ya incluye $SNIPPET"
    continue
  fi
  awk -v snip="$SNIPPET" '
    function n(s, c) { return gsub(c, "", s) }
    skip {
      depth += n($0, "[{]") - n($0, "[}]")
      if (depth <= 0) skip = 0
      next
    }
    /^[[:space:]]*location[[:space:]]+\/[[:space:]]*[{]/ ||
    /^[[:space:]]*location[[:space:]]+=[[:space:]]*\/robots\.txt[[:space:]]*[{]/ {
      if ($0 ~ /location[[:space:]]+\/[[:space:]]*[{]/) {
        ind = $0; sub(/[^[:space:]].*$/, "", ind)
        print ind "include " snip ";  # Imagina Base"
        changed++
      }
      depth = n($0, "[{]") - n($0, "[}]")
      if (depth > 0) skip = 1
      next
    }
    { print }
    END { if (!changed) exit 3 }
  ' "$f" > "$f.imagina.tmp" || {
    rc=$?
    rm -f "$f.imagina.tmp"
    restore
    if [ "$rc" -eq 3 ]; then
      fail "no encontré un 'location /' en $f para cambiarlo. No toqué nada. Mándame el contenido de ese archivo (sudo cat $f)."
    fi
    fail "no pude editar $f. No toqué nada."
  }
  cat "$f.imagina.tmp" > "$f"
  rm -f "$f.imagina.tmp"
  echo "  $f: listo"
done

# 5. Probar y recargar.
if ! nginx -t; then
  restore
  fail "Nginx no aceptó la configuración. Dejé todo como estaba. Mándame lo que dice arriba."
fi
if command -v systemctl >/dev/null 2>&1; then systemctl reload nginx; else nginx -s reload; fi
echo
echo "Nginx recargado. Copias en $BACKUPS (.$TS)."

# 6. Comprobar desde el propio servidor.
if command -v curl >/dev/null 2>&1; then
  sleep 1
  root=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN/" || true)
  api=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN/api/v1/health/live" || true)
  echo "  https://$DOMAIN/                     -> $root"
  echo "  https://$DOMAIN/api/v1/health/live   -> $api"
  if [ "$api" != "200" ]; then
    echo
    echo "El API no respondió. Revisa el servicio: sudo systemctl status imagina-api"
  else
    echo
    echo "Todo bien: la app debería abrir otra vez."
  fi
fi
