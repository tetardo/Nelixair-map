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


class TestOpenAip(unittest.TestCase):
    def test_parse(self):
        fx = {f.ident: f for f in openaip.parse(OAIP)}
        self.assertEqual(fx["PON"].cls, "vordme")
        self.assertAlmostEqual(fx["PON"].freq, 113.7)
        self.assertEqual(fx["OL"].cls, "ndb")
        self.assertAlmostEqual(fx["OL"].freq, 331.0)
        self.assertNotIn("XXX", fx)

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
            build.main(["all", "--cifp", CIFP, "--openaip", OAIP, "--out", d, "--raw", d])
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
            self.assertEqual([s["id"] for s in meta["sources"]], ["faa-cifp", "openaip"])
            self.assertEqual(meta["sources"][0]["cycle"], "2511")

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


class TestCifpUrl(unittest.TestCase):
    def test_pick(self):
        html = ('<a href="https://aeronav.faa.gov/Upload_313-d/cifp/CIFP_251030.zip">'
                '<a href="https://aeronav.faa.gov/Upload_313-d/cifp/CIFP_251127.zip">')
        self.assertTrue(build.pick_cifp_url(html, dt.date(2025, 11, 10)).endswith("CIFP_251030.zip"))
        self.assertTrue(build.pick_cifp_url(html, dt.date(2025, 12, 1)).endswith("CIFP_251127.zip"))


if __name__ == "__main__":
    unittest.main()
