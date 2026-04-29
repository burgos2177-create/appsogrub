#!/usr/bin/env bash
# Bumpa el cache-buster de TODOS los <script src="js/...?v=..."> en index.html
# para forzar que los browsers descarguen las versiones nuevas tras un deploy.
# Uso (antes de commit + push):
#   bash bump-cache.sh
# O para usar el hash del último commit:
#   bash bump-cache.sh --git
set -e

if [[ "${1:-}" == "--git" ]]; then
  V=$(git log -1 --format=%h)
else
  V=$(date +%Y%m%d-%H%M)
fi

# Reemplaza ?v=<lo-que-sea> en cualquier <script src="js/...">
# Funciona con Git Bash en Windows y con bash en Linux/Mac.
perl -i -pe "s|(<script src=\"js/[^\"]+?)\?v=[A-Za-z0-9-]+|\1?v=${V}|g" index.html

echo "Cache-buster bumpeado a ?v=${V}"
git --no-pager diff --stat index.html || true
