#!/usr/bin/env python3
"""Cartes d'aéroport : plan au sol (pistes, taxiways, aires, parkings, bâtiments) depuis OpenStreetMap.

Source : OpenStreetMap via l'API Overpass (© contributeurs OSM, licence ODbL 1.0).
Données communautaires, non certifiées : illustration uniquement, pas de navigation.

  python3 pipeline/ground.py fetch --raw data/raw/ground            # télécharge les terrains pilotes
  python3 pipeline/ground.py build --raw data/raw/ground --out build # -> ground.geojson + ground-index.json

Sortie :
  ground.geojson      une entité par objet, propriété `kind` normalisée (voir KINDS), `apt` = ident OACI
  ground-index.json   {"LFML": {"bbox": [...], "counts": {...}, "osm": "horodatage base OSM"}, ...}
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import os
import sys
import time
import urllib.parse
import urllib.request

log = logging.getLogger("ground")

# Terrains pilotes (élargir quand la qualité OSM est validée)
PILOT = ["LFML", "LFMN", "LFLL", "LFBO", "LFPO"]
# Serveur principal puis miroirs publics (Overpass répond souvent 429 / 504 quand il est chargé)
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter",
            "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
UA = "nelixair-map-ground (+https://github.com/tetardo/Nelixair-map)"

# Largeurs par défaut (m) quand OSM ne précise pas `width`
DEFAULT_WIDTH = {"runway": 45.0, "taxiway": 18.0, "taxilane": 10.0, "stopway": 45.0}
# Mètres par pixel au zoom 18 à l'équateur, tuiles MapLibre de 512 px
MPP18_EQ = 40075016.686 / (512 * 2 ** 18)
R_M = 6371008.8

QUERY = """[out:json][timeout:120];
(way["aeroway"="aerodrome"]["icao"="{icao}"];relation["aeroway"="aerodrome"]["icao"="{icao}"];)->.ad;
.ad map_to_area->.a;
(
  way(area.a)["aeroway"~"^(runway|stopway|taxiway|taxilane|apron|parking_position|holding_position|gate|hangar|terminal|helipad)$"];
  node(area.a)["aeroway"~"^(parking_position|holding_position|gate|helipad)$"];
  relation(area.a)["aeroway"~"^(apron|terminal|hangar)$"];
  way(area.a)["building"];
);
out geom;
.ad out geom;
"""


def _get(url: str, data: bytes | None = None) -> bytes:
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def _query(icao: str, attempts: int = 2, pause: float = 15.0) -> bytes:
    """Interroge Overpass en essayant les serveurs tour à tour, avec attente croissante."""
    body = urllib.parse.urlencode({"data": QUERY.replace("{icao}", icao)}).encode()
    last: Exception | None = None
    for n in range(attempts):
        for url in OVERPASS:
            try:
                raw = _get(url, body)
                json.loads(raw)  # réponse complète et valide
                return raw
            except Exception as e:  # 429, 504, coupure réseau, JSON tronqué
                last = e
                log.warning("%s : %s a échoué (%s)", icao, url.split("/")[2], e)
        time.sleep(pause * (n + 1))
    raise RuntimeError(f"{icao} : Overpass indisponible ({last})")


def fetch(icaos: list[str], raw_dir: str, pause: float = 5.0, budget: float = 1500.0) -> dict[str, int]:
    """Une requête Overpass par terrain (politesse : pause entre les requêtes).

    Un terrain en échec n'empêche pas les autres ; l'ancien fichier éventuel est conservé.
    Échoue seulement si aucun terrain n'a pu être téléchargé. `budget` (s) borne la durée totale.
    """
    os.makedirs(raw_dir, exist_ok=True)
    counts = {}
    start = time.monotonic()
    for i, icao in enumerate(icaos):
        if time.monotonic() - start > budget:
            log.error("budget Overpass dépassé : %s ignorés", ", ".join(icaos[i:]))
            break
        if i:
            time.sleep(pause)
        try:
            raw = _query(icao)
        except RuntimeError as e:
            log.error("%s", e)
            continue
        with open(os.path.join(raw_dir, f"{icao}.json"), "wb") as fh:
            fh.write(raw)
        counts[icao] = len(json.loads(raw).get("elements", []))
        log.info("%s : %d éléments OSM", icao, counts[icao])
    if not counts:
        raise RuntimeError("aucun terrain téléchargé")
    return counts


# ---------- Géométrie locale (projection équirectangulaire autour d'un point : suffisant à l'échelle d'un aéroport) ----------

def _xy(lon: float, lat: float, lat0: float) -> tuple[float, float]:
    return math.radians(lon) * R_M * math.cos(math.radians(lat0)), math.radians(lat) * R_M


def _ll(x: float, y: float, lat0: float) -> tuple[float, float]:
    return math.degrees(x / (R_M * math.cos(math.radians(lat0)))), math.degrees(y / R_M)


def _r(v: float) -> float:
    return round(v, 7)


def bearing(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Route vraie de a vers b (lon, lat), degrés."""
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dl = math.radians(b[0] - a[0])
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def strip_polygon(line: list[tuple[float, float]], width_m: float) -> list[list[float]]:
    """Rectangle d'une piste rectiligne : axe premier -> dernier point, largeur `width_m`."""
    a, b = line[0], line[-1]
    lat0 = (a[1] + b[1]) / 2
    ax, ay = _xy(*a, lat0)
    bx, by = _xy(*b, lat0)
    dx, dy = bx - ax, by - ay
    n = math.hypot(dx, dy) or 1.0
    ox, oy = -dy / n * width_m / 2, dx / n * width_m / 2
    ring = [(ax + ox, ay + oy), (bx + ox, by + oy), (bx - ox, by - oy), (ax - ox, ay - oy)]
    pts = [list(map(_r, _ll(x, y, lat0))) for x, y in ring]
    return pts + [pts[0]]


