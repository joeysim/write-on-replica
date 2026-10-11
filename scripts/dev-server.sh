#!/bin/bash
# Serve the page for development in an ordinary browser. Inside the app the same files
# are served from the bundle; here the native bridge is replaced by the shim in native.js.
set -euo pipefail
exec python3 -m http.server "${PORT:-4173}" --bind 127.0.0.1 --directory "$(dirname "$0")/../web"
