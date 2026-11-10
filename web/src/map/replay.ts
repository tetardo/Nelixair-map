// Relecture animée du plan de vol : un avion parcourt la route au rythme prévu (temps du nav log), accéléré ×N.
// Le curseur du profil vertical suit l'avion ; la carte peut le suivre.
import type * as maplibregl from "maplibre-gl";
import type { Map as MlMap } from "maplibre-gl";
import { watch } from "vue";
import { along, routeVertices, type RouteVertex } from "../lib/routeGeom";
import type { LngLat } from "../lib/format";
import { ROUTE_COLOR } from "./flightRoute";
import { state } from "../store";

let map: MlMap;
let verts: RouteVertex[] = [];
let tl: { t: number; d: number }[] = []; // temps de vol (s) -> distance (NM)
let raf = 0, last = 0, lastCursor = 0;
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export function initReplay(m: MlMap) {
  map = m;
  map.addSource("replay", { type: "geojson", data: EMPTY });
  map.addLayer({ id: "replay-ac", type: "symbol", source: "replay",
    layout: { "icon-image": "traffic-plane", "icon-size": 1.5, "icon-rotate": ["get", "hdg"], "icon-rotation-alignment": "map",
      "icon-allow-overlap": true, "icon-ignore-placement": true },
    paint: { "icon-color": ROUTE_COLOR, "icon-halo-color": "#fff", "icon-halo-width": 1.5 } });
  watch(() => state.ofp, () => stopReplay());
}

/** Distance parcourue après `t` secondes, d'après les temps cumulés du nav log (à défaut, vitesse constante). */
function dAt(t: number): number {
  if (!tl.length) return 0;
  let i = 1;
  while (i < tl.length - 1 && tl[i].t < t) i++;
  const a = tl[i - 1], b = tl[i] ?? a;
  const k = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 1;
  return a.d + (b.d - a.d) * k;
}
export function tAtD(d: number): number {
  let i = 1;
  while (i < tl.length - 1 && tl[i].d < d) i++;
  const a = tl[i - 1], b = tl[i] ?? a;
  return b.d > a.d ? a.t + ((d - a.d) / (b.d - a.d)) * (b.t - a.t) : a.t;
}

function build(): boolean {
  const o = state.ofp;
  if (!o) return false;
  verts = routeVertices(o);
  const total = verts[verts.length - 1].d;
  const ete = o.ete || (total / 420) * 3600;
  tl = [{ t: 0, d: 0 }];
  // sommets 1..n = points du nav log ; temps cumulés croissants, sinon répartis à vitesse constante
  o.fixes.forEach((f, i) => {
    const v = verts[i + 1];
    if (v && f.ete != null && f.ete > tl[tl.length - 1].t && f.ete <= ete) tl.push({ t: f.ete, d: v.d });
  });
  if (tl[tl.length - 1].d < total) tl.push({ t: Math.max(ete, tl[tl.length - 1].t + 60), d: total });
  state.replay.total = tl[tl.length - 1].t;
  return true;
}

function draw() {
  const d = dAt(state.replay.t);
  const p = along(verts, d), q = along(verts, d + 0.3);
  const dx = (q.ll[0] - p.ll[0]) * Math.cos((p.ll[1] * Math.PI) / 180), dy = q.ll[1] - p.ll[1];
  const hdg = dx || dy ? (Math.atan2(dx, dy) * 180) / Math.PI : 0;
  (map.getSource("replay") as maplibregl.GeoJSONSource | undefined)?.setData({ type: "FeatureCollection",
    features: [{ type: "Feature", properties: { hdg }, geometry: { type: "Point", coordinates: p.ll as LngLat } }] });
  const now = performance.now();
  if (now - lastCursor > 90 || !state.replay.playing) { lastCursor = now; state.profileAt = d; } // le profil n'a pas besoin de 60 images/s
  if (state.replay.follow && state.replay.playing) map.setCenter(p.ll);
}

function frame(now: number) {
  const r = state.replay;
  if (!r.playing) return;
  r.t = Math.min(r.total, r.t + ((now - last) / 1000) * r.speed);
  last = now;
  draw();
  if (r.t >= r.total) { r.playing = false; state.profileAt = dAt(r.t); return; }
  raf = requestAnimationFrame(frame);
}

export function playReplay() {
  const r = state.replay;
  if (!r.on) { if (!build()) return; r.on = true; r.t = 0; state.profileOpen = true; }
  if (r.t >= r.total) r.t = 0;
  r.playing = true;
  last = performance.now();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
}
export function pauseReplay() { state.replay.playing = false; cancelAnimationFrame(raf); }
export function seekReplay(t: number) {
  const r = state.replay;
  if (!r.on) return;
  r.t = Math.max(0, Math.min(r.total, t));
  draw();
}
export const seekReplayD = (d: number) => seekReplay(tAtD(d));
export function stopReplay() {
  pauseReplay();
  state.replay.on = false; state.replay.t = 0;
  (map?.getSource("replay") as maplibregl.GeoJSONSource | undefined)?.setData(EMPTY);
}
/** Point de la relecture en cours : distance, altitude prévue, vitesse sol moyenne du tronçon. */
export function replayInfo(): { d: number; alt: number; gs: number } | null {
  if (!state.replay.on) return null;
  const t = state.replay.t, d = dAt(t), d2 = dAt(Math.min(state.replay.total, t + 30));
  return { d, alt: along(verts, d).alt, gs: Math.round(((d2 - d) / 30) * 3600) };
}
