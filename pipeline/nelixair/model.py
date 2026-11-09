"""Format interne source-agnostique (« nelixair-nav v1 »).

Chaque source (FAA CIFP, OpenAIP, plus tard une source mondiale sous licence)
produit uniquement des `Fix`, `Airway`, `Airport`, `Airspace` et `MoraCell`.
Tout l'aval (fusion, export GeoJSON, tuiles, index de recherche) ne connaît que ces types.

Sérialisation : NDJSON, un objet par ligne, champ `kind` = "fix" | "airway".
Voir docs/FORMAT.md pour la spécification complète.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from typing import Iterable, Iterator, Optional

FORMAT_VERSION = 1

# Classes de points reconnues. Toute source doit mapper vers l'une d'elles.
FIX_CLASSES = (
    "waypoint",   # point RNAV / intersection
    "vor",
    "vordme",
    "vortac",
    "tacan",
    "dme",
    "ndb",
)
NAVAID_CLASSES = frozenset(FIX_CLASSES) - {"waypoint"}

# Niveau d'une voie aérienne : H = haute altitude, L = basse, B = les deux.
AIRWAY_LEVELS = ("H", "L", "B")


@dataclass
class Fix:
    ident: str                 # ex. "BIGEE", "ABQ"
    cls: str                   # une valeur de FIX_CLASSES
    lat: float                 # WGS84, degrés décimaux
    lon: float
    src: str                   # ex. "faa-cifp", "openaip"
    region: str = ""           # code ICAO 2 lettres (ex. "K2", "LF"), "" si inconnu
    name: str = ""
    freq: Optional[float] = None   # MHz pour VOR/DME/TACAN, kHz pour NDB
    channel: str = ""          # canal TACAN/DME si connu
    country: str = ""          # ISO 3166-1 alpha-2 si connu
    cycle: str = ""            # cycle AIRAC / date de la donnée source
    kind: str = field(default="fix", init=False)

    @property
    def key(self) -> str:
        """Clé de jointure stable : ident + région + famille (wpt / navaid)."""
        return fix_key(self.ident, self.region, self.cls)

    def validate(self) -> None:
        if self.cls not in FIX_CLASSES:
            raise ValueError(f"classe inconnue {self.cls!r} pour {self.ident}")
        if not (-90 <= self.lat <= 90 and -180 <= self.lon <= 180):
            raise ValueError(f"coordonnées hors bornes pour {self.ident}: {self.lat},{self.lon}")
        if not self.ident:
            raise ValueError("ident vide")


def fix_family(cls: str) -> str:
    return "ndb" if cls == "ndb" else ("wpt" if cls == "waypoint" else "vhf")


def fix_key(ident: str, region: str, cls: str) -> str:
    return f"{ident}|{region}|{fix_family(cls)}"


@dataclass
class AirwayPoint:
    """Point d'une voie aérienne, référencé par clé (résolu à l'export)."""
    ident: str
    region: str
    cls: str                   # classe attendue (sert à la jointure)
    mea: Optional[int] = None  # altitude mini (ft) du tronçon partant de ce point
    max_alt: Optional[int] = None
    direction: str = ""        # "F" (sens séquence), "B" (sens inverse), "" (deux sens)

    @property
    def key(self) -> str:
        return fix_key(self.ident, self.region, self.cls)


@dataclass
class Airway:
    """Une portion continue d'une voie aérienne (une voie peut avoir plusieurs portions)."""
    ident: str                 # ex. "J60", "V16", "UN871"
    level: str                 # "H", "L" ou "B"
    src: str
    points: list[AirwayPoint]
    route_type: str = ""       # code brut de la source, informatif
    cycle: str = ""
    kind: str = field(default="airway", init=False)

    def validate(self) -> None:
        if self.level not in AIRWAY_LEVELS:
            raise ValueError(f"niveau inconnu {self.level!r} pour {self.ident}")
        if len(self.points) < 2:
            raise ValueError(f"voie {self.ident} avec moins de 2 points")


# Catégories d'aéroport (pilotent le zoom d'apparition et le symbole).
AIRPORT_KINDS = ("large", "medium", "small", "heliport", "seaplane")


