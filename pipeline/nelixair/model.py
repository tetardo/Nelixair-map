"""Format interne source-agnostique (« nelixair-nav v1 »).

Chaque source (FAA CIFP, OpenAIP, plus tard une source mondiale sous licence)
produit uniquement des `Fix` et des `Airway`. Tout l'aval (fusion, export
GeoJSON, tuiles, index de recherche) ne connaît que ces types.

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


Record = "Fix | Airway"


def dump_ndjson(records: Iterable, path: str) -> int:
    n = 0
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(json.dumps({"kind": "header", "format": "nelixair-nav", "version": FORMAT_VERSION}) + "\n")
        for r in records:
            r.validate()
            fh.write(json.dumps(asdict(r), ensure_ascii=False, separators=(",", ":")) + "\n")
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
            else:
                raise ValueError(f"kind inconnu {kind!r}")
