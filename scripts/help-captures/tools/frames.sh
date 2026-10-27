#!/usr/bin/env bash
# Convierte los cuadros WebP de una demo a PNG para mirarlos (desarrollo).
#   bash scripts/help-captures/tools/frames.sh <clave>   → /tmp/learn-shots/<clave>-frame-N.png
set -e
KEY=$1
DIR=$(cd "$(dirname "$0")/../../.." && pwd)/apps/web/public/help-media/demos/$KEY
mkdir -p /tmp/learn-shots
for f in "$DIR"/*.webp; do
    n=$(basename "$f" .webp)
    ffmpeg -loglevel error -y -i "$f" "/tmp/learn-shots/$KEY-frame-$n.png"
    echo "/tmp/learn-shots/$KEY-frame-$n.png"
done
