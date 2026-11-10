// Import du dernier plan de vol SimBrief (OFP) d'un pilote.
// API publique : https://developers.navigraph.com/docs/simbrief/fetching-ofp-data
// Les valeurs arrivent en chaînes ; une liste d'un seul élément arrive parfois en objet.

export interface OfpFix {
  ident: string; name: string; type: string; lat: number; lon: number;
  stage: string; via: string; sidstar: boolean;
  leg: number; cum: number; trk: number | null; alt: number | null;
  tas: number | null; wind: string; oat: number | null;
  ete: number | null; fuelRem: number | null; freq: string;
}
export interface OfpApt { icao: string; iata: string; name: string; lat: number; lon: number; rwy: string; elev: number | null; metar: string }
export interface Ofp {
  user: string; fetched: string; generated: string; airac: string; units: string;
  callsign: string; flight: string; aircraft: string; acName: string; reg: string;
  orig: OfpApt; dest: OfpApt; altn: OfpApt[];
  route: string; cruise: string; ci: string; distance: number | null; airDist: number | null; ete: number | null;
  fuel: { ramp: number | null; takeoff: number | null; landing: number | null; burn: number | null; reserve: number | null;
    contingency: number | null; alternate: number | null; extra: number | null };
  weights: { zfw: number | null; tow: number | null; law: number | null; pax: number | null };
  fixes: OfpFix[];
}

type J = Record<string, any>;
const num = (v: unknown): number | null => {
  if (v == null || v === "" || typeof v === "object") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string => (v == null || typeof v === "object" ? "" : String(v).trim());
const list = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

function apt(a: J | undefined): OfpApt {
  a = a || {};
  return { icao: str(a.icao_code), iata: str(a.iata_code), name: str(a.name), lat: num(a.pos_lat) ?? 0, lon: num(a.pos_long) ?? 0,
    rwy: str(a.plan_rwy), elev: num(a.elevation), metar: str(a.metar) };
}

/** Transforme la réponse JSON SimBrief en structure compacte (gardée aussi en stockage local). */
export function parseOfp(j: J, user = ""): Ofp {
  if (!j || typeof j !== "object" || !j.origin || !j.navlog) throw new Error("Réponse SimBrief inattendue");
  const g = j.general || {}, f = j.fuel || {}, w = j.weights || {}, ac = j.aircraft || {}, p = j.params || {}, t = j.times || {};
  let cum = 0;
  const fixes: OfpFix[] = list<J>(j.navlog?.fix).map((x) => {
    const leg = num(x.distance) ?? 0;
    cum += leg;
    const wd = num(x.wind_dir), ws = num(x.wind_spd);
    return {
      ident: str(x.ident), name: str(x.name), type: str(x.type), lat: num(x.pos_lat) ?? 0, lon: num(x.pos_long) ?? 0,
      stage: str(x.stage), via: str(x.via_airway), sidstar: str(x.is_sid_star) === "1",
      leg, cum, trk: num(x.track_mag) ?? num(x.track_true), alt: num(x.altitude_feet),
      tas: num(x.true_airspeed), wind: wd != null && ws != null ? `${String(Math.round(wd) % 360).padStart(3, "0")}/${Math.round(ws)}` : "",
      oat: num(x.oat), ete: num(x.time_total), fuelRem: num(x.fuel_plan_onboard), freq: str(x.frequency),
    };
  }).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon) && !(x.lat === 0 && x.lon === 0));
  const callsign = str(g.icao_airline) + str(g.flight_number) || str(j.atc?.callsign);
  return {
    user, fetched: new Date().toISOString(), generated: str(p.time_generated), airac: str(p.airac), units: str(p.units) || "kgs",
    callsign, flight: str(g.flight_number), aircraft: str(ac.icaocode || ac.icao_code), acName: str(ac.name), reg: str(ac.reg),
    orig: apt(j.origin), dest: apt(j.destination), altn: list<J>(j.alternate).map(apt).filter((a) => a.icao),
    route: str(g.route), cruise: str(g.initial_altitude), ci: str(g.costindex),
    distance: num(g.route_distance), airDist: num(g.air_distance), ete: num(t.est_time_enroute),
    fuel: { ramp: num(f.plan_ramp), takeoff: num(f.plan_takeoff), landing: num(f.plan_landing), burn: num(f.enroute_burn),
      reserve: num(f.reserve), contingency: num(f.contingency), alternate: num(f.alternate_burn), extra: num(f.extra) },
    weights: { zfw: num(w.est_zfw), tow: num(w.est_tow), law: num(w.est_ldw), pax: num(w.pax_count) },
    fixes,
  };
}

export function ofpUrl(user: string): string {
  const u = user.trim();
  const key = /^\d+$/.test(u) ? "userid" : "username";
  return `https://www.simbrief.com/api/xml.fetcher.php?${key}=${encodeURIComponent(u)}&json=1`;
}

export async function fetchOfp(user: string): Promise<Ofp> {
  let r: Response;
  try {
    r = await fetch(ofpUrl(user), { cache: "no-store" });
  } catch {
    throw new Error("SimBrief injoignable depuis le navigateur (réseau ou blocage CORS).");
  }
  if (r.status === 400) throw new Error("Pseudo ou Pilot ID SimBrief inconnu, ou aucun plan de vol généré.");
  if (!r.ok) throw new Error(`SimBrief a répondu ${r.status}.`);
  return parseOfp(await r.json(), user.trim());
}

/** Durée en secondes -> « 2 h 05 » */
/** Vol de démonstration fictif LFML → LFPG (sans compte SimBrief). */
export async function demoOfp(): Promise<Ofp> {
  const r = await fetch(import.meta.env.BASE_URL + "demo/simbrief-demo.json");
  if (!r.ok) throw new Error(String(r.status));
  return parseOfp(await r.json(), "démo");
}

export const hhmm = (s: number | null): string => {
  if (s == null) return "";
  const m = Math.round(s / 60);
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
};
