// « Mes vols » sur la carte : tous les trajets du carnet en arcs de grand cercle, terrains visités,
// trajet survolé (liste ou carte) en surbrillance.
import type * as maplibregl from "maplibre-gl";
import type { Map as MlMap } from "maplibre-gl";
import { logbook } from "../lib/demoFlights";
import type { LngLat } from "../lib/format";
import { bearing, destination, distNm } from "../lib/geo";
import { state } from "../store";

let map: MlMap | null = null;
const COLOR = "#7c5cff";
export const LOGBOOK_LAYERS = ["logbook-line"];

function arc(a: LngLat, b: LngLat): LngLat[] {
  const d = distNm(a, b), n = Math.max(2, Math.ceil(d / 25));
  // cap recalculé à chaque pas : suit le grand cercle
  const out: LngLat[] = [a];
  let p = a;
  for (let i = 1; i < n; i++) { p = destination(p, bearing(p, b), d / n); out.push(p); }
  out.push(b);
  return out;
}

function data(): GeoJSON.FeatureCollection {
  const fs: GeoJSON.Feature[] = [];
  const apts = new Map<string, LngLat>();
  for (const e of logbook()) {
    fs.push({ type: "Feature", properties: { t: "leg", id: e.id }, geometry: { type: "LineString", coordinates: arc(e.line[0], e.line[1]) } });
    apts.set(e.orig, e.line[0]); apts.set(e.dest, e.line[1]);
  }
  for (const [icao, p] of apts) fs.push({ type: "Feature", properties: { t: "apt", icao }, geometry: { type: "Point", coordinates: p } });
  return { type: "FeatureCollection", features: fs };
}

export function initLogbook(m: MlMap) {
  map = m;
  m.addSource("logbook", { type: "geojson", data: data() });
  const leg: any = ["==", ["get", "t"], "leg"]; // expression MapLibre
  m.addLayer({ id: "logbook-line", type: "line", source: "logbook", filter: leg, layout: { "line-cap": "round", visibility: "none" },
    paint: { "line-color": COLOR, "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.6, 9, 3], "line-opacity": 0.75 } });
  m.addLayer({ id: "logbook-hot", type: "line", source: "logbook", filter: ["all", leg, ["==", ["get", "id"], -1]], layout: { "line-cap": "round", visibility: "none" },
    paint: { "line-color": "#ffb020", "line-width": ["interpolate", ["linear"], ["zoom"], 4, 4, 9, 6] } });
  m.addLayer({ id: "logbook-apt", type: "circle", source: "logbook", filter: ["==", ["get", "t"], "apt"], layout: { visibility: "none" },
    paint: { "circle-radius": 4, "circle-color": "#ffffff", "circle-stroke-color": COLOR, "circle-stroke-width": 2 } });
  m.addLayer({ id: "logbook-lbl", type: "symbol", source: "logbook", filter: ["==", ["get", "t"], "apt"], minzoom: 4.5, layout: { visibility: "none",
    "text-field": ["get", "icao"], "text-font": ["Noto Sans Bold"], "text-size": 10.5, "text-offset": [0, 1.1], "text-anchor": "top" },
    paint: { "text-color": "#ffffff", "text-halo-color": COLOR, "text-halo-width": 2 } });
  showLogbook(state.logbookMap, false);
}

/** Affiche ou masque tous les trajets ; à l'affichage, cadre la carte sur l'ensemble. */
export function showLogbook(on: boolean, fit = true) {
  if (!map) return;
  for (const id of ["logbook-line", "logbook-hot", "logbook-apt", "logbook-lbl"]) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  if (on && fit) {
    const pts = logbook().flatMap((e) => e.line);
    const w = Math.min(...pts.map((p) => p[0])), e = Math.max(...pts.map((p) => p[0]));
    const s = Math.min(...pts.map((p) => p[1])), n = Math.max(...pts.map((p) => p[1]));
    map.fitBounds([[w, s], [e, n]], { padding: { top: 80, bottom: 50, left: 50, right: 70 }, duration: state.anim ? 1000 : 0 });
  }
}

/** Trajet allumé (-1 : aucun). */
export function highlightLogbook(id: number) {
  map?.setFilter("logbook-hot", ["all", ["==", ["get", "t"], "leg"], ["==", ["get", "id"], id]] as never);
}

export function logbookAt(f: maplibregl.MapGeoJSONFeature): number | null {
  return f.layer.id === "logbook-line" ? Number(f.properties.id) : null;
}
