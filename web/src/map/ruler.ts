// Outil règle : clics successifs sur la carte → distance (NM), route vraie et magnétique de chaque tronçon, total.
// Échap ou le bouton termine ; clic droit retire le dernier point.
import type * as maplibregl from "maplibre-gl";
import type { Map as MlMap } from "maplibre-gl";
import type { LngLat } from "../lib/format";
import { bearing, distNm } from "../lib/geo";
import { deg3, magVar } from "../lib/magvar";
import { state } from "../store";

export const LUCIDE_RULER = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/></svg>`;
const COLOR = "#ffb020";
const RAD = Math.PI / 180;
let map: MlMap;
let pts: LngLat[] = [];
let cursor: LngLat | null = null;
let btn: HTMLButtonElement | null = null;

/** Points intermédiaires sur l'orthodromie (le tracé suit la vraie route la plus courte). */
function gc(a: LngLat, b: LngLat): LngLat[] {
  const n = Math.max(1, Math.ceil(distNm(a, b) / 50));
  const [l1, f1, l2, f2] = [a[0] * RAD, a[1] * RAD, b[0] * RAD, b[1] * RAD];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((f2 - f1) / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin((l2 - l1) / 2) ** 2));
  if (d < 1e-9) return [a, b];
  const out: LngLat[] = [];
  let prev = a[0];
  for (let i = 0; i <= n; i++) {
    const t = i / n, A = Math.sin((1 - t) * d) / Math.sin(d), B = Math.sin(t * d) / Math.sin(d);
    const x = A * Math.cos(f1) * Math.cos(l1) + B * Math.cos(f2) * Math.cos(l2);
    const y = A * Math.cos(f1) * Math.sin(l1) + B * Math.cos(f2) * Math.sin(l2);
    const z = A * Math.sin(f1) + B * Math.sin(f2);
    let lon = Math.atan2(y, x) / RAD;
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    prev = lon;
    out.push([lon, Math.atan2(z, Math.sqrt(x * x + y * y)) / RAD]);
  }
  return out;
}

export function legText(a: LngLat, b: LngLat): string {
  const t = bearing(a, b), m = t - magVar(a[1], a[0]);
  return `${Math.round(distNm(a, b)).toLocaleString("fr-FR")} NM · ${deg3(m)}°M (${deg3(t)}°V)`;
}

function render() {
  const all = cursor && pts.length ? [...pts, cursor] : pts;
  const fs: GeoJSON.Feature[] = [];
  let tot = 0;
  for (let i = 1; i < all.length; i++) {
    const a = all[i - 1], b = all[i], line = gc(a, b);
    tot += distNm(a, b);
    fs.push({ type: "Feature", properties: { t: "leg", live: i === all.length - 1 && !!cursor }, geometry: { type: "LineString", coordinates: line } });
    fs.push({ type: "Feature", properties: { t: "lbl", txt: legText(a, b) }, geometry: { type: "Point", coordinates: line[Math.floor(line.length / 2)] } });
  }
  all.forEach((p, i) => fs.push({ type: "Feature", properties: { t: "pt", txt: i === all.length - 1 && all.length > 2 ? `Total ${Math.round(tot).toLocaleString("fr-FR")} NM` : "" },
    geometry: { type: "Point", coordinates: p } }));
  (map.getSource("ruler") as maplibregl.GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: fs });
}

export function setRuler(on: boolean) {
  state.ruler = on;
  pts = []; cursor = null;
  btn?.setAttribute("aria-pressed", String(on));
  map.getCanvas().style.cursor = on ? "crosshair" : "";
  map.doubleClickZoom[on ? "disable" : "enable"]();
  render();
}

export function initRuler(m: MlMap) {
  map = m;
  map.addSource("ruler", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: "ruler-line", type: "line", source: "ruler", filter: ["==", ["get", "t"], "leg"],
    paint: { "line-color": COLOR, "line-width": 2.5, "line-dasharray": ["case", ["get", "live"], ["literal", [2, 2]], ["literal", [1, 0]]] } });
  map.addLayer({ id: "ruler-pt", type: "circle", source: "ruler", filter: ["==", ["get", "t"], "pt"],
    paint: { "circle-radius": 4, "circle-color": "#fff", "circle-stroke-color": COLOR, "circle-stroke-width": 2 } });
  map.addLayer({ id: "ruler-lbl", type: "symbol", source: "ruler", filter: ["!=", ["get", "txt"], ""],
    layout: { "text-field": ["get", "txt"], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-offset": [0, -1.1],
      "text-allow-overlap": true, "text-ignore-placement": true, "text-max-width": 40 },
    paint: { "text-color": "#1a1200", "text-halo-color": COLOR, "text-halo-width": 3 } });

  map.on("click", (e) => {
    if (!state.ruler) return;
    pts.push([e.lngLat.lng, e.lngLat.lat]);
    render();
  });
  map.on("mousemove", (e) => {
    if (!state.ruler || !pts.length) return;
    cursor = [e.lngLat.lng, e.lngLat.lat];
    render();
  });
  map.on("contextmenu", (e) => {
    if (!state.ruler) return;
    e.preventDefault();
    pts.pop(); if (!pts.length) cursor = null;
    render();
  });
  map.on("dblclick", () => { if (state.ruler) { cursor = null; render(); } });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.ruler) setRuler(false); });
}

/** Bouton de la carte (au-dessus du zoom). */
export function rulerControl(): maplibregl.IControl {
  return {
    onAdd() {
      const d = document.createElement("div");
      d.className = "maplibregl-ctrl maplibregl-ctrl-group";
      d.innerHTML = `<button type="button" id="ruler-btn" title="Règle : distance et route (Échap pour finir)" aria-label="Règle" aria-pressed="false">${LUCIDE_RULER}</button>`;
      btn = d.querySelector("button")!;
      btn.addEventListener("click", (e) => { e.stopPropagation(); setRuler(!state.ruler); });
      return d;
    },
    onRemove() { /* jamais retiré */ },
  };
}
