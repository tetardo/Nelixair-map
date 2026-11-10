// Configuration du front. Modifiable sans toucher au reste du code.
// Les chemins relatifs sont résolus par rapport à la page (GitHub Pages sert le site dans un sous-dossier).

const satLayers = ["GOES-East_ABI_Band13_Clean_Infrared", "GOES-West_ABI_Band13_Clean_Infrared", "Himawari_AHI_Band13_Clean_Infrared"];

export const CFG = {
  // Tuiles vectorielles produites par scripts/build.sh
  pmtiles: "data/nav.pmtiles",
  airspacesPmtiles: "data/airspaces.pmtiles",
  mora: "data/mora.geojson",
  // Repli GeoJSON (dev, ou ?geojson dans l'URL)
  geojson: {
    fixes: "data/fixes.geojson", airways: "data/airways.geojson",
    airports: "data/airports.geojson", airspaces: "data/airspaces.geojson",
  },
  // Cartes d'aéroport : plan au sol OSM (terrains pilotes) ; repli GeoJSON en développement
  groundPmtiles: "data/ground.pmtiles",
  groundGeojson: "data/ground.geojson",
  groundIndex: "data/ground-index.json",
  eaip: "data/eaip.json",
  taxiBase: "data/",
  search: "data/search.json",
  routes: "data/routes.json",
  meta: "data/meta.json",
  // Détails aéroport (pistes, fréquences, cartes) : data/apt/<2 premiers caractères>.json
  airportDetails: "data/apt/",
  // Météo : relais statique des caches NOAA (branche wx-data, mise à jour toutes les 10 min).
  // raw.githubusercontent.com autorise les appels navigateur (CORS), contrairement à aviationweather.gov.
  wxMetars: "https://raw.githubusercontent.com/tetardo/Nelixair-map/wx-data/metars.json",
  wxTafs: "https://raw.githubusercontent.com/tetardo/Nelixair-map/wx-data/tafs.json",
  wxHazards: "https://raw.githubusercontent.com/tetardo/Nelixair-map/wx-data/hazards.geojson",
  wxPireps: "https://raw.githubusercontent.com/tetardo/Nelixair-map/wx-data/pireps.geojson",
  // Satellite infrarouge géostationnaire NASA GIBS (domaine public, sans clé).
  // Couverture : Amériques (GOES-Est/Ouest) et Asie-Pacifique (Himawari). Pas de Meteosat (Europe/Afrique) chez GIBS.
  satellite: satLayers.map((l) =>
    `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${l}/default/default/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`),
  // Fond de carte vectoriel libre, sans clé (schéma OpenMapTiles)
  basemapStyle: "https://tiles.openfreemap.org/styles/positron",
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  font: ["Noto Sans Regular"],
  fontBold: ["Noto Sans Bold"],
  // Attribution des données aéronautiques (obligatoire pour OpenAIP, CC BY-NC 4.0)
  attribution:
    '<a href="https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/cifp/" target="_blank" rel="noopener">FAA CIFP</a> · ' +
    '<a href="https://www.openaip.net" target="_blank" rel="noopener">OpenAIP</a> (CC BY-NC 4.0) · ' +
    'Météo <a href="https://aviationweather.gov" target="_blank" rel="noopener">NOAA AWC</a> · ' +
    'Satellite <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener">NASA GIBS</a>',
  groundAttribution:
    'Plans au sol © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">contributeurs OpenStreetMap</a> (ODbL)',
  center: [2.5, 46.6] as [number, number], // France métropolitaine (base de la compagnie)
  zoom: 5.3,
  maxZoom: 17.5,
};