def length_m(line: list[tuple[float, float]]) -> float:
    lat0 = line[0][1]
    pts = [_xy(*p, lat0) for p in line]
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))


def centroid(pts: list[tuple[float, float]]) -> tuple[float, float]:
    ring = pts[:-1] if len(pts) > 1 and pts[0] == pts[-1] else pts
    return sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)


def _width(tags: dict, kind: str) -> float:
    try:
        w = float(str(tags.get("width", "")).replace("m", "").replace(",", ".").strip())
        if 2 <= w <= 150:
            return w
    except ValueError:
        pass
    return DEFAULT_WIDTH.get(kind, 15.0)


def _w18(width_m: float, lat: float) -> float:
    """Largeur en pixels au zoom 18 (le front l'interpole en exponentielle base 2)."""
    return round(width_m / (MPP18_EQ * math.cos(math.radians(lat))), 1)


def runway_ends(ref: str, line: list[tuple[float, float]]) -> list[tuple[str, tuple[float, float], float]]:
    """Associe chaque désignation ("13L/31R") à son extrémité de piste.

    Le numéro d'une piste est son QFU / 10 : l'extrémité « 13L » est celle d'où l'on décolle au 13x°.
    On compare la route vraie de l'axe aux deux numéros (écart de déclinaison de quelques degrés toléré).
    """
    parts = [p.strip() for p in ref.replace(" ", "").split("/") if p.strip()]
    a, b = line[0], line[-1]
    hdg = bearing(a, b)
    if len(parts) != 2:
        return []

    def num(s: str) -> int | None:
        d = "".join(c for c in s if c.isdigit())
        return int(d) if d else None

    n1, n2 = num(parts[0]), num(parts[1])
    if n1 is None or n2 is None:
        return []
    diff = lambda h, n: abs((h - n * 10 + 180) % 360 - 180)  # noqa: E731
    if diff(hdg, n1) <= diff(hdg, n2):
        return [(parts[0], a, hdg), (parts[1], b, (hdg + 180) % 360)]
    return [(parts[1], a, hdg), (parts[0], b, (hdg + 180) % 360)]


