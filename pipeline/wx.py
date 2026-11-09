#!/usr/bin/env python3
"""Relais météo : METAR et TAF mondiaux de la NOAA, republiés pour le navigateur.

L'API aviationweather.gov refuse les appels depuis un navigateur (pas de CORS).
Ce script télécharge les fichiers de cache officiels (mis à jour chaque minute,
domaine public) et écrit deux JSON compacts que le site lit directement :

  metars.json  {"t": horodatage, "f": [champs], "d": [[...], ...]}
  tafs.json    {"t": horodatage, "d": {"LFML": "TAF LFML ...", ...}}

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
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET

CACHE = "https://aviationweather.gov/data/cache/"
METARS_URL = CACHE + "metars.cache.csv.gz"
TAFS_URL = CACHE + "tafs.cache.xml.gz"
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


def main(argv=None) -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", required=True)
    p.add_argument("--metars", help="fichier local metars.cache.csv(.gz)")
    p.add_argument("--tafs", help="fichier local tafs.cache.xml(.gz)")
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
    print(f"{len(metars)} METAR, {len(tafs)} TAF -> {a.out}")


if __name__ == "__main__":
    main()
