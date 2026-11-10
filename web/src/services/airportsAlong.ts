// Terrains le long de la route (dégagements en route) : lus dans les tuiles nav (z6 : grands et moyens terrains)
// sur tout le trajet, pas seulement dans la partie affichée de la carte.
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { PMTiles } from "pmtiles";
import { CFG } from "../config";
import { distNm } from "../lib/geo";
import type { LngLat } from "../lib/format";
import { navPmtilesUrl } from "../map/mapView";

export interface AptRow { ident: string; name: string; ll: LngLat; rwyFt: number; ifr: boolean; kind: string }
export interface Alternate extends AptRow { d: number; off: number } // d : NM depuis le départ, off : NM de la route

const Z = 6;
let pm: PMTiles | null = null;
const cache = new Map<string, Promise<AptRow[]>>();
let gjP: Promise<AptRow[]> | null = null;

const row = (p: Record<string, any>, ll: LngLat): AptRow | null =>
  p.ident && p.cls === "airport" ? { ident: String(p.ident), name: String(p.name || ""), ll, rwyFt: Number(p.rwy_ft) || 0, ifr: !!p.ifr, kind: String(p.kind || "") } : null;

function tile(x: number, y: number): Promise<AptRow[]> {
  const k = `${x}/${y}`;
  let t = cache.get(k);
  if (!t) {
    pm = pm || new PMTiles(navPmtilesUrl!);
    t = pm.getZxy(Z, x, y).then((r) => {
      if (!r?.data) return [];
      const layer = new VectorTile(new PbfReader(new Uint8Array(r.data))).layers.airports;
      const out: AptRow[] = [];
      for (let i = 0; i < (layer?.length ?? 0); i++) {
        const f = layer.feature(i).toGeoJSON(x, y, Z);
        if (f.geometry.type !== "Point") continue;
        const a = row(f.properties || {}, f.geometry.coordinates as LngLat);
        if (a) out.push(a);
      }
      return out;
    }).catch(() => []);
    cache.set(k, t);
  }
  return t;
}
function allGeojson(): Promise<AptRow[]> {
  gjP = gjP || fetch(CFG.geojson.airports).then((r) => r.json())
    .then((j: GeoJSON.FeatureCollection) => j.features.map((f) => row(f.properties || {}, (f.geometry as GeoJSON.Point).coordinates as LngLat)).filter((a): a is AptRow => !!a))
    .catch(() => []);
  return gjP;
}
const tileXY = ([lon, lat]: LngLat) => {
  const n = 2 ** Z, r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return [Math.floor(((lon + 180) / 360) * n), Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)];
};

/** Terrains à moins de `corridor` NM de la route (échantillons réguliers), avec leur position le long de la route. */
export async function airportsAlong(pts: { d: number; ll: LngLat }[], corridor: number): Promise<Alternate[]> {
  let cands: AptRow[];
  if (!navPmtilesUrl) cands = await allGeojson();
  else {
    // tuiles couvrant la route élargie du couloir (≈ 1° de marge)
    const keys = new Set<string>();
    const pad = corridor / 60 + 0.2;
    for (const p of pts) for (const dx of [-pad, 0, pad]) for (const dy of [-pad, 0, pad]) {
      const [x, y] = tileXY([p.ll[0] + dx / Math.max(0.2, Math.cos((p.ll[1] * Math.PI) / 180)), p.ll[1] + dy]);
      keys.add(`${x}/${y}`);
    }
    const lists = await Promise.all([...keys].map((k) => { const [x, y] = k.split("/").map(Number); return tile(x, y); }));
    const seen = new Set<string>();
    cands = lists.flat().filter((a) => (seen.has(a.ident) ? false : (seen.add(a.ident), true)));
  }
  const out: Alternate[] = [];
  for (const a of cands) {
    let best = { off: Infinity, d: 0 };
    for (const p of pts) { const o = distNm(a.ll, p.ll); if (o < best.off) best = { off: o, d: p.d }; }
    if (best.off <= corridor) out.push({ ...a, ...best });
  }
  return out.sort((x, y) => x.d - y.d);
}
