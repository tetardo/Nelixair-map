// Calques du trafic en ligne (VATSIM / IVAO) : avions orientés, indicatifs, terrains contrôlés, trajet du vol choisi.
import type * as maplibregl from "maplibre-gl";
import type { Map as MlMap } from "maplibre-gl";
import type { LngLat } from "../lib/format";
import { loadIndex } from "../services/data";
import { filedRoute } from "../lib/filedRoute";
import { loadSectors, sectorFor } from "../services/atcSectors";
import { fetchTraffic, type Atc, type Net, type Pilot, type Traffic } from "../services/traffic";
import { state } from "../store";

export const NET_COLOR: Record<Net, string> = { vatsim: "#2fbf71", ivao: "#3d8bfd" };
const NET_NAME: Record<Net, string> = { vatsim: "VATSIM", ivao: "IVAO" };
const EVERY = 30_000; // les réseaux publient toutes les 15 s ; 30 s suffisent pour une carte
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const TRAIL_MAX = 40; // 40 relevés de 30 s : les 20 dernières minutes
const VEC_MIN = 2; // vecteur vitesse : position dans 2 minutes

let map: MlMap;
let timer = 0;
const data: Partial<Record<Net, Traffic>> = {};
let apts: Map<string, LngLat> | null = null;
/** Positions relevées depuis l'ouverture de la carte, par réseau et indicatif. */
const trails = new Map<string, LngLat[]>();
function recordTrails() {
  const seen = new Set<string>();
  for (const n of ["vatsim", "ivao"] as Net[]) for (const p of data[n]?.pilots || []) {
    const k = n + "|" + p.callsign, t = trails.get(k) || [], ll: LngLat = [p.lon, p.lat];
    seen.add(k);
    if (p.ground) { trails.delete(k); continue; }
    const l = t[t.length - 1];
    if (!l || Math.abs(l[0] - ll[0]) + Math.abs(l[1] - ll[1]) > 1e-4) t.push(ll);
    if (t.length > TRAIL_MAX) t.splice(0, t.length - TRAIL_MAX);
    trails.set(k, t);
  }
  for (const k of trails.keys()) if (!seen.has(k)) trails.delete(k);
}

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
  map.addSource("atc-sec", { type: "geojson", data: EMPTY });
  map.addSource("traffic-tail", { type: "geojson", data: EMPTY });
  const color: any = ["match", ["get", "net"], "ivao", NET_COLOR.ivao, NET_COLOR.vatsim]; // expression MapLibre
  // secteurs des centres en route en ligne : voile léger, contour, et contour épais pour le secteur survolé
  map.addLayer({ id: "atc-sec-fill", type: "fill", source: "atc-sec", paint: { "fill-color": color, "fill-opacity": 0.05 } });
  map.addLayer({ id: "atc-sec-line", type: "line", source: "atc-sec", paint: { "line-color": color, "line-width": 1.2, "line-opacity": 0.55 } });
  map.addLayer({ id: "atc-sec-hot", type: "line", source: "atc-sec", filter: ["==", ["get", "cs"], "\u0000"],
    paint: { "line-color": "#ffb020", "line-width": 3, "line-opacity": 0.95 } });
  map.addLayer({ id: "atc-sec-hot-fill", type: "fill", source: "atc-sec", filter: ["==", ["get", "cs"], "\u0000"],
    paint: { "fill-color": "#ffb020", "fill-opacity": 0.12 } });
  map.addLayer({ id: "traffic-sel", type: "line", source: "traffic-sel",
    paint: { "line-color": ["get", "c"], "line-width": 2, "line-dasharray": ["literal", [2, 2]], "line-opacity": 0.9 } });
  // traînée des positions passées et vecteur vitesse (où sera l'avion dans 2 min)
  map.addLayer({ id: "traffic-trail", type: "line", source: "traffic-tail", minzoom: 5, filter: ["==", ["get", "k"], "trail"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": color, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1, 9, 2], "line-opacity": 0.4 } });
  map.addLayer({ id: "traffic-vec", type: "line", source: "traffic-tail", minzoom: 6, filter: ["==", ["get", "k"], "vec"],
    layout: { "line-cap": "round" },
    paint: { "line-color": color, "line-width": 1.5, "line-opacity": 0.85 } });
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

let fetchedAt = 0; // heure de la dernière mise à jour des positions

/** Position à l'estime après `h` heures au cap et à la vitesse sol. */
function ahead(p: Pilot, lon: number, lat: number, h: number): LngLat {
  const d = (p.gs * h) / 60, r = (p.hdg * Math.PI) / 180; // degrés de latitude parcourus
  return [lon + (d * Math.sin(r)) / Math.max(0.2, Math.cos((lat * Math.PI) / 180)), lat + d * Math.cos(r)];
}
/** Avions affichés, avancés à l'estime depuis la dernière mise à jour (2 min au plus), avec traînées et vecteurs. */
function pilotFeatures(): { planes: GeoJSON.FeatureCollection; tails: GeoJSON.FeatureCollection } {
  const nets = (["vatsim", "ivao"] as Net[]).filter((n) => state.filters[n]);
  const h = Math.min(120, Math.max(0, (Date.now() - fetchedAt) / 1000)) / 3600;
  const tails: GeoJSON.Feature[] = [];
  const planes = nets.flatMap((n) => data[n]?.pilots || []).map((p, i): GeoJSON.Feature => {
    const moving = !p.ground && p.gs > 40;
    const [lon, lat] = state.anim && moving ? ahead(p, p.lon, p.lat, h) : [p.lon, p.lat];
    if (moving) {
      const props = { net: p.net, k: "vec" };
      tails.push({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: [[lon, lat], ahead(p, lon, lat, VEC_MIN / 60)] } });
      const t = trails.get(p.net + "|" + p.callsign);
      if (t && t.length) tails.push({ type: "Feature", properties: { net: p.net, k: "trail" }, geometry: { type: "LineString", coordinates: [...t, [lon, lat]] } });
    }
    return { type: "Feature", id: i, properties: { net: p.net, callsign: p.callsign, hdg: p.hdg, ground: p.ground },
      geometry: { type: "Point", coordinates: [lon, lat] } };
  });
  return { planes: { type: "FeatureCollection", features: planes }, tails: { type: "FeatureCollection", features: tails } };
}
function setPilots() {
  const { planes, tails } = pilotFeatures();
  (map.getSource("traffic") as maplibregl.GeoJSONSource | undefined)?.setData(planes);
  (map.getSource("traffic-tail") as maplibregl.GeoJSONSource | undefined)?.setData(tails);
}
/** Appelé chaque seconde par la boucle d'animation. */
export function tickTraffic() {
  if (!map || !(state.filters.vatsim || state.filters.ivao) || !fetchedAt) return;
  setPilots();
}

function render() {
  const nets = (["vatsim", "ivao"] as Net[]).filter((n) => state.filters[n]);
  setPilots();
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
  renderSectors(nets);
  const vis = nets.length ? "visible" : "none";
  for (const id of ["traffic-ac", "traffic-lbl", "traffic-trail", "traffic-vec", "traffic-atc", "traffic-atc-lbl", "traffic-sel", "atc-sec-fill", "atc-sec-line", "atc-sec-hot", "atc-sec-hot-fill"]) map.setLayoutProperty(id, "visibility", vis);
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

/** Secteurs des contrôleurs en route en ligne (chargés à la demande). */
const secShape = new Map<string, GeoJSON.Feature>(); // indicatif -> limite affichée
async function renderSectors(nets: Net[]) {
  const src = map.getSource("atc-sec") as maplibregl.GeoJSONSource | undefined;
  if (!src) return;
  const list = nets.flatMap((n) => (data[n]?.atc || []).filter((a) => a.kind === "CTR" || a.kind === "FSS"));
  if (!list.length) { secShape.clear(); src.setData(EMPTY); return; }
  const s = await loadSectors();
  if (!s) return;
  secShape.clear();
  const fs: GeoJSON.Feature[] = [];
  for (const a of list) {
    const f = sectorFor(s, a.callsign);
    if (!f) continue;
    const g = { type: "Feature", properties: { net: a.net, cs: a.callsign }, geometry: f.geometry } as GeoJSON.Feature;
    secShape.set(a.net + "|" + a.callsign, g);
    fs.push(g);
  }
  src.setData({ type: "FeatureCollection", features: fs });
}
/** Allume le secteur d'un contrôleur en route (survol de la liste). */
export function highlightAtcSector(a: Atc | null) {
  const f = ["==", ["get", "cs"], a && secShape.has(a.net + "|" + a.callsign) ? a.callsign : "\u0000"];
  for (const id of ["atc-sec-hot", "atc-sec-hot-fill"]) if (map?.getLayer(id)) map.setFilter(id, f as never);
}
/** Emprise du secteur d'un contrôleur en route, ou null s'il n'est pas connu. */
export function atcSectorBounds(a: Atc): [[number, number], [number, number]] | null {
  const g = secShape.get(a.net + "|" + a.callsign)?.geometry;
  if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const rings = g.type === "Polygon" ? g.coordinates : g.coordinates.flat();
  for (const r of rings) for (const [x, y] of r) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return [[w, s], [e, n]];
}
export const hasAtcSector = (a: Atc) => secShape.has(a.net + "|" + a.callsign);

export async function refreshTraffic() {
  clearTimeout(timer);
  if (!map) return;
  const nets = (["vatsim", "ivao"] as Net[]).filter((n) => state.filters[n]);
  if (nets.length) {
    await airportIndex();
    await Promise.all(nets.map((n) => fetchTraffic(n).then((t) => (data[n] = t)).catch((e) => { console.warn(e); delete data[n]; })));
    fetchedAt = Date.now();
    recordTrails();
    timer = window.setTimeout(refreshTraffic, document.hidden ? EVERY * 4 : EVERY);
  }
  render();
}

/** Route déposée du vol choisi (à défaut : départ → avion → arrivée). */
let drawSeq = 0;
export async function drawFlight(p: Pilot | null) {
  const src = map?.getSource("traffic-sel") as maplibregl.GeoJSONSource | undefined;
  if (!src) return;
  const seq = ++drawSeq;
  if (!p) return src.setData(EMPTY);
  const dep = airportPos(p.dep), arr = airportPos(p.arr);
  let pts = p.route ? await filedRoute(p.route, dep, arr).catch(() => []) : [];
  if (seq !== drawSeq) return; // un autre vol a été choisi entre-temps
  if (pts.length < 2) pts = [dep, [p.lon, p.lat] as LngLat, arr].filter(Boolean) as LngLat[];
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
