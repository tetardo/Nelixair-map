// Route du plan de vol SimBrief : trait magenta (convention EFB), points tournants, TOC / TOD, terrains.
import type { Map as MlMap } from "maplibre-gl";
import type { Ofp } from "../services/simbrief";

type L = any; // spécifications de couche MapLibre
type F = GeoJSON.Feature;
export const ROUTE_COLOR = "#d6336c";

/** Longitudes « déroulées » : une route qui traverse l'antiméridien reste continue. */
function unwrap(pts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [lon, lat] of pts) {
    if (!out.length) { out.push([lon, lat]); continue; }
    let l = lon;
    const prev = out[out.length - 1][0];
    while (l - prev > 180) l -= 360;
    while (l - prev < -180) l += 360;
    out.push([l, lat]);
  }
  return out;
}

export function routeData(ofp: Ofp | null): GeoJSON.FeatureCollection {
  if (!ofp) return { type: "FeatureCollection", features: [] };
  const pts = unwrap([[ofp.orig.lon, ofp.orig.lat], ...ofp.fixes.map((f) => [f.lon, f.lat] as [number, number])]);
  const fs: F[] = [];
  // tronçons par phase : montée / croisière / descente (la croisière en trait plein, le reste plus fin)
  for (let i = 1; i < pts.length; i++) {
    const f = ofp.fixes[i - 1];
    fs.push({ type: "Feature", properties: { t: "leg", stage: f.stage || "CRZ", i: i - 1 }, geometry: { type: "LineString", coordinates: [pts[i - 1], pts[i]] } });
  }
  ofp.fixes.forEach((f, i) => {
    if (f.ident === ofp.dest.icao && i === ofp.fixes.length - 1) return;
    const kind = f.ident === "TOC" || f.ident === "TOD" ? "toc" : f.type === "apt" ? "apt" : "fix";
    fs.push({ type: "Feature", properties: { t: kind, i, lbl: f.ident, sid: f.sidstar ? 1 : 0 },
      geometry: { type: "Point", coordinates: pts[i + 1] } });
  });
  const apts: [string, string, number, number][] = [["dep", ofp.orig.icao, ofp.orig.lon, ofp.orig.lat], ["arr", ofp.dest.icao, ofp.dest.lon, ofp.dest.lat],
    ...ofp.altn.map((a) => ["alt", a.icao, a.lon, a.lat] as [string, string, number, number])];
  const ref = pts[0][0];
  for (const [role, icao, lon, lat] of apts) {
    let l = lon;
    while (l - ref > 180) l -= 360;
    while (l - ref < -180) l += 360;
    fs.push({ type: "Feature", properties: { t: "term", role, lbl: icao }, geometry: { type: "Point", coordinates: [l, lat] } });
  }
  // tracé vers le dégagement, en pointillé
  const last = pts[pts.length - 1];
  for (const a of ofp.altn) {
    let l = a.lon;
    while (l - last[0] > 180) l -= 360;
    while (l - last[0] < -180) l += 360;
    fs.push({ type: "Feature", properties: { t: "altn" }, geometry: { type: "LineString", coordinates: [last, [l, a.lat]] } });
  }
  return { type: "FeatureCollection", features: fs };
}

export function routeBounds(ofp: Ofp): [[number, number], [number, number]] {
  const pts = unwrap([[ofp.orig.lon, ofp.orig.lat], ...ofp.fixes.map((f) => [f.lon, f.lat] as [number, number])]);
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of pts) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return [[w, s], [e, n]];
}

export const ROUTE_LAYERS = ["ofp-casing", "ofp-line", "ofp-altn", "ofp-fix", "ofp-toc", "ofp-term", "ofp-lbl", "ofp-term-lbl", "ofp-hl"];

export function addRouteLayers(map: MlMap, F: string[], FB: string[]) {
  const add = (l: L) => map.addLayer(l);
  const legs = ["==", ["get", "t"], "leg"];
  add({ id: "ofp-casing", type: "line", source: "ofp", filter: legs, layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#ffffff", "line-opacity": 0.85, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 4, 9, 7] } });
  add({ id: "ofp-line", type: "line", source: "ofp", filter: legs, layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ROUTE_COLOR, "line-width": ["interpolate", ["linear"], ["zoom"], 3, ["case", ["==", ["get", "stage"], "CRZ"], 2.5, 1.8], 9, 4.5] } });
  add({ id: "ofp-altn", type: "line", source: "ofp", filter: ["==", ["get", "t"], "altn"],
    paint: { "line-color": ROUTE_COLOR, "line-width": 1.8, "line-dasharray": [2, 2], "line-opacity": 0.8 } });
  // tronçon survolé dans le nav log
  add({ id: "ofp-hl", type: "line", source: "ofp", filter: ["==", ["get", "i"], -1], layout: { "line-cap": "round" },
    paint: { "line-color": "#ffd21f", "line-width": ["interpolate", ["linear"], ["zoom"], 3, 5, 9, 9], "line-opacity": 0.9 } });
  add({ id: "ofp-fix", type: "circle", source: "ofp", filter: ["==", ["get", "t"], "fix"],
    paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 2.5, 9, 5], "circle-color": "#ffffff",
      "circle-stroke-color": ROUTE_COLOR, "circle-stroke-width": 2 } });
  add({ id: "ofp-toc", type: "circle", source: "ofp", filter: ["==", ["get", "t"], "toc"],
    paint: { "circle-radius": 5, "circle-color": ROUTE_COLOR, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
  add({ id: "ofp-term", type: "circle", source: "ofp", filter: ["==", ["get", "t"], "term"],
    paint: { "circle-radius": 7, "circle-color": ["match", ["get", "role"], "alt", "#ffffff", ROUTE_COLOR],
      "circle-stroke-color": ["match", ["get", "role"], "alt", ROUTE_COLOR, "#ffffff"], "circle-stroke-width": 2.5 } });
  add({ id: "ofp-lbl", type: "symbol", source: "ofp", filter: ["any", ["==", ["get", "t"], "fix"], ["==", ["get", "t"], "toc"]],
    minzoom: 4.5,
    layout: { "text-field": ["get", "lbl"], "text-font": FB, "text-size": 11, "text-offset": [0, 1.1], "text-anchor": "top",
      "text-optional": true, "symbol-sort-key": ["case", ["==", ["get", "t"], "toc"], 0, 1] },
    paint: { "text-color": ROUTE_COLOR, "text-halo-color": "#ffffff", "text-halo-width": 1.8 } });
  add({ id: "ofp-term-lbl", type: "symbol", source: "ofp", filter: ["==", ["get", "t"], "term"],
    layout: { "text-field": ["get", "lbl"], "text-font": FB, "text-size": 12, "text-offset": [0.9, 0], "text-anchor": "left", "text-allow-overlap": true },
    paint: { "text-color": "#ffffff", "text-halo-color": ROUTE_COLOR, "text-halo-width": 2.5 } });
  void F;
}
