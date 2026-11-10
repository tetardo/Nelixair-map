// Trafic en ligne des réseaux de simulation VATSIM et IVAO (flux publics, sans clé).
// VATSIM : https://data.vatsim.net/v3/vatsim-data.json (mis à jour toutes les 15 s)
// IVAO   : https://api.ivao.aero/v2/tracker/whazzup (toutes les 15 s environ)
// Les noms des membres ne sont ni affichés ni conservés : indicatif, appareil et plan de vol seulement.

export type Net = "vatsim" | "ivao";
export interface Pilot {
  net: Net; callsign: string; lat: number; lon: number; alt: number; gs: number; hdg: number; ground: boolean;
  ac: string; dep: string; arr: string; altn: string; route: string; rules: string; cruise: string; squawk: string;
}
/** Poste de contrôle : type DEL GND TWR APP CTR FSS, rattaché à un terrain ou une région (préfixe de l'indicatif). */
export interface Atc { net: Net; callsign: string; freq: string; kind: string; where: string; atis: string }
export interface Traffic { pilots: Pilot[]; atc: Atc[]; updated: string }

const VATSIM = "https://data.vatsim.net/v3/vatsim-data.json";
const IVAO = "https://api.ivao.aero/v2/tracker/whazzup";
const FACILITY: Record<number, string> = { 1: "FSS", 2: "DEL", 3: "GND", 4: "TWR", 5: "APP", 6: "CTR" };

type J = Record<string, any>;
const s = (v: unknown) => (v == null ? "" : String(v).trim());
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Type de poste d'après le suffixe de l'indicatif (LFPG_TWR, LFFF_E_CTR…). */
function kindOf(callsign: string): string {
  const suf = callsign.split("_").at(-1) || "";
  return ["DEL", "GND", "TWR", "APP", "DEP", "CTR", "FSS", "ATIS"].includes(suf) ? (suf === "DEP" ? "APP" : suf) : "";
}

async function vatsim(): Promise<Traffic> {
  const r = await fetch(VATSIM, { cache: "no-store" });
  if (!r.ok) throw new Error("VATSIM " + r.status);
  const j: J = await r.json();
  const pilots: Pilot[] = (j.pilots || []).map((p: J) => {
    const fp: J = p.flight_plan || {};
    return {
      net: "vatsim", callsign: s(p.callsign), lat: n(p.latitude), lon: n(p.longitude), alt: n(p.altitude), gs: n(p.groundspeed),
      hdg: n(p.heading), ground: n(p.groundspeed) < 40, ac: s(fp.aircraft_short || fp.aircraft), dep: s(fp.departure), arr: s(fp.arrival),
      altn: s(fp.alternate), route: s(fp.route), rules: s(fp.flight_rules), cruise: s(fp.altitude), squawk: s(p.transponder),
    };
  });
  const atc: Atc[] = (j.controllers || []).filter((c: J) => c.facility > 0).map((c: J) => {
    const cs = s(c.callsign);
    return { net: "vatsim", callsign: cs, freq: s(c.frequency), kind: FACILITY[c.facility] || kindOf(cs), where: cs.split("_")[0], atis: "" };
  });
  // terrains avec seulement un ATIS en ligne
  for (const a of j.atis || []) {
    const cs = s(a.callsign);
    atc.push({ net: "vatsim", callsign: cs, freq: s(a.frequency), kind: "ATIS", where: cs.split("_")[0], atis: (a.text_atis || []).join(" ") });
  }
  return { pilots, atc, updated: s(j.general?.update_timestamp) };
}

async function ivao(): Promise<Traffic> {
  const r = await fetch(IVAO, { cache: "no-store" });
  if (!r.ok) throw new Error("IVAO " + r.status);
  const j: J = await r.json();
  const c: J = j.clients || {};
  const pilots: Pilot[] = (c.pilots || []).filter((p: J) => p.lastTrack).map((p: J) => {
    const t: J = p.lastTrack, fp: J = p.flightPlan || {};
    return {
      net: "ivao", callsign: s(p.callsign), lat: n(t.latitude), lon: n(t.longitude), alt: n(t.altitude), gs: n(t.groundSpeed),
      hdg: n(t.heading), ground: !!t.onGround, ac: s(fp.aircraftId || fp.aircraft?.icaoCode), dep: s(fp.departureId), arr: s(fp.arrivalId),
      altn: s(fp.alternativeId), route: s(fp.route), rules: s(fp.flightRules), cruise: s(fp.level), squawk: s(t.transponder),
    };
  });
  const atc: Atc[] = (c.atcs || []).map((a: J) => {
    const cs = s(a.callsign);
    return { net: "ivao", callsign: cs, freq: s(a.atcSession?.frequency), kind: kindOf(cs) || s(a.atcSession?.position), where: cs.split("_")[0],
      atis: Array.isArray(a.atis?.lines) ? a.atis.lines.join(" ") : "" };
  });
  return { pilots, atc, updated: s(j.updatedAt) };
}

export function fetchTraffic(net: Net): Promise<Traffic> {
  return net === "vatsim" ? vatsim() : ivao();
}
