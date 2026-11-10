// Secteurs des contrôleurs en route (CTR / FSS) : limites VATSpy (vatsimnetwork/vatspy-data-project,
// CC BY-SA 4.0), utilisées aussi par les clients IVAO. Chargées à la demande (≈ 3 Mo, une fois par session)
// quand un calque de trafic est activé.
const BASE = "https://raw.githubusercontent.com/vatsimnetwork/vatspy-data-project/master/";

interface Sectors { byPrefix: Map<string, string>; byIcao: Map<string, string>; shapes: Map<string, GeoJSON.Feature> }
let pending: Promise<Sectors | null> | null = null;

async function load(): Promise<Sectors | null> {
  try {
    const [dat, geo] = await Promise.all([
      fetch(BASE + "VATSpy.dat").then((r) => (r.ok ? r.text() : Promise.reject(r.status))),
      fetch(BASE + "Boundaries.geojson").then((r) => (r.ok ? r.json() : Promise.reject(r.status))) as Promise<GeoJSON.FeatureCollection>,
    ]);
    const byPrefix = new Map<string, string>(), byIcao = new Map<string, string>(), shapes = new Map<string, GeoJSON.Feature>();
    let inFirs = false;
    for (const line of dat.split(/\r?\n/)) {
      if (line.startsWith("[")) { inFirs = line.startsWith("[FIRs]"); continue; }
      if (!inFirs || !line || line.startsWith(";")) continue;
      const [icao, , prefix, boundary] = line.split("|");
      const b = (boundary || icao || "").trim();
      if (!b) continue;
      if (prefix?.trim()) byPrefix.set(prefix.trim().toUpperCase(), b);
      if (icao?.trim() && !byIcao.has(icao.trim().toUpperCase())) byIcao.set(icao.trim().toUpperCase(), b);
    }
    for (const f of geo.features) { const id = String(f.properties?.id || ""); if (id && !shapes.has(id)) shapes.set(id, f); }
    return { byPrefix, byIcao, shapes };
  } catch (e) {
    console.warn("Secteurs VATSpy indisponibles", e);
    pending = null; // nouvel essai au prochain rafraîchissement
    return null;
  }
}
export const loadSectors = () => (pending ??= load());

/** Limite du secteur d'un indicatif en route (LFFF_E_CTR, EDGG_N_CTR, LON_S_CTR…), comme VATSpy. */
export function sectorFor(s: Sectors, callsign: string): GeoJSON.Feature | null {
  const parts = callsign.toUpperCase().split("_").filter((p) => !["CTR", "FSS"].includes(p));
  for (let n = parts.length; n >= 1; n--) {
    const k = parts.slice(0, n).join("_");
    const id = s.byPrefix.get(k) || s.byIcao.get(k) || s.byIcao.get(parts.slice(0, n).join("-"));
    const f = id ? s.shapes.get(id) : undefined;
    if (f) return f;
  }
  return null;
}
