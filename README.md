<img src="web/public/img/nelixair-logo.svg" alt="Nelixair" width="64" align="right">

# nelixair-map

Carte web mondiale des **voies aériennes**, **waypoints**, **navaids**, **aéroports** et **espaces aériens**, au style
d'une carte en route IFR. Site 100 % statique : MapLibre GL + tuiles vectorielles
PMTiles, interface Vue 3 + TypeScript (Vite), hébergeable sur GitHub Pages ou n'importe quel CDN.

> ⚠️ **Ne pas utiliser pour la navigation.** Carte d'illustration, sans garantie.

## Captures d'écran

Générées automatiquement à chaque déploiement, sur les données réelles du cycle en cours.

| Vue d'accueil (France, calques) | Carte en route (US) |
|---|---|
| ![Vue d'accueil centrée sur la France](https://tetardo.github.io/Nelixair-map/screenshots/accueil-france.png) | ![Carte en route des États-Unis](https://tetardo.github.io/Nelixair-map/screenshots/carte.png) |
| **Europe, mode nuit** | **Fiche aéroport** (météo, pistes, fréquences, cartes FAA) |
| ![Espaces aériens autour de Paris, mode nuit](https://tetardo.github.io/Nelixair-map/screenshots/europe-nuit.png) | ![Fiche de KSFO](https://tetardo.github.io/Nelixair-map/screenshots/fiche-aeroport.png) |
| **Log d'une voie aérienne** | **Météo** (SIGMET / AIRMET, PIREP, satellite IR, zone de nuit) |
| ![Log de la voie J80](https://tetardo.github.io/Nelixair-map/screenshots/log-voie.png) | ![SIGMET, AIRMET, PIREP et satellite sur les États-Unis](https://tetardo.github.io/Nelixair-map/screenshots/meteo.png) |
| **Éphémérides** (lever, coucher, nuit aéronautique) | **Carte d'aéroport** (plan au sol OSM, vent par piste, LFML) |
| ![Fiche de KDEN, section Soleil](https://tetardo.github.io/Nelixair-map/screenshots/fiche-soleil.png) | ![Plan au sol de LFML](https://tetardo.github.io/Nelixair-map/screenshots/carte-aeroport-lfml.png) |
| **Carte d'aéroport, mode nuit** | **Piste : composantes de vent par QFU** |
| ![Plan au sol de LFML de nuit](https://tetardo.github.io/Nelixair-map/screenshots/carte-aeroport-lfml-nuit.png) | ![Popup de piste avec vent de face et de travers](https://tetardo.github.io/Nelixair-map/screenshots/piste-vent-lfml.png) |
| **Bulle de survol et surbrillance** | **Menu Affichage, vue satellite** |
| ![Survol d'une piste de LFML](https://tetardo.github.io/Nelixair-map/screenshots/survol-lfml.png) | ![Vue satellite de LFML avec le menu Affichage](https://tetardo.github.io/Nelixair-map/screenshots/satellite-lfml.png) |
| **Barre de navigation, panneau Aéroports** | **Plan de vol SimBrief (vol de démo)** |
| ![Barre verticale et liste des cartes d'aéroport](https://tetardo.github.io/Nelixair-map/screenshots/aeroports.png) | ![Route LFML-LFPO et nav log](https://tetardo.github.io/Nelixair-map/screenshots/plan-de-vol.png) |

## Couverture des données

| Source | Contenu | Zone | Licence |
|--------|---------|------|---------|
| [FAA CIFP](https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/cifp/) | voies aériennes, waypoints, VOR/DME/TACAN/NDB, aéroports, Grid MORA | États-Unis | domaine public |
| [OpenAIP](https://www.openaip.net) | VOR/DME/TACAN/NDB, aéroports, espaces aériens (CTR, TMA, zones R/P/D, FIR…) | monde | **CC BY-NC 4.0** |
| [FAA d-TPP](https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/dtpp/) | cartes d'approche, de départ, d'arrivée et diagrammes (liens vers les PDF officiels) | États-Unis | domaine public |
| [NOAA AWC](https://aviationweather.gov/data/api/) | METAR / TAF (monde), SIGMET (monde), AIRMET / G-AIRMET et PIREP (surtout US) ; relais toutes les 10 min | monde | domaine public |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) (via Overpass) | plans au sol : pistes, taxiways, aires de trafic, postes de stationnement, points d'attente, bâtiments | terrains pilotes : LFML, LFMN, LFLL, LFBO, LFPO | **ODbL 1.0** |
| [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a4) | imagerie aérienne et satellite (vue Satellite du menu Affichage), tuiles chargées par le navigateur | monde | conditions Esri, **usage non commercial** avec attribution |
| [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen) | relief ombré (vue Relief) | monde | données ouvertes, attribution |
| [NASA GIBS](https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api) | satellite infrarouge GOES-East, GOES-West, Himawari (Amériques, Pacifique, Asie ; **pas l'Europe ni l'Afrique**) | partielle | données NASA ouvertes |
| [SimBrief](https://developers.navigraph.com/docs/simbrief/fetching-ofp-data) (Navigraph) | plan de vol du pilote (OFP), lu à la demande par son navigateur ; rien n'est stocké côté serveur | monde | [conditions développeurs Navigraph](https://developers.navigraph.com) — à vérifier avant tout usage commercial |

Conséquences à connaître :

- **Hors États-Unis, il n'y a ni voies aériennes, ni waypoints, ni Grid MORA**
  (seulement navaids, aéroports et espaces aériens OpenAIP). Aucune source mondiale gratuite et redistribuable ne publie les
  voies aériennes. Pour le monde entier, il faut une source sous licence
  (ARINC 424 d'un fournisseur de données) dont le contrat autorise une diffusion
  publique. Le pipeline est prêt pour ça, voir [docs/FORMAT.md](docs/FORMAT.md).
- **OpenAIP impose un usage non commercial** et une attribution (affichée sur la carte).
  Un usage commercial exige de retirer OpenAIP ou d'obtenir une autre licence.
- **La vue Satellite (Esri) est aussi limitée au non commercial** : avec un abonnement payant,
  il faudra un compte Esri / ArcGIS payant ou une autre source d'imagerie.
- **Les cartes d'aéroport sont générées depuis OpenStreetMap** : données communautaires, non certifiées,
  complétude variable selon le terrain. Pas de SID / STAR / approches hors US (aucune source codée gratuite).
- Les données X-Plane, Navigraph, Jeppesen, etc. ne sont **pas** utilisées : leurs
  licences interdisent la redistribution.

## Fonctionnalités

- Voies hautes / basses colorées, identifiant en cartouche, MEA aux grands zooms
- Symboles VOR, VOR/DME, VORTAC, TACAN, DME, NDB, waypoint
- Clic : popup (fréquence, coordonnées DMS, région, cycle, source) ; clic sur une
  voie : tronçon, distance, route vraie, MEA, et surbrillance de toute la voie
- Recherche d'ident (navaid, waypoint ou voie), clavier `/` pour focaliser
- Barre de navigation verticale (icônes [Lucide](https://lucide.dev), licence ISC) : Fiche, Aéroports
  (cartes au sol disponibles), Liste, Calques ; en bas Affichage, jour / nuit, sources. Recliquer une
  section referme le panneau.
- Plan de vol : import du dernier OFP [SimBrief](https://www.simbrief.com) d'un pilote (pseudo ou Pilot ID, lu
  directement par le navigateur), route en magenta avec TOC / TOD et dégagement, nav log (altitude, route
  magnétique, distances, temps, carburant), carburant et masses. Bouton « Vol de démo » sans compte.
- Panneau latéral : filtres (voies hautes/basses, RNAV/conventionnelles, chaque classe de navaid,
  waypoints), liste triable des éléments à l'écran, fiche détaillée d'un point (voies qui y passent)
  et log d'une voie (MEA, route vraie, distance, cumul)
- Aéroports par catégorie (grand / moyen / petit / héliport / hydrobase, IFR en bleu, VFR en magenta),
  fiche avec METAR décodé (vent, visibilité, plafond, catégorie VFR/MVFR/IFR/LIFR), TAF, pistes (longueur,
  largeur, revêtement, QFU), fréquences (copiables d'un clic) et, aux US, cartes FAA d-TPP classées par type
- Espaces aériens : contrôlés (CTR, TMA, CTA…), zones R/P/D/TRA/TSA, FIR/UIR, autres (TMZ, RMZ…),
  avec classe et limites ; clic = liste des espaces sous le point
- Pastilles METAR colorées par catégorie de vol (zoom ≥ 5, données NOAA en direct)
- SIGMET / AIRMET en cours de validité, colorés par danger (orages, turbulence, givrage, IFR, cendres, cyclone),
  avec niveaux, validité et texte brut au clic
- PIREP (comptes rendus de pilotes) : couleur = intensité de turbulence, contour cyan = givrage
- Satellite infrarouge (NASA GIBS, rafraîchi toutes les 10 min ; absent sur l'Europe et l'Afrique, faute de
  Meteosat dans GIBS)
- Zone de nuit sur la carte, et dans la fiche aéroport : lever, coucher, début et fin de la nuit aéronautique
  (crépuscule civil, définition EASA), calcul local approché à ± 2 min
- Grid MORA (US) en milliers / centaines de pieds
- **Cartes d'aéroport** (terrains pilotes) : en zoomant sur le terrain, plan au sol à l'échelle (pistes et désignations
  aux seuils, taxiways avec identifiants en cartouche jaune, aires, postes numérotés, points d'attente, aérogares),
  jour et nuit ; bouton « Afficher le plan au sol » dans la fiche ; lien vers la page AD 2 de l'eAIP du SIA pour les
  terrains français, avec le cycle AIRAC en vigueur (calculé localement, 28 jours)
- Clic sur plusieurs objets superposés : liste de choix ; survol : nom de l'objet sous la souris
- Lien partageable vers une fiche (`?sel=KSFO`) ; raccourcis `/` (recherche), `F` (panneau), `Échap`
- Habillage type EFB : barre d'outils sombre, carte en mode jour ou nuit (mémorisé)
- Couches activables, échelle en NM, coordonnées du curseur, cycle des données
- Tracés en grand cercle, coupure correcte à l'antiméridien
- Lien partageable (position dans l'URL)

## Architecture

```
sources brutes ──adaptateurs──▶ format interne NDJSON ──fusion──▶ GeoJSON ──tippecanoe──▶ nav.pmtiles
 (CIFP, OpenAIP,                 (docs/FORMAT.md)                 + search.json, routes.json   │ + airspaces.pmtiles
                                                                  + mora.geojson               │
  futur ARINC mondial)                                            + meta.json                  │
OSM (Overpass) ──pipeline/ground.py──▶ ground.geojson ──tippecanoe──▶ ground.pmtiles ─────────┤
                                                                                              ▼
                                                        web/ (Vue 3 + MapLibre) ──Vite──▶ dist/ (statique)
```

```
pipeline/            Python 3.10+, bibliothèque standard uniquement
  build.py           CLI : fetch | ingest | export | all
  nelixair/model.py  format interne (Fix, Airway, Airport, Airspace, MoraCell)
  nelixair/sources/  un adaptateur par source
  nelixair/merge.py  déduplication multi-sources, résolution des voies
  nelixair/export.py GeoJSON + index de recherche + métadonnées
  tests/             tests unitaires + fixtures synthétiques (ARINC 424, OpenAIP, Overpass)
pipeline/ground.py   cartes d'aéroport : plan au sol OSM des terrains pilotes
scripts/build.sh     chaîne complète jusqu'aux PMTiles
web/                 front Vue 3 + TypeScript (Vite)
  src/config.ts      chemins des données, fond de carte, attribution
  src/map/           MapLibre : couches, thèmes jour/nuit, symboles, carte d'aéroport (ground.ts)
  src/components/    interface : barre d'outils, panneau, fiches
  src/services/      météo, soleil, index de recherche, détails aéroport
  src/lib/           formatage, géodésie, cycles AIRAC
  public/            fichiers statiques (logo)
```

## Build local

Prérequis : Python ≥ 3.10, [tippecanoe](https://github.com/felt/tippecanoe) ≥ 2.17, Node.js ≥ 20.

```bash
npm install                           # une fois : Vue, MapLibre, Vite
# clé gratuite sur https://www.openaip.net (Profil > API) ; sans clé : US uniquement
export OPENAIP_API_KEY=...
scripts/build.sh                      # télécharge CIFP + OpenAIP + plans au sol OSM, construit les tuiles dans web/data/
npm run dev                           # http://localhost:5173 (rechargement à chaud)
npm run build                         # typage + site final dans dist/ (données copiées)
```

Sans tippecanoe, le front sait lire le GeoJSON directement (pratique pour développer
sur une petite zone, trop lourd pour la donnée complète) :

```bash
python3 pipeline/build.py all --cifp pipeline/tests/fixtures/FAACIFP18.sample \
  --openaip pipeline/tests/fixtures/openaip_navaids.json
python3 pipeline/ground.py build --raw pipeline/tests/fixtures/ground   # plan au sol synthétique
mkdir -p web/data && cp build/*.geojson build/*.json web/data/
npm run dev                           # ouvrir http://localhost:5173/?geojson
```

Tests : `python3 -m unittest discover -s pipeline/tests`

## Déploiement (GitHub Pages)

1. *Settings → Pages → Source* : **GitHub Actions**.
2. *Settings → Secrets → Actions* : ajouter le secret `OPENAIP_API_KEY` (clé API OpenAIP).
3. Le workflow `deploy.yml` tourne à chaque push sur `main`, chaque jeudi
   (nouveau cycle CIFP récupéré automatiquement) et à la demande.

GitHub Pages sert les requêtes HTTP Range nécessaires à PMTiles. Pour un autre
hébergeur, vérifier ce point et servir les `.pmtiles` avec CORS si le domaine diffère.

La météo ne vient pas directement d'aviationweather.gov : son API refuse les appels depuis un
navigateur (pas de CORS). Le workflow `wx.yml` télécharge toutes les 10 minutes les fichiers de cache
mondiaux de la NOAA (METAR, TAF, AIRMET/SIGMET US, SIGMET internationaux, PIREP), les convertit (`pipeline/wx.py`) et les publie sur la branche `wx-data`, que le site
lit via `raw.githubusercontent.com`. Fraîcheur : 10 à 20 minutes (GitHub décale parfois les tâches
planifiées). GitHub suspend ces tâches après 60 jours sans activité sur le dépôt : les réactiver depuis
l'onglet *Actions*.

## Configuration du front

`web/src/config.ts` : chemins des données, style de fond (OpenFreeMap par défaut,
sans clé), polices, attribution, vue initiale, zoom maximal.

Terrains des cartes d'aéroport : liste `PILOT` de `pipeline/ground.py` (une requête Overpass par terrain,
à garder raisonnable : l'API Overpass est un service communautaire).

## Licence du code

À définir par le propriétaire du dépôt. Les données gardent leurs licences propres (tableau ci-dessus).
Icônes : [Lucide](https://lucide.dev/license) (ISC), compatible avec un usage commercial.
