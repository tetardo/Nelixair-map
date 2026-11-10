// Espaces aériens traversés par la route : lus directement dans les tuiles (z7) le long du trajet,
// pas seulement dans la partie affichée de la carte. Données OpenAIP (planchers et plafonds publiés).
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { PMTiles } from "pmtiles";
import { CFG } from "../config";
import type { LngLat } from "../lib/format";
import { inPolygon } from "../lib/routeGeom";
import { aspPmtilesUrl } from "../map/mapView";

export interface AspCrossing {
  key: string; name: string; type: string; cls: string; group: string;
  lower: string; upper: string; lowerFt: number; upperFt: number;
  from: number; to: number; // NM le long de la route
  inside: boolean; // l'altitude prévue entre dans l'espace (plancher ≤ alt ≤ plafond)
}
interface Shape { p: Record<string, any>; rings: number[][][][]; bb: [number, number, number, number] }

const Z = 7;
let pm: PMTiles | null = null;
const tileCache = new Map<string, Promise<Shape[]>>();
let geojsonP: Promise<Shape[]> | null = null;

function bbox(polys: number[][][][]): [number, number, number, number] {
  let w = 180, s = 90, e = -180, n = -90;
  for (const poly of polys) for (const [x, y] of poly[0]) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return [w, s, e, n];
}
function shapeOf(geom: GeoJSON.Geometry, p: Record<string, any>): Shape | null {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : null;
  return polys ? { p, rings: polys, bb: bbox(polys) } : null;
}
function tileShapes(x: number, y: number): Promise<Shape[]> {
  const k = `${x}/${y}`;
  let t = tileCache.get(k);
  if (!t) {
    pm = pm || new PMTiles(aspPmtilesUrl!);
    t = pm.getZxy(Z, x, y).then((r) => {
      if (!r?.data) return [];
      const layer = new VectorTile(new PbfReader(new Uint8Array(r.data))).layers.airspaces;
      const out: Shape[] = [];
      for (let i = 0; i < (layer?.length ?? 0); i++) {
        const f = layer.feature(i).toGeoJSON(x, y, Z);
        const s = shapeOf(f.geometry, f.properties || {});
        if (s) out.push(s);
      }
      return out;
    }).catch(() => []);
    tileCache.set(k, t);
  }
  return t;
}
function allGeojson(): Promise<Shape[]> {
  geojsonP = geojsonP || fetch(CFG.geojson.airspaces).then((r) => r.json())
    .then((j: GeoJSON.FeatureCollection) => j.features.map((f) => shapeOf(f.geometry, f.properties || {})).filter((s): s is Shape => !!s))
    .catch(() => []);
  return geojsonP;
}
const tileXY = ([lon, lat]: LngLat) => {
  const n = 2 ** Z, r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return [Math.floor(((lon + 180) / 360) * n), Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)];
};

/** Espaces traversés, dans l'ordre de la route (`pts` : échantillons réguliers avec altitude prévue). */
export async function airspacesAlong(pts: { d: number; ll: LngLat; alt: number }[]): Promise<AspCrossing[]> {
  const perPt: Shape[][] = await Promise.all(pts.map(async (pt) => {
    if (!aspPmtilesUrl) return allGeojson();
    const [x, y] = tileXY(pt.ll);
    return tileShapes(x, y);
  }));
  const open = new Map<string, AspCrossing>(), done: AspCrossing[] = [];
  const step = pts.length > 1 ? pts[1].d - pts[0].d : 1;
  pts.forEach((pt, i) => {
    const here = new Set<string>();
    for (const s of perPt[i]) {
      const [w, so, e, n] = s.bb, [lon, lat] = pt.ll;
      if (lon < w || lon > e || lat < so || lat > n) continue;
      if (s.p.group === "fir") continue; // les FIR couvrent tout : listées à part si besoin
      if (!s.rings.some((poly) => inPolygon(pt.ll, poly))) continue;
      const key = `${s.p.name}|${s.p.type}|${s.p.lower_ft}|${s.p.upper_ft}`;
      if (here.has(key)) continue;
      here.add(key);
      const lo = Number(s.p.lower_ft) || 0, up = Number.isFinite(Number(s.p.upper_ft)) ? Number(s.p.upper_ft) : 99999;
      const inside = pt.alt >= lo && pt.alt <= up;
      const c = open.get(key);
      if (c) { c.to = pt.d; c.inside ||= inside; }
      else open.set(key, { key, name: s.p.name || "?", type: s.p.type || "", cls: s.p.icao_class || "", group: s.p.group || "other",
        lower: s.p.lower || "", upper: s.p.upper || "", lowerFt: lo, upperFt: up, from: Math.max(0, pt.d - step / 2), to: pt.d, inside });
    }
    for (const [k, c] of open) if (!here.has(k)) { done.push(c); open.delete(k); }
  });
  done.push(...open.values());
  return done.sort((a, b) => a.from - b.from || a.lowerFt - b.lowerFt);
}
