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


def pa(ident, region, iata, la, lo, rwy, ifr, surf, elev, mil, name):
    return line({1: "SUSA", 5: "P", 7: ident, 11: region, 13: "A", 14: iata, 22: "0", 28: rwy, 31: ifr,
                 32: surf, 33: lat(la), 42: lon(lo), 57: elev, 82: mil, 94: name, 124: "00005", 129: CYCLE})


def pg(apt, rw, length, brg, la, lo, width, cont="0"):
    return line({1: "SUSA", 5: "P", 7: apt, 11: "K2", 13: "G", 14: rw, 22: cont, 23: length, 28: brg,
                 33: lat(la), 42: lon(lo), 78: width, 124: "00007", 129: CYCLE})


def mora_row(slat, slon, values):
    vals = "".join(v.rjust(3) for v in values).ljust(90)
    return line({1: "SUSA", 5: "A", 6: "S", 14: slat, 17: slon, 31: vals, 124: "00006", 129: CYCLE})


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
    pa("KABQ", "K2", "ABQ", 35.0402, -106.6092, "137", "Y", "H", "05355", "C", "ALBUQUERQUE INTL SUNPORT"),
    pg("KABQ", "RW08", "13793", "0830", 35.0480, -106.6250, "150"),
    pg("KABQ", "RW26", "13793", "2630", 35.0400, -106.5800, "150"),
    pg("KABQ", "RW03", "10000", "0300", 35.0300, -106.6100, "150"),
    pg("KABQ", "RW21", "10000", "2100", 35.0500, -106.6000, "150"),
    # continuation de RW03 : doit être ignorée
    pg("KABQ", "RW03", "99999", "0300", 35.0300, -106.6100, "150", cont="2"),
    pa("KSAF", "K2", "SAF", 35.6171, -106.0894, "083", "Y", "H", "06348", "C", "SANTA FE MUNI"),
    pa("E80", "K2", "", 34.6450, -106.8340, "050", "N", "H", "04821", "C", "ALEXANDER MUNI"),
    pa("0E0", "K2", "", 34.98, -106.06, "036", "N", "S", "06269", "P", "SYNTH DIRT STRIP"),
    pa("KXXX", "K2", "", 35.3, -105.0, "090", "N", "W", "01000", "M", "SYNTH SEAPLANE BASE"),
    # Grid MORA : rangée 35N depuis 107W ; 3e carré inconnu
    mora_row("N35", "W107", ["120", "110", "UNK", "095"]),
    # rangée 36N depuis 120W : 2e carré = 36N 119W (Whitney)
    mora_row("N36", "W120", ["120", "165", "140"]),
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

openaip_airports = {"fetched": "2026-11-09", "items": [
    {"name": "PARIS CHARLES DE GAULLE", "icaoCode": "LFPG", "iataCode": "CDG", "type": 3, "country": "FR",
     "geometry": {"type": "Point", "coordinates": [2.5479, 49.0097]}, "elevation": {"value": 119, "unit": 0},
     "runways": [{"designator": "09L", "trueHeading": 87, "dimension": {"length": {"value": 4215, "unit": 0}, "width": {"value": 45, "unit": 0}}, "surface": {"mainComposite": 0}},
                 {"designator": "27R", "trueHeading": 267, "dimension": {"length": {"value": 4215, "unit": 0}, "width": {"value": 45, "unit": 0}}, "surface": {"mainComposite": 0}},
                 {"designator": "08R", "dimension": {"length": {"value": 2700, "unit": 0}}, "surface": {"mainComposite": 1}}],
     "frequencies": [{"value": "119.250", "unit": 2, "type": 14, "name": "DE GAULLE TOUR"},
                     {"value": "128.000", "unit": 2, "type": 15, "name": "ATIS"}]},
    # doublon de KABQ (CIFP prioritaire)
    {"name": "ALBUQUERQUE", "icaoCode": "KABQ", "type": 3, "country": "US",
     "geometry": {"type": "Point", "coordinates": [-106.609, 35.040]},
     "runways": [{"designator": "08", "dimension": {"length": {"value": 4204, "unit": 0}}, "surface": {"mainComposite": 1}}],
     "frequencies": [{"value": "120.300", "unit": 2, "type": 14, "name": "ALBUQUERQUE TOWER"}]},
    # piste sur surface inconnue (22) : pas une hydrobase
    {"name": "SYNTH UNKNOWN SURFACE", "icaoCode": "LFQQ", "type": 2, "country": "FR",
     "geometry": {"type": "Point", "coordinates": [3.2, 48.2]},
     "runways": [{"designator": "10", "dimension": {"length": {"value": 800, "unit": 0}}, "surface": {"mainComposite": 22}}]},
    {"name": "TOUSSUS LE NOBLE", "icaoCode": "LFPN", "type": 2, "country": "FR",
     "geometry": {"type": "Point", "coordinates": [2.1119, 48.7519]}, "elevation": {"value": 164, "unit": 0},
     "runways": [{"dimension": {"length": {"value": 1100, "unit": 0}}, "surface": {"mainComposite": 0}}]},
    {"name": "HELIPORT DE PARIS", "icaoCode": "LFPI", "type": 7, "country": "FR",
     "geometry": {"type": "Point", "coordinates": [2.2733, 48.8333]}},
    # planeur sans code OACI : écarté
    {"name": "SYNTH GLIDER", "type": 1, "country": "FR", "geometry": {"type": "Point", "coordinates": [3.0, 48.0]}},
    # fermé : écarté
    {"name": "CLOSED", "icaoCode": "LFZZ", "type": 8, "country": "FR", "geometry": {"type": "Point", "coordinates": [3.1, 48.1]}},
]}
with open(os.path.join(HERE, "fixtures", "openaip_airports.json"), "w") as fh:
    json.dump(openaip_airports, fh, indent=1)


