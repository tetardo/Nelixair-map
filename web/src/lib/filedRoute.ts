// Route déposée d'un vol en ligne (champ « route » du plan de vol) -> suite de positions.
// Points résolus via l'index de recherche (le plus proche du point précédent, les idents ne sont pas uniques),
// voies déroulées entre leurs points d'entrée et de sortie. Ce qui n'est pas reconnu (SID, STAR, DCT) est ignoré.
import type { LngLat } from "./format";
import { getRoute, loadIndex, loadRoutes, type FixRow } from "../services/data";

let byIdent: Map<string, FixRow[]> | null = null;
async function fixesByIdent(): Promise<Map<string, FixRow[]> | null> {
  if (byIdent) return byIdent;
  const idx = await loadIndex();
  if (!idx) return null;
  byIdent = new Map();
  for (const r of idx.fixes) { const a = byIdent.get(r[0]); if (a) a.push(r); else byIdent.set(r[0], [r]); }
  return byIdent;
}

const d2 = (a: LngLat, b: LngLat) => {
  const dx = (a[0] - b[0]) * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180), dy = a[1] - b[1];
  return dx * dx + dy * dy;
};
/** Coordonnées ICAO du plan de vol : 4530N00500E, 45N005E, 4530N005E… */
function coord(t: string): LngLat | null {
  const m = /^(\d{2})(\d{2})?([NS])(\d{3})(\d{2})?([EW])$/.exec(t);
  if (!m) return null;
  const lat = (+m[1] + (+(m[2] || 0)) / 60) * (m[3] === "S" ? -1 : 1);
  const lon = (+m[4] + (+(m[5] || 0)) / 60) * (m[6] === "W" ? -1 : 1);
  return [lon, lat];
}

const cache = new Map<string, LngLat[]>();

/** Positions de la route déposée, de `from` (départ) à `to` (arrivée). Liste vide si rien n'est reconnu. */
export async function filedRoute(route: string, from: LngLat | null, to: LngLat | null): Promise<LngLat[]> {
  const key = `${route}|${from}|${to}`;
  if (cache.has(key)) return cache.get(key)!;
  const [fx] = await Promise.all([fixesByIdent(), loadRoutes()]);
  if (!fx) return [];
  const toks = route.toUpperCase().split(/\s+/).map((t) => t.split("/")[0]).filter((t) => t && t !== "DCT");
  const out: LngLat[] = from ? [from] : [];
  const pts: { id: string; ll: LngLat }[] = [];
  let pendingAwy: string | null = null;
  const last = () => (out.length ? out[out.length - 1] : to);
  const near = (id: string): LngLat | null => {
    const c = coord(id);
    if (c) return c;
    const rows = fx.get(id);
    if (!rows?.length) return null;
    const ref = last();
    let best = rows[0];
    if (ref) for (const r of rows) if (d2([r[2], r[3]], ref) < d2([best[2], best[3]], ref)) best = r;
    const ll: LngLat = [best[2], best[3]];
    return ref && d2(ll, ref) > 30 * 30 ? null : ll; // plus de ~1 800 NM du point précédent : homonyme, ignoré
  };
  for (const t of toks) {
    if (/^[A-Z]{1,2}\d{1,4}[A-Z]?$/.test(t) && getRoute(t) && !fx.has(t)) { pendingAwy = t; continue; }
    const ll = near(t);
    if (!ll) { if (!getRoute(t)) pendingAwy = null; continue; }
    const prev = pts[pts.length - 1];
    if (pendingAwy && prev) {
      // déroule la voie entre le point précédent et celui-ci
      for (const part of getRoute(pendingAwy)!.parts) {
        const i = part.pts.findIndex((p) => p[0] === prev.id && d2([p[2], p[3]], prev.ll) < 0.01);
        const j = part.pts.findIndex((p) => p[0] === t && d2([p[2], p[3]], ll) < 0.01);
        if (i < 0 || j < 0) continue;
        const seg = i < j ? part.pts.slice(i + 1, j) : part.pts.slice(j + 1, i).reverse();
        for (const p of seg) out.push([p[2], p[3]]);
        break;
      }
    }
    pendingAwy = null;
    pts.push({ id: t, ll });
    out.push(ll);
  }
  if (to) out.push(to);
  const res = pts.length ? out : [];
  cache.set(key, res);
  return res;
}