@dataclass
class Airport:
    ident: str                 # code OACI si disponible, sinon identifiant local
    category: str              # une valeur de AIRPORT_KINDS
    lat: float
    lon: float
    src: str
    name: str = ""
    iata: str = ""
    elev_ft: Optional[int] = None
    rwy_ft: Optional[int] = None   # piste la plus longue
    rwy_surface: str = ""          # "hard", "soft", "water", ""
    ifr: bool = False
    military: bool = False
    country: str = ""
    region: str = ""
    cycle: str = ""
    # Pistes, une entrée par sens : {des, len_ft, wid_ft, surface, hdg, hdg_ref ("T" vrai / "M" magnétique)}
    runways: list = field(default_factory=list)
    # Fréquences : {type (TWR, APP, ATIS…), mhz, name}
    freqs: list = field(default_factory=list)
    kind_rec: str = field(default="airport", init=False, repr=False)

    def validate(self) -> None:
        if self.category not in AIRPORT_KINDS:
            raise ValueError(f"catégorie d'aéroport inconnue {self.category!r} pour {self.ident}")
        if not (-90 <= self.lat <= 90 and -180 <= self.lon <= 180):
            raise ValueError(f"coordonnées hors bornes pour {self.ident}")


# Groupes d'espaces aériens (affichage et filtres).
AIRSPACE_GROUPS = ("controlled", "special", "fir", "other")


@dataclass
class Airspace:
    name: str
    type: str                  # code normalisé : CTR, TMA, CTA, ATZ, R, P, D, FIR, UIR, TRA, TSA, ...
    group: str                 # une valeur de AIRSPACE_GROUPS
    rings: list                # [[ [lon, lat], ... ], ...] : anneau extérieur puis trous
    src: str
    icao_class: str = ""       # "A".."G" ou ""
    lower: str = ""            # libellé : "SFC", "2500 ft MSL", "FL115"
    upper: str = ""
    lower_ft: Optional[int] = None
    upper_ft: Optional[int] = None
    country: str = ""
    cycle: str = ""
    kind_rec: str = field(default="airspace", init=False, repr=False)

    def validate(self) -> None:
        if self.group not in AIRSPACE_GROUPS:
            raise ValueError(f"groupe inconnu {self.group!r} pour {self.name}")
        if not self.rings or len(self.rings[0]) < 4:
            raise ValueError(f"polygone invalide pour {self.name}")


@dataclass
class MoraCell:
    """Grid MORA : altitude minimale hors route d'un carré de 1°×1° (coin sud-ouest lat/lon)."""
    lat: int
    lon: int
    mora_ft: int
    src: str
    cycle: str = ""
    kind_rec: str = field(default="mora", init=False, repr=False)

    def validate(self) -> None:
        if not (-90 <= self.lat < 90 and -180 <= self.lon < 180):
            raise ValueError(f"cellule MORA hors bornes {self.lat},{self.lon}")


_KIND_OF = {Fix: "fix", Airway: "airway", Airport: "airport", Airspace: "airspace", MoraCell: "mora"}


def dump_ndjson(records: Iterable, path: str) -> int:
    n = 0
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(json.dumps({"kind": "header", "format": "nelixair-nav", "version": FORMAT_VERSION}) + "\n")
        for r in records:
            r.validate()
            d = asdict(r)
            d.pop("kind_rec", None)
            d["kind"] = _KIND_OF[type(r)]
            fh.write(json.dumps(d, ensure_ascii=False, separators=(",", ":")) + "\n")
            n += 1
    return n


def load_ndjson(path: str) -> Iterator:
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            kind = obj.pop("kind")
            if kind == "header":
                if obj.get("version") != FORMAT_VERSION:
                    raise ValueError(f"version de format non supportée: {obj.get('version')}")
                continue
            if kind == "fix":
                yield Fix(**obj)
            elif kind == "airway":
                obj["points"] = [AirwayPoint(**p) for p in obj["points"]]
                yield Airway(**obj)
            elif kind == "airport":
                yield Airport(**obj)
            elif kind == "airspace":
                yield Airspace(**obj)
            elif kind == "mora":
                yield MoraCell(**obj)
            else:
                raise ValueError(f"kind inconnu {kind!r}")
