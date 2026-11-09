"""Adaptateur OpenAIP (navaids mondiaux).

Licence des données : CC BY-NC 4.0 (https://www.openaip.net) — usage non
commercial uniquement, attribution obligatoire. OpenAIP ne publie pas de voies
aériennes : seuls les navaids sont importés.

Deux étapes séparées pour la reproductibilité :
  fetch() : télécharge via l'API officielle (clé gratuite requise) vers un JSON brut
  parse() : lit ce JSON brut (liste d'items API, ou GeoJSON FeatureCollection)
"""
from __future__ import annotations

import json
import time
import urllib.request
from typing import Iterator, Optional

from ..model import Fix

SRC = "openaip"
API_URL = "https://api.core.openaip.net/api/navaids"

# Codes `type` du schéma OpenAIP core -> classe interne.
TYPE_MAP = {
    0: "dme",
    1: "tacan",
    2: "ndb",
    3: "vor",
    4: "vordme",
    5: "vortac",
    6: "vor",      # DVOR
    7: "vordme",   # DVOR-DME
    8: "vortac",   # DVORTAC
}
# Unités de fréquence OpenAIP : 1 = kHz, 2 = MHz
UNIT_KHZ, UNIT_MHZ = 1, 2


def fetch(api_key: str, out_path: str, page_size: int = 1000, pause_s: float = 0.5) -> int:
    items: list = []
    page = 1
    while True:
        req = urllib.request.Request(
            f"{API_URL}?page={page}&limit={page_size}",
            headers={"x-openaip-api-key": api_key, "Accept": "application/json",
                     "User-Agent": "nelixair-map-build"},
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = json.load(resp)
        items.extend(body.get("items", []))
        if page >= int(body.get("totalPages", 1)):
            break
        page += 1
        time.sleep(pause_s)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump({"source": API_URL, "fetched": time.strftime("%Y-%m-%d"), "items": items}, fh)
    return len(items)


def _freq(item: dict, cls: str) -> Optional[float]:
    fr = item.get("frequency") or {}
    try:
        v = float(fr.get("value"))
    except (TypeError, ValueError):
        return None
    unit = fr.get("unit")
    if cls == "ndb":
        return v * 1000 if unit == UNIT_MHZ else v       # -> kHz
    return v / 1000 if unit == UNIT_KHZ else v           # -> MHz


def item_to_fix(item: dict, cycle: str = "") -> Optional[Fix]:
    cls = TYPE_MAP.get(item.get("type"))
    geom = item.get("geometry") or {}
    coords = geom.get("coordinates") or []
    ident = (item.get("identifier") or "").strip().upper()
    if cls is None or len(coords) < 2 or not ident:
        return None
    lon, lat = float(coords[0]), float(coords[1])
    ch = item.get("channel")
    return Fix(ident=ident, cls=cls, lat=lat, lon=lon, src=SRC, region="",
               name=(item.get("name") or "").strip(), freq=_freq(item, cls),
               channel=str(ch) if ch else "", country=(item.get("country") or "").upper(),
               cycle=cycle)


def parse(path: str) -> Iterator[Fix]:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    cycle = ""
    if isinstance(data, dict) and data.get("type") == "FeatureCollection":
        items = [dict(f.get("properties") or {}, geometry=f.get("geometry")) for f in data["features"]]
    elif isinstance(data, dict):
        items, cycle = data.get("items", []), data.get("fetched", "")
    else:
        items = data
    for it in items:
        fx = item_to_fix(it, cycle)
        if fx:
            yield fx