def sq(x0, y0, d):
    return [[x0, y0], [x0 + d, y0], [x0 + d, y0 + d], [x0, y0 + d], [x0, y0]]


openaip_airspaces = {"fetched": "2026-11-09", "items": [
    {"name": "CTR PARIS", "type": 4, "icaoClass": 3, "country": "FR",
     "lowerLimit": {"value": 0, "unit": 1, "referenceDatum": 0}, "upperLimit": {"value": 1500, "unit": 1, "referenceDatum": 1},
     "geometry": {"type": "Polygon", "coordinates": [sq(2.3, 48.9, 0.4)]}},
    {"name": "TMA PARIS 1", "type": 7, "icaoClass": 0, "country": "FR",
     "lowerLimit": {"value": 1500, "unit": 1, "referenceDatum": 1}, "upperLimit": {"value": 115, "unit": 6, "referenceDatum": 2},
     "geometry": {"type": "MultiPolygon", "coordinates": [[sq(2.0, 48.6, 1.0)], [sq(3.2, 48.6, 0.3)]]}},
    {"name": "R 45 SYNTH", "type": 1, "icaoClass": 8, "country": "FR",
     "lowerLimit": {"value": 0, "unit": 1, "referenceDatum": 0}, "upperLimit": {"value": 3000, "unit": 0, "referenceDatum": 1},
     "geometry": {"type": "Polygon", "coordinates": [sq(1.5, 47.5, 0.2)]}},
    {"name": "PARIS FIR", "type": 10, "country": "FR",
     "lowerLimit": {"value": 0, "unit": 1, "referenceDatum": 0}, "upperLimit": {"value": 195, "unit": 6, "referenceDatum": 2},
     "geometry": {"type": "Polygon", "coordinates": [sq(-1.0, 46.0, 5.0)]}},
    {"name": "UNKNOWN TYPE", "type": 99, "country": "FR",
     "geometry": {"type": "Polygon", "coordinates": [sq(0.0, 45.0, 0.1)]}},
]}
with open(os.path.join(HERE, "fixtures", "openaip_airspaces.json"), "w") as fh:
    json.dump(openaip_airspaces, fh, indent=1)
print("ok")


