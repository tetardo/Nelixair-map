#!/usr/bin/env python3
"""CLI du pipeline nelixair-map.

  fetch   télécharge les sources brutes dans data/raw/
  ingest  sources brutes -> format interne NDJSON (build/nav/<source>.ndjson)
  export  NDJSON (par priorité) -> GeoJSON + search.json + meta.json
  all     ingest + export

Les tuiles PMTiles sont produites ensuite par scripts/build.sh (tippecanoe).
"""
from __future__ import annotations

import argparse
import datetime as dt
import itertools
import logging
import os
import re
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from nelixair import model  # noqa: E402
from nelixair.export import export  # noqa: E402
from nelixair.merge import merge  # noqa: E402
from nelixair.sources import faa_cifp, faa_dtpp, openaip  # noqa: E402

log = logging.getLogger("build")

CIFP_PAGE = "https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/cifp/download/"
CIFP_RE = re.compile(r"https://aeronav\.faa\.gov/[^\"']*?/CIFP_(\d{6})\.zip")

# Métadonnées d'attribution par source (reprises dans meta.json et affichées par le front).
SOURCE_META = {
    "faa-cifp": {"name": "FAA CIFP", "license": "Domaine public (U.S. Government)",
                 "url": "https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/cifp/",
                 "coverage": "États-Unis : waypoints, navaids, voies aériennes, aéroports, Grid MORA"},
    "openaip": {"name": "OpenAIP", "license": "CC BY-NC 4.0",
                "url": "https://www.openaip.net",
                "coverage": "Monde : navaids, aéroports, espaces aériens, FIR"},
}

# Ordre de priorité par défaut (le premier gagne lors de la déduplication).
DEFAULT_PRIORITY = ["faa-cifp", "openaip"]


def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "nelixair-map-build"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def pick_cifp_url(html: str, today: dt.date) -> str:
    """Choisit l'édition CIFP en vigueur (date d'effet <= aujourd'hui la plus récente)."""
    found = {}
    for m in CIFP_RE.finditer(html):
        d = dt.datetime.strptime(m.group(1), "%y%m%d").date()
        found[d] = m.group(0)
    if not found:
        raise RuntimeError("aucun lien CIFP trouvé sur la page FAA")
    current = [d for d in found if d <= today]
    return found[max(current) if current else min(found)]


def cmd_fetch(a) -> None:
    os.makedirs(a.raw, exist_ok=True)
    url = a.cifp_url or pick_cifp_url(_get(CIFP_PAGE).decode("utf-8", "replace"), dt.date.today())
    log.info("CIFP : %s", url)
    with open(os.path.join(a.raw, "cifp.zip"), "wb") as fh:
        fh.write(_get(url))
    try:
        cyc = faa_dtpp.fetch(os.path.join(a.raw, "dtpp.xml"))
        log.info("FAA d-TPP : cycle %s", cyc)
    except Exception as e:  # les cartes sont un bonus : le build continue sans
        log.warning("FAA d-TPP indisponible (%s) : pas de liens vers les cartes", e)
    key = a.openaip_key or os.environ.get("OPENAIP_API_KEY")
    if key:
        for ep in openaip.ENDPOINTS:
            n = openaip.fetch(key, os.path.join(a.raw, f"openaip_{ep}.json"), endpoint=ep)
            log.info("OpenAIP %s : %d", ep, n)
    else:
        log.warning("OPENAIP_API_KEY absent : navaids mondiaux ignorés (US uniquement)")


