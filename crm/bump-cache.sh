#!/usr/bin/env bash
# Cache-busting del CRM. index.html ya carga main.js con ?v=Date.now(), pero los
# imports estáticos entre módulos llevan ?v=<stamp> fijo y GitHub Pages los
# cachea: sin bumpearlos, un deploy queda a medias (main.js nuevo llamando
# módulos viejos). Correr ANTES de cada push que toque crm/js o crm/css:
#   bash crm/bump-cache.sh        (desde la raíz de appsogrub)
#   bash bump-cache.sh            (desde crm/)
set -e
cd "$(dirname "$0")"
V=$(date +%Y%m%d-%H%M)
find js -name '*.js' -print0 | xargs -0 perl -i -pe "s|(\.js)\?v=[A-Za-z0-9-]+|\1?v=${V}|g"
perl -i -pe "s|(href=\"css/[^\"]+?)\?v=[A-Za-z0-9-]+|\1?v=${V}|g" index.html
echo "CRM: cache-buster ?v=${V} en js/**/*.js e index.html (css)"
