// Formatage partagé (fiches, popups, liste, recherche).

export type LngLat = [number, number];

export const CLS: Record<string, string> = {
  waypoint: "Waypoint", vor: "VOR", vordme: "VOR/DME", vortac: "VORTAC", tacan: "TACAN", dme: "DME", ndb: "NDB", airport: "Aéroport",
};
export const APT_KIND: Record<string, string> = {
  large: "Grand aéroport", medium: "Aéroport", small: "Petit terrain", heliport: "Héliport", seaplane: "Hydrobase",
};
export const SURF: Record<string, string> = { hard: "revêtue", soft: "non revêtue", water: "plan d'eau" };
export const ASP_GROUP: Record<string, string> = { controlled: "Contrôlé", special: "Zone réglementée", fir: "Région d'information", other: "Autre" };
export const LVL: Record<string, string> = { H: "Haute altitude", L: "Basse altitude", B: "Haute et basse" };
export const LVL_SHORT: Record<string, string> = { H: "Haute", L: "Basse", B: "H+B" };
export const SRC: Record<string, string> = { "faa-cifp": "FAA CIFP", openaip: "OpenAIP" };

// Couleurs des dangers SIGMET / AIRMET (identiques jour et nuit)
export const HZ_COLORS: Record<string, string> = {
  conv: "#e0342f", turb: "#f08a24", ice: "#2bb3e6", ifr: "#9b5de5", ash: "#8d6e63", tc: "#c2185b", other: "#7d8aa5",
};
export const HZ_LBL: Record<string, string> = {
  conv: "Orages / convection", turb: "Turbulence", ice: "Givrage", ifr: "IFR / relief masqué", ash: "Cendres volcaniques",
  tc: "Cyclone tropical", other: "Autre",
};
export const SEV_LBL: Record<string, string> = { NEG: "nulle", SMTH: "faible", LGT: "faible", MOD: "modérée", SEV: "forte", EXTM: "extrême" };

export const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

export const yes = (v: unknown): boolean => v === true || v === "true";

export const ft = (v: unknown): string | null => (v == null || v === "" ? null : `${Number(v).toLocaleString("fr-FR")} ft`);

/** Altitude : niveau de vol à partir de 18 000 ft (altitude de transition US), pieds sinon. */
export const alt = (v: number): string => (v >= 18000 ? `FL${Math.round(v / 100)}` : `${v.toLocaleString("fr-FR")} ft`);

export function dms(v: number, lat: boolean): string {
  const h = lat ? (v >= 0 ? "N" : "S") : v >= 0 ? "E" : "W";
  v = Math.abs(v);
  const d = Math.floor(v), m = Math.floor((v - d) * 60), s = ((v - d) * 60 - m) * 60;
  return `${h}${String(d).padStart(lat ? 2 : 3, "0")}°${String(m).padStart(2, "0")}'${s.toFixed(1).padStart(4, "0")}"`;
}

export const freq = (p: { freq?: number | null; cls?: string }): string | null =>
  p.freq == null ? null : p.cls === "ndb" ? `${Math.round(p.freq)} kHz` : `${Number(p.freq).toFixed(2)} MHz`;

export const deg3 = (v: number): string => String(Math.round(v) % 360).padStart(3, "0") + "°";

/** "2026-11-09T22:38:00Z" -> "09/11 2238Z" */
export const zt = (v: unknown): string => {
  const m = /^\d{4}-(\d\d)-(\d\d)[T ](\d\d):(\d\d)/.exec(String(v || ""));
  return m ? `${m[2]}/${m[1]} ${m[3]}${m[4]}Z` : "";
};

/** Lignes clé / valeur en ignorant les valeurs vides. */
export const pairs = (list: [string, unknown][]): [string, string][] =>
  list.filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)]);
