#!/usr/bin/env bash
#
# v0.1.186 — Documentos de descubrimiento OAuth (RFC 8414 / RFC 9728) como
# ARCHIVOS ESTÁTICOS en la raíz del SPA, para que claude.ai / Claude Desktop
# puedan descubrir el servidor de autorización del MCP SIN tocar el proxy.
#
# Por qué: los clientes MCP piden `https://<host>/.well-known/oauth-authorization-server`
# en la RAÍZ del host. Los proxies del runbook mandan `/api/*` al API y TODO lo
# demás al SPA con fallback a index.html — así que esa URL devolvía un 200
# con el HTML de la app, y el cliente rompe al intentar parsearlo como JSON
# ("Failed to start MCP authorization"). Pero `try_files {path} …` sirve un
# archivo REAL antes del fallback: si el archivo existe en `web/.well-known/`,
# sale el JSON. El deploy lo genera en cada release con el origen público
# (APP_BASE_URL), que es lo único que la metadata necesita saber.
#
# La regla de proxy `/.well-known/oauth-*` → API (Caddyfile / nginx.conf)
# sigue siendo la opción PREFERIDA (responde por host: dominios propios de
# cada empresa, ADR-S17); esto es la red de seguridad para servidores donde
# nadie la agregó. Con la regla puesta, el proxy nunca llega a estos archivos.
#
# Uso: APP_BASE_URL=https://app.acme.com WEB_DIR=/opt/imagina-base/current/web \
#      bash oauth-discovery-static.sh
set -euo pipefail

: "${WEB_DIR:?Falta WEB_DIR (carpeta raíz del SPA)}"
BASE="${APP_BASE_URL:-}"
BASE="${BASE%/}"
if [ -z "$BASE" ] || [[ ! "$BASE" =~ ^https?://[^/[:space:]]+$ ]]; then
    echo "  (oauth-discovery: APP_BASE_URL vacío o inválido — no se generan los archivos estáticos)" >&2
    exit 0
fi

WK="${WEB_DIR}/.well-known"
mkdir -p "${WK}" "${WK}/oauth-protected-resource/api/v1"

AS_DOC=$(cat <<EOF
{
  "issuer": "${BASE}",
  "authorization_endpoint": "${BASE}/api/v1/oauth/authorize",
  "token_endpoint": "${BASE}/api/v1/oauth/token",
  "registration_endpoint": "${BASE}/api/v1/oauth/register",
  "revocation_endpoint": "${BASE}/api/v1/oauth/revoke",
  "response_types_supported": ["code"],
  "response_modes_supported": ["query"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none", "client_secret_basic", "client_secret_post"],
  "revocation_endpoint_auth_methods_supported": ["none", "client_secret_basic", "client_secret_post"],
  "scopes_supported": ["read", "full"],
  "service_documentation": "https://github.com/augusto97/imagina-crm-cloud/blob/main/docs/mcp.md"
}
EOF
)
PR_DOC=$(cat <<EOF
{
  "resource": "${BASE}/api/v1/mcp",
  "authorization_servers": ["${BASE}"],
  "scopes_supported": ["read", "full"],
  "bearer_methods_supported": ["header"],
  "resource_name": "Imagina Base MCP",
  "resource_documentation": "https://github.com/augusto97/imagina-crm-cloud/blob/main/docs/mcp.md"
}
EOF
)

# Servidor de autorización: forma raíz (RFC 8414) + la variante OpenID
# Discovery que algunos clientes prueban después.
printf '%s\n' "$AS_DOC" > "${WK}/oauth-authorization-server"
printf '%s\n' "$AS_DOC" > "${WK}/openid-configuration"
# Recurso protegido: forma path-aware (RFC 9728 §3.1, la que prueban primero
# los clientes que no leyeron el WWW-Authenticate). `oauth-protected-resource`
# tiene que ser DIRECTORIO para que exista `…/api/v1/mcp`; el API sirve la
# forma raíz bajo /api/v1/oauth/.well-known/ (que sí pasa por el proxy).
printf '%s\n' "$PR_DOC" > "${WK}/oauth-protected-resource/api/v1/mcp"
echo "  ✓ descubrimiento OAuth estático en ${WK} (issuer ${BASE})"
