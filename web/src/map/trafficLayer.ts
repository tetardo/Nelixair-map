// Calques du trafic en ligne (VATSIM / IVAO) : avions orientés, indicatifs, terrains contrôlés, trajet du vol choisi.
import type * as maplibregl from "maplibre-gl";
import type { Map as MlMap } from "maplibre-gl";
import type { LngLat } from "../lib/format";
import { loadIndex } from "../services/data";
import { fetchTraffic, type Atc, type Net, type Pilot, type Traffic } from "../services/traffic";
import { state } from "../store";

export const NET_COLOR: Record<Net, string> = { vatsim: "#2fbf71", ivao: "#3d8bfd" };
const NET_NAME: Record<Net, string> = { vatsim: "VATSIM", ivao: "IVAO" };
const EVERY = 30_000; // les réseaux publient toutes les 15 s ; 30 s suffisent pour une carte
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

let map: MlMap;
let timer = 0;
const data: Partial<Record<Net, Traffic>> = {};
let apts: Map<string, LngLat> | null = null;

/** Silhouette d'avion (icône SDF : la couleur est donnée par le calque). */
function planeIcon(): ImageData {
  const px = 2, s = 24, c = document.createElement("canvas");
  c.width = c.height = s * px;
  const g = c.getContext("2d")!;
  g.scale(px, px);
  g.fillStyle = "#000";
  g.beginPath();
  // nez en haut (cap 0) ; fuselage, ailes, empennage
  g.moveTo(12, 1.5); g.quadraticCurveTo(13.6, 3, 13.6, 7); g.lineTo(13.6, 9.5); g.lineTo(22.5, 14.5); g.lineTo(22.5, 16.5);
  g.lineTo(13.6, 13.8); g.lineTo(13.4, 18.6); g.lineTo(16.5, 21); g.lineTo(16.5, 22.5); g.lineTo(12, 21.3);
  g.lineTo(7.5, 22.5); g.lineTo(7.5, 21); g.lineTo(10.6, 18.6); g.lineTo(10.4, 13.8); g.lineTo(1.5, 16.5); g.lineTo(1.5, 14.5);
  g.lineTo(10.4, 9.5); g.lineTo(10.4, 7); g.quadraticCurveTo(10.4, 3, 12, 1.5); g.closePath(); g.fill();
  return g.getImageData(0, 0, s * px, s * px);
}

async function airportIndex(): Promise<Map<string, LngLat>> {
  if (apts) return apts;
  const idx = await loadIndex();
  apts = new Map();
  for (const r of idx?.fixes || []) if (r[1] === "airport") apts.set(r[0], [r[2], r[3]]);
  return apts;
}
export const airportPos = (icao: string): LngLat | null => apts?.get(icao) ?? null;

export function initTraffic(m: MlMap) {
  map = m;
  map.addImage("traffic-plane", planeIcon(), { pixelRatio: 2, sdf: true });
  map.addSource("traffic", { type: "geojson", data: EMPTY });
  map.addSource("traffic-atc", { type: "geojson", data: EMPTY });
  map.addSource("traffic-sel", { type: "geojson", data: EMPTY });
  const color: any = ["match", ["get", "net"], "ivao", NET_COLOR.ivao, NET_COLOR.vatsim]; // expression MapLibre
  map.addLayer({ id: "traffic-sel", type: "line", source: "traffic-sel",
    paint: { "line-color": ["get", "c"], "line-width": 2, "line-dasharray": ["literal", [2, 2]], "line-opacity": 0.9 } });
  map.addLayer({ id: "traffic-atc", type: "circle", source: "traffic-atc",
    // pastille pleine (les METAR sont des anneaux creux : pas de confusion)
    paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 4, 8, 7], "circle-color": color,
      "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } });
  map.addLayer({ id: "traffic-atc-lbl", type: "symbol", source: "traffic-atc", minzoom: 4,
    layout: { "text-field": ["get", "lbl"], "text-font": ["Noto Sans Bold"], "text-size": 10, "text-anchor": "left", "text-offset": [0.9, 0], "text-allow-overlap": false },
    paint: { "text-color": "#fff", "text-halo-color": color, "text-halo-width": 2 } });
  map.addLayer({ id: "traffic-ac", type: "symbol", source: "traffic",
    layout: { "icon-image": "traffic-plane", "icon-size": ["interpolate", ["linear"], ["zoom"], 2, 0.7, 7, 1, 11, 1.25],
      "icon-rotate": ["get", "hdg"], "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-ignore-placement": true },
    paint: { "icon-color": color, "icon-halo-color": "rgba(0,0,0,.65)", "icon-halo-width": 1, "icon-opacity": ["case", ["get", "ground"], 0.55, 1] } });
  map.addLayer({ id: "traffic-lbl", type: "symbol", source: "traffic", minzoom: 6,
    layout: { "text-field": ["get", "callsign"], "text-font": ["Noto Sans Bold"], "text-size": 10.5, "text-offset": [0, 1.3], "text-anchor": "top" },
    paint: { "text-color": "#fff", "text-halo-color": color, "text-halo-width": 2 } });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshTraffic(); });
  refreshTraffic();
}

