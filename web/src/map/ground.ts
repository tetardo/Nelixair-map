// Carte d'aéroport : rendu du plan au sol OSM (pistes, taxiways, aires, postes, bâtiments) en style « chart ».
// Visible à partir du zoom 11, détaillé à partir de 13-15. Les largeurs suivent l'échelle réelle (w18 = px au zoom 18).
import type { Map as MlMap } from "maplibre-gl";
import type { Theme } from "./themes";

type L = any; // spécifications de couche MapLibre (expressions trop dynamiques pour le typage strict)

export const GROUND_LAYERS = [
  "g-boundary", "g-apron", "g-apron-line", "g-taxi-edge", "g-taxi", "g-taxi-center", "g-stopway", "g-runway", "g-runway-line",
  "g-rwy-axis", "g-building", "g-holding-line", "g-holding", "g-stand", "g-stand-lbl", "g-twy-lbl", "g-rwy-lbl", "g-building-lbl",
];
/** Couches cliquables (fiche de l'objet au sol). */
export const GROUND_CLICKABLE = ["g-stand", "g-stand-lbl", "g-twy-lbl", "g-taxi", "g-runway", "g-holding"];

const kind = (...k: string[]) => (k.length === 1 ? ["==", ["get", "kind"], k[0]] : ["in", ["get", "kind"], ["literal", k]]);

// Largeur à l'échelle : exponentielle base 2 (la largeur en pixels double à chaque zoom)
const scaled = (extra = 0, min = 0.6) => ["interpolate", ["exponential", 2], ["zoom"],
  11, ["max", min, ["+", ["/", ["get", "w18"], 128], extra / 4]],
  18, ["+", ["get", "w18"], extra],
  20, ["+", ["*", ["get", "w18"], 4], extra]];

