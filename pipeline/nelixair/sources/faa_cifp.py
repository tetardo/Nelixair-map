"""Adaptateur FAA CIFP (Coded Instrument Flight Procedures), format ARINC 424-18.

Domaine public (U.S. Government work). Couvre l'espace aérien US (CONUS,
Alaska, Hawaï, territoires). Fichier : FAACIFP18 dans CIFP_YYMMDD.zip.

Enregistrements exploités (colonnes 1-indexées, ARINC 424-18) :
  EA  waypoints en route
  D_  aides VHF (VOR, VOR/DME, VORTAC, TACAN, DME)
  DB  NDB en route
  ER  voies aériennes en route
  PA  aéroports (section P, sous-section 'A' en colonne 13)
  PG  pistes (longueur, QFU magnétique, largeur)
  AS  Grid MORA (altitudes minimales hors route par carré de 1°)
Les enregistrements de continuation (n° > 1) sont ignorés.
"""
from __future__ import annotations

import io
import zipfile
from collections import defaultdict
from typing import Iterable, Iterator, Optional

from ..model import Airport, Airway, AirwayPoint, Fix, MoraCell

SRC = "faa-cifp"


def col(line: str, start: int, end: int) -> str:
    """Extrait les colonnes [start, end] (1-indexées, inclusives) sans espaces."""
    return line[start - 1:end].strip()


def parse_lat(s: str) -> Optional[float]:
    # NDDMMSSss
    if len(s) != 9 or s[0] not in "NS" or not s[1:].isdigit():
        return None
    v = int(s[1:3]) + int(s[3:5]) / 60 + int(s[5:9]) / 100 / 3600
    return -v if s[0] == "S" else v


def parse_lon(s: str) -> Optional[float]:
    # EDDDMMSSss
    if len(s) != 10 or s[0] not in "EW" or not s[1:].isdigit():
        return None
    v = int(s[1:4]) + int(s[4:6]) / 60 + int(s[6:10]) / 100 / 3600
    return -v if s[0] == "W" else v


def parse_alt(s: str) -> Optional[int]:
    s = s.strip()
    if s.startswith("FL") and s[2:].isdigit():
        return int(s[2:]) * 100
    return int(s) if s.isdigit() else None


def _is_primary(cont: str) -> bool:
    return cont in ("0", "1", "")


def vhf_class(c1: str, c2: str) -> Optional[str]:
    """Classe navaid depuis les 2 premiers caractères du champ 'Navaid Class'."""
    if c1 == "V":
        if c2 in ("T", "M"):
            return "vortac"
        if c2 == "D":
            return "vordme"
        return "vor"
    if c1 == " ":
        if c2 in ("T", "M"):
            return "tacan"
        if c2 in ("D", "N"):
            return "dme"
    return None  # ILS/DME, localizer, etc. : hors périmètre carte en route


def _parse_ea(line: str, cycle: str) -> Optional[Fix]:
    if not _is_primary(line[21]):
        return None
    lat, lon = parse_lat(col(line, 33, 41)), parse_lon(col(line, 42, 51))
    if lat is None or lon is None:
        return None
    return Fix(ident=col(line, 14, 18), cls="waypoint", lat=lat, lon=lon, src=SRC,
               region=col(line, 20, 21), name=col(line, 99, 123), country="",
               cycle=cycle)


def _parse_vhf(line: str, cycle: str) -> Optional[Fix]:
    if not _is_primary(line[21]):
        return None
    cls = vhf_class(line[27], line[28])
    if cls is None:
        return None
    lat, lon = parse_lat(col(line, 33, 41)), parse_lon(col(line, 42, 51))
    if lat is None:  # DME/TACAN seul : position DME
        lat, lon = parse_lat(col(line, 56, 64)), parse_lon(col(line, 65, 74))
    if lat is None or lon is None:
        return None
    f = col(line, 23, 27)
    return Fix(ident=col(line, 14, 17), cls=cls, lat=lat, lon=lon, src=SRC,
               region=col(line, 20, 21), name=col(line, 94, 123),
               freq=int(f) / 100 if f.isdigit() else None, cycle=cycle)


