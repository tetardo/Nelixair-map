"""Catalogue des cartes FAA d-TPP (Terminal Procedures Publication).

Domaine public (U.S. Government). Seul le catalogue XML est téléchargé au build
(d-tpp_Metafile.xml) ; les PDF restent chez la FAA et sont ouverts par lien direct :
  https://aeronav.faa.gov/d-tpp/<cycle>/<pdf_name>

Le cycle d-TPP suit le calendrier AIRAC (28 jours), numéroté AANN comme le CIFP.
"""
from __future__ import annotations

import datetime as dt
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from typing import Optional

BASE = "https://aeronav.faa.gov/d-tpp"
METAFILE = BASE + "/{cycle}/xml_data/d-tpp_Metafile.xml"

# Cycle AIRAC de référence : 2501 en vigueur le 23 janvier 2025.
_REF = dt.date(2025, 1, 23)


def airac_cycle(day: dt.date) -> str:
    """Cycle AIRAC en vigueur à `day`, au format AANN (ex. 2511)."""
    n = (day - _REF).days // 28
    start = _REF + dt.timedelta(days=28 * n)
    # premier cycle de l'année du début de cycle
    k = (dt.date(start.year, 1, 1) - _REF).days
    first = _REF + dt.timedelta(days=28 * -(-k // 28))
    return f"{start.year % 100:02d}{(start - first).days // 28 + 1:02d}"


def fetch(out_path: str, day: Optional[dt.date] = None) -> str:
    """Télécharge le catalogue du cycle en vigueur (repli sur le cycle précédent). Retourne le cycle."""
    day = day or dt.date.today()
    last_err: Exception = RuntimeError("aucun cycle tenté")
    for d in (day, day - dt.timedelta(days=28)):
        cycle = airac_cycle(d)
        req = urllib.request.Request(METAFILE.format(cycle=cycle), headers={"User-Agent": "nelixair-map-build"})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                data = r.read()
        except urllib.error.URLError as e:
            last_err = e
            continue
        with open(out_path, "wb") as fh:
            fh.write(data)
        return cycle
    raise last_err


def parse(path: str) -> tuple[str, dict[str, list]]:
    """Retourne (cycle, {ident: [[code, nom, pdf], ...]}).

    Chaque aéroport est indexé par son code OACI (KABQ) et par son identifiant FAA (ABQ, E80),
    car le CIFP utilise l'un ou l'autre.
    """
    charts: dict[str, list] = {}
    cycle = ""
    for _ev, el in ET.iterparse(path, events=("start", "end")):
        if _ev == "start":
            if el.tag == "digital_tpp":
                cycle = el.get("cycle", "")
            continue
        if el.tag != "airport_name":
            continue
        rows = []
        for rec in el.findall("record"):
            pdf = (rec.findtext("pdf_name") or "").strip()
            if not pdf or (rec.findtext("useraction") or "").strip() == "D":  # carte supprimée
                continue
            rows.append([(rec.findtext("chart_code") or "").strip(), (rec.findtext("chart_name") or "").strip(), pdf])
        if rows:
            for key in (el.get("icao_ident"), el.get("apt_ident")):
                if key:
                    charts.setdefault(key.strip().upper(), rows)
        el.clear()
    return cycle, charts
