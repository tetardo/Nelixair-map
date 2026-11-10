import json
import os
import sys
import tempfile
import unittest
import datetime as dt

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from nelixair import model  # noqa: E402
from nelixair.export import export  # noqa: E402
from nelixair.geo import split_antimeridian, great_circle  # noqa: E402
from nelixair.merge import merge  # noqa: E402
from nelixair.sources import faa_cifp, openaip  # noqa: E402
import build  # noqa: E402

FIX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
def _load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


CIFP = os.path.join(FIX, "FAACIFP18.sample")
OAIP = os.path.join(FIX, "openaip_navaids.json")


class TestCifp(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.recs = list(faa_cifp.parse(CIFP))
        cls.fixes = {f.ident: f for f in cls.recs if isinstance(f, model.Fix)}
        cls.awys = [a for a in cls.recs if isinstance(a, model.Airway)]

    def test_coords(self):
        self.assertEqual(faa_cifp.parse_lat("N35023768"), 35 + 2 / 60 + 37.68 / 3600)
        self.assertAlmostEqual(faa_cifp.parse_lon("W106485976"), -(106 + 48 / 60 + 59.76 / 3600))
        self.assertIsNone(faa_cifp.parse_lat("        "))

    def test_navaid_classes(self):
        f = self.fixes
        self.assertEqual(f["ABQ"].cls, "vortac")
        self.assertEqual(f["SAF"].cls, "vordme")
        self.assertEqual(f["TCC"].cls, "vor")
        self.assertEqual(f["ZZT"].cls, "tacan")
        self.assertEqual(f["GUP"].cls, "ndb")
        self.assertNotIn("IABQ", f)  # ILS/DME exclu
        self.assertAlmostEqual(f["ABQ"].freq, 113.2)
        self.assertAlmostEqual(f["GUP"].freq, 340.0)
        self.assertEqual(f["ABQ"].region, "K2")
        self.assertEqual(f["ABQ"].name, "ALBUQUERQUE")
        self.assertEqual(f["ABQ"].cycle, "2511")

    def test_continuation_ignored(self):
        self.assertEqual(sum(1 for r in self.recs if getattr(r, "ident", "") == "BIGEE"
                             and isinstance(r, model.Fix)), 1)

    def test_airway_segments(self):
        j15 = [a for a in self.awys if a.ident == "J15"]
        self.assertEqual([[p.ident for p in a.points] for a in j15],
                         [["ABQ", "ANTON", "BIGEE", "TCC"], ["SAF", "ZZT"]])
        self.assertEqual(j15[0].points[2].mea, 18000)  # "FL180"
        v16 = [a for a in self.awys if a.ident == "V16"]
        # changement de niveau L -> B à SAF : deux portions jointives
        self.assertEqual([(a.level, [p.ident for p in a.points]) for a in v16],
                         [("L", ["GUP", "ABQ", "SAF"]), ("B", ["SAF", "TCC"])])
        self.assertEqual(v16[0].points[0].direction, "F")
        self.assertEqual(v16[0].points[0].cls, "ndb")


class TestCifpAirportsMora(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        recs = list(faa_cifp.parse(CIFP))
        cls.apts = {a.ident: a for a in recs if isinstance(a, model.Airport)}
        cls.mora = {(c.lat, c.lon): c.mora_ft for c in recs if isinstance(c, model.MoraCell)}

    def test_airports(self):
        a = self.apts["KABQ"]
        self.assertEqual((a.category, a.iata, a.rwy_ft, a.elev_ft, a.ifr, a.rwy_surface), ("large", "ABQ", 13700, 5355, True, "hard"))
        self.assertEqual(a.name, "ALBUQUERQUE INTL SUNPORT")
        self.assertEqual(self.apts["KSAF"].category, "large")
        self.assertEqual(self.apts["E80"].category, "medium")
        self.assertEqual(self.apts["0E0"].category, "small")
        self.assertEqual(self.apts["KXXX"].category, "seaplane")
        self.assertTrue(self.apts["KXXX"].military)

    def test_runways(self):
        rw = {r["des"]: r for r in self.apts["KABQ"].runways}
        self.assertEqual(set(rw), {"08", "26", "03", "21"})  # continuation ignorée
        self.assertEqual((rw["08"]["len_ft"], rw["08"]["hdg"], rw["08"]["hdg_ref"], rw["08"]["wid_ft"]), (13793, 83, "M", 150))

    def test_mora(self):
        self.assertEqual(self.mora[(35, -107)], 12000)
        self.assertEqual(self.mora[(35, -106)], 11000)
        self.assertNotIn((35, -105), self.mora)  # UNK
        self.assertEqual(self.mora[(35, -104)], 9500)
        self.assertEqual(self.mora[(36, -119)], 16500)


class TestOpenAip(unittest.TestCase):
    def test_parse(self):
        fx = {f.ident: f for f in openaip.parse(OAIP)}
        self.assertEqual(fx["PON"].cls, "vordme")
        self.assertAlmostEqual(fx["PON"].freq, 113.7)
        self.assertEqual(fx["OL"].cls, "ndb")
        self.assertAlmostEqual(fx["OL"].freq, 331.0)
        self.assertNotIn("XXX", fx)

    def test_airports(self):
        apts = {a.ident: a for a in openaip.parse_airports(os.path.join(FIX, "openaip_airports.json"))}
        self.assertEqual(set(apts), {"LFPG", "KABQ", "LFPN", "LFPI", "LFQQ"})
        # surface 22 = inconnue (et non "eau") : petit terrain, pas une hydrobase
        self.assertEqual((apts["LFQQ"].category, apts["LFQQ"].rwy_surface), ("small", ""))
        self.assertEqual(apts["LFPG"].runways[0], {"des": "09L", "len_ft": 13829, "wid_ft": 148, "surface": "asphalte",
                                                   "hdg": 87, "hdg_ref": "T"})
        self.assertEqual(apts["LFPG"].freqs, [{"type": "TWR", "mhz": 119.25, "name": "DE GAULLE TOUR"},
                                              {"type": "ATIS", "mhz": 128.0, "name": "ATIS"}])
        g = apts["LFPG"]
        self.assertEqual((g.category, g.iata, g.rwy_ft, g.rwy_surface, g.elev_ft), ("large", "CDG", 13829, "hard", 390))
        self.assertEqual(apts["LFPN"].category, "small")
        self.assertEqual(apts["LFPI"].category, "heliport")

    def test_airspaces(self):
        asp = list(openaip.parse_airspaces(os.path.join(FIX, "openaip_airspaces.json")))
        by = {}
        for a in asp:
            by.setdefault(a.name, []).append(a)
        ctr = by["CTR PARIS"][0]
        self.assertEqual((ctr.type, ctr.group, ctr.icao_class, ctr.lower, ctr.upper), ("CTR", "controlled", "D", "SFC", "1500 ft MSL"))
        self.assertEqual(len(by["TMA PARIS 1"]), 2)  # MultiPolygon -> 2 enregistrements
        self.assertEqual(by["TMA PARIS 1"][0].upper, "FL115")
        self.assertEqual(by["TMA PARIS 1"][0].upper_ft, 11500)
        self.assertEqual(by["R 45 SYNTH"][0].upper, "9843 ft MSL")
        self.assertEqual(by["PARIS FIR"][0].group, "fir")
        self.assertEqual(by["UNKNOWN TYPE"][0].type, "T99")

    def test_geojson_input(self):
        fc = {"type": "FeatureCollection", "features": [{"type": "Feature",
              "geometry": {"type": "Point", "coordinates": [2, 49]},
              "properties": {"identifier": "abc", "type": 3, "name": "X"}}]}
        with tempfile.NamedTemporaryFile("w", suffix=".geojson", delete=False) as fh:
            json.dump(fc, fh)
        try:
            (f,) = list(openaip.parse(fh.name))
            self.assertEqual((f.ident, f.cls, f.lon), ("ABC", "vor", 2.0))
        finally:
            os.unlink(fh.name)


class TestGeo(unittest.TestCase):
    def test_antimeridian(self):
        parts = split_antimeridian(great_circle(52.0, -179.5, 52.5, 178.5))
        self.assertEqual(len(parts), 2)
        self.assertEqual(parts[0][-1][0], -180)
        self.assertEqual(parts[1][0][0], 180)

    def test_densify(self):
        pts = great_circle(40, -74, 51.5, 0)  # ~3000 NM
        self.assertGreater(len(pts), 40)
        self.assertEqual(pts[0], (-74, 40))
        # le grand cercle NY-Londres passe bien au nord des extrémités
        self.assertGreater(max(p[1] for p in pts), 51.5)


class TestRoundTripAndExport(unittest.TestCase):
    def test_full(self):
        with tempfile.TemporaryDirectory() as d:
            build.main(["all", "--cifp", CIFP, "--openaip", OAIP, "--out", d, "--raw", d,
                        "--dtpp", os.path.join(FIX, "dtpp.xml")])
            # NDJSON relisible
            recs = list(model.load_ndjson(os.path.join(d, "nav", "faa-cifp.ndjson")))
            self.assertTrue(any(isinstance(r, model.Airway) for r in recs))
            meta = _load(os.path.join(d, "meta.json"))
            fixes = _load(os.path.join(d, "fixes.geojson"))["features"]
            legs = _load(os.path.join(d, "airways.geojson"))["features"]
            search = _load(os.path.join(d, "search.json"))
            idents = [f["properties"]["ident"] for f in fixes]
            self.assertEqual(idents.count("ABQ"), 1)  # doublon OpenAIP écarté
            abq = next(f for f in fixes if f["properties"]["ident"] == "ABQ")
            self.assertEqual(abq["properties"]["src"], "faa-cifp")
            self.assertIn("PON", idents)
            self.assertEqual(meta["stats"]["fixes_dropped_as_duplicates"], 1)
            # V99 : NOPE1 introuvable -> aucun segment deviné ABQ-SAF sur V99
            self.assertFalse([l for l in legs if l["properties"]["ident"] == "V99"])
            self.assertEqual(meta["stats"]["airway_points_unresolved"], 1)
            # R220 coupé à l'antiméridien
            r220 = next(l for l in legs if l["properties"]["ident"] == "R220")
            self.assertEqual(r220["geometry"]["type"], "MultiLineString")
            j15 = [l for l in legs if l["properties"]["ident"] == "J15"]
            self.assertEqual(len(j15), 4)  # 3 + 1 tronçons, pas de lien TCC-SAF
            self.assertIn("J15", search["airways"])
            routes = _load(os.path.join(d, "routes.json"))
            self.assertEqual([[p[0] for p in part["pts"]] for part in routes["J15"]["parts"]],
                             [["ABQ", "ANTON", "BIGEE", "TCC"], ["SAF", "ZZT"]])
            self.assertEqual(routes["J15"]["parts"][0]["pts"][2][4], 18000)
            self.assertEqual([p["lv"] for p in routes["V16"]["parts"]], ["L", "B"])
            self.assertTrue(routes["R220"]["rnav"])
            self.assertFalse(routes["J15"]["rnav"])
            self.assertTrue(r220["properties"]["rnav"])
            self.assertEqual([s["id"] for s in meta["sources"]], ["faa-cifp", "openaip"])
            self.assertEqual(meta["sources"][0]["cycle"], "2511")
            apts = _load(os.path.join(d, "airports.geojson"))["features"]
            ids = [f["properties"]["ident"] for f in apts]
            self.assertEqual(ids.count("KABQ"), 1)
            self.assertEqual(next(f for f in apts if f["properties"]["ident"] == "KABQ")["properties"]["src"], "faa-cifp")
            self.assertIn("LFPG", ids)
            self.assertEqual(meta["stats"]["airports_dropped_as_duplicates"], 1)
            asp = _load(os.path.join(d, "airspaces.geojson"))["features"]
            self.assertEqual(len(asp), 6)
            self.assertEqual(meta["counts"]["mora_cells"], 6)
            self.assertIn(["LFPG", "airport"], [r[:2] for r in search["fixes"]])
            # détails aéroport : pistes appariées, fréquences OpenAIP reportées sur l'aéroport CIFP, cartes d-TPP
            k = _load(os.path.join(d, "apt", "KA.json"))["KABQ"]
            self.assertEqual([r[0] for r in k["rwy"]], ["08/26", "03/21"])
            self.assertEqual(k["rwy"][0][3], "béton")  # revêtement OpenAIP complété par désignation
            self.assertEqual(k["frq"], [["TWR", 120.3, "ALBUQUERQUE TOWER"]])
            self.assertEqual([c[0] for c in k["chr"]], ["MIN", "APD", "IAP"])  # carte supprimée exclue
            self.assertEqual(_load(os.path.join(d, "apt", "E8.json"))["E80"]["chr"][0][2], "00002R3.PDF")
            g = _load(os.path.join(d, "apt", "LF.json"))["LFPG"]
            self.assertEqual([r[0] for r in g["rwy"]], ["09L/27R", "08R"])
            self.assertNotIn("chr", g)
            self.assertEqual(meta["charts"]["base"], "https://aeronav.faa.gov/d-tpp/2511/")

    def test_priority_swap(self):
        with tempfile.TemporaryDirectory() as d:
            build.main(["all", "--cifp", CIFP, "--openaip", OAIP, "--out", d, "--raw", d,
                        "--priority", "openaip,faa-cifp"])
            fixes = _load(os.path.join(d, "fixes.geojson"))["features"]
            abq = [f for f in fixes if f["properties"]["ident"] == "ABQ"]
            self.assertEqual([f["properties"]["src"] for f in abq], ["openaip"])
            meta = _load(os.path.join(d, "meta.json"))
            # les voies CIFP passant par ABQ restent résolues via l'alias
            self.assertEqual(meta["stats"]["airway_points_unresolved"], 1)


class TestDtpp(unittest.TestCase):
    def test_airac(self):
        import datetime as dt
        from nelixair.sources.faa_dtpp import airac_cycle
        self.assertEqual(airac_cycle(dt.date(2025, 10, 30)), "2511")
        self.assertEqual(airac_cycle(dt.date(2025, 10, 29)), "2510")
        self.assertEqual(airac_cycle(dt.date(2025, 12, 25)), "2513")
        self.assertEqual(airac_cycle(dt.date(2026, 1, 22)), "2601")

    def test_pair_opposite(self):
        from nelixair.export import pair_runways
        rw = [{"des": d, "len_ft": 9000} for d in ("36", "18", "04L", "22R", "04R", "H1")]
        self.assertEqual([r[0] for r in pair_runways(rw)], ["18/36", "04L/22R", "04R", "H1"])


class TestWx(unittest.TestCase):
    def test_relay(self):
        import wx
        with tempfile.TemporaryDirectory() as d:
            wx.main(["--out", d, "--metars", os.path.join(FIX, "wx_metars.csv"), "--tafs", os.path.join(FIX, "wx_tafs.xml")])
            m = _load(os.path.join(d, "metars.json"))
            rows = {r[0]: dict(zip(m["f"], r)) for r in m["d"]}
            self.assertEqual(set(rows), {"LFML", "KSAF", "KXXX"})  # ligne sans coordonnées écartée
            lfml = rows["LFML"]
            self.assertEqual((lfml["wdir"], lfml["wspd"], lfml["wgst"], lfml["visib"], lfml["altim"], lfml["fltCat"]),
                             (320, 12, 25, "6+", 1018, "VFR"))
            self.assertEqual(rows["KSAF"]["clouds"], [["OVC", 800]])
            self.assertEqual((rows["KXXX"]["wdir"], rows["KXXX"]["visib"], rows["KXXX"]["vertVis"]), ("VRB", 0.5, 200))
            t = _load(os.path.join(d, "tafs.json"))["d"]
            self.assertTrue(t["LFML"].startswith("TAF LFML"))
            # mode fichiers locaux sans couches secondaires : fichiers vides, pas de téléchargement
            self.assertEqual(_load(os.path.join(d, "hazards.geojson"))["features"], [])

    def test_hazards_pireps(self):
        import wx
        with tempfile.TemporaryDirectory() as d:
            wx.main(["--out", d, "--metars", os.path.join(FIX, "wx_metars.csv"), "--tafs", os.path.join(FIX, "wx_tafs.xml"),
                     "--airsigmets", os.path.join(FIX, "wx_airsigmets.xml"), "--isigmets", os.path.join(FIX, "wx_isigmets.json"),
                     "--pireps", os.path.join(FIX, "wx_pireps.csv")])
            hz = [f["properties"] for f in _load(os.path.join(d, "hazards.geojson"))["features"]]
            self.assertEqual([(h["kind"], h["fam"], h["src"]) for h in hz],
                             [("SIGMET", "conv", "US"), ("AIRMET", "turb", "US"), ("SIGMET", "turb", "INTL")])
            self.assertEqual((hz[1]["base"], hz[1]["top"], hz[1]["sev"]), (18000, 38000, "MOD"))
            self.assertEqual(hz[2]["fir"], "MARSEILLE")
            self.assertTrue(hz[2]["from"].endswith("Z"))
            feats = _load(os.path.join(d, "hazards.geojson"))["features"]
            ring = feats[1]["geometry"]["coordinates"][0]
            self.assertEqual(ring[0], ring[-1])  # anneau refermé
            pr = [f["properties"] for f in _load(os.path.join(d, "pireps.geojson"))["features"]]
            self.assertEqual([(p["tb"], p["ic"], p["alt"]) for p in pr], [("MOD", "", 35000), ("", "LGT", 9000)])


class TestCifpUrl(unittest.TestCase):
    def test_pick(self):
        html = ('<a href="https://aeronav.faa.gov/Upload_313-d/cifp/CIFP_251030.zip">'
                '<a href="https://aeronav.faa.gov/Upload_313-d/cifp/CIFP_251127.zip">')
        self.assertTrue(build.pick_cifp_url(html, dt.date(2025, 11, 10)).endswith("CIFP_251030.zip"))
        self.assertTrue(build.pick_cifp_url(html, dt.date(2025, 12, 1)).endswith("CIFP_251127.zip"))


class TestGround(unittest.TestCase):
    """Plan au sol OSM (pipeline/ground.py) sur la réponse Overpass synthétique."""

    @classmethod
    def setUpClass(cls):
        import ground
        cls.g = ground
        cls.feats, cls.summary = ground.parse(_load(os.path.join(FIX, "ground", "LFML.json")), "LFML")

    def kinds(self, k):
        return [f for f in self.feats if f["properties"]["kind"] == k]

    def test_counts(self):
        c = self.summary["counts"]
        self.assertEqual(c["runway"], 2)
        self.assertEqual(c["stand"], 8)
        self.assertEqual(self.summary["taxiways"], ["A", "A1", "A2", "A3", "A4"])
        self.assertEqual(self.summary["runways"], ["13L/31R", "13R/31L"])
        e = self.summary["ends"]
        self.assertEqual(sorted(e), ["13L", "13R", "31L", "31R"])
        self.assertAlmostEqual((e["31R"] - e["13L"]) % 360, 180, delta=0.5)

    def test_runway_ends(self):
        ends = {f["properties"]["ref"]: f for f in self.kinds("rwy_end")}
        self.assertEqual(set(ends), {"13L", "31R", "13R", "31L"})
        # 13L = extrémité nord-ouest (on décolle au 134°), 31R = sud-est
        self.assertGreater(ends["13L"]["geometry"]["coordinates"][1], ends["31R"]["geometry"]["coordinates"][1])
        self.assertAlmostEqual(ends["13L"]["properties"]["hdg"], 134, delta=1)

    def test_runway_ends_reversed_way(self):
        # Une piste dessinée dans l'autre sens dans OSM garde les bonnes désignations
        a, b = (5.0, 43.0), (5.03, 42.98)
        ends = dict((d, p) for d, p, _ in self.g.runway_ends("13/31", [b, a]))
        self.assertEqual(ends["13"], a)
        self.assertEqual(ends["31"], b)

    def test_runway_polygon_width(self):
        rw = next(f for f in self.kinds("runway") if f["properties"]["ref"] == "13L/31R")
        ring = rw["geometry"]["coordinates"][0]
        self.assertEqual(ring[0], ring[-1])
        self.assertAlmostEqual(self.g.length_m([tuple(ring[0]), tuple(ring[3])]), 45, delta=0.5)
        self.assertAlmostEqual(rw["properties"]["len"], 3500, delta=5)

    def test_taxiway_pixel_width(self):
        tw = self.kinds("taxiway")[0]["properties"]
        # 18 m au zoom 18 vers 43,4° N : ~0,3 m/px * cos(lat) -> ~83 px
        self.assertAlmostEqual(tw["w18"], 18 / (0.29858 * 0.7262), delta=1)

    def test_build_index(self):
        with tempfile.TemporaryDirectory() as d:
            idx = self.g.build(os.path.join(FIX, "ground"), d)
            self.assertIn("LFML", idx)
            fc = _load(os.path.join(d, "ground.geojson"))
            self.assertEqual(len(fc["features"]), len(self.feats))
            self.assertEqual(_load(os.path.join(d, "ground-index.json"))["airports"]["LFML"]["osm"], "2026-11-01T00:00:00Z")

    def test_fetch_survives_failing_airport(self):
        """Un terrain en 504 ne bloque pas les autres ; l'échec n'est fatal que si tous échouent."""
        import urllib.parse
        from unittest import mock
        ok = json.dumps({"elements": [{"type": "node", "id": 1}]}).encode()

        def fake(url, body):
            if b"LFMN" in urllib.parse.unquote_to_bytes(body):
                raise OSError("HTTP Error 504")
            return ok
        with tempfile.TemporaryDirectory() as d, mock.patch.object(self.g, "_get", side_effect=fake), \
                mock.patch.object(self.g.time, "sleep"):
            self.assertEqual(self.g.fetch(["LFML", "LFMN"], d), {"LFML": 1})
            self.assertTrue(os.path.exists(os.path.join(d, "LFML.json")))
            with self.assertRaises(RuntimeError):
                self.g.fetch(["LFMN"], d)

    def test_build_without_data_writes_nothing(self):
        """Aucun terrain téléchargé : pas de GeoJSON vide (tippecanoe échoue dessus)."""
        with tempfile.TemporaryDirectory() as raw, tempfile.TemporaryDirectory() as out:
            self.assertEqual(self.g.build(raw, out), {})
            self.assertEqual(os.listdir(out), [])


class TestTaxiGraph(unittest.TestCase):
    """Graphe de roulage : raccordement des voies, postes, entrées de piste."""

    def test_graph(self):
        import ground
        import taxigraph
        with open(os.path.join(FIX, "ground", "LFML.json"), encoding="utf-8") as f:
            g = taxigraph.build_graph(json.load(f)["elements"], ground.runway_ends)
        # A1..A4 rejoignent l'axe 13L/31R (extrémités raccordées), triées depuis le seuil
        e = g["rwys"]["13L"]["entries"]
        self.assertEqual(len(e), 4)
        self.assertEqual([d for _, d in e], sorted(d for _, d in e))
        self.assertEqual(len(g["stands"]), 8)
        self.assertEqual(sorted(r for r, _ in g["holds"]), ["A1", "A2", "A3", "A4"])
        # longueurs d'arêtes positives, références valides
        self.assertTrue(all(x[3] > 0 and 0 <= x[2] < len(g["refs"]) for x in g["e"]))

    def test_build_writes_graph(self):
        import ground
        with tempfile.TemporaryDirectory() as d:
            idx = ground.build(os.path.join(FIX, "ground"), d)
            self.assertTrue(os.path.exists(os.path.join(d, "taxi", "LFML.json")))
            self.assertEqual(idx["LFML"]["taxi"]["rwys"], ["13L", "31R"])  # 13R/31L non reliées dans la fixture


class TestEaip(unittest.TestCase):
    """Lecture de l'eAIP SIA (AD 2) sur un extrait à la structure réelle."""

    @classmethod
    def setUpClass(cls):
        import eaip
        cls.eaip = eaip
        with open(os.path.join(FIX, "eaip", "FR-AD-2.LFML-fr-FR.html"), encoding="utf-8") as f:
            cls.apt = eaip.parse(f.read(), "LFML")

    def test_airac_and_url(self):
        self.assertEqual(self.eaip.airac_start(dt.date(2026, 11, 10)), dt.date(2026, 10, 29))
        self.assertEqual(self.eaip.airac_start(dt.date(2026, 11, 26)), dt.date(2026, 11, 26))
        self.assertTrue(self.eaip.ad2_url("LFML", dt.date(2026, 10, 29)).endswith(
            "eAIP_29_OCT_2026/FRANCE/AIRAC-2026-10-29/html/eAIP/FR-AD-2.LFML-fr-FR.html"))

    def test_ad22(self):
        self.assertEqual(self.apt["elev_ft"], 70)
        self.assertAlmostEqual(self.apt["magvar"], 2.57)
        self.assertAlmostEqual(self.apt["arp"][1], 43.4367, places=3)

    def test_runway_revision_resolved(self):
        r = self.apt["rwys"]["13L"]
        # <del>(132)</del> (131) : seule la valeur en vigueur compte
        self.assertEqual((r["true"], r["mag"]), (134.47, 131))
        self.assertEqual((r["len"], r["wid"], r["pcn"]), (3500, 45, "58/R/B/W/T"))
        self.assertEqual((r["thr_elev"], r["dthr_elev"]), (9, 8))
        self.assertIn("dthr", r)
        self.assertNotIn("dthr", self.apt["rwys"]["13R"])

    def test_declared_distances(self):
        r = self.apt["rwys"]["31R"]
        self.assertEqual((r["tora"], r["toda"], r["asda"], r["lda"]), (3440, 3500, 3440, 2780))
        self.assertEqual(self.apt["rwys"]["13L"]["intersections"][0], {"twy": "D1", "tora": 3003})

    def test_lighting_ils(self):
        r = self.apt["rwys"]["13R"]
        self.assertEqual(r["papi"], 3.0)
        self.assertEqual(r["ils"]["freq"], 108.3)
        self.assertEqual(r["ils"]["id"], "MCE")
        self.assertEqual((r["ils"]["gs"], r["ils"]["rdh_ft"]), (3.0, 54))
        self.assertEqual(self.apt["rwys"]["31R"]["apch_lgt"], "CAT I - 900 m - LIH")
        self.assertEqual(self.apt["ta_ft"], 5000)
        self.assertEqual([n["id"] for n in self.apt["navaids"]], ["MAR", "MRM"])

    def test_intersection_position(self):
        apt = {"rwys": {"13L": {"intersections": [{"twy": "D1", "tora": 3003}, {"twy": "ZZ", "tora": 1}]}}}
        feats = [
            {"type": "Feature", "properties": {"apt": "LFML", "kind": "rwy_axis", "ref": "13L/31R"},
             "geometry": {"type": "LineString", "coordinates": [[5.0, 43.0], [5.04, 43.0]]}},
            # taxiway perpendiculaire qui touche l'axe à 5.01
            {"type": "Feature", "properties": {"apt": "LFML", "kind": "taxiway", "ref": "D1"},
             "geometry": {"type": "LineString", "coordinates": [[5.01, 43.002], [5.01, 43.0001]]}},
        ]
        self.eaip.locate_intersections("LFML", apt, feats)
        it = apt["rwys"]["13L"]["intersections"]
        self.assertAlmostEqual(it[0]["pos"][0], 5.01, places=4)
        self.assertNotIn("pos", it[1])

    def test_build(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(self.eaip.build(os.path.join(FIX, "eaip"), d), 1)
            doc = _load(os.path.join(d, "eaip.json"))
            self.assertIn("LFML", doc["airports"])
            self.assertIn("Licence Ouverte", doc["source"])
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(self.eaip.build(os.path.join(d, "absent"), d), 0)
            self.assertFalse(os.path.exists(os.path.join(d, "eaip.json")))


class TestOpenAipRetry(unittest.TestCase):
    def _run(self, errors):
        import io
        import urllib.error
        from unittest import mock
        calls = []

        def fake(req, timeout):
            calls.append(1)
            if errors:
                code = errors.pop(0)
                raise urllib.error.HTTPError(req.full_url, code, "err", {}, None)
            return io.BytesIO(b'{"items": [], "totalPages": 1}')
        with mock.patch("urllib.request.urlopen", side_effect=fake), mock.patch.object(openaip.time, "sleep"):
            return openaip._get_json(openaip.urllib.request.Request("https://x")), len(calls)

    def test_retries_408_then_succeeds(self):
        body, n = self._run([408, 502])
        self.assertEqual((body["totalPages"], n), (1, 3))

    def test_401_not_retried(self):
        import urllib.error
        with self.assertRaises(urllib.error.HTTPError):
            self._run([401])



if __name__ == "__main__":
    unittest.main()