def _parse_ndb(line: str, cycle: str) -> Optional[Fix]:
    if not _is_primary(line[21]):
        return None
    lat, lon = parse_lat(col(line, 33, 41)), parse_lon(col(line, 42, 51))
    if lat is None or lon is None:
        return None
    f = col(line, 23, 27)
    return Fix(ident=col(line, 14, 17), cls="ndb", lat=lat, lon=lon, src=SRC,
               region=col(line, 20, 21), name=col(line, 94, 123),
               freq=int(f) / 10 if f.isdigit() else None, cycle=cycle)


_SURFACE = {"H": "hard", "S": "soft", "W": "water"}


def airport_kind(rwy_ft: Optional[int], surface: str, ident: str) -> str:
    if surface == "water":
        return "seaplane"
    if rwy_ft is None:
        return "small"
    if rwy_ft >= 8000:
        return "large"
    if rwy_ft >= 5000:
        return "medium"
    return "small"


def _parse_pa(line: str, cycle: str) -> Optional[Airport]:
    if not _is_primary(line[21]):
        return None
    lat, lon = parse_lat(col(line, 33, 41)), parse_lon(col(line, 42, 51))
    if lat is None or lon is None:
        return None
    ident = col(line, 7, 10)
    rwy = col(line, 28, 30)
    rwy_ft = int(rwy) * 100 if rwy.isdigit() and int(rwy) > 0 else None
    surface = _SURFACE.get(line[31], "")
    elev = col(line, 57, 61)
    try:
        elev_ft = int(elev)
    except ValueError:
        elev_ft = None
    return Airport(ident=ident, category=airport_kind(rwy_ft, surface, ident), lat=lat, lon=lon, src=SRC,
                   name=col(line, 94, 123), iata=col(line, 14, 16), elev_ft=elev_ft, rwy_ft=rwy_ft,
                   rwy_surface=surface, ifr=line[30] == "Y", military=line[81] == "M",
                   country="US", region=col(line, 11, 12), cycle=cycle)


def _parse_pg(line: str) -> Optional[tuple]:
    """Piste : (ident aéroport, {des, len_ft, wid_ft, hdg, hdg_ref})."""
    if not _is_primary(line[21]):
        return None
    rw = col(line, 14, 18)
    if not rw.startswith("RW"):
        return None
    ln, brg, wd = col(line, 23, 27), col(line, 28, 31), col(line, 78, 80)
    return col(line, 7, 10), {
        "des": rw[2:], "len_ft": int(ln) if ln.isdigit() else None,
        "wid_ft": int(wd) if wd.isdigit() and int(wd) > 0 else None, "surface": "",
        "hdg": round(int(brg) / 10) % 360 if brg.isdigit() else None, "hdg_ref": "M",
    }


def _parse_as(line: str, cycle: str) -> Iterator[MoraCell]:
    """Une ligne = 30 carrés consécutifs vers l'est depuis le coin sud-ouest (lat, lon) de départ."""
    slat, slon = col(line, 14, 16), col(line, 17, 20)
    if len(slat) != 3 or slat[0] not in "NS" or not slat[1:].isdigit():
        return
    if len(slon) != 4 or slon[0] not in "EW" or not slon[1:].isdigit():
        return
    lat = int(slat[1:]) * (-1 if slat[0] == "S" else 1)
    lon0 = int(slon[1:]) * (-1 if slon[0] == "W" else 1)
    for i in range(30):
        v = line[30 + 3 * i: 33 + 3 * i]
        if not v.isdigit():
            continue  # "UNK" ou vide
        lon = (lon0 + i + 180) % 360 - 180
        yield MoraCell(lat=lat, lon=lon, mora_ft=int(v) * 100, src=SRC, cycle=cycle)


# Section+sous-section d'un fix référencé dans un ER -> classe de jointure
_REF_CLS = {"EA": "waypoint", "D ": "vor", "DB": "ndb"}


