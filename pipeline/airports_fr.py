"""Terrains français qui ont une carte d'aéroport (plan au sol OSM + données de piste eAIP SIA).

Palier 1 (2026-11) : les 25 plus grands aéroports de France (trafic passagers) et 10 petits
terrains appréciés en simulation. Élargir par paliers, après contrôle de la qualité OSM.
"""

# 25 plus grands aéroports (ordre approximatif du trafic passagers)
LARGE = [
    "LFPG",  # Paris-Charles de Gaulle
    "LFPO",  # Paris-Orly
    "LFMN",  # Nice-Côte d'Azur
    "LFLL",  # Lyon-Saint-Exupéry
    "LFML",  # Marseille-Provence
    "LFBO",  # Toulouse-Blagnac
    "LFSB",  # Bâle-Mulhouse
    "LFBD",  # Bordeaux-Mérignac
    "LFRS",  # Nantes-Atlantique
    "LFOB",  # Beauvais-Tillé
    "LFQQ",  # Lille-Lesquin
    "LFKJ",  # Ajaccio
    "LFKB",  # Bastia
    "LFMT",  # Montpellier
    "LFRB",  # Brest
    "LFST",  # Strasbourg
    "LFBZ",  # Biarritz
    "LFBP",  # Pau
    "LFLC",  # Clermont-Ferrand
    "LFKF",  # Figari
    "LFMP",  # Perpignan
    "LFTH",  # Toulon-Hyères
    "LFRN",  # Rennes
    "LFBT",  # Tarbes-Lourdes
    "LFLS",  # Grenoble-Isère
]

# 10 petits terrains (altiport, îles, régionaux)
SMALL = [
    "LFLJ",  # Courchevel (altiport)
    "LFHM",  # Megève (altiport)
    "LFHU",  # L'Alpe d'Huez (altiport)
    "LFKC",  # Calvi
    "LFEY",  # Île d'Yeu
    "LFAT",  # Le Touquet
    "LFRU",  # Morlaix
    "LFRV",  # Vannes
    "LFLW",  # Aurillac
    "LFBX",  # Périgueux
]

ALL = LARGE + SMALL

# Sous-ensemble court pour la CI (contrôle de qualité sans surcharger Overpass)
CI_SAMPLE = ["LFML", "LFPG", "LFLJ"]
