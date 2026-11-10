// Données statiques chargées à la demande : index de recherche, voies, détails aéroport, métadonnées.
import { CFG } from "../config";

// ---------- Index de recherche ----------
export type FixRow = [string, string, number, number, string, string]; // ident, classe, lon, lat, nom, région
export interface SearchIndex { v: number; fixes: FixRow[]; airways: Record<string, [number, number, number, number]> }
export type Hit = { t: "awy"; ident: string; bb: [number, number, number, number] } | { t: "fix"; r: FixRow };

let index: SearchIndex | null = null;
let indexP: Promise<SearchIndex | null> | null = null;
export function loadIndex(): Promise<SearchIndex | null> {
  indexP = indexP || fetch(CFG.search).then((r) => r.json()).then((j) => (index = j)).catch((e) => {
    console.error(e); indexP = null; return null;
  });
  return indexP;
}
export const indexLoaded = (): boolean => index != null;

export function search(q: string): Hit[] {
  q = q.trim().toUpperCase();
  if (!q || !index) return [];
  const exact: Hit[] = [], prefix: Hit[] = [];
  for (const [ident, bb] of Object.entries(index.airways)) {
    if (ident === q) exact.push({ t: "awy", ident, bb }); else if (ident.startsWith(q)) prefix.push({ t: "awy", ident, bb });
  }
  for (const r of index.fixes) {
    const id = r[0];
    if (id === q) exact.push({ t: "fix", r }); else if (id.startsWith(q) && prefix.length < 200) prefix.push({ t: "fix", r });
  }
  const key = (h: Hit) => (h.t === "awy" ? h.ident : h.r[0]);
  prefix.sort((a, b) => key(a).length - key(b).length);
  return exact.concat(prefix).slice(0, 30);
}
export const hitIdent = (h: Hit): string => (h.t === "awy" ? h.ident : h.r[0]);

// ---------- Voies (routes.json) ----------
export type RoutePt = [string, string, number, number, number | null, string | null]; // ident, classe, lon, lat, MEA, sens
export interface Route { rnav: boolean; parts: { lv: string; pts: RoutePt[] }[] }

let routes: Record<string, Route> | null = null;
let routesP: Promise<Record<string, Route> | null> | null = null;
let fixAirways: Map<string, { lon: number; lat: number; awy: string }[]> | null = null;
export function loadRoutes(): Promise<Record<string, Route> | null> {
  routesP = routesP || fetch(CFG.routes).then((r) => r.json()).then((j: Record<string, Route>) => {
    routes = j;
    fixAirways = new Map();
    for (const [awy, r] of Object.entries(j))
      for (const part of r.parts)
        for (const [id, , lon, lat] of part.pts) {
          const arr = fixAirways.get(id) || [];
          arr.push({ lon, lat, awy });
          fixAirways.set(id, arr);
        }
    return j;
  }).catch((e) => { console.error(e); routesP = null; return null; });
  return routesP;
}
export const getRoute = (ident: string): Route | null => routes?.[ident] || null;

/** Voies passant par un point (ident + position, les idents ne sont pas uniques dans le monde). */
export function airwaysThrough(ident: string, ll: [number, number]): string[] {
  const near = (fixAirways?.get(ident) || []).filter((x) => Math.abs(x.lon - ll[0]) < 0.02 && Math.abs(x.lat - ll[1]) < 0.02);
  return [...new Set(near.map((x) => x.awy))].sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
}

// ---------- Détails aéroport : un fichier par préfixe d'ident ----------
export interface AptDetails {
  rwy?: [string, number | null, number | null, string, number | null, string][];
  frq?: [string, number, string][];
  chr?: [string, string, string][];
}
const aptCache = new Map<string, Promise<Record<string, AptDetails>>>();
export function aptDetails(ident: string): Promise<AptDetails | null> {
  const k = ident.toUpperCase().slice(0, 2).replace(/[^A-Z0-9]/g, "_") || "__";
  if (!aptCache.has(k)) aptCache.set(k, fetch(`${CFG.airportDetails}${k}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
  return aptCache.get(k)!.then((d) => d[ident] || null);
}

export async function exists(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "HEAD" });
    // Le serveur de développement peut renvoyer index.html (200) pour un fichier absent
    return r.ok && !(r.headers.get("content-type") || "").includes("text/html");
  } catch { return false; }
}
