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
[[ -n "${DTPP:-}" ]] && args+=(--dtpp "$DTPP")
python3 pipeline/build.py "${args[@]}"

# Cartes d'aéroport (plan au sol OSM, terrains pilotes). Bonus : un échec n'arrête pas le build.
GROUND_RAW=${GROUND_RAW:-$RAW/ground}
if [[ -z "${SKIP_FETCH:-}" ]]; then
  python3 pipeline/ground.py fetch --raw "$GROUND_RAW" || echo "AVERTISSEMENT : Overpass indisponible, cartes d'aéroport ignorées" >&2
fi
python3 pipeline/ground.py build --raw "$GROUND_RAW" --out "$OUT" || echo "AVERTISSEMENT : pas de plan au sol" >&2

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
  -L airways:"$OUT/airways.geojson" \
  -L airports:"$OUT/airports.geojson"

# Espaces aériens : fichier séparé (polygones, réglages différents, chargé seulement si affiché).
# --detect-longitude-wraparound : polygones qui traversent l'antiméridien (FIR du Pacifique).
tippecanoe \
  --force --quiet \
  -o "$OUT/airspaces.pmtiles" \
  -n "nelixair-airspaces" \
  -A "OpenAIP (CC BY-NC 4.0)" \
  -Z2 -z10 \
  --detect-longitude-wraparound \
  --drop-densest-as-needed \
  --no-tile-stats \
  -L airspaces:"$OUT/airspaces.geojson"

# Plan au sol : petits objets, visibles à partir du zoom 11 (-r1 : aucun point supprimé).
if [[ -s "$OUT/ground-index.json" && -s "$OUT/ground.geojson" ]]; then
  tippecanoe \
    --force --quiet \
    -o "$OUT/ground.pmtiles" \
    -n "nelixair-ground" \
    -A "© OpenStreetMap contributors (ODbL)" \
    -Z11 -z16 -r1 \
    --no-tiny-polygon-reduction \
    --no-tile-stats \
    -L ground:"$OUT/ground.geojson"
fi

mkdir -p "$SITE_DATA"
[[ -s "$OUT/ground.pmtiles" ]] && cp "$OUT/ground.pmtiles" "$OUT/ground-index.json" "$SITE_DATA/"
cp "$OUT/nav.pmtiles" "$OUT/airspaces.pmtiles" "$OUT/search.json" "$OUT/routes.json" \
   "$OUT/mora.geojson" "$OUT/meta.json" "$SITE_DATA/"
mkdir -p "$SITE_DATA/apt"
cp "$OUT"/apt/*.json "$SITE_DATA/apt/" 2>/dev/null || true
echo "OK : $(du -h "$OUT/nav.pmtiles" | cut -f1) navigation, $(du -h "$OUT/airspaces.pmtiles" | cut -f1) espaces -> $SITE_DATA/"
