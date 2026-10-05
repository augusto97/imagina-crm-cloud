#!/bin/sh
# Variables comunes del entorno de desarrollo. Lo cargan los demás scripts.
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
LOGS=${IMAGINA_DEV_LOGS:-/tmp/imagina-dev}
mkdir -p "$LOGS"
