"""Génère des fixtures ARINC 424 SYNTHÉTIQUES (coordonnées approximatives, non opérationnelles).

Usage : python -I pipeline/tests/make_fixtures.py
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def line(fields: dict) -> str:
    buf = [" "] * 132
    for start, val in fields.items():
        for i, ch in enumerate(val):
            buf[start - 1 + i] = ch
    return "".join(buf)


def lat(v):
    h = "N" if v >= 0 else "S"; v = abs(v); d = int(v); m = int((v - d) * 60); s = round((v - d - m / 60) * 360000)
    return f"{h}{d:02d}{m:02d}{s:04d}"


def lon(v):
    h = "E" if v >= 0 else "W"; v = abs(v); d = int(v); m = int((v - d) * 60); s = round((v - d - m / 60) * 360000)
    return f"{h}{d:03d}{m:02d}{s:04d}"


CYCLE = "2511"


def ea(ident, region, la, lo, name=""):
    return line({1: "SUSA", 5: "E", 6: "A", 7: "ENRT", 14: ident, 20: region, 22: "0",
                 27: "C  ", 30: "RH", 33: lat(la), 42: lon(lo), 80: "NAR", 99: name or ident,
                 124: "00001", 129: CYCLE})


def vhf(ident, region, la, lo, freq, cls, name):
    return line({1: "SUSA", 5: "D", 6: " ", 14: ident, 20: region, 22: "0", 23: freq, 28: cls,
                 33: lat(la), 42: lon(lo), 52: ident, 56: lat(la), 65: lon(lo), 94: name,
                 124: "00002", 129: CYCLE})


def ndb(ident, region, la, lo, freq, name):
    return line({1: "SUSA", 5: "D", 6: "B", 14: ident, 20: region, 22: "0", 23: freq, 28: "H  W ",
                 33: lat(la), 42: lon(lo), 94: name, 124: "00003", 129: CYCLE})


def er(route, seq, fix, region, secsub, desc, level, mea="", rtype="O", direction=" ", cont="0"):
    return line({1: "SUSA", 5: "E", 6: "R", 14: route, 26: f"{seq:04d}", 30: fix, 35: region,
                 37: secsub, 39: cont, 40: desc, 45: rtype, 46: level, 47: direction,
                 84: mea, 124: "00004", 129: CYCLE})


lines = [
    "HDR01FAACIFP18      001P013203774 2511 SYNTHETIC FIXTURE".ljust(132),
    vhf("ABQ", "K2", 35.0438, -106.8166, "11320", "VTHW ", "ALBUQUERQUE"),
    vhf("SAF", "K2", 35.5413, -106.0647, "11360", "VDHW ", "SANTA FE"),
    vhf("TCC", "K2", 35.1823, -103.5986, "11160", "V HW ", "TUCUMCARI"),
    vhf("ZZT", "K2", 35.30, -104.50, "11000", " THW ", "SYNTH TACAN"),
    vhf("IABQ", "K2", 35.04, -106.60, "11090", "IDHW ", "ILS DME (ignored)"),
    ndb("GUP", "K2", 35.5, -108.8, "03400", "GALLUP"),
    ea("ANTON", "K2", 35.30, -105.40),
    ea("BIGEE", "K2", 35.25, -104.20, "BIGEE"),
    # continuation record of BIGEE: must be ignored
    line({1: "SUSA", 5: "E", 6: "A", 7: "ENRT", 14: "BIGEE", 20: "K2", 22: "2", 129: CYCLE}),
    ea("ALSKA", "PA", 52.0, -179.5),
    ea("ASIAA", "PA", 52.5, 178.5),
    # J15 (haute) : ABQ - ANTON - BIGEE - TCC, fin de voie à TCC
    er("J15", 10, "ABQ", "K2", "D ", "V   ", "H", "18000"),
    er("J15", 20, "ANTON", "K2", "EA", "E   ", "H", "18000"),
    er("J15", 30, "BIGEE", "K2", "EA", "E   ", "H", "FL180"),
    er("J15", 40, "TCC", "K2", "D ", "VE  ", "H"),
    # deuxième portion de J15 (discontinue) : SAF - ZZT
    er("J15", 50, "SAF", "K2", "D ", "V   ", "H", "18000"),
    er("J15", 60, "ZZT", "K2", "D ", "VE  ", "H"),
    # V16 (basse) : GUP - ABQ - SAF, avec changement de niveau vers B
    er("V16", 10, "GUP", "K2", "DB", "N   ", "L", "09000", direction="F"),
    er("V16", 20, "ABQ", "K2", "D ", "V   ", "L", "10000"),
    er("V16", 30, "SAF", "K2", "D ", "V   ", "B", "11000"),
    er("V16", 40, "TCC", "K2", "D ", "VE  ", "B"),
    # R220 : traverse l'antiméridien
    er("R220", 10, "ALSKA", "PA", "EA", "E   ", "B", "FL200", rtype="R"),
    er("R220", 20, "ASIAA", "PA", "EA", "EE  ", "B", rtype="R"),
    # V99 : référence un point inexistant -> doit être coupée
    er("V99", 10, "ABQ", "K2", "D ", "V   ", "L"),
    er("V99", 20, "NOPE1", "K2", "EA", "E   ", "L"),
    er("V99", 30, "SAF", "K2", "D ", "VE  ", "L"),
]

os.makedirs(os.path.join(HERE, "fixtures"), exist_ok=True)
with open(os.path.join(HERE, "fixtures", "FAACIFP18.sample"), "w") as fh:
    fh.write("\n".join(lines) + "\n")

openaip_items = {"fetched": "2026-11-09", "items": [
    # doublon de ABQ (doit être écarté au profit du CIFP)
    {"identifier": "ABQ", "name": "ALBUQUERQUE", "type": 5, "country": "US",
     "frequency": {"value": "113.200", "unit": 2}, "geometry": {"type": "Point", "coordinates": [-106.8170, 35.0440]}},
    {"identifier": "PON", "name": "PONTOISE", "type": 4, "country": "FR", "channel": "84X",
     "frequency": {"value": "113.700", "unit": 2}, "geometry": {"type": "Point", "coordinates": [2.0383, 49.0967]}},
    {"identifier": "OL", "name": "SYNTH NDB", "type": 2, "country": "FR",
     "frequency": {"value": "331", "unit": 1}, "geometry": {"type": "Point", "coordinates": [1.0, 48.0]}},
    {"identifier": "XXX", "name": "UNKNOWN TYPE", "type": 99, "country": "FR",
     "geometry": {"type": "Point", "coordinates": [1.0, 47.0]}},
]}
with open(os.path.join(HERE, "fixtures", "openaip_navaids.json"), "w") as fh:
    json.dump(openaip_items, fh, indent=1)
print("ok")
