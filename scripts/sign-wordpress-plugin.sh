#!/bin/sh
# Firma el complemento de WordPress para el release (v0.1.335, ADR-S84 addendum).
#
#   RELEASE_SIGNING_KEY="<clave privada PEM ed25519>" sh scripts/sign-wordpress-plugin.sh <carpeta-del-complemento>
#
# Deja en la carpeta:
#   - includes/release-key.json  la clave PÚBLICA (con ella cada sitio verifica la PRÓXIMA versión)
#   - manifest.json              el SHA-256 de cada archivo (y la versión)
#   - manifest.sig               firma Ed25519 del manifiesto, en base64
#
# Es la misma clave que firma el bundle (SEC-37): vive en los secretos de
# GitHub, nunca en los servidores. Así, aunque alguien tomara un servidor de la
# app, no podría repartir una versión del complemento con su código: los sitios
# la rechazan antes de instalarla. Sin la clave, no hace nada (el complemento
# sale sin firmar, como antes).
#
# Ojo: `includes/update-source.json` NO entra en el manifiesto: lo agrega cada
# servidor al repartir el zip, y el complemento lo valida con su forma exacta.
set -eu
DIR=${1:?carpeta del complemento}
if [ -z "${RELEASE_SIGNING_KEY:-}" ]; then
    echo "sin RELEASE_SIGNING_KEY: el complemento sale sin firmar"
    exit 0
fi
[ -f "$DIR/imagina-base-connector.php" ] || { echo "no es la carpeta del complemento: $DIR" >&2; exit 1; }
KEY=$(mktemp)
SIG=$(mktemp)
trap 'rm -f "$KEY" "$SIG"' EXIT
umask 077
printf '%s\n' "$RELEASE_SIGNING_KEY" > "$KEY"

# La clave pública cruda (los últimos 32 bytes del DER de una clave ed25519).
PUB=$(openssl pkey -in "$KEY" -pubout -outform DER | tail -c 32 | base64 | tr -d '\n')
printf '{"ed25519":"%s"}\n' "$PUB" > "$DIR/includes/release-key.json"
rm -f "$DIR/manifest.json" "$DIR/manifest.sig" "$DIR/includes/update-source.json"

# El manifiesto: claves ordenadas, rutas con «/», sin los archivos de la firma.
node - "$DIR" <<'JS'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dir = process.argv[2];
const files = {};
const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const abs = path.join(d, e.name);
        const rel = path.relative(dir, abs).split(path.sep).join('/');
        if (e.isSymbolicLink()) throw new Error(`acceso directo en el complemento: ${rel}`);
        if (e.isDirectory()) walk(abs);
        else if (e.isFile() && !['manifest.json', 'manifest.sig', 'includes/update-source.json'].includes(rel)) {
            files[rel] = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
        }
    }
};
walk(dir);
const head = fs.readFileSync(path.join(dir, 'imagina-base-connector.php'), 'utf8').slice(0, 4096);
const version = /^\s*\*?\s*Version:\s*([0-9]+\.[0-9]+(?:\.[0-9]+)?)\s*$/im.exec(head)?.[1];
if (!version) throw new Error('el complemento no dice su versión');
const sorted = Object.fromEntries(Object.keys(files).sort().map((k) => [k, files[k]]));
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ plugin: 'imagina-base-connector', version, files: sorted }));
console.log(`manifiesto del complemento ${version}: ${Object.keys(sorted).length} archivos`);
JS

openssl pkeyutl -sign -inkey "$KEY" -rawin -in "$DIR/manifest.json" -out "$SIG"
base64 < "$SIG" | tr -d '\n' > "$DIR/manifest.sig"
echo "complemento firmado (clave pública $PUB)"