export function addGroundLayers(map: MlMap, src: { source: string; "source-layer"?: string }, font: string[], fontBold: string[], before?: string) {
  const add = (l: L) => map.addLayer({ ...src, ...l }, before);
  add({ id: "g-boundary", type: "fill", minzoom: 11, filter: kind("boundary"),
    paint: { "fill-opacity": ["interpolate", ["linear"], ["zoom"], 11, 0, 12.5, 0.85] } });
  add({ id: "g-apron", type: "fill", minzoom: 12, filter: kind("apron") });
  add({ id: "g-apron-line", type: "line", minzoom: 14, filter: kind("apron"), paint: { "line-width": 0.8 } });
  add({ id: "g-taxi-edge", type: "line", minzoom: 13, filter: kind("taxiway", "taxilane"),
    layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-width": scaled(2) } });
  add({ id: "g-taxi", type: "line", minzoom: 11, filter: kind("taxiway", "taxilane"),
    layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-width": scaled() } });
  add({ id: "g-taxi-center", type: "line", minzoom: 14.5, filter: kind("taxiway", "taxilane"),
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-width": ["interpolate", ["linear"], ["zoom"], 14.5, 0.6, 18, 1.6] } });
  add({ id: "g-stopway", type: "fill", minzoom: 12, filter: kind("stopway") });
  add({ id: "g-runway", type: "fill", minzoom: 11, filter: kind("runway") });
  add({ id: "g-runway-line", type: "line", minzoom: 14, filter: kind("runway"), paint: { "line-width": 1 } });
  add({ id: "g-rwy-axis", type: "line", minzoom: 13.5, filter: kind("rwy_axis"),
    paint: { "line-width": ["interpolate", ["linear"], ["zoom"], 13.5, 0.6, 17, 2], "line-dasharray": [5, 5] } });
  add({ id: "g-building", type: "fill", minzoom: 13, filter: kind("building"),
    paint: { "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0.5, 15, 1] } });
  add({ id: "g-holding-line", type: "line", minzoom: 14, filter: ["all", kind("holding"), ["==", ["geometry-type"], "LineString"]],
    paint: { "line-width": 2.5 } });
  add({ id: "g-holding", type: "circle", minzoom: 14, filter: ["all", kind("holding"), ["==", ["geometry-type"], "Point"]],
    paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 2, 17, 4], "circle-stroke-width": 1.2 } });
  add({ id: "g-stand", type: "circle", minzoom: 14, filter: kind("stand", "gate"),
    paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 1.8, 17, 5], "circle-stroke-width": 1 } });
  add({ id: "g-stand-lbl", type: "symbol", minzoom: 15.5, filter: ["all", kind("stand", "gate"), ["has", "ref"]],
    layout: { "text-field": ["get", "ref"], "text-font": fontBold, "text-size": ["interpolate", ["linear"], ["zoom"], 15.5, 9, 18, 12],
      "text-offset": [0, 0.9], "text-anchor": "top", "text-optional": true },
    paint: { "text-halo-width": 1.2 } });
  add({ id: "g-twy-lbl", type: "symbol", minzoom: 13.5, filter: ["all", kind("taxiway", "taxilane"), ["has", "ref"]],
    layout: { "symbol-placement": "line", "symbol-spacing": 260, "text-field": ["get", "ref"], "text-font": fontBold,
      "text-size": ["interpolate", ["linear"], ["zoom"], 13.5, 10, 17, 13], "text-rotation-alignment": "viewport",
      "icon-rotation-alignment": "viewport", "icon-text-fit": "both", "icon-text-fit-padding": [1, 3, 1, 3], "text-keep-upright": true } });
  // Désignation au seuil, orientée comme le marquage peint (lisible en arrivant face à la piste), juste avant le seuil
  add({ id: "g-rwy-lbl", type: "symbol", minzoom: 12, filter: kind("rwy_end"),
    layout: { "text-field": ["get", "ref"], "text-font": fontBold, "text-size": ["interpolate", ["linear"], ["zoom"], 12, 10, 16, 14],
      "text-rotate": ["get", "hdg"], "icon-rotate": ["get", "hdg"], "text-rotation-alignment": "map", "icon-rotation-alignment": "map", "text-keep-upright": false,
      "text-offset": [0, 1.5], "icon-text-fit": "both", "icon-text-fit-padding": [2, 4, 2, 4],
      "text-allow-overlap": true, "icon-allow-overlap": true } });
  add({ id: "g-building-lbl", type: "symbol", minzoom: 14.5, filter: ["all", kind("building"), ["has", "name"]],
    layout: { "text-field": ["get", "name"], "text-font": font, "text-size": 11, "text-max-width": 8, "text-optional": true },
    paint: { "text-halo-width": 1.2 } });
}

export function themeGround(map: MlMap, name: string, T: Theme) {
  const g = T.g;
  const P = (id: string, k: string, v: unknown) => map.setPaintProperty(id, k as never, v as never);
  P("g-boundary", "fill-color", g.boundary);
  P("g-apron", "fill-color", g.apron); P("g-apron-line", "line-color", g.apronLine);
  P("g-taxi-edge", "line-color", g.taxiEdge); P("g-taxi", "line-color", g.taxi); P("g-taxi-center", "line-color", g.taxiCenter);
  P("g-stopway", "fill-color", g.stopway);
  P("g-runway", "fill-color", g.runway); P("g-runway-line", "line-color", g.runwayEdge); P("g-rwy-axis", "line-color", g.rwyAxis);
  P("g-building", "fill-color", ["case", ["==", ["get", "sub"], "terminal"], g.terminal, g.building]);
  P("g-holding-line", "line-color", g.holding);
  P("g-holding", "circle-color", g.holding); P("g-holding", "circle-stroke-color", g.halo);
  P("g-stand", "circle-color", g.stand); P("g-stand", "circle-stroke-color", g.halo);
  P("g-stand-lbl", "text-color", g.standText); P("g-stand-lbl", "text-halo-color", g.halo);
  map.setLayoutProperty("g-twy-lbl", "icon-image", `${name}-box-twy`); P("g-twy-lbl", "text-color", g.twyLblText);
  map.setLayoutProperty("g-rwy-lbl", "icon-image", `${name}-box-rwy`); P("g-rwy-lbl", "text-color", g.rwyLblText);
  P("g-building-lbl", "text-color", g.text); P("g-building-lbl", "text-halo-color", g.halo);
}
