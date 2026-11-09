#!/usr/bin/env python3
"""Relais météo : METAR et TAF mondiaux de la NOAA, republiés pour le navigateur.

L'API aviationweather.gov refuse les appels depuis un navigateur (pas de CORS).
Ce script télécharge les fichiers de cache officiels (mis à jour chaque minute,
domaine public) et écrit deux JSON compacts que le site lit directement :

  metars.json    {"t": horodatage, "f": [champs], "d": [[...], ...]}
  tafs.json      {"t": horodatage, "d": {"LFML": "TAF LFML ...", ...}}
  hazards.geojson  SIGMET / AIRMET US + SIGMET internationaux (polygones)
  pireps.geojson   comptes rendus de pilotes (points)

Usage :
  python3 pipeline/wx.py --out wx/                      # télécharge puis convertit
  python3 pipeline/wx.py --out wx/ --metars f.csv.gz --tafs f.xml.gz   # fichiers locaux
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import os
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET

CACHE = "https://aviationweather.gov/data/cache/"
METARS_URL = CACHE + "metars.cache.csv.gz"
TAFS_URL = CACHE + "tafs.cache.xml.gz"
AIRSIGMETS_URL = CACHE + "airsigmets.cache.xml.gz"
PIREPS_URL = CACHE + "aircraftreports.cache.csv.gz"
ISIGMET_URL = "https://aviationweather.gov/api/data/isigmet?format=json"
UA = "nelixair-map-wx (+https://github.com/tetardo/Nelixair-map)"

# Ordre des champs de metars.json (repris tel quel par web/weather.js)
FIELDS = ["icaoId", "lat", "lon", "rawOb", "reportTime", "temp", "dewp", "wdir", "wspd", "wgst",
          "visib", "altim", "clouds", "fltCat", "vertVis"]
INHG_TO_HPA = 33.8639


def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def _num(v, cast=float):
    try:
        return cast(v)
    except (TypeError, ValueError):
        return None


def parse_metars(raw: bytes) -> list[list]:
    """CSV de cache NOAA -> lignes compactes dans l'ordre de FIELDS."""
    text = gzip.decompress(raw).decode("utf-8", "replace") if raw[:2] == b"\x1f\x8b" else raw.decode("utf-8", "replace")
    lines = text.splitlines()
    # quelques lignes d'en-tête libres (« No errors », « 1234 results »…) avant les noms de colonnes
    start = next((i for i, l in enumerate(lines) if l.startswith("raw_text,")), None)
    if start is None:
        raise ValueError("en-tête CSV METAR introuvable")
    reader = csv.reader(lines[start:])
    header = next(reader)
    col = {}
    for i, h in enumerate(header):
        col.setdefault(h, i)
    for need in ("raw_text", "station_id", "latitude", "longitude", "flight_category"):
        if need not in col:
            raise ValueError(f"colonne {need} absente du CSV METAR")
    sky = [i for i, h in enumerate(header) if h == "sky_cover"]
    out = []
    for row in reader:
        if len(row) < len(header) // 2:
            continue
        g = lambda k: row[col[k]] if k in col and col[k] < len(row) else ""
        lat, lon = _num(g("latitude")), _num(g("longitude"))
        if lat is None or lon is None:
            continue
        clouds = []
        for i in sky:
            cover = row[i] if i < len(row) else ""
            base = _num(row[i + 1], int) if i + 1 < len(row) else None
            if cover:
                clouds.append([cover, base])
        wdir = g("wind_dir_degrees")
        alt = _num(g("altim_in_hg"))
        vis = g("visibility_statute_mi")
        out.append([
            g("station_id"), round(lat, 4), round(lon, 4), g("raw_text"), g("observation_time"),
            _num(g("temp_c")), _num(g("dewpoint_c")),
            "VRB" if wdir == "VRB" else _num(wdir, int), _num(g("wind_speed_kt"), int), _num(g("wind_gust_kt"), int),
            vis if vis.endswith("+") else _num(vis),
            round(alt * INHG_TO_HPA) if alt else None,
            clouds, g("flight_category") or None, _num(g("vert_vis_ft"), int),
        ])
    return out


