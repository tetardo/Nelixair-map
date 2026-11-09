"""Adaptateur OpenAIP (navaids, aéroports et espaces aériens mondiaux).

Licence des données : CC BY-NC 4.0 (https://www.openaip.net) — usage non
commercial uniquement, attribution obligatoire. OpenAIP ne publie pas de voies
aériennes.

Deux étapes séparées pour la reproductibilité :
  fetch() : télécharge via l'API officielle (clé gratuite requise) vers un JSON brut
  parse() : lit ce JSON brut (liste d'items API, ou GeoJSON FeatureCollection)
"""
from __future__ import annotations

import json
import time
import urllib.request
from typing import Iterator, Optional

from ..model import Airport, Airspace, Fix

SRC = "openaip"
API_BASE = "https://api.core.openaip.net/api"
API_URL = API_BASE + "/navaids"
ENDPOINTS = ("navaids", "airports", "airspaces")

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


def fetch(api_key: str, out_path: str, page_size: int = 1000, pause_s: float = 0.5,
          endpoint: str = "navaids") -> int:
    items: list = []
    page = 1
    url = f"{API_BASE}/{endpoint}"
    while True:
        req = urllib.request.Request(
            f"{url}?page={page}&limit={page_size}",
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
        json.dump({"source": url, "fetched": time.strftime("%Y-%m-%d"), "items": items}, fh)
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


def _load_items(path: str) -> tuple[list, str]:
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    if isinstance(data, dict) and data.get("type") == "FeatureCollection":
        return [dict(f.get("properties") or {}, geometry=f.get("geometry")) for f in data["features"]], ""
    if isinstance(data, dict):
        return data.get("items", []), data.get("fetched", "")
    return data, ""


def parse(path: str) -> Iterator[Fix]:
    items, cycle = _load_items(path)
    for it in items:
        fx = item_to_fix(it, cycle)
        if fx:
            yield fx


# ---------- Aéroports ----------
# Codes `type` OpenAIP core (aéroports). Ceux absents sont ignorés (ex. 8 = fermé).
AIRPORT_TYPES = {
    0: "airport", 1: "glider", 2: "airfield", 3: "international", 4: "heliport_mil",
    5: "military", 6: "ultralight", 7: "heliport", 9: "ifr", 10: "water", 11: "strip",
    12: "agri", 13: "altiport",
}
# Unités de longueur OpenAIP : 0 = mètre, 1 = pied
M_TO_FT = 3.28084


def _len_ft(dim: dict) -> Optional[int]:
    ln = (dim or {}).get("length") or {}
    try:
        v = float(ln.get("value"))
    except (TypeError, ValueError):
        return None
    return round(v * M_TO_FT) if ln.get("unit", 0) == 0 else round(v)


def _elev_ft(el: dict) -> Optional[int]:
    try:
        v = float((el or {}).get("value"))
    except (TypeError, ValueError):
        return None
    return round(v * M_TO_FT) if (el or {}).get("unit", 0) == 0 else round(v)


def item_to_airport(item: dict, cycle: str = "") -> Optional[Airport]:
    t = AIRPORT_TYPES.get(item.get("type"))
    coords = (item.get("geometry") or {}).get("coordinates") or []
    if t is None or len(coords) < 2:
        return None
    ident = (item.get("icaoCode") or "").strip().upper()
    if not ident:
        # pas de code OACI : on ne garde que les terrains significatifs (pistes en dur)
        if t not in ("airport", "international", "ifr", "military"):
            return None
        ident = (item.get("altIdentifier") or item.get("name") or "").strip().upper()[:8]
        if not ident:
            return None
    rwys = item.get("runways") or []
    lengths = [(_len_ft(r.get("dimension")), r) for r in rwys]
    lengths = [(ln, r) for ln, r in lengths if ln]
    rwy_ft, rwy = max(lengths, key=lambda x: x[0]) if lengths else (None, None)
    comp = ((rwy or {}).get("surface") or {}).get("mainComposite")
    # 0 asphalte, 1 béton : dur ; 22 eau ; le reste : non revêtu (approximation)
    surface = "hard" if comp in (0, 1) else "water" if comp == 22 else ("soft" if comp is not None else "")
    if t in ("heliport", "heliport_mil"):
        kind = "heliport"
    elif t == "water" or surface == "water":
        kind = "seaplane"
    elif t == "international" or (rwy_ft or 0) >= 8000:
        kind = "large"
    elif t in ("airport", "ifr", "military") or (rwy_ft or 0) >= 5000:
        kind = "medium"
    else:
        kind = "small"
    return Airport(ident=ident, category=kind, lat=float(coords[1]), lon=float(coords[0]), src=SRC,
                   name=(item.get("name") or "").strip(), iata=(item.get("iataCode") or "").strip().upper(),
                   elev_ft=_elev_ft(item.get("elevation")), rwy_ft=rwy_ft, rwy_surface=surface,
                   ifr=t in ("ifr", "international"), military=t in ("military", "heliport_mil"),
                   country=(item.get("country") or "").upper(), cycle=cycle)


def parse_airports(path: str) -> Iterator[Airport]:
    items, cycle = _load_items(path)
    for it in items:
        ap = item_to_airport(it, cycle)
        if ap:
            yield ap


# ---------- Espaces aériens ----------
# Codes `type` OpenAIP core (espaces) -> (code normalisé, groupe)
AIRSPACE_TYPES = {
    0: ("OTHER", "other"), 1: ("R", "special"), 2: ("D", "special"), 3: ("P", "special"),
    4: ("CTR", "controlled"), 5: ("TMZ", "other"), 6: ("RMZ", "other"), 7: ("TMA", "controlled"),
    8: ("TRA", "special"), 9: ("TSA", "special"), 10: ("FIR", "fir"), 11: ("UIR", "fir"),
    12: ("ADIZ", "special"), 13: ("ATZ", "controlled"), 14: ("MATZ", "controlled"),
    15: ("AWY", "controlled"), 16: ("MTR", "special"), 17: ("ALERT", "special"),
    18: ("WARNING", "special"), 19: ("PROTECTED", "special"), 20: ("HTZ", "other"),
    21: ("GLIDING", "other"), 22: ("TRP", "other"), 23: ("TIZ", "other"), 24: ("TIA", "other"),
    25: ("MTA", "special"), 26: ("CTA", "controlled"), 27: ("ACC", "fir"), 28: ("SPORT", "other"),
    29: ("LOW_OVERFLIGHT", "special"), 30: ("MRT", "special"), 31: ("TFR", "special"),
    32: ("VFR_SECTOR", "other"), 33: ("FIS", "fir"), 34: ("LTA", "controlled"),
    35: ("UTA", "controlled"), 36: ("MCTR", "controlled"),
}
ICAO_CLASS = {0: "A", 1: "B", 2: "C", 3: "D", 4: "E", 5: "F", 6: "G"}
# Limites : unit 0 = m, 1 = ft, 6 = FL ; referenceDatum 0 = GND, 1 = MSL, 2 = STD
_DATUM = {0: "AGL", 1: "MSL", 2: "STD"}


def limit_label(lim: dict) -> tuple[str, Optional[int]]:
    lim = lim or {}
    try:
        v = float(lim.get("value"))
    except (TypeError, ValueError):
        return "", None
    unit, datum = lim.get("unit"), lim.get("referenceDatum")
    if unit == 6:
        return f"FL{int(v):03d}", int(v * 100)
    ft = round(v * M_TO_FT) if unit == 0 else round(v)
    if ft == 0 and datum == 0:
        return "SFC", 0
    if ft >= 99999:
        return "UNL", None
    return f"{ft} ft {_DATUM.get(datum, '')}".strip(), ft


def _polygons(geom: dict) -> list:
    """Liste de polygones (chacun = liste d'anneaux) depuis Polygon/MultiPolygon."""
    if not geom:
        return []
    if geom.get("type") == "Polygon":
        return [geom.get("coordinates") or []]
    if geom.get("type") == "MultiPolygon":
        return geom.get("coordinates") or []
    return []


def item_to_airspaces(item: dict, cycle: str = "") -> Iterator[Airspace]:
    code, group = AIRSPACE_TYPES.get(item.get("type"), (f"T{item.get('type')}", "other"))
    lower, lower_ft = limit_label(item.get("lowerLimit"))
    upper, upper_ft = limit_label(item.get("upperLimit"))
    for rings in _polygons(item.get("geometry")):
        rings = [[[round(float(x), 5), round(float(y), 5)] for x, y, *_ in ring] for ring in rings if len(ring) >= 4]
        if not rings:
            continue
        yield Airspace(name=(item.get("name") or "").strip(), type=code, group=group, rings=rings, src=SRC,
                       icao_class=ICAO_CLASS.get(item.get("icaoClass"), ""), lower=lower, upper=upper,
                       lower_ft=lower_ft, upper_ft=upper_ft, country=(item.get("country") or "").upper(),
                       cycle=cycle)


def parse_airspaces(path: str) -> Iterator[Airspace]:
    items, cycle = _load_items(path)
    for it in items:
        yield from item_to_airspaces(it, cycle)
