// Configuration du front. Modifiable sans toucher au code.
window.NELIXAIR_CONFIG = {
  // Tuiles vectorielles produites par scripts/build.sh
  pmtiles: "data/nav.pmtiles",
  airspacesPmtiles: "data/airspaces.pmtiles",
  mora: "data/mora.geojson",
  // Repli GeoJSON (dev, ou ?geojson dans l'URL)
  geojson: {
    fixes: "data/fixes.geojson", airways: "data/airways.geojson",
    airports: "data/airports.geojson", airspaces: "data/airspaces.geojson",
  },
  search: "data/search.json",
  routes: "data/routes.json",
  meta: "data/meta.json",
  // Détails aéroport (pistes, fréquences, cartes) : data/apt/<2 premiers caractères>.json
  airportDetails: "data/apt/",
  // Météo : relais statique des caches NOAA (branche wx-data, mise à jour toutes les 10 min).
  // raw.githubusercontent.com autorise les appels navigateur (CORS), contrairement à aviationweather.gov.
  wxMetars: "https://raw.githubusercontent.com/tetardo/Nelixair-map/wx-data/metars.json",
  wxTafs: "https://raw.githubusercontent.com/tetardo/Nelixair-map/wx-data/tafs.json",
  // Fond de carte vectoriel libre, sans clé (schéma OpenMapTiles)
  basemapStyle: "https://tiles.openfreemap.org/styles/positron",
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  font: ["Noto Sans Regular"],
  fontBold: ["Noto Sans Bold"],
  // Attribution des données aéronautiques (obligatoire pour OpenAIP, CC BY-NC 4.0)
  attribution:
    '<a href="https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/cifp/" target="_blank" rel="noopener">FAA CIFP</a> · ' +
    '<a href="https://www.openaip.net" target="_blank" rel="noopener">OpenAIP</a> (CC BY-NC 4.0) · ' +
    'Météo <a href="https://aviationweather.gov" target="_blank" rel="noopener">NOAA AWC</a>',
  center: [-98, 39],
  zoom: 3.6,
};
