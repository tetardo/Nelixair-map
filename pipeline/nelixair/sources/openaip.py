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
import urllib.error
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


def _get_json(req: urllib.request.Request, attempts: int = 4, pause_s: float = 10.0) -> dict:
    """GET avec reprises : l'API OpenAIP renvoie parfois 408 / 5xx sur une page isolée."""
    for n in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                return json.load(resp)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            code = getattr(e, "code", None)  # None = coupure réseau / timeout
            retryable = code is None or code in (408, 429) or code >= 500
            if not retryable or n == attempts - 1:
                raise
            time.sleep(pause_s * (n + 1))
    raise AssertionError("inatteignable")


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
        body = _get_json(req)
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


# Revêtement des pistes (surface.mainComposite), schéma OpenAIP core.
SURFACES = {
    0: "asphalte", 1: "béton", 2: "herbe", 3: "sable", 4: "eau", 5: "bitume", 6: "brique",
    7: "macadam", 8: "pierre", 9: "corail", 10: "argile", 11: "latérite", 12: "gravier",
    13: "terre", 14: "glace", 15: "neige", 16: "revêtement synthétique", 17: "métal",
    18: "plaques aluminium", 19: "plaques acier", 20: "bois", 21: "enrobé non bitumineux", 22: "",
}
_HARD = {0, 1, 5, 6, 7, 21}


def surface_class(comp) -> str:
    """Classe de revêtement : hard / water / soft, "" si inconnu (22 = inconnu, pas eau)."""
    if comp is None or comp == 22:
        return ""
    if comp == 4:
        return "water"
    return "hard" if comp in _HARD else "soft"


def _runway(r: dict) -> Optional[dict]:
    des = (r.get("designator") or "").strip().upper()
    dim = r.get("dimension") or {}
    ln = _len_ft(dim)
    wd = (dim.get("width") or {})
    try:
        wid = float(wd.get("value"))
        wid_ft = round(wid * M_TO_FT) if wd.get("unit", 0) == 0 else round(wid)
    except (TypeError, ValueError):
        wid_ft = None
    comp = (r.get("surface") or {}).get("mainComposite")
    hdg = r.get("trueHeading")
    if not des and not ln:
        return None
    out = {"des": des, "len_ft": ln, "wid_ft": wid_ft, "surface": SURFACES.get(comp, ""),
           "hdg": int(hdg) if isinstance(hdg, (int, float)) else None, "hdg_ref": "T", "_comp": comp}
    return out


# Types de fréquence d'aérodrome (schéma OpenAIP core). Le nom publié est gardé à côté.
FREQ_TYPES = {
    0: "APP", 1: "APRON", 2: "ARR", 3: "CTR", 4: "CTAF", 5: "DEL", 6: "DEP", 7: "FIS",
    8: "GLIDING", 9: "GND", 10: "INFO", 11: "MULTICOM", 12: "UNICOM", 13: "RADAR",
    14: "TWR", 15: "ATIS", 16: "RADIO", 17: "OTHER", 18: "AIRMET", 19: "AWOS",
    20: "LIGHTS", 21: "VOLMET", 22: "AFIS",
}


def _airport_freq(f: dict) -> Optional[dict]:
    try:
        v = float(f.get("value"))
    except (TypeError, ValueError):
        return None
    mhz = v / 1000 if f.get("unit") == UNIT_KHZ else v
    return {"type": FREQ_TYPES.get(f.get("type"), "OTHER"), "mhz": round(mhz, 3),
            "name": (f.get("name") or "").strip()}


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
    runways = [rw for rw in (_runway(r) for r in item.get("runways") or []) if rw]
    longest = max((r for r in runways if r.get("len_ft")), key=lambda r: r["len_ft"], default=None)
    rwy_ft = longest["len_ft"] if longest else None
    comp = longest.get("_comp") if longest else None
    surface = surface_class(comp)
    for r in runways:
        r.pop("_comp", None)
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
                   country=(item.get("country") or "").upper(), cycle=cycle,
                   runways=runways, freqs=[f for f in (_airport_freq(f) for f in item.get("frequencies") or []) if f])


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
