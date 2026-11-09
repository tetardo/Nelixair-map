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


def _write_fc(path: str, features) -> int:
    n = 0
    with open(path, "w", encoding="utf-8") as fh:
        fh.write('{"type":"FeatureCollection","features":[\n')
        for f in features:
            fh.write((",\n" if n else "") + json.dumps(f, ensure_ascii=False, separators=(",", ":")))
            n += 1
        fh.write("\n]}\n")
    return n


def export(ds: Dataset, out_dir: str, sources_meta: list[dict]) -> dict:
    os.makedirs(out_dir, exist_ok=True)
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

    # Index de recherche compact, chargé à la demande par le front.
    search = {
        "v": 1,
        "fixes": [[f.ident, f.cls, _r(f.lon, 4), _r(f.lat, 4),
                   "" if f.name == f.ident else f.name, f.region or f.country]
                  for f in ds.fixes],
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
        "counts": {"fixes": n_fix, "airway_legs": n_leg, "airways": len(awy_bbox)},
        "stats": ds.stats,
    }
    with open(os.path.join(out_dir, "meta.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)
    return meta
