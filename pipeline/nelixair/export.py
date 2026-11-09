"""Export du jeu fusionné : GeoJSON (pour tippecanoe), index de recherche, métadonnées."""
from __future__ import annotations

import json
import os
import time

from .geo import great_circle, haversine_nm, initial_bearing, split_antimeridian
from .merge import Dataset, resolve
from .model import NAVAID_CLASSES

# Zoom minimum d'apparition par classe (attribut lu par tippecanoe).
MINZOOM = {"vor": 3, "vordme": 3, "vortac": 3, "tacan": 4, "dme": 5, "ndb": 5, "waypoint": 6}


def _r(v: float, nd: int = 5) -> float:
    return round(v, nd)


def fix_feature(fx) -> dict:
    props = {"ident": fx.ident, "cls": fx.cls, "src": fx.src}
    for k in ("name", "region", "country", "channel", "cycle"):
        v = getattr(fx, k)
        if v:
            props[k] = v
    if fx.freq is not None:
        props["freq"] = fx.freq
    props["navaid"] = fx.cls in NAVAID_CLASSES
    return {
        "type": "Feature",
        "tippecanoe": {"minzoom": MINZOOM.get(fx.cls, 6)},
        "geometry": {"type": "Point", "coordinates": [_r(fx.lon), _r(fx.lat)]},
        "properties": props,
    }


def is_rnav(airway) -> bool:
    """Voie RNAV : code ARINC 'R' (route type), sinon convention d'ident Q/T (US)."""
    if airway.route_type:
        return airway.route_type == "R"
    return airway.ident[:1] in ("Q", "T") and airway.ident[1:2].isdigit()


def leg_feature(airway, a, fa, b, fb) -> dict:
    coords = great_circle(fa.lat, fa.lon, fb.lat, fb.lon)
    parts = split_antimeridian(coords)
    parts = [[[_r(x), _r(y)] for x, y in p] for p in parts]
    geom = ({"type": "LineString", "coordinates": parts[0]} if len(parts) == 1
            else {"type": "MultiLineString", "coordinates": parts})
    props = {
        "ident": airway.ident, "level": airway.level, "src": airway.src,
        "rnav": is_rnav(airway), "from": fa.ident, "to": fb.ident,
        "dist_nm": round(haversine_nm(fa.lat, fa.lon, fb.lat, fb.lon), 1),
        "trk_true": round(initial_bearing(fa.lat, fa.lon, fb.lat, fb.lon)),
    }
    if a.mea:
        props["mea"] = a.mea
    if a.max_alt:
        props["max_alt"] = a.max_alt
    if a.direction:
        props["dir"] = a.direction
    return {"type": "Feature", "tippecanoe": {"minzoom": 2 if airway.level == "H" else 4},
            "geometry": geom, "properties": props}


APT_MINZOOM = {"large": 3, "medium": 6, "small": 8, "seaplane": 8, "heliport": 9}


def airport_feature(a) -> dict:
    props = {"ident": a.ident, "cls": "airport", "kind": a.category, "src": a.src, "ifr": a.ifr, "mil": a.military}
    for k in ("name", "iata", "elev_ft", "rwy_ft", "rwy_surface", "country", "region", "cycle"):
        v = getattr(a, k)
        if v not in ("", None):
            props[k] = v
    # tri d'affichage : plus la piste est longue, plus le terrain est prioritaire
    props["rank"] = -(a.rwy_ft or 0)
    return {"type": "Feature", "tippecanoe": {"minzoom": APT_MINZOOM.get(a.category, 8)},
            "geometry": {"type": "Point", "coordinates": [_r(a.lon), _r(a.lat)]}, "properties": props}


ASP_MINZOOM = {"fir": 2, "controlled": 5, "special": 5, "other": 7}


