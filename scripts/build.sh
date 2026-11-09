#!/usr/bin/env bash
# Build complet : sources -> format interne -> GeoJSON -> PMTiles -> web/data/
#
#   OPENAIP_API_KEY=xxx scripts/build.sh          # télécharge puis construit
#   SKIP_FETCH=1 scripts/build.sh                  # réutilise data/raw/
#   CIFP=chemin.zip OPENAIP=chemin.json SKIP_FETCH=1 scripts/build.sh
#
# Prérequis : python3 (stdlib uniquement), tippecanoe >= 2.17 (sortie .pmtiles native).
set -euo pipefail
cd "$(dirname "$0")/.."

RAW=${RAW:-data/raw}
OUT=${OUT:-build}
SITE_DATA=${SITE_DATA:-web/data}

if [[ -z "${SKIP_FETCH:-}" ]]; then
  python3 pipeline/build.py fetch --raw "$RAW"
fi

args=(all --raw "$RAW" --out "$OUT")
[[ -n "${CIFP:-}" ]] && args+=(--cifp "$CIFP")
[[ -n "${OPENAIP:-}" ]] && args+=(--openaip "$OPENAIP")
[[ -n "${PRIORITY:-}" ]] && args+=(--priority "$PRIORITY")
python3 pipeline/build.py "${args[@]}"

command -v tippecanoe >/dev/null || { echo "tippecanoe introuvable (voir README)" >&2; exit 1; }

# -r1 : pas d'éclaircissement automatique des points, l'apparition est pilotée
#       par l'attribut tippecanoe.minzoom écrit à l'export (navaids z3, waypoints z6).
# --drop-densest-as-needed : garde-fou si une tuile dépasse 500 Ko.
tippecanoe \
  --force --quiet \
  -o "$OUT/nav.pmtiles" \
  -n "nelixair-nav" \
  -A "FAA CIFP (public domain) · OpenAIP (CC BY-NC 4.0)" \
  -Z2 -z11 -r1 \
  --drop-densest-as-needed \
  --no-tile-stats \
  -L fixes:"$OUT/fixes.geojson" \
  -L airways:"$OUT/airways.geojson"

mkdir -p "$SITE_DATA"
cp "$OUT/nav.pmtiles" "$OUT/search.json" "$OUT/routes.json" "$OUT/meta.json" "$SITE_DATA/"
echo "OK : $(du -h "$OUT/nav.pmtiles" | cut -f1) de tuiles -> $SITE_DATA/"