# Catalogue d-TPP synthétique (structure du d-tpp_Metafile.xml FAA)
dtpp = """<?xml version="1.0" encoding="UTF-8"?>
<digital_tpp cycle="2511" from_edate="0901Z  10/30/25" to_edate="0901Z  11/27/25">
 <state_code ID="NM" state_fullname="New Mexico">
  <city_name ID="ALBUQUERQUE" volume="SW-3">
   <airport_name ID="ALBUQUERQUE INTL SUNPORT" military="N" apt_ident="ABQ" icao_ident="KABQ" alnum="1">
    <record><chartseq>10100</chartseq><chart_code>MIN</chart_code><chart_name>TAKEOFF MINIMUMS</chart_name><useraction></useraction><pdf_name>SW3TO.PDF</pdf_name></record>
    <record><chartseq>70000</chartseq><chart_code>APD</chart_code><chart_name>AIRPORT DIAGRAM</chart_name><useraction></useraction><pdf_name>00001AD.PDF</pdf_name></record>
    <record><chartseq>50750</chartseq><chart_code>IAP</chart_code><chart_name>ILS OR LOC RWY 08</chart_name><useraction></useraction><pdf_name>00001IL8.PDF</pdf_name></record>
    <record><chartseq>50800</chartseq><chart_code>IAP</chart_code><chart_name>RNAV (GPS) RWY 26 (DELETED)</chart_name><useraction>D</useraction><pdf_name>DELETED_JOB.PDF</pdf_name></record>
   </airport_name>
  </city_name>
  <city_name ID="BELEN" volume="SW-3">
   <airport_name ID="ALEXANDER MUNI" military="N" apt_ident="E80" icao_ident="" alnum="2">
    <record><chartseq>50750</chartseq><chart_code>IAP</chart_code><chart_name>RNAV (GPS) RWY 03</chart_name><useraction></useraction><pdf_name>00002R3.PDF</pdf_name></record>
   </airport_name>
  </city_name>
 </state_code>
</digital_tpp>
"""
with open(os.path.join(HERE, "fixtures", "dtpp.xml"), "w") as fh:
    fh.write(dtpp)

# Caches météo NOAA synthétiques (même structure que metars.cache.csv / tafs.cache.xml)
SKY = "sky_cover,cloud_base_ft_agl," * 4
wx_csv = "\n".join([
    "No errors", "No warnings", "4 ms", "data source=metars", "3 results",
    "raw_text,station_id,observation_time,latitude,longitude,temp_c,dewpoint_c,wind_dir_degrees,wind_speed_kt,"
    "wind_gust_kt,visibility_statute_mi,altim_in_hg,sea_level_pressure_mb,corrected,auto,auto_station,"
    "maintenance_indicator_on,no_signal,lightning_sensor_off,freezing_rain_sensor_off,present_weather_sensor_off,"
    "wx_string," + SKY + "flight_category,three_hr_pressure_tendency_mb,maxT_c,minT_c,maxT24hr_c,minT24hr_c,"
    "precip_in,pcp3hr_in,pcp6hr_in,pcp24hr_in,snow_in,vert_vis_ft,metar_type,elevation_m",
    "LFML 092230Z 32012G25KT CAVOK 14/03 Q1018,LFML,2026-11-09T22:30:00Z,43.44,5.216,14,3,320,12,25,6+,30.06,,,,,,,,,,"
    ",CLR,,,,,,,,VFR,,,,,,,,,,,,METAR,6",
    "KSAF 092153Z 00000KT 2SM BR OVC008 05/04 A3010,KSAF,2026-11-09T21:53:00Z,35.617,-106.089,5,4,0,0,,2.0,30.10,,,,,,,,,,"
    "BR,OVC,800,,,,,,,IFR,,,,,,,,,,,,METAR,1935",
    "KXXX 092153Z VRB03KT 1/2SM FG VV002 02/02 A2992,KXXX,2026-11-09T21:53:00Z,35.3,-105.0,2,2,VRB,3,,0.5,29.92,,,,,,,,,,"
    "FG,OVX,0,,,,,,,LIFR,,,,,,,,,,,200,SPECI,10",
    "BROKEN ROW WITHOUT COORDS,XXXX,2026-11-09T21:53:00Z,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,",
]) + "\n"
with open(os.path.join(HERE, "fixtures", "wx_metars.csv"), "w") as fh:
    fh.write(wx_csv)

wx_xml = """<?xml version="1.0" encoding="UTF-8"?>
<response><data num_results="2">
<TAF><raw_text>TAF LFML 092300Z 1000/1106 32015G25KT CAVOK</raw_text><station_id>LFML</station_id></TAF>
<TAF><raw_text>TAF KSAF 092130Z 0922/1024 VRB05KT P6SM OVC010</raw_text><station_id>KSAF</station_id></TAF>
</data></response>
"""
with open(os.path.join(HERE, "fixtures", "wx_tafs.xml"), "w") as fh:
    fh.write(wx_xml)