def airspace_feature(s) -> dict:
    props = {"name": s.name, "type": s.type, "group": s.group, "src": s.src}
    for k in ("icao_class", "lower", "upper", "lower_ft", "upper_ft", "country"):
        v = getattr(s, k)
        if v not in ("", None):
            props[k] = v
    return {"type": "Feature", "tippecanoe": {"minzoom": ASP_MINZOOM.get(s.group, 6)},
            "geometry": {"type": "Polygon", "coordinates": s.rings}, "properties": props}


def mora_features(c):
    """Un carré (quadrillage) + un point au centre (étiquette : milliers en grand, centaines en petit)."""
    ring = [[c.lon, c.lat], [c.lon + 1, c.lat], [c.lon + 1, c.lat + 1], [c.lon, c.lat + 1], [c.lon, c.lat]]
    props = {"mora": c.mora_ft, "th": str(c.mora_ft // 1000), "hu": str((c.mora_ft % 1000) // 100)}
    yield {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]}, "properties": props}
    yield {"type": "Feature", "geometry": {"type": "Point", "coordinates": [c.lon + 0.5, c.lat + 0.5]}, "properties": props}


def pair_runways(runways: list) -> list:
    """Regroupe les sens opposés d'une même piste : 09L + 27R -> "09L/27R".

    Retourne [[désignation, longueur ft, largeur ft, revêtement, QFU, référence QFU], ...].
    """
    def opposite(des: str) -> str:
        num = "".join(c for c in des if c.isdigit())
        if not num:
            return ""
        side = des[len(num):]
        n = (int(num) + 18 - 1) % 36 + 1
        return f"{n:02d}" + {"L": "R", "R": "L"}.get(side, side)

    out, used = [], set()
    by_des = {r.get("des"): r for r in runways}
    for r in runways:
        d = r.get("des") or ""
        if d in used:
            continue
        used.add(d)
        opp = by_des.get(opposite(d)) if d else None
        name = d
        if opp is not None and opp.get("des") not in used:
            used.add(opp["des"])
            a, b = sorted([d, opp["des"]])
            name = f"{a}/{b}"
        out.append([name, r.get("len_ft"), r.get("wid_ft"), r.get("surface") or (opp or {}).get("surface") or "",
                    r.get("hdg"), r.get("hdg_ref", "")])
    out.sort(key=lambda x: -(x[1] or 0))
    return out


def shard_of(ident: str) -> str:
    """Fichier de détail d'un aéroport : 2 premiers caractères alphanumériques de l'ident."""
    k = "".join(c if c.isalnum() else "_" for c in ident.upper()[:2])
    return k or "__"


def write_airport_details(ds: Dataset, out_dir: str, charts: dict) -> int:
    """Détails chargés à la demande par la fiche aéroport : data/apt/<shard>.json."""
    shards: dict[str, dict] = {}
    for a in ds.airports:
        d = {}
        rw = pair_runways(a.runways)
        if rw:
            d["rwy"] = rw
        if a.freqs:
            d["frq"] = [[f["type"], f["mhz"], f["name"]] for f in a.freqs]
        ch = charts.get(a.ident) if a.country in ("US", "") or a.src == "faa-cifp" else None
        if ch:
            d["chr"] = ch
        if d:
            shards.setdefault(shard_of(a.ident), {})[a.ident] = d
    apt_dir = os.path.join(out_dir, "apt")
    os.makedirs(apt_dir, exist_ok=True)
    for k, v in shards.items():
        with open(os.path.join(apt_dir, f"{k}.json"), "w", encoding="utf-8") as fh:
            json.dump(v, fh, ensure_ascii=False, separators=(",", ":"))
    return sum(len(v) for v in shards.values())


def _write_fc(path: str, features) -> int:
    n = 0
    with open(path, "w", encoding="utf-8") as fh:
        fh.write('{"type":"FeatureCollection","features":[\n')
        for f in features:
            fh.write((",\n" if n else "") + json.dumps(f, ensure_ascii=False, separators=(",", ":")))
            n += 1
        fh.write("\n]}\n")
    return n