def _rings_from_members(members: list[dict]) -> list[list[tuple[float, float]]]:
    """Assemble les anneaux extérieurs d'une relation multipolygone (chaînage simple des ways)."""
    segs = [[(p["lon"], p["lat"]) for p in m.get("geometry", [])] for m in members
            if m.get("type") == "way" and m.get("role", "outer") in ("outer", "") and m.get("geometry")]
    rings = []
    while segs:
        cur = segs.pop(0)
        changed = True
        while cur[0] != cur[-1] and changed:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == cur[-1]:
                    cur += s[1:]
                elif s[-1] == cur[-1]:
                    cur += s[::-1][1:]
                elif s[-1] == cur[0]:
                    cur = s[:-1] + cur
                elif s[0] == cur[0]:
                    cur = s[::-1][:-1] + cur
                else:
                    continue
                segs.pop(i)
                changed = True
                break
        if len(cur) >= 4 and cur[0] == cur[-1]:
            rings.append(cur)
    return rings


def _poly(ring: list[tuple[float, float]]) -> dict:
    return {"type": "Polygon", "coordinates": [[[_r(x), _r(y)] for x, y in ring]]}


def _line(pts: list[tuple[float, float]]) -> dict:
    return {"type": "LineString", "coordinates": [[_r(x), _r(y)] for x, y in pts]}


def _pt(p: tuple[float, float]) -> dict:
    return {"type": "Point", "coordinates": [_r(p[0]), _r(p[1])]}


def parse(data: dict, icao: str) -> tuple[list[dict], dict]:
    """Réponse Overpass -> (entités GeoJSON, résumé pour l'index)."""
    feats: list[dict] = []
    counts: dict[str, int] = {}
    taxi_refs: set[str] = set()
    runways: list[str] = []
    bbox = [180.0, 90.0, -180.0, -90.0]
    name = ""

    def add(kind: str, geom: dict, **props):
        p = {"apt": icao, "kind": kind}
        p.update({k: v for k, v in props.items() if v not in (None, "")})
        feats.append({"type": "Feature", "geometry": geom, "properties": p})
        counts[kind] = counts.get(kind, 0) + 1

    seen = set()
    for el in data.get("elements", []):
        key = (el["type"], el["id"])
        if key in seen:
            continue
        seen.add(key)
        tags = el.get("tags", {})
        aw = tags.get("aeroway", "")
        ref = (tags.get("ref") or "").strip()
        if el["type"] == "node":
            p = (el["lon"], el["lat"])
            if aw in ("parking_position", "gate"):
                add("stand" if aw == "parking_position" else "gate", _pt(p), ref=ref)
            elif aw == "holding_position":
                add("holding", _pt(p), ref=ref)
            elif aw == "helipad":
                add("helipad", _pt(p), ref=ref)
            continue

        if el["type"] == "relation":
            rings = _rings_from_members(el.get("members", []))
            if aw == "aerodrome":
                name = tags.get("name", name)
                for ring in rings:
                    for x, y in ring:
                        bbox = [min(bbox[0], x), min(bbox[1], y), max(bbox[2], x), max(bbox[3], y)]
                    add("boundary", _poly(ring))
            elif aw in ("apron", "terminal", "hangar"):
                for ring in rings:
                    add("apron" if aw == "apron" else "building", _poly(ring), ref=ref, sub=aw if aw != "apron" else None,
                        name=tags.get("name"))
            continue

        pts = [(g["lon"], g["lat"]) for g in el.get("geometry", [])]
        if len(pts) < 2:
            continue
        closed = len(pts) >= 4 and pts[0] == pts[-1]
        if aw == "aerodrome":
            name = tags.get("name", name)
            for x, y in pts:
                bbox = [min(bbox[0], x), min(bbox[1], y), max(bbox[2], x), max(bbox[3], y)]
            if closed:
                add("boundary", _poly(pts))
        elif aw in ("runway", "stopway"):
            w = _width(tags, aw)
            if closed and aw == "runway" and tags.get("area") == "yes":
                add(aw, _poly(pts), ref=ref, surface=tags.get("surface"))
                continue
            add(aw, {"type": "Polygon", "coordinates": [strip_polygon(pts, w)]}, ref=ref, surface=tags.get("surface"),
                width=w, len=round(length_m(pts)))
            if aw == "runway":
                add("rwy_axis", _line([pts[0], pts[-1]]), ref=ref)
                runways.append(ref or "?")
                for des, p, hdg in runway_ends(ref, pts):
                    add("rwy_end", _pt(p), ref=des, hdg=round(hdg, 1))
        elif aw in ("taxiway", "taxilane"):
            lat = pts[0][1]
            w = _width(tags, aw)
            add(aw, _line(pts), ref=ref, w18=_w18(w, lat))
            if ref:
                taxi_refs.add(ref)
        elif aw == "apron":
            if closed:
                add("apron", _poly(pts), ref=ref)
        elif aw in ("parking_position", "gate"):
            add("stand" if aw == "parking_position" else "gate", _pt(centroid(pts) if closed else pts[0]), ref=ref)
        elif aw == "holding_position":
            add("holding", _line(pts), ref=ref)
        elif aw == "helipad":
            add("helipad", _pt(centroid(pts)), ref=ref)
        elif closed and (aw in ("terminal", "hangar") or tags.get("building")):
            sub = aw if aw in ("terminal", "hangar") else ("terminal" if tags.get("building") == "terminal"
                                                           else "hangar" if tags.get("building") == "hangar" else None)
            add("building", _poly(pts), sub=sub, name=tags.get("name") if sub else None)

    if bbox[0] > bbox[2]:  # pas de contour d'aérodrome : emprise des objets
        for f in feats:
            g = f["geometry"]
            cs = [g["coordinates"]] if g["type"] == "Point" else g["coordinates"] if g["type"] == "LineString" else g["coordinates"][0]
            for x, y in cs:
                bbox = [min(bbox[0], x), min(bbox[1], y), max(bbox[2], x), max(bbox[3], y)]
    summary = {
        "name": name,
        "bbox": [round(v, 5) for v in bbox] if bbox[0] <= bbox[2] else None,
        "osm": (data.get("osm3s") or {}).get("timestamp_osm_base", ""),
        "counts": counts,
        "runways": sorted(set(runways)),
        "taxiways": sorted(taxi_refs, key=lambda s: (len(s), s)),
    }
    return feats, summary