wx_airsigmets = """<?xml version="1.0" encoding="UTF-8"?>
<response><data num_results="2">
<AIRSIGMET><raw_text>CONVECTIVE SIGMET 45C VALID UNTIL 0055Z NM AZ</raw_text><valid_time_from>2026-11-09T22:55:00Z</valid_time_from>
<valid_time_to>2026-11-10T00:55:00Z</valid_time_to><altitude max_ft_msl="45000"/><hazard type="CONVECTIVE" severity="NONE"/>
<airsigmet_type>SIGMET</airsigmet_type><area num_points="4"><point><longitude>-107.0</longitude><latitude>35.0</latitude></point>
<point><longitude>-105.5</longitude><latitude>35.0</latitude></point><point><longitude>-105.5</longitude><latitude>36.0</latitude></point>
<point><longitude>-107.0</longitude><latitude>35.0</latitude></point></area></AIRSIGMET>
<AIRSIGMET><raw_text>AIRMET TANGO FOR TURB</raw_text><valid_time_from>2026-11-09T21:00:00Z</valid_time_from><valid_time_to>2026-11-10T03:00:00Z</valid_time_to>
<altitude min_ft_msl="18000" max_ft_msl="38000"/><hazard type="TURB" severity="MOD"/><airsigmet_type>AIRMET</airsigmet_type>
<area num_points="3"><point><longitude>-104.0</longitude><latitude>34.5</latitude></point><point><longitude>-103.0</longitude><latitude>34.5</latitude></point>
<point><longitude>-103.5</longitude><latitude>35.5</latitude></point></area></AIRSIGMET>
<AIRSIGMET><raw_text>SIGMET WITHOUT AREA</raw_text><hazard type="ICE" severity="SEV"/><airsigmet_type>SIGMET</airsigmet_type></AIRSIGMET>
</data></response>
"""
with open(os.path.join(HERE, "fixtures", "wx_airsigmets.xml"), "w") as fh:
    fh.write(wx_airsigmets)

wx_isigmets = [
    {"icaoId": "LFPW", "firId": "LFMM", "firName": "MARSEILLE", "hazard": "TURB", "qualifier": "SEV",
     "validTimeFrom": 1794265200, "validTimeTo": 1794279600, "base": 25000, "top": 38000,
     "coords": [{"lat": 43.0, "lon": 4.0}, {"lat": 44.0, "lon": 4.0}, {"lat": 44.0, "lon": 6.0}, {"lat": 43.0, "lon": 6.0}],
     "rawSigmet": "LFMM SIGMET 3 VALID 092300/100300 LFPW- SEV TURB"},
    {"icaoId": "XXXX", "hazard": "TS", "coords": [{"lat": 10.0, "lon": 10.0}], "rawSigmet": "POINT ONLY"},
]
with open(os.path.join(HERE, "fixtures", "wx_isigmets.json"), "w") as fh:
    json.dump(wx_isigmets, fh, indent=1)

wx_pireps = "\n".join([
    "No errors", "No warnings", "3 ms", "data source=aircraftreports", "2 results",
    "receipt_time,observation_time,aircraft_ref,latitude,longitude,altitude_ft_msl,turbulence_type,turbulence_intensity,"
    "turbulence_base_ft_msl,turbulence_top_ft_msl,icing_type,icing_intensity,icing_base_ft_msl,icing_top_ft_msl,report_type,raw_text",
    "2026-11-09T22:40:00Z,2026-11-09T22:38:00Z,B738,35.2,-106.3,35000,CHOP,MOD,,,,,,,PIREP,ABQ UA /OV ABQ/TM 2238/FL350/TP B738/TB MOD CHOP",
    "2026-11-09T22:41:00Z,2026-11-09T22:39:00Z,C172,35.6,-106.0,9000,,,,,,,,,PIREP,SAF UA /OV SAF/TM 2239/FL090/TP C172/IC LGT RIME",
]) + "\n"
with open(os.path.join(HERE, "fixtures", "wx_pireps.csv"), "w") as fh:
    fh.write(wx_pireps)
