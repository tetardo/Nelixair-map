# nelixair-map

Carte web mondiale des **voies aériennes**, **waypoints** et **navaids**, au style
d'une carte en route IFR. Site 100 % statique : MapLibre GL + tuiles vectorielles
PMTiles, hébergeable sur GitHub Pages ou n'importe quel CDN.

> ⚠️ **Ne pas utiliser pour la navigation.** Carte d'illustration, sans garantie.

## Couverture des données

| Source | Contenu | Zone | Licence |
|--------|---------|------|---------|
| [FAA CIFP](https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/cifp/) | voies aériennes, waypoints, VOR/DME/TACAN/NDB | États-Unis | domaine public |
| [OpenAIP](https://www.openaip.net) | VOR/DME/TACAN/NDB | monde | **CC BY-NC 4.0** |

Conséquences à connaître :

- **Hors États-Unis, il n'y a que les navaids**, pas de voies aériennes ni de
  waypoints. Aucune source mondiale gratuite et redistribuable ne publie les
  voies aériennes. Pour le monde entier, il faut une source sous licence
  (ARINC 424 d'un fournisseur de données) dont le contrat autorise une diffusion
  publique. Le pipeline est prêt pour ça, voir [docs/FORMAT.md](docs/FORMAT.md).
- **OpenAIP impose un usage non commercial** et une attribution (affichée sur la carte).
  Un usage commercial exige de retirer OpenAIP ou d'obtenir une autre licence.
- Les données X-Plane, Navigraph, Jeppesen, etc. ne sont **pas** utilisées : leurs
  licences interdisent la redistribution.

## Fonctionnalités

- Voies hautes / basses colorées, identifiant en cartouche, MEA aux grands zooms
- Symboles VOR, VOR/DME, VORTAC, TACAN, DME, NDB, waypoint
- Clic : popup (fréquence, coordonnées DMS, région, cycle, source) ; clic sur une
  voie : tronçon, distance, route vraie, MEA, et surbrillance de toute la voie
- Recherche d'ident (navaid, waypoint ou voie), clavier `/` pour focaliser
- Habillage type EFB : barre d'outils sombre, carte en mode jour ou nuit (mémorisé)
- Couches activables, échelle en NM, coordonnées du curseur, cycle des données
- Tracés en grand cercle, coupure correcte à l'antiméridien
- Lien partageable (position dans l'URL)

## Architecture

```
sources brutes ──adaptateurs──▶ format interne NDJSON ──fusion──▶ GeoJSON ──tippecanoe──▶ nav.pmtiles
 (CIFP, OpenAIP,                 (docs/FORMAT.md)                 + search.json                │
  futur ARINC mondial)                                            + meta.json                  ▼
                                                                              web/ (MapLibre, statique)
```

```
pipeline/            Python 3.10+, bibliothèque standard uniquement
  build.py           CLI : fetch | ingest | export | all
  nelixair/model.py  format interne (Fix, Airway)
  nelixair/sources/  un adaptateur par source
  nelixair/merge.py  déduplication multi-sources, résolution des voies
  nelixair/export.py GeoJSON + index de recherche + métadonnées
  tests/             tests unitaires + fixtures ARINC 424 synthétiques
scripts/build.sh     chaîne complète jusqu'aux PMTiles
web/                 front statique (index.html, app.js, symbols.js, config.js)
```

## Build local

Prérequis : Python ≥ 3.10, [tippecanoe](https://github.com/felt/tippecanoe) ≥ 2.17.

```bash
# clé gratuite sur https://www.openaip.net (Profil > API) ; sans clé : US uniquement
export OPENAIP_API_KEY=...
scripts/build.sh                      # télécharge le cycle CIFP en vigueur + OpenAIP, construit les tuiles
python3 -m http.server -d web 8000    # http://localhost:8000
```

Sans tippecanoe, le front sait lire le GeoJSON directement (pratique pour développer
sur une petite zone, trop lourd pour la donnée complète) :

```bash
python3 pipeline/build.py all --cifp pipeline/tests/fixtures/FAACIFP18.sample \
  --openaip pipeline/tests/fixtures/openaip_navaids.json
mkdir -p web/data && cp build/*.geojson build/*.json web/data/
python3 -m http.server -d web 8000    # ouvrir http://localhost:8000/?geojson
```

Tests : `python3 -m unittest discover -s pipeline/tests`

## Déploiement (GitHub Pages)

1. *Settings → Pages → Source* : **GitHub Actions**.
2. *Settings → Secrets → Actions* : ajouter le secret `OPENAIP` (clé API OpenAIP).
3. Le workflow `deploy.yml` tourne à chaque push sur `main`, chaque jeudi
   (nouveau cycle CIFP récupéré automatiquement) et à la demande.

GitHub Pages sert les requêtes HTTP Range nécessaires à PMTiles. Pour un autre
hébergeur, vérifier ce point et servir `nav.pmtiles` avec CORS si le domaine diffère.

## Configuration du front

`web/config.js` : chemins des données, style de fond (OpenFreeMap par défaut,
sans clé), polices, attribution, vue initiale.

## Licence du code

À définir par le propriétaire du dépôt. Les données gardent leurs licences propres (tableau ci-dessus).
