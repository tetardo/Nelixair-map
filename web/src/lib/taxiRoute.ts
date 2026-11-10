// Itinéraire de roulage poste -> piste sur le graphe OSM (pipeline/taxigraph.py). Indicatif : la clairance ATC prime.
import type { LngLat } from "./format";

export interface TaxiGraph {
  n: LngLat[]; e: [number, number, number, number, number][]; refs: string[];
  stands: [string, number, number, number][]; holds: [string, number][];
  rwys: Record<string, { thr: LngLat; hdg: number; entries: [number, number][] }>;
}
export interface TaxiRoute { coords: LngLat[]; via: string[]; holds: { ref: string; at: LngLat }[]; dist: number; entry: number; fromThr: number }

const cache = new Map<string, Promise<TaxiGraph | null>>();
export function loadTaxi(base: string, apt: string): Promise<TaxiGraph | null> {
  if (!cache.has(apt)) cache.set(apt, fetch(`${base}taxi/${apt}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return cache.get(apt)!;
}

const RWY_PENALTY = 8; // rouler sur une piste coûte 8× plus (traversée possible, remontée évitée)

/** Plus court chemin (Dijkstra) depuis un nœud vers un ensemble de nœuds cibles. */
function dijkstra(g: TaxiGraph, from: number, targets: Set<number>) {
  const adj: [number, number, number][][] = g.n.map(() => []);
  g.e.forEach(([a, b, , len, rwy], k) => { const w = len * (rwy ? RWY_PENALTY : 1); adj[a].push([b, w, k]); adj[b].push([a, w, k]); });
  const dist = new Float64Array(g.n.length).fill(Infinity), prev = new Int32Array(g.n.length).fill(-1), pe = new Int32Array(g.n.length).fill(-1);
  const heap: [number, number][] = [[0, from]];
  dist[from] = 0;
  const push = (x: [number, number]) => { heap.push(x); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [d, u] = pop();
    if (d > dist[u]) continue;
    if (targets.has(u)) return { end: u, prev, pe };
    for (const [v, w, k] of adj[u]) if (d + w < dist[v]) { dist[v] = d + w; prev[v] = u; pe[v] = k; push([dist[v], v]); }
  }
  return null;
}

/**
 * Itinéraire du poste `stand` (index dans g.stands) vers la piste `qfu`.
 * `full` : entrée la plus proche du seuil (pleine longueur) ; sinon : entrée la plus proche du poste.
 */
export function routeToRunway(g: TaxiGraph, stand: number, qfu: string, full = true): TaxiRoute | null {
  const s = g.stands[stand], r = g.rwys[qfu];
  if (!s || !r?.entries.length) return null;
  // pleine longueur : entrées dans les 400 premiers mètres après le seuil (ou la plus proche)
  const minD = r.entries[0][1];
  const pool = full ? r.entries.filter(([, d]) => d <= minD + 400) : r.entries;
  const res = dijkstra(g, s[3], new Set(pool.map(([i]) => i)));
  if (!res) return null;
  const path: number[] = [], edgesUsed: number[] = [];
  for (let u = res.end; u !== -1; u = res.prev[u]) { path.unshift(u); if (res.pe[u] >= 0) edgesUsed.unshift(res.pe[u]); }
  const via: string[] = [];
  let dist = 0;
  for (const k of edgesUsed) {
    const [, , ri, len] = g.e[k];
    dist += len;
    const ref = g.refs[ri];
    if (ref && via[via.length - 1] !== ref) via.push(ref);
  }
  const onPath = new Set(path);
  const holds = g.holds.filter(([, n]) => onPath.has(n)).map(([ref, n]) => ({ ref, at: g.n[n], i: path.indexOf(n) }))
    .sort((a, b) => a.i - b.i).map(({ ref, at }) => ({ ref, at }));
  return { coords: [[s[1], s[2]] as LngLat, ...path.map((i) => g.n[i])], via, holds, dist: Math.round(dist),
    entry: res.end, fromThr: r.entries.find(([i]) => i === res.end)?.[1] ?? 0 };
}

/** Poste du graphe le plus proche d'un point (clic sur la carte). */
export function nearestStand(g: TaxiGraph, p: LngLat, maxDeg = 0.0006): number {
  let best = -1, bd = Infinity;
  g.stands.forEach(([, x, y], i) => { const d = Math.hypot(x - p[0], y - p[1]); if (d < bd) { bd = d; best = i; } });
  return bd <= maxDeg ? best : -1;
}