export const TRAFFIC_LAYERS = ["traffic-ac", "traffic-atc"];

function render() {
  const nets = (["vatsim", "ivao"] as Net[]).filter((n) => state.filters[n]);
  const pilots = nets.flatMap((n) => data[n]?.pilots || []);
  (map.getSource("traffic") as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features: pilots.map((p, i) => ({
    type: "Feature", id: i, properties: { net: p.net, callsign: p.callsign, hdg: p.hdg, ground: p.ground },
    geometry: { type: "Point", coordinates: [p.lon, p.lat] } })) });
  // un point par terrain contrôlé et par réseau, libellé des postes (D G T A, i pour l'ATIS)
  const byApt = new Map<string, Atc[]>();
  for (const n of nets) for (const a of data[n]?.atc || []) {
    if (a.kind === "CTR" || a.kind === "FSS") continue;
    const k = a.net + "|" + a.where;
    byApt.set(k, [...(byApt.get(k) || []), a]);
  }
  const ORDER = ["DEL", "GND", "TWR", "APP", "ATIS"], SHORT: Record<string, string> = { DEL: "D", GND: "G", TWR: "T", APP: "A", ATIS: "i" };
  const fs: GeoJSON.Feature[] = [];
  for (const [k, list] of byApt) {
    const [net, icao] = k.split("|"), pos = apts?.get(icao);
    if (!pos) continue;
    const kinds = ORDER.filter((o) => list.some((a) => a.kind === o));
    fs.push({ type: "Feature", properties: { net, icao, lbl: kinds.map((x) => SHORT[x]).join(" ") }, geometry: { type: "Point", coordinates: pos } });
  }
  (map.getSource("traffic-atc") as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features: fs });
  const vis = nets.length ? "visible" : "none";
  for (const id of ["traffic-ac", "traffic-lbl", "traffic-atc", "traffic-atc-lbl", "traffic-sel"]) map.setLayoutProperty(id, "visibility", vis);
  state.trafficStatus = nets.map((n) => {
    const d = data[n];
    if (!d) return `${NET_NAME[n]} : indisponible`;
    const ctr = d.atc.filter((a) => a.kind !== "ATIS").length;
    return `${NET_NAME[n]} : ${d.pilots.length} pilote${d.pilots.length > 1 ? "s" : ""}, ${ctr} contrôleur${ctr > 1 ? "s" : ""}`;
  }).join(" · ");
  // garde la fiche du vol choisi à jour
  if (state.detail.kind === "traffic") {
    const cur = state.detail.p;
    const p = data[cur.net]?.pilots.find((x) => x.callsign === cur.callsign);
    if (p) { state.detail = { kind: "traffic", p }; drawFlight(p); }
  }
}

export async function refreshTraffic() {
  clearTimeout(timer);
  if (!map) return;
  const nets = (["vatsim", "ivao"] as Net[]).filter((n) => state.filters[n]);
  if (nets.length) {
    await airportIndex();
    await Promise.all(nets.map((n) => fetchTraffic(n).then((t) => (data[n] = t)).catch((e) => { console.warn(e); delete data[n]; })));
    timer = window.setTimeout(refreshTraffic, document.hidden ? EVERY * 4 : EVERY);
  }
  render();
}

/** Trajet départ → avion → arrivée du vol choisi. */
export function drawFlight(p: Pilot | null) {
  const src = map?.getSource("traffic-sel") as maplibregl.GeoJSONSource | undefined;
  if (!src) return;
  if (!p) return src.setData(EMPTY);
  const pts = [airportPos(p.dep), [p.lon, p.lat] as LngLat, airportPos(p.arr)].filter(Boolean) as LngLat[];
  src.setData({ type: "FeatureCollection", features: pts.length > 1
    ? [{ type: "Feature", properties: { c: NET_COLOR[p.net] }, geometry: { type: "LineString", coordinates: pts } }] : [] });
}

export function pilotAt(f: maplibregl.MapGeoJSONFeature): Pilot | null {
  const { net, callsign } = f.properties as { net: Net; callsign: string };
  return data[net]?.pilots.find((p) => p.callsign === callsign) || null;
}
export function atcAt(f: maplibregl.MapGeoJSONFeature): { icao: string; list: Atc[] } {
  const { net, icao } = f.properties as { net: Net; icao: string };
  return { icao, list: (data[net]?.atc || []).filter((a) => a.where === icao) };
}
/** Contrôleurs en route (CTR / FSS) en ligne, pour la liste du panneau. */
export function enrouteAtc(): Atc[] {
  return (["vatsim", "ivao"] as Net[]).filter((n) => state.filters[n]).flatMap((n) => (data[n]?.atc || []).filter((a) => a.kind === "CTR" || a.kind === "FSS"));
}