def build(raw_dir: str, out_dir: str) -> dict:
    os.makedirs(out_dir, exist_ok=True)
    index, n = {}, 0
    with open(os.path.join(out_dir, "ground.geojson"), "w", encoding="utf-8") as out:
        out.write('{"type":"FeatureCollection","features":[\n')
        for fn in sorted(os.listdir(raw_dir)) if os.path.isdir(raw_dir) else []:
            if not fn.endswith(".json"):
                continue
            icao = fn[:-5].upper()
            with open(os.path.join(raw_dir, fn), encoding="utf-8") as fh:
                data = json.load(fh)
            feats, summary = parse(data, icao)
            if not feats or not summary["bbox"]:
                log.warning("%s : aucune donnée sol exploitable", icao)
                continue
            for f in feats:
                out.write((",\n" if n else "") + json.dumps(f, ensure_ascii=False, separators=(",", ":")))
                n += 1
            index[icao] = summary
            log.info("%s : %s", icao, summary["counts"])
        out.write("\n]}\n")
    with open(os.path.join(out_dir, "ground-index.json"), "w", encoding="utf-8") as fh:
        json.dump({"source": "OpenStreetMap (ODbL 1.0)", "built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                   "airports": index}, fh, ensure_ascii=False, separators=(",", ":"))
    return index


def main(argv=None) -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("command", choices=["fetch", "build"])
    p.add_argument("--raw", default="data/raw/ground")
    p.add_argument("--out", default="build")
    p.add_argument("--icao", default=",".join(PILOT), help="idents OACI séparés par des virgules")
    a = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    if a.command == "fetch":
        fetch([s.strip().upper() for s in a.icao.split(",") if s.strip()], a.raw)
    else:
        idx = build(a.raw, a.out)
        if not idx:
            sys.exit("aucun terrain construit")


if __name__ == "__main__":
    main()
