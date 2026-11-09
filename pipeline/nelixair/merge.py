"""Fusion multi-sources : déduplication des fixes et résolution des voies aériennes.

Règle : les sources sont passées par ordre de priorité décroissante. Un fix d'une
source moins prioritaire est écarté s'il existe déjà un fix de même ident et de
même famille (waypoint / VHF / NDB) à moins de `dedup_nm` milles nautiques.
Ainsi, brancher plus tard une source mondiale sous licence en tête de liste
remplace naturellement OpenAIP/CIFP là où elle a des données.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Iterable

from .geo import haversine_nm
from .model import Airport, Airspace, Airway, Fix, MoraCell, fix_family

log = logging.getLogger(__name__)


@dataclass
class Dataset:
    fixes: list[Fix] = field(default_factory=list)
    airways: list[Airway] = field(default_factory=list)
    airports: list[Airport] = field(default_factory=list)
    airspaces: list[Airspace] = field(default_factory=list)
    mora: dict[tuple[int, int], MoraCell] = field(default_factory=dict)
    # clé (ident|region|famille) -> Fix
    index: dict[str, Fix] = field(default_factory=dict)
    stats: dict = field(default_factory=dict)


def merge(sources: Iterable[Iterable], dedup_nm: float = 3.0) -> Dataset:
    ds = Dataset()
    by_ident: dict[tuple[str, str], list[Fix]] = defaultdict(list)
    dropped = 0
    apt_by_ident: dict[str, list[Airport]] = defaultdict(list)
    apt_dropped = 0
    for records in sources:
        for r in records:
            if isinstance(r, Airway):
                r.validate()
                ds.airways.append(r)
                continue
            if isinstance(r, Airport):
                r.validate()
                near = apt_by_ident[r.ident]
                if any(a.src != r.src and haversine_nm(a.lat, a.lon, r.lat, r.lon) <= 5 for a in near):
                    apt_dropped += 1
                    continue
                near.append(r)
                ds.airports.append(r)
                continue
            if isinstance(r, Airspace):
                r.validate()
                ds.airspaces.append(r)
                continue
            if isinstance(r, MoraCell):
                r.validate()
                ds.mora.setdefault((r.lat, r.lon), r)  # première source (prioritaire) gagne
                continue
            r.validate()
            fam = fix_family(r.cls)
            near = by_ident[(r.ident, fam)]
            twin = next((f for f in near if f.src != r.src
                         and haversine_nm(f.lat, f.lon, r.lat, r.lon) <= dedup_nm), None)
            if twin is not None:
                dropped += 1
                # alias : les voies de la source écartée pointent vers le fix retenu
                ds.index.setdefault(r.key, twin)
                continue
            if r.key in ds.index and ds.index[r.key].src == r.src:
                continue  # doublon interne à une source
            near.append(r)
            ds.fixes.append(r)
            ds.index.setdefault(r.key, r)
    ds.stats["fixes_dropped_as_duplicates"] = dropped
    ds.stats["airports_dropped_as_duplicates"] = apt_dropped
    return ds


def resolve(ds: Dataset, airway: Airway) -> list[list[tuple]]:
    """Retourne les portions résolues [(AirwayPoint, Fix), ...].

    Un point introuvable coupe la voie (on ne trace jamais de segment deviné).
    """
    parts: list[list[tuple]] = [[]]
    for p in airway.points:
        fx = ds.index.get(p.key)
        if fx is None:
            ds.stats["airway_points_unresolved"] = ds.stats.get("airway_points_unresolved", 0) + 1
            log.debug("point non résolu %s sur %s", p.key, airway.ident)
            parts.append([])
            continue
        parts[-1].append((p, fx))
    return [pt for pt in parts if len(pt) >= 2]