def export(ds: Dataset, out_dir: str, sources_meta: list[dict], charts: tuple = ("", {})) -> dict:
    os.makedirs(out_dir, exist_ok=True)
    tpp_cycle, tpp = charts
    n_fix = _write_fc(os.path.join(out_dir, "fixes.geojson"), (fix_feature(f) for f in ds.fixes))

    legs = []
    awy_bbox: dict[str, list[float]] = {}
    routes: dict[str, dict] = {}
    for awy in ds.airways:
        for part in resolve(ds, awy):
            r = routes.setdefault(awy.ident, {"rnav": is_rnav(awy), "parts": []})
            r["parts"].append({"lv": awy.level, "pts": [
                [fx.ident, fx.cls, _r(fx.lon, 4), _r(fx.lat, 4), p.mea, p.direction] for p, fx in part]})
            for (a, fa), (b, fb) in zip(part, part[1:]):
                legs.append(leg_feature(awy, a, fa, b, fb))
                bb = awy_bbox.setdefault(awy.ident, [180, 90, -180, -90])
                for f in (fa, fb):
                    bb[0], bb[1] = min(bb[0], f.lon), min(bb[1], f.lat)
                    bb[2], bb[3] = max(bb[2], f.lon), max(bb[3], f.lat)
    n_leg = _write_fc(os.path.join(out_dir, "airways.geojson"), legs)

    n_apt = _write_fc(os.path.join(out_dir, "airports.geojson"), (airport_feature(a) for a in ds.airports))
    n_asp = _write_fc(os.path.join(out_dir, "airspaces.geojson"), (airspace_feature(a) for a in ds.airspaces))
    _write_fc(os.path.join(out_dir, "mora.geojson"), (f for c in ds.mora.values() for f in mora_features(c)))
    n_mora = len(ds.mora)
    n_details = write_airport_details(ds, out_dir, tpp)
    ds.stats["airports_with_charts"] = sum(1 for a in ds.airports if a.ident in tpp)
    asp_types: dict[str, int] = {}
    for a in ds.airspaces:
        asp_types[a.type] = asp_types.get(a.type, 0) + 1
    apt_kinds: dict[str, int] = {}
    for a in ds.airports:
        apt_kinds[a.category] = apt_kinds.get(a.category, 0) + 1
    ds.stats["airspace_types"] = dict(sorted(asp_types.items(), key=lambda kv: -kv[1]))
    ds.stats["airport_kinds"] = apt_kinds

    # Index de recherche compact, chargé à la demande par le front.
    search = {
        "v": 1,
        "fixes": [[f.ident, f.cls, _r(f.lon, 4), _r(f.lat, 4),
                   "" if f.name == f.ident else f.name, f.region or f.country]
                  for f in ds.fixes]
                 + [[a.ident, "airport", _r(a.lon, 4), _r(a.lat, 4), a.name, a.country or a.region]
                    for a in ds.airports],
        "airways": {k: [_r(x, 3) for x in v] for k, v in awy_bbox.items()},
    }
    with open(os.path.join(out_dir, "search.json"), "w", encoding="utf-8") as fh:
        json.dump(search, fh, ensure_ascii=False, separators=(",", ":"))

    # Points ordonnés de chaque voie (log de voie et index point -> voies du front).
    with open(os.path.join(out_dir, "routes.json"), "w", encoding="utf-8") as fh:
        json.dump(routes, fh, ensure_ascii=False, separators=(",", ":"))

    meta = {
        "built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sources": sources_meta,
        "counts": {"fixes": n_fix, "airway_legs": n_leg, "airways": len(awy_bbox),
                   "airports": n_apt, "airspaces": n_asp, "mora_cells": n_mora,
                   "airport_details": n_details},
        "stats": ds.stats,
    }
    if tpp_cycle:
        meta["charts"] = {"name": "FAA d-TPP", "cycle": tpp_cycle, "base": f"https://aeronav.faa.gov/d-tpp/{tpp_cycle}/"}
    with open(os.path.join(out_dir, "meta.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)
    return meta