def _build_airways(rows: dict, cycle: str) -> Iterator[Airway]:
    for (_area, ident), recs in rows.items():
        recs.sort(key=lambda r: r[0])
        seg: list[AirwayPoint] = []
        seg_level = None
        seg_rtype = ""
        for _seq, pt, level, rtype, end in recs:
            if seg and level != seg_level:
                # changement de niveau : on clôt la portion au point courant
                seg.append(AirwayPoint(pt.ident, pt.region, pt.cls))
                yield Airway(ident=ident, level=seg_level, src=SRC, points=seg,
                             route_type=seg_rtype, cycle=cycle)
                seg = []
            if not seg:
                seg_level, seg_rtype = level, rtype
            seg.append(pt)
            if end:
                if len(seg) >= 2:
                    yield Airway(ident=ident, level=seg_level, src=SRC, points=seg,
                                 route_type=seg_rtype, cycle=cycle)
                seg = []
        if len(seg) >= 2:
            yield Airway(ident=ident, level=seg_level, src=SRC, points=seg,
                         route_type=seg_rtype, cycle=cycle)


def parse_lines(lines: Iterable[str]) -> Iterator:
    airway_rows: dict = defaultdict(list)
    airports: list[Airport] = []
    runways: dict = defaultdict(list)
    cycle = ""
    for raw in lines:
        line = raw.rstrip("\r\n")
        if len(line) < 132 or line[0] != "S":
            continue  # en-têtes HDR et lignes tronquées
        line = line.ljust(132)
        cycle = cycle or line[128:132].strip()
        sec, sub = line[4], line[5]
        if sec == "E" and sub == "A":
            fx = _parse_ea(line, cycle)
            if fx:
                yield fx
        elif sec == "D" and sub == " ":
            fx = _parse_vhf(line, cycle)
            if fx:
                yield fx
        elif sec == "D" and sub == "B":
            fx = _parse_ndb(line, cycle)
            if fx:
                yield fx
        elif sec == "P" and line[12] == "A":
            ap = _parse_pa(line, cycle)
            if ap:
                airports.append(ap)  # émis en fin de fichier, une fois les pistes (PG) lues
        elif sec == "P" and line[12] == "G":
            rw = _parse_pg(line)
            if rw:
                runways[rw[0]].append(rw[1])
        elif sec == "A" and sub == "S":
            yield from _parse_as(line, cycle)
        elif sec == "E" and sub == "R":
            if not _is_primary(line[38]):
                continue
            ref = _REF_CLS.get(line[36:38])
            if ref is None:
                continue  # fix terminal/aéroport : non supporté, rare
            seq = col(line, 26, 29)
            level = line[45] if line[45] in "HLB" else "B"
            pt = AirwayPoint(
                ident=col(line, 30, 34), region=col(line, 35, 36), cls=ref,
                mea=parse_alt(line[83:88]), max_alt=parse_alt(line[93:98]),
                direction=line[46].strip(),
            )
            end = line[40] == "E"  # Waypoint Description Code pos. 2 : fin de voie continue
            airway_rows[(col(line, 2, 4), col(line, 14, 18))].append(
                (int(seq) if seq.isdigit() else 0, pt, level, line[44].strip(), end))
    for ap in airports:
        ap.runways = runways.get(ap.ident, [])
        yield ap
    yield from _build_airways(airway_rows, cycle)


def parse(path: str) -> Iterator:
    """Accepte le fichier FAACIFP18 brut ou le zip CIFP_YYMMDD.zip."""
    if path.endswith(".zip"):
        with zipfile.ZipFile(path) as zf:
            name = next(n for n in zf.namelist() if n.upper().endswith("FAACIFP18"))
            with zf.open(name) as fh:
                yield from parse_lines(io.TextIOWrapper(fh, encoding="latin-1"))
    else:
        with open(path, encoding="latin-1") as fh:
            yield from parse_lines(fh)