def parse_tafs(raw: bytes) -> dict[str, str]:
    data = gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw
    tafs = {}
    for _ev, el in ET.iterparse(io.BytesIO(data)):
        if el.tag == "TAF":
            sid = (el.findtext("station_id") or "").strip()
            txt = (el.findtext("raw_text") or "").strip()
            if sid and txt:
                tafs.setdefault(sid, txt)  # premier = plus récent
            el.clear()
    return tafs


def _unzip(raw: bytes) -> bytes:
    return gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw


# Famille de danger (pilote la couleur sur la carte)
def hazard_family(h: str) -> str:
    h = (h or "").upper()
    if any(k in h for k in ("CONVECTIVE", "TS", "CB", "TSGR")):
        return "conv"
    if "TURB" in h or h in ("MTW", "LLWS"):
        return "turb"
    if "IC" in h:  # ICE, ICING
        return "ice"
    if h in ("IFR", "MT_OBSC", "MTN OBSCN", "MT OBSC") or "OBSC" in h:
        return "ifr"
    if h in ("VA", "ASH") or "VOLCANIC" in h:
        return "ash"
    if h in ("TC",) or "CYCLONE" in h:
        return "tc"
    return "other"


def _ring(points: list) -> list:
    ring = [[round(lon, 4), round(lat, 4)] for lon, lat in points]
    if len(ring) >= 3 and ring[0] != ring[-1]:
        ring.append(ring[0])
    return ring


def parse_airsigmets(raw: bytes) -> list[dict]:
    """Cache XML NOAA des SIGMET / AIRMET US -> features GeoJSON."""
    feats = []
    for _ev, el in ET.iterparse(io.BytesIO(_unzip(raw))):
        if el.tag != "AIRSIGMET":
            continue
        pts = []
        for p in el.iter("point"):
            lon, lat = _num(p.findtext("longitude")), _num(p.findtext("latitude"))
            if lon is not None and lat is not None:
                pts.append((lon, lat))
        ring = _ring(pts)
        hz = el.find("hazard")
        alt = el.find("altitude")
        htype = hz.get("type", "") if hz is not None else ""
        if len(ring) >= 4:
            feats.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]}, "properties": {
                "kind": (el.findtext("airsigmet_type") or "").strip() or "SIGMET", "hazard": htype,
                "fam": hazard_family(htype), "sev": hz.get("severity", "") if hz is not None else "",
                "from": (el.findtext("valid_time_from") or "").strip(), "to": (el.findtext("valid_time_to") or "").strip(),
                "base": _num(alt.get("min_ft_msl"), int) if alt is not None else None,
                "top": _num(alt.get("max_ft_msl"), int) if alt is not None else None,
                "raw": (el.findtext("raw_text") or "").strip(), "src": "US"}})
        el.clear()
    return feats


def _iso(v) -> str:
    if isinstance(v, (int, float)):
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(v))
    return str(v or "")


def parse_isigmets(raw: bytes) -> list[dict]:
    """API NOAA des SIGMET internationaux (JSON) -> features GeoJSON."""
    feats = []
    for it in json.loads(_unzip(raw) or b"[]"):
        coords = it.get("coords") or []
        pts = []
        for c in coords:
            if isinstance(c, dict):
                lon, lat = _num(c.get("lon")), _num(c.get("lat"))
            else:
                lon, lat = _num(c[0]), _num(c[1])
            if lon is not None and lat is not None:
                pts.append((lon, lat))
        ring = _ring(pts)
        if len(ring) < 4:
            continue  # SIGMET sans polygone (ligne, point) : ignoré
        hz = it.get("hazard") or ""
        feats.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]}, "properties": {
            "kind": "SIGMET", "hazard": hz, "fam": hazard_family(hz), "sev": it.get("qualifier") or "",
            "from": _iso(it.get("validTimeFrom")), "to": _iso(it.get("validTimeTo")),
            "base": _num(it.get("base"), int), "top": _num(it.get("top"), int),
            "fir": it.get("firName") or it.get("firId") or "", "raw": (it.get("rawSigmet") or "").strip(), "src": "INTL"}})
    return feats


_SEV = ["NEG", "SMTH", "LGT", "MOD", "SEV", "EXTM"]


def _max_sev(texts) -> str:
    best = -1
    for t in texts:
        t = (t or "").upper()
        for i, k in enumerate(_SEV):
            if k in t:
                best = max(best, i)
    return _SEV[best] if best >= 0 else ""


