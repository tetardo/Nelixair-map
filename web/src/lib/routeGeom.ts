// Géométrie du plan de vol : profil le long de la route (distance cumulée, position, altitude prévue).
import type { Ofp } from "../services/simbrief";
import type { LngLat } from "./format";
import { distNm } from "./geo";

export interface RouteVertex { d: number; ll: LngLat; alt: number; ident: string; stage: string }

/** Sommets de la route : départ, points du nav log, arrivée (distance recalculée, altitudes prévues). */
export function routeVertices(o: Ofp): RouteVertex[] {
  const v: RouteVertex[] = [{ d: 0, ll: [o.orig.lon, o.orig.lat], alt: o.orig.elev ?? 0, ident: o.orig.icao, stage: "DEP" }];
  for (const f of o.fixes) {
    const ll: LngLat = [f.lon, f.lat], prev = v[v.length - 1];
    const d = prev.d + distNm(prev.ll, ll);
    const isDest = f.ident === o.dest.icao;
    v.push({ d, ll, alt: isDest ? (o.dest.elev ?? f.alt ?? 0) : (f.alt ?? prev.alt), ident: f.ident, stage: isDest ? "ARR" : f.stage });
  }
  const last = v[v.length - 1];
  if (last.ident !== o.dest.icao) {
    v.push({ d: last.d + distNm(last.ll, [o.dest.lon, o.dest.lat]), ll: [o.dest.lon, o.dest.lat], alt: o.dest.elev ?? 0, ident: o.dest.icao, stage: "ARR" });
  }
  return v;
}

/** Position et altitude prévue à la distance `d` (interpolation linéaire entre sommets). */
export function along(v: RouteVertex[], d: number): { ll: LngLat; alt: number } {
  let i = 1;
  while (i < v.length - 1 && v[i].d < d) i++;
  const a = v[i - 1], b = v[i] ?? a;
  const t = b.d > a.d ? Math.min(1, Math.max(0, (d - a.d) / (b.d - a.d))) : 0;
  let dl = b.ll[0] - a.ll[0];
  if (dl > 180) dl -= 360; else if (dl < -180) dl += 360;
  return { ll: [a.ll[0] + dl * t, a.ll[1] + (b.ll[1] - a.ll[1]) * t], alt: a.alt + (b.alt - a.alt) * t };
}

/** Échantillons réguliers le long de la route (environ `n` points). */
export function samples(v: RouteVertex[], n = 300): { d: number; ll: LngLat; alt: number }[] {
  const total = v[v.length - 1].d, step = Math.max(0.5, total / n), out = [];
  for (let d = 0; d < total; d += step) out.push({ d, ...along(v, d) });
  out.push({ d: total, ...along(v, total) });
  return out;
}

/** Point dans un polygone (règle pair-impair), anneaux GeoJSON. */
export function inPolygon(ll: LngLat, rings: number[][][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > ll[1]) !== (yj > ll[1]) && ll[0] < ((xj - xi) * (ll[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
