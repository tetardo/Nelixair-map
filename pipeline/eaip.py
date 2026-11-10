#!/usr/bin/env python3
"""Données de piste officielles des aérodromes français, lues dans l'eAIP du SIA (AD 2).

Source : SIA, eAIP France, Licence Ouverte (Etalab). Attribution : « SIA, eAIP AIRAC <date> ».
Pages HTML publiques par cycle AIRAC ; le serveur n'est pas joignable depuis tous les réseaux (OK depuis GitHub Actions).

  python3 pipeline/eaip.py fetch --raw data/raw/eaip [--icao LFML LFMN ...]
  python3 pipeline/eaip.py build --raw data/raw/eaip --out build     # -> eaip.json

Extrait par aérodrome :
  AD 2.2  ARP, altitude de référence, déclinaison magnétique
  AD 2.12 cap vrai / magnétique, dimensions, revêtement et PCN, seuil (et seuil décalé), altitudes de seuil
  AD 2.13 distances déclarées TORA / TODA / ASDA / LDA (+ départs depuis intersection)
  AD 2.14 balisage d'approche, PAPI (angle), MEHT
  AD 2.17 altitude de transition
  AD 2.19 ILS / LOC / GP / DME par piste, NDB et VOR du terrain
Les révisions (<del>ancien</del> nouveau) sont résolues : seule la valeur en vigueur est gardée.
Ne contient pas de minima (hors périmètre volontaire).
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import logging
import math
import os
import re
import sys
import time
import urllib.request

log = logging.getLogger("eaip")

UA = "nelixair-map-eaip (+https://github.com/tetardo/Nelixair-map)"
MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
AIRAC_REF = dt.date(2026, 1, 22)  # cycle 2601
DEFAULT_ICAO = ["LFML", "LFMN", "LFLL", "LFBO", "LFPO"]


# ---------- Cycle AIRAC et URL ----------
def airac_start(day: dt.date | None = None) -> dt.date:
    day = day or dt.datetime.now(dt.timezone.utc).date()
    return AIRAC_REF + dt.timedelta(days=28 * ((day - AIRAC_REF).days // 28))


def ad2_url(icao: str, start: dt.date) -> str:
    d = f"{start.day:02d}_{MONTHS[start.month - 1]}_{start.year}"
    return (f"https://www.sia.aviation-civile.gouv.fr/media/dvd/eAIP_{d}/FRANCE/AIRAC-{start:%Y-%m-%d}"
            f"/html/eAIP/FR-AD-2.{icao}-fr-FR.html")


def fetch(raw: str, icaos: list[str], start: dt.date | None = None) -> int:
    start = start or airac_start()
    os.makedirs(raw, exist_ok=True)
    ok = 0
    for icao in icaos:
        url = ad2_url(icao, start)
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=60) as r:
                    data = r.read()
                with open(os.path.join(raw, f"FR-AD-2.{icao}-fr-FR.html"), "wb") as f:
                    f.write(data)
                ok += 1
                log.info("%s : %d Ko", icao, len(data) // 1024)
                break
            except Exception as e:  # réseau, 404 (terrain absent de l'eAIP), 5xx
                log.warning("%s : essai %d échoué (%s)", icao, attempt + 1, e)
                if getattr(e, "code", 0) == 404:
                    break
                time.sleep(5 * (attempt + 1))
    with open(os.path.join(raw, "cycle.txt"), "w") as f:
        f.write(start.isoformat())
    return ok


# ---------- Lecture HTML ----------
_DEL = re.compile(r"<del\b[^>]*>.*?</del>", re.S | re.I)
_TR = re.compile(r"<tr\b[^>]*>(.*?)</tr>", re.S | re.I)
_CELL = re.compile(r"<t[dh]\b[^>]*/>|<t[dh]\b[^>]*>(.*?)</t[dh]>", re.S | re.I)
_TAG = re.compile(r"<[^>]+>")


def _text(x: str | None) -> str:
    return re.sub(r"\s+", " ", html.unescape(_TAG.sub(" ", x or ""))).strip()


def sections(h: str, icao: str) -> dict[int, str]:
    """Découpe la page en sections AD 2.n (révisions déjà résolues)."""
    h = _DEL.sub("", h)
    pos = sorted((int(m.group(1)), m.start()) for m in re.finditer(rf'id="{icao}-AD-2\.(\d+)"', h))
    out = {}
    for i, (n, p) in enumerate(pos):
        out.setdefault(n, h[p:pos[i + 1][1] if i + 1 < len(pos) else len(h)])
    return out


def rows(sec: str) -> list[list[str]]:
    return [[_text(c) for c in _CELL.findall(tr)] for tr in _TR.findall(sec)]


_DMS = re.compile(r"(\d{2,3})°(\d{2})'(\d{2}(?:\.\d+)?)\"\s*([NSEW])")


def dms_pairs(s: str) -> list[list[float]]:
    """Coordonnées DMS successives -> [[lon, lat], ...] (6 décimales)."""
    vals = [(int(d) + int(m) / 60 + float(sec) / 3600) * (-1 if h in "SW" else 1) for d, m, sec, h in _DMS.findall(s)]
    return [[round(vals[i + 1], 6), round(vals[i], 6)] for i in range(0, len(vals) - 1, 2)]


_RWY = re.compile(r"^\d{2}[LCR]?$")
_NUM = lambda s: float(m.group()) if (m := re.search(r"-?\d+(?:\.\d+)?", s or "")) else None  # noqa: E731


def _int(s: str) -> int | None:
    v = _NUM(s)
    return int(v) if v is not None else None


def parse(h: str, icao: str) -> dict:
    S = sections(h, icao)
    apt: dict = {"rwys": {}}
    R = apt["rwys"]

    # AD 2.2 : lignes identifiées par leur id
    s2 = S.get(2, "")
    def row2(key: str) -> str:
        m = re.search(rf'id="AD-2\.2-{key}"[^>]*>(.*?)</tr>', s2, re.S)
        cells = [_text(c) for c in _CELL.findall(m.group(1))] if m else []
        return cells[-1] if cells else ""
    if (p := dms_pairs(row2("Position_Geo_Arp"))):
        apt["arp"] = p[0]
    apt["elev_ft"] = _int(row2("Altitude_Reference"))
    mv = row2("Declinaison_Magnetique")
    if (v := _NUM(mv)) is not None:
        apt["magvar"] = round(-v if "W" in mv.upper() else v, 2)  # > 0 = Est
    if (y := _int(row2("Annee"))):
        apt["magvar_year"] = y

    # AD 2.12 : première table, une ligne par QFU. L'ordre des colonnes varie selon les terrains (pente, etc.) :
    # chaque valeur est cherchée par sa forme dans la ligne entière, cap vrai cohérent avec le numéro de piste.
    for c in rows(S.get(12, "")):
        if len(c) < 4 or not _RWY.match(c[0]):
            continue
        q = c[0]
        r = R.setdefault(q, {})
        txt = " | ".join(c[1:])
        nominal = (int(q[:2]) % 36) * 10
        near = lambda v: abs((v - nominal + 180) % 360 - 180) <= 25  # noqa: E731
        if "true" not in r:
            for v in re.findall(r"(?<![\d.])(\d{1,3}\.\d+)(?![\d.])", txt):
                if near(float(v)):
                    r["true"] = float(v)
                    break
        mags = [int(v) for v in re.findall(r"\(\s*(\d{1,3})\s*\)", txt) if near(int(v))]
        if mags:
            r["mag"] = mags[-1]
        if (m := re.search(r"(\d{3,4})\s*x\s*(\d{2,3})", txt)):
            r["len"], r["wid"] = int(m.group(1)), int(m.group(2))
        if (m := re.search(r"(\d{2,3})\s+([A-Z](?:/[A-Z]){3})\s*([^|]*)", txt)):
            r["pcn"] = f"{m.group(1)}/{m.group(2)}"
            r["surface"] = m.group(3).split(" / ")[0].strip()
        geo = txt.split("GUND")[0]
        pts = dms_pairs(geo)
        if pts:
            r["thr"] = pts[0]
        if (m := re.search(r"\(([^()]*\d{2}°\d{2}'[^()]*)\)", geo)) and (d := dms_pairs(m.group(1))):
            r["dthr"] = d[0]
        if (m := re.search(r"(?<!D)THR\s*:\s*(\d+)\s*ft", txt)):
            r["thr_elev"] = int(m.group(1))
        if (m := re.search(r"DTHR\s*:\s*(\d+)\s*ft", txt)):
            r["dthr_elev"] = int(m.group(1))

    # AD 2.13 : distances déclarées ; lignes « TWY xx » = départ d'intersection de la piste précédente
    last = None
    for c in rows(S.get(13, "")):
        if len(c) < 5:
            continue
        d = {k: _int(v) for k, v in zip(("tora", "toda", "asda", "lda"), c[1:5]) if _int(v)}
        if _RWY.match(c[0]):
            last = c[0]
            R.setdefault(last, {}).update(d)
        elif last and c[0].upper().startswith("TWY") and d.get("tora"):
            R[last].setdefault("intersections", []).append({"twy": c[0][3:].strip(), "tora": d["tora"]})

    # AD 2.14 : balisage
    for c in rows(S.get(14, "")):
        if len(c) < 5 or not _RWY.match(c[0]):
            continue
        r = R.setdefault(c[0], {})
        if c[1] and c[1] != "NIL":
            r["apch_lgt"] = c[1]
        if (m := re.search(r"PAPI\s*(\d+(?:\.\d+)?)", c[3])):
            r["papi"] = float(m.group(1))
        if (v := _int(c[4])):
            r["meht_ft"] = v

    # AD 2.17 : altitude de transition
    for c in rows(S.get(17, "")):
        line = " ".join(c)
        if re.search(r"transition", line, re.I) and (m := re.search(r"(\d{3,5})\s*ft", line)):
            apt["ta_ft"] = int(m.group(1))
            break
    else:
        if (m := re.search(r"(?:TA|[Aa]ltitude de transition|[Tt]ransition altitude)\s*[:=]?\s*(\d{3,5})\s*ft", _text(S.get(17, "")))):
            apt["ta_ft"] = int(m.group(1))

    # AD 2.19 : moyens radio. LOC / GP / DME rattachés à leur piste.
    navs = []
    for c in rows(S.get(19, "")):
        if len(c) < 5 or not c[0] or c[0].startswith("Type"):
            continue
        typ = c[0]
        m = re.match(r"(LOC|GP|DME|ILS|MKR|OM|MM)\s+(\d{2}[LCR]?)\b\s*(?:\((.*?)\))?", typ)
        freq = c[2]
        if m:
            kind, rwy, cat = m.group(1), m.group(2), m.group(3)
            ils = R.setdefault(rwy, {}).setdefault("ils", {})
            if kind == "LOC":
                ils.update({"id": c[1] or None, "freq": _NUM(freq)})
                if cat:
                    ils["cat"] = cat
            elif kind == "GP":
                if (g := re.search(r"\(\s*(\d+(?:\.\d+)?)\s*°\s*\)", c[7] if len(c) > 7 else "")):
                    ils["gs"] = float(g.group(1))
                if (g := re.search(r"(\d+)\s*ft", c[7] if len(c) > 7 else "")):
                    ils["rdh_ft"] = int(g.group(1))
            elif kind == "DME":
                ils["dme"] = True
            continue
        if typ.split()[0] in ("NDB", "VOR", "VOR-DME", "DVOR", "DVOR-DME", "VORTAC", "DME", "TACAN"):
            nav = {"type": typ, "id": c[1], "freq": freq}
            if (p := dms_pairs(c[4])):
                nav["pos"] = p[0]
            navs.append(nav)
    if navs:
        apt["navaids"] = navs
    # pistes sans aucune donnée exploitable : retirées
    apt["rwys"] = {k: v for k, v in sorted(R.items()) if v}
    return {k: v for k, v in apt.items() if v not in (None, {}, [])}


# ---------- Départs d'intersection : position sur l'axe de piste, d'après le plan au sol OSM ----------
def _xy(p, lat0):
    return (p[0] * 111320.0 * math.cos(math.radians(lat0)), p[1] * 110540.0)


def locate_intersections(icao: str, apt: dict, feats: list[dict], max_m: float = 150.0) -> None:
    """Ajoute `pos` [lon, lat] (point de l'axe le plus proche du taxiway) à chaque départ d'intersection."""
    axes = [f for f in feats if f["properties"].get("apt") == icao and f["properties"].get("kind") == "rwy_axis"]
    for q, r in apt.get("rwys", {}).items():
        axis = next((a for a in axes if q in str(a["properties"].get("ref", "")).split("/")), None)
        if not axis or not r.get("intersections"):
            continue
        A, B = axis["geometry"]["coordinates"][0], axis["geometry"]["coordinates"][-1]
        lat0 = A[1]
        ax, ay = _xy(A, lat0); bx, by = _xy(B, lat0)
        L2 = (bx - ax) ** 2 + (by - ay) ** 2 or 1.0
        for it in r["intersections"]:
            best = None
            for f in feats:
                p = f["properties"]
                if p.get("apt") != icao or p.get("kind") not in ("taxiway", "taxilane") or p.get("ref") != it["twy"]:
                    continue
                g = f["geometry"]
                lines = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"] if g["type"] == "MultiLineString" else []
                for pt in (c for ln in lines for c in ln):
                    px, py = _xy(pt, lat0)
                    t = max(0.0, min(1.0, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / L2))
                    d = math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)))
                    if best is None or d < best[0]:
                        best = (d, t)
            if best and best[0] <= max_m:
                t = best[1]
                it["pos"] = [round(A[0] + t * (B[0] - A[0]), 6), round(A[1] + t * (B[1] - A[1]), 6)]


def build(raw: str, out: str, ground: str | None = None) -> int:
    cycle = ""
    with contextlib_suppress():
        cycle = open(os.path.join(raw, "cycle.txt")).read().strip()
    airports = {}
    for fn in sorted(os.listdir(raw)) if os.path.isdir(raw) else []:
        m = re.match(r"FR-AD-2\.([A-Z]{4})-fr-FR\.html$", fn)
        if not m:
            continue
        with open(os.path.join(raw, fn), encoding="utf-8", errors="replace") as f:
            try:
                apt = parse(f.read(), m.group(1))
            except Exception as e:  # une page malformée n'arrête pas le build
                log.warning("%s : lecture impossible (%s)", m.group(1), e)
                continue
        if apt.get("rwys"):
            airports[m.group(1)] = apt
    if not airports:
        log.warning("aucune donnée eAIP")
        return 0
    ground = ground or os.path.join(out, "ground.geojson")
    if os.path.exists(ground):
        with open(ground, encoding="utf-8") as f:
            feats = json.load(f).get("features", [])
        for icao, apt in airports.items():
            locate_intersections(icao, apt, feats)
    os.makedirs(out, exist_ok=True)
    doc = {"source": "SIA, eAIP France (Licence Ouverte)", "cycle": cycle, "airports": airports}
    with open(os.path.join(out, "eaip.json"), "w") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    log.info("eaip.json : %d aérodromes", len(airports))
    return len(airports)


class contextlib_suppress:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return exc[0] is not None and issubclass(exc[0], OSError)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch"); f.add_argument("--raw", required=True); f.add_argument("--icao", nargs="*", default=DEFAULT_ICAO)
    b = sub.add_parser("build"); b.add_argument("--raw", required=True); b.add_argument("--out", required=True)
    b.add_argument("--ground", help="ground.geojson (défaut : <out>/ground.geojson) pour situer les départs d'intersection")
    a = ap.parse_args(argv)
    if a.cmd == "fetch":
        n = fetch(a.raw, a.icao)
        print(f"eAIP : {n}/{len(a.icao)} pages")
        return 0 if n else 1
    n = build(a.raw, a.out, a.ground)
    print(f"eAIP : {n} aérodromes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