def parse_pireps(raw: bytes) -> list[dict]:
    """Cache CSV NOAA des comptes rendus de pilotes -> points GeoJSON (turbulence / givrage max)."""
    lines = _unzip(raw).decode("utf-8", "replace").splitlines()
    start = next((i for i, l in enumerate(lines) if "raw_text" in l and "latitude" in l), None)
    if start is None:
        raise ValueError("en-tête CSV PIREP introuvable")
    reader = csv.reader(lines[start:])
    header = next(reader)
    col = {}
    for i, h in enumerate(header):
        col.setdefault(h, i)
    turb = [i for i, h in enumerate(header) if h == "turbulence_intensity"]
    ice = [i for i, h in enumerate(header) if h == "icing_intensity"]
    feats = []
    for row in reader:
        g = lambda k: row[col[k]] if k in col and col[k] < len(row) else ""
        lat, lon = _num(g("latitude")), _num(g("longitude"))
        if lat is None or lon is None:
            continue
        rawt = g("raw_text")
        tb = _max_sev([row[i] for i in turb if i < len(row)]) or _max_sev(re.findall(r"/TB ([^/]*)", rawt))
        ic = _max_sev([row[i] for i in ice if i < len(row)]) or _max_sev(re.findall(r"/IC ([^/]*)", rawt))
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 3), round(lat, 3)]},
                      "properties": {"t": g("observation_time"), "alt": _num(g("altitude_ft_msl"), int), "ac": g("aircraft_ref"),
                                     "tb": tb, "ic": ic, "type": g("report_type"), "raw": rawt}})
    return feats


def _optional(name: str, fn, url: str, local: str | None):
    """Les couches secondaires ne doivent jamais bloquer la publication des METAR."""
    try:
        return fn(open(local, "rb").read() if local else _get(url))
    except Exception as e:  # noqa: BLE001
        print(f"avertissement : {name} indisponible ({e})", file=sys.stderr)
        return []


def main(argv=None) -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", required=True)
    p.add_argument("--metars", help="fichier local metars.cache.csv(.gz)")
    p.add_argument("--tafs", help="fichier local tafs.cache.xml(.gz)")
    p.add_argument("--airsigmets", help="fichier local airsigmets.cache.xml(.gz)")
    p.add_argument("--isigmets", help="fichier local de l'API isigmet (JSON)")
    p.add_argument("--pireps", help="fichier local aircraftreports.cache.csv(.gz)")
    a = p.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    raw_m = open(a.metars, "rb").read() if a.metars else _get(METARS_URL)
    metars = parse_metars(raw_m)
    if not a.metars and len(metars) < 1000:
        sys.exit(f"seulement {len(metars)} METAR : fichier NOAA suspect, publication annulée")
    raw_t = open(a.tafs, "rb").read() if a.tafs else _get(TAFS_URL)
    tafs = parse_tafs(raw_t)
    with open(os.path.join(a.out, "metars.json"), "w", encoding="utf-8") as fh:
        json.dump({"t": now, "src": METARS_URL, "f": FIELDS, "d": metars}, fh, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(a.out, "tafs.json"), "w", encoding="utf-8") as fh:
        json.dump({"t": now, "src": TAFS_URL, "d": tafs}, fh, ensure_ascii=False, separators=(",", ":"))
    offline = bool(a.metars)  # mode fichiers locaux : pas de téléchargement des couches absentes
    hazards = (_optional("SIGMET/AIRMET US", parse_airsigmets, AIRSIGMETS_URL, a.airsigmets) if a.airsigmets or not offline else []) + \
              (_optional("SIGMET internationaux", parse_isigmets, ISIGMET_URL, a.isigmets) if a.isigmets or not offline else [])
    pireps = _optional("PIREP", parse_pireps, PIREPS_URL, a.pireps) if a.pireps or not offline else []
    for name, feats in (("hazards.geojson", hazards), ("pireps.geojson", pireps)):
        with open(os.path.join(a.out, name), "w", encoding="utf-8") as fh:
            json.dump({"type": "FeatureCollection", "t": now, "features": feats}, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(metars)} METAR, {len(tafs)} TAF, {len(hazards)} SIGMET/AIRMET, {len(pireps)} PIREP -> {a.out}")


if __name__ == "__main__":
    main()
