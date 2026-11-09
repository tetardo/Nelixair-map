// Configuration du front. Modifiable sans toucher au code.
window.NELIXAIR_CONFIG = {
  // Tuiles vectorielles produites par scripts/build.sh
  pmtiles: "data/nav.pmtiles",
  // Repli GeoJSON (dev, ou ?geojson dans l'URL)
  geojson: { fixes: "data/fixes.geojson", airways: "data/airways.geojson" },
  search: "data/search.json",
  meta: "data/meta.json",
  // Fond de carte vectoriel libre, sans clé (schéma OpenMapTiles)
  basemapStyle: "https://tiles.openfreemap.org/styles/positron",
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  font: ["Noto Sans Regular"],
  fontBold: ["Noto Sans Bold"],
  // Attribution des données aéronautiques (obligatoire pour OpenAIP, CC BY-NC 4.0)
  attribution:
    '<a href="https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/cifp/" target="_blank" rel="noopener">FAA CIFP</a> · ' +
    '<a href="https://www.openaip.net" target="_blank" rel="noopener">OpenAIP</a> (CC BY-NC 4.0)',
  center: [-98, 39],
  zoom: 3.6,
};
