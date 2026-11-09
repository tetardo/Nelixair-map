# Format interne `nelixair-nav` v1

Toutes les sources sont converties dans ce format avant toute autre étape.
Fusion, export GeoJSON, tuiles et index de recherche ne lisent que lui.
Ajouter une source revient donc à écrire **un seul adaptateur**.

## Fichier

NDJSON (un objet JSON par ligne), un fichier par source : `build/nav/<source>.ndjson`.
Première ligne : `{"kind":"header","format":"nelixair-nav","version":1}`.

## `fix`

| champ     | type          | obligatoire | description |
|-----------|---------------|-------------|-------------|
| `kind`    | `"fix"`       | oui | |
| `ident`   | string        | oui | identifiant publié (`BIGEE`, `ABQ`) |
| `cls`     | enum          | oui | `waypoint`, `vor`, `vordme`, `vortac`, `tacan`, `dme`, `ndb` |
| `lat`,`lon` | number      | oui | WGS84, degrés décimaux |
| `src`     | string        | oui | identifiant de la source (`faa-cifp`, `openaip`…) |
| `region`  | string        | non | code région OACI 2 caractères (`K2`, `LF`), `""` si inconnu |
| `name`    | string        | non | nom long |
| `freq`    | number\|null  | non | MHz (VHF) ou kHz (NDB) |
| `channel` | string        | non | canal TACAN/DME |
| `country` | string        | non | ISO 3166-1 alpha-2 |
| `cycle`   | string        | non | cycle AIRAC ou date de la donnée |

Clé de jointure : `ident|region|famille` avec famille ∈ `wpt`, `vhf`, `ndb`.

## `airway`

Une portion **continue** d'une voie. Une voie interrompue (ou qui change de
niveau) donne plusieurs enregistrements de même `ident`.

| champ        | type   | description |
|--------------|--------|-------------|
| `kind`       | `"airway"` | |
| `ident`      | string | `J60`, `V16`, `UN871` |
| `level`      | enum   | `H` (haute), `L` (basse), `B` (les deux) |
| `src`        | string | source |
| `points`     | array  | points ordonnés, voir ci-dessous (≥ 2) |
| `route_type` | string | code brut de la source, informatif |
| `cycle`      | string | |

Point : `{ident, region, cls, mea, max_alt, direction}`. `cls` sert seulement à
la jointure (famille). `mea`/`max_alt` en pieds s'appliquent au tronçon qui
**part** de ce point. `direction` : `F` (sens de la séquence), `B` (inverse), `""`.

## Fusion

Les sources sont lues par ordre de priorité (`--priority`, défaut
`faa-cifp,openaip`). Un fix est écarté si un fix de même ident et même famille,
issu d'une autre source déjà retenue, se trouve à moins de 3 NM. La clé du fix
écarté devient un alias vers le fix retenu : les voies de toutes les sources
restent résolues.

Un point de voie introuvable **coupe** la voie : aucun tronçon n'est deviné.
Le nombre de points non résolus est publié dans `meta.json` (`stats`).

## Brancher une source sous licence (ex. ARINC 424 mondial)

1. Écrire `pipeline/nelixair/sources/<nom>.py` exposant `parse(path) -> Iterator[Fix | Airway]`.
   Pour une source ARINC 424 complète, `faa_cifp.parse_lines` fonctionne déjà
   tel quel (le format est le même) : seul le filtrage de zone éventuel change.
2. L'ajouter dans `cmd_ingest` et `SOURCE_META` de `pipeline/build.py`.
3. La placer en tête de `--priority`.
4. Vérifier que la licence autorise la **diffusion publique** des tuiles.