def cmd_ingest(a) -> None:
    nav = os.path.join(a.out, "nav")
    os.makedirs(nav, exist_ok=True)
    jobs = []
    cifp = a.cifp or os.path.join(a.raw, "cifp.zip")
    if os.path.exists(cifp):
        jobs.append(("faa-cifp", faa_cifp.parse(cifp)))
    oa = a.openaip or os.path.join(a.raw, "openaip_navaids.json")
    oa_dir = os.path.dirname(oa)
    oa_apt = a.openaip_airports or os.path.join(oa_dir, "openaip_airports.json")
    oa_asp = a.openaip_airspaces or os.path.join(oa_dir, "openaip_airspaces.json")
    oa_parts = []
    if os.path.exists(oa):
        oa_parts.append(openaip.parse(oa))
    if os.path.exists(oa_apt):
        oa_parts.append(openaip.parse_airports(oa_apt))
    if os.path.exists(oa_asp):
        oa_parts.append(openaip.parse_airspaces(oa_asp))
    if oa_parts:
        jobs.append(("openaip", itertools.chain(*oa_parts)))
    if not jobs:
        sys.exit("aucune source brute trouvée (lancer `fetch` ou passer --cifp/--openaip)")
    for name, records in jobs:
        n = model.dump_ndjson(records, os.path.join(nav, f"{name}.ndjson"))
        log.info("%s : %d enregistrements", name, n)


def cmd_export(a) -> None:
    nav = os.path.join(a.out, "nav")
    order = a.priority.split(",") if a.priority else DEFAULT_PRIORITY
    present = [s for s in order if os.path.exists(os.path.join(nav, f"{s}.ndjson"))]
    # toute source ingérée mais absente de la liste passe en dernier
    extra = sorted(f[:-7] for f in os.listdir(nav) if f.endswith(".ndjson") and f[:-7] not in present)
    present += extra
    ds = merge(model.load_ndjson(os.path.join(nav, f"{s}.ndjson")) for s in present)
    cycles = {}
    for f in ds.fixes:
        cycles.setdefault(f.src, f.cycle)
    dtpp = a.dtpp or os.path.join(a.raw, "dtpp.xml")
    charts = faa_dtpp.parse(dtpp) if os.path.exists(dtpp) else ("", {})
    if charts[0]:
        log.info("d-TPP %s : %d idents avec cartes", charts[0], len(charts[1]))
    meta = export(ds, a.out, [dict(SOURCE_META.get(s, {"name": s}), id=s, cycle=cycles.get(s, ""))
                              for s in present], charts)
    log.info("export : %s", meta["counts"])
    # Contrôle de cohérence Grid MORA : le carré du mont Whitney (36.58N 118.29W, 14 505 ft)
    # doit dépasser 15 000 ft. Sinon l'orientation des carrés est fausse.
    w = ds.mora.get((36, -119))
    if ds.mora:
        log.info("contrôle MORA Whitney (36N 119W) : %s ft", w.mora_ft if w else "absent")
    if ds.stats:
        log.info("stats : %s", ds.stats)


def main(argv=None) -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("command", choices=["fetch", "ingest", "export", "all"])
    p.add_argument("--raw", default="data/raw", help="dossier des sources brutes")
    p.add_argument("--out", default="build", help="dossier de sortie")
    p.add_argument("--cifp", help="chemin vers CIFP_YYMMDD.zip ou FAACIFP18")
    p.add_argument("--cifp-url", help="forcer l'URL du zip CIFP")
    p.add_argument("--openaip", help="chemin vers le JSON brut OpenAIP")
    p.add_argument("--openaip-airports", help="JSON brut OpenAIP des aéroports (défaut : à côté de --openaip)")
    p.add_argument("--openaip-airspaces", help="JSON brut OpenAIP des espaces (défaut : à côté de --openaip)")
    p.add_argument("--openaip-key", help="clé API OpenAIP (sinon $OPENAIP_API_KEY)")
    p.add_argument("--dtpp", help="catalogue FAA d-TPP (d-tpp_Metafile.xml), défaut : <raw>/dtpp.xml")
    p.add_argument("--priority", help="ordre des sources, ex. faa-cifp,openaip")
    p.add_argument("-v", "--verbose", action="store_true")
    a = p.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if a.verbose else logging.INFO, format="%(levelname)s %(message)s")
    if a.command == "fetch":
        cmd_fetch(a)
    if a.command in ("ingest", "all"):
        cmd_ingest(a)
    if a.command in ("export", "all"):
        cmd_export(a)


if __name__ == "__main__":
    main()
