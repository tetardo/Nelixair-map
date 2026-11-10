// Météo : METAR / TAF de la NOAA (domaine public).
// L'API aviationweather.gov refuse les appels navigateur (pas de CORS) : on lit un relais
// statique (pipeline/wx.py, publié toutes les 10 min par .github/workflows/wx.yml).
import { CFG } from "../config";

const TTL = 5 * 60 * 1000;
const cache = new Map<string, { t: number; p: Promise<any> }>();

export interface Metar {
  icaoId: string; lat: number; lon: number; rawOb: string; reportTime?: string;
  temp?: number | null; dewp?: number | null; wdir?: number | string | null; wspd?: number | null; wgst?: number | null;
  visib?: number | string | null; altim?: number | null; clouds: { cover: string; base: number | null }[];
  fltCat?: string | null; vertVis?: number | null;
}

export const WX_COLORS: Record<string, string> = { VFR: "#22a559", MVFR: "#2f6fe0", IFR: "#e0342f", LIFR: "#c235c2" };

function load(url: string): Promise<any> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.t < TTL) return hit.p;
  const p = fetch(url, { cache: "no-cache" }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });
  cache.set(url, { t: Date.now(), p });
  p.catch(() => cache.delete(url));
  return p;
}

// metars.json -> { time, list, byId }
let metarsP: Promise<{ time: string; list: Metar[]; byId: Map<string, Metar> }> | null = null, metarsT = 0;
function metars() {
  if (!metarsP || Date.now() - metarsT > TTL) {
    metarsT = Date.now();
    metarsP = load(CFG.wxMetars).then((j: { t: string; f: string[]; d: unknown[][] }) => {
      const list = j.d.map((r) => {
        const o: Record<string, unknown> = {};
        j.f.forEach((k, i) => (o[k] = r[i]));
        o.clouds = ((o.clouds as [string, number | null][]) || []).map(([cover, base]) => ({ cover, base }));
        return o as unknown as Metar;
      });
      return { time: j.t, list, byId: new Map(list.map((m) => [m.icaoId, m])) };
    });
    metarsP.catch(() => (metarsP = null));
  }
  return metarsP;
}

/** Visibilité en milles terrestres (peut valoir "10+", "1/2", "P6SM"…). */
export function visSm(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const s = String(v).replace("+", "").replace("P", "").replace("SM", "").trim();
  if (s.includes("/")) {
    let tot = 0;
    for (const p of s.split(" ")) {
      if (p.includes("/")) { const [a, b] = p.split("/").map(Number); tot += a / b; } else tot += Number(p);
    }
    return isNaN(tot) ? null : tot;
  }
  const n = Number(s);
  return isNaN(n) ? null : n;
}

/** Plafond = base de la plus basse couche BKN/OVC/OVX, ou visibilité verticale. */
export function ceilingFt(m: Metar): number | null {
  let c: number | null = null;
  for (const cl of m.clouds || []) {
    if (["BKN", "OVC", "OVX", "VV"].includes(cl.cover) && cl.base != null) c = c == null ? cl.base : Math.min(c, cl.base);
  }
  if (c == null && m.vertVis != null) c = m.vertVis;
  return c;
}

/** Catégorie de vol FAA : VFR / MVFR / IFR / LIFR. */
export function flightCat(m: Metar): string | null {
  if (m.fltCat) return m.fltCat;
  const v = visSm(m.visib), c = ceilingFt(m);
  if ((c != null && c < 500) || (v != null && v < 1)) return "LIFR";
  if ((c != null && c < 1000) || (v != null && v < 3)) return "IFR";
  if ((c != null && c <= 3000) || (v != null && v <= 5)) return "MVFR";
  if (v == null && c == null) return null;
  return "VFR";
}

export function wind(m: Metar): string | null {
  if (m.wspd == null) return null;
  if (m.wspd === 0) return "Calme";
  const dir = m.wdir === "VRB" ? "VRB" : String(m.wdir).padStart(3, "0") + "°";
  return `${dir} ${m.wspd} kt${m.wgst ? ` rafales ${m.wgst} kt` : ""}`;
}

export async function metarsInBbox(w: number, s: number, e: number, n: number): Promise<Metar[]> {
  const { list } = await metars();
  return list.filter((m) => m.lat >= s && m.lat <= n && m.lon >= w && m.lon <= e);
}
export async function metar(id: string): Promise<Metar | null> {
  return (await metars()).byId.get(id) || null;
}
export async function taf(id: string): Promise<{ rawTAF: string } | null> {
  const j = await load(CFG.wxTafs);
  return j.d[id] ? { rawTAF: j.d[id] } : null;
}
/** Âge des données en minutes (null si inconnu). */
export async function wxAge(): Promise<number | null> {
  const { time } = await metars();
  const t = Date.parse(time);
  return isNaN(t) ? null : Math.max(0, Math.round((Date.now() - t) / 60000));
}

export async function loadJson(url: string): Promise<any> {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
