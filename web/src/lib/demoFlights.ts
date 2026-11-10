// « Mes vols » du pilote fictif : 20 vols de démonstration entre terrains qui ont une carte d'aéroport.
// Les plans sont construits dans le navigateur au format interne (Ofp) : route par de vrais VOR proches
// de la route directe (index de recherche), profil montée / croisière / descente, temps et carburant estimés.
// FICTIF : ce ne sont pas des routes ATC, ne pas utiliser pour la navigation.
import { loadIndex } from "../services/data";
import type { Ofp, OfpApt, OfpFix } from "../services/simbrief";
import type { LngLat } from "./format";
import { bearing, destination, distNm } from "./geo";

export const PILOT = { name: "Pilote démo Nelixair", id: "NLX-0001", base: "LFML" };

// Terrains : position, altitude (ft), nom court. Positions arrondies, suffisantes pour une démo.
const APT: Record<string, [number, number, number, string, string]> = {
  LFPG: [49.0097, 2.5479, 392, "CDG", "Paris-Charles de Gaulle"], LFPO: [48.7233, 2.3794, 291, "ORY", "Paris-Orly"],
  LFMN: [43.6584, 7.2159, 12, "NCE", "Nice-Côte d'Azur"], LFLL: [45.7256, 5.0811, 821, "LYS", "Lyon-Saint-Exupéry"],
  LFML: [43.4393, 5.2214, 74, "MRS", "Marseille-Provence"], LFBO: [43.6291, 1.3638, 499, "TLS", "Toulouse-Blagnac"],
  LFSB: [47.5896, 7.5299, 885, "BSL", "Bâle-Mulhouse"], LFBD: [44.8283, -0.7156, 162, "BOD", "Bordeaux-Mérignac"],
  LFRS: [47.1532, -1.6107, 90, "NTE", "Nantes-Atlantique"], LFQQ: [50.5633, 3.0869, 157, "LIL", "Lille-Lesquin"],
  LFKJ: [41.9236, 8.8029, 18, "AJA", "Ajaccio"], LFKB: [42.5527, 9.4837, 26, "BIA", "Bastia"],
  LFRB: [48.4479, -4.4185, 325, "BES", "Brest"], LFST: [48.5383, 7.6282, 505, "SXB", "Strasbourg"],
  LFBZ: [43.4684, -1.5231, 245, "BIQ", "Biarritz"], LFKF: [41.5006, 9.0978, 87, "FSC", "Figari"],
  LFMP: [42.7404, 2.8707, 144, "PGF", "Perpignan"], LFTH: [43.0973, 6.146, 7, "TLN", "Toulon-Hyères"],
  LFLS: [45.3629, 5.3294, 1302, "GNB", "Grenoble-Isère"], LFLJ: [45.3967, 6.6347, 6588, "CVF", "Courchevel"],
  LFHU: [45.0883, 6.0847, 6102, "", "L'Alpe d'Huez"], LFAT: [50.5174, 1.6206, 36, "LTQ", "Le Touquet"],
  LFEY: [46.7186, -2.3911, 79, "IDY", "Île d'Yeu"],
};

// Appareils : vitesse vraie (kt), plafond de croisière (ft), consommation (kg/h), NM par 1000 ft en montée / descente
const AC: Record<string, { name: string; tas: number; ceil: number; burn: number; nm: number; pax: number }> = {
  A319: { name: "A319-100", tas: 447, ceil: 37000, burn: 2300, nm: 3, pax: 130 },
  A320: { name: "A320-200", tas: 450, ceil: 37000, burn: 2450, nm: 3, pax: 168 },
  A321: { name: "A321neo", tas: 452, ceil: 36000, burn: 2600, nm: 3, pax: 200 },
  E190: { name: "Embraer 190", tas: 440, ceil: 35000, burn: 1900, nm: 3, pax: 100 },
  AT76: { name: "ATR 72-600", tas: 275, ceil: 23000, burn: 650, nm: 3, pax: 70 },
  PC12: { name: "Pilatus PC-12", tas: 270, ceil: 25000, burn: 200, nm: 2.5, pax: 6 },
  TB20: { name: "Socata TB20", tas: 150, ceil: 9500, burn: 45, nm: 2, pax: 3 },
  DR40: { name: "Robin DR400", tas: 115, ceil: 10500, burn: 30, nm: 2, pax: 3 },
};

// orig, dest, type, immatriculation, date (AAAA-MM-JJ), heure de départ UTC
const LOG: [string, string, string, string, string, string][] = [
  ["LFML", "LFPG", "A320", "F-NLXA", "2026-11-09", "06:40"],
  ["LFPG", "LFMN", "A320", "F-NLXA", "2026-11-08", "09:15"],
  ["LFMN", "LFKJ", "A320", "F-NLXA", "2026-11-08", "06:50"],
  ["LFKJ", "LFPO", "A320", "F-NLXB", "2026-11-06", "16:20"],
  ["LFPO", "LFBO", "A321", "F-NLXN", "2026-11-05", "07:05"],
  ["LFBO", "LFRB", "AT76", "F-NLXT", "2026-11-03", "10:30"],
  ["LFRB", "LFRS", "AT76", "F-NLXT", "2026-11-03", "06:45"],
  ["LFRS", "LFLL", "E190", "F-NLXE", "2026-11-01", "14:10"],
  ["LFLL", "LFLJ", "PC12", "F-NLXP", "2026-10-30", "09:00"],
  ["LFLS", "LFHU", "DR40", "F-NLXR", "2026-10-28", "08:30"],
  ["LFPG", "LFST", "E190", "F-NLXE", "2026-10-26", "17:40"],
  ["LFST", "LFBD", "A319", "F-NLXC", "2026-10-24", "11:25"],
  ["LFBD", "LFKB", "A320", "F-NLXA", "2026-10-22", "08:05"],
  ["LFKB", "LFML", "AT76", "F-NLXT", "2026-10-20", "15:50"],
  ["LFML", "LFQQ", "A320", "F-NLXB", "2026-10-18", "07:35"],
  ["LFQQ", "LFBZ", "A320", "F-NLXB", "2026-10-16", "12:20"],
  ["LFBZ", "LFPO", "A320", "F-NLXA", "2026-10-14", "18:05"],
  ["LFAT", "LFEY", "TB20", "F-NLXS", "2026-10-11", "09:45"],
  ["LFSB", "LFKF", "A319", "F-NLXC", "2026-10-08", "06:30"],
  ["LFTH", "LFPO", "A320", "F-NLXB", "2026-10-05", "13:15"],
];

export interface LogEntry { id: number; orig: string; dest: string; origName: string; destName: string; ac: string; acName: string;
  reg: string; date: string; dep: string; nm: number; ete: number; line: LngLat[] }

const VOR = new Set(["vor", "vordme", "vortac"]);
const ll = (icao: string): LngLat => [APT[icao][1], APT[icao][0]];
const flightNo = (i: number) => String(101 + i * 2);

/** Liste des vols (sans l'itinéraire détaillé, calculé à l'ouverture). */
export function logbook(): LogEntry[] {
  return LOG.map(([o, d, ac, reg, date, dep], id) => {
    const nm = Math.round(distNm(ll(o), ll(d)) * 1.02);
    return { id, orig: o, dest: d, origName: APT[o][4], destName: APT[d][4], ac, acName: AC[ac].name, reg, date, dep, nm,
      ete: Math.round(((nm / AC[ac].tas) * 3600 + 900) / 60) * 60, line: [ll(o), ll(d)] };
  });
}

/** VOR proches de la route directe (un tous les ~70 NM, à 25 NM au plus), dans l'ordre du vol. */
async function viaVors(a: LngLat, b: LngLat): Promise<{ ident: string; name: string; ll: LngLat }[]> {
  const idx = await loadIndex();
  if (!idx) return [];
  const total = distNm(a, b), brg = bearing(a, b);
  if (total < 60) return [];
  const vors = idx.fixes.filter((r) => VOR.has(r[1]));
  const out: { ident: string; name: string; ll: LngLat }[] = [];
  const n = Math.max(1, Math.round(total / 70) - 1);
  for (let k = 1; k <= n; k++) {
    const p = destination(a, brg, (total * k) / (n + 1));
    let best: (typeof vors)[number] | null = null, bd = 25;
    for (const r of vors) {
      if (Math.abs(r[3] - p[1]) > 0.5 || Math.abs(r[2] - p[0]) > 0.8) continue;
      const dd = distNm(p, [r[2], r[3]]);
      if (dd < bd) { bd = dd; best = r; }
    }
    if (best && !out.some((x) => x.ident === best![0]) && distNm(a, [best[2], best[3]]) > 20 && distNm(b, [best[2], best[3]]) > 20) {
      out.push({ ident: best[0], name: String(best[4] || best[0]), ll: [best[2], best[3]] });
    }
  }
  return out;
}

function apt(icao: string): OfpApt {
  const [lat, lon, elev, iata, name] = APT[icao];
  return { icao, iata, name: name.toUpperCase(), lat, lon, rwy: "", elev, metar: "" };
}

/** Plan de vol complet d'un vol du carnet (format interne Ofp, comme un import SimBrief). */
export async function demoFlight(id: number): Promise<Ofp> {
  const e = logbook()[id];
  const A = AC[e.ac], O = APT[e.orig], D = APT[e.dest];
  const pts = [{ ident: e.orig, name: "", ll: ll(e.orig) }, ...(await viaVors(ll(e.orig), ll(e.dest))), { ident: e.dest, name: "", ll: ll(e.dest) }];
  const cumAt: number[] = [0];
  for (let i = 1; i < pts.length; i++) cumAt.push(cumAt[i - 1] + distNm(pts[i - 1].ll, pts[i].ll));
  const total = cumAt.at(-1)!;
  // croisière : plafond de l'appareil, réduite si la montée et la descente ne tiennent pas dans 85 % du trajet
  let crz = A.ceil;
  const span = (ft: number) => ((ft - O[2]) / 1000) * A.nm + ((ft - D[2]) / 1000) * A.nm;
  while (crz > Math.max(O[2], D[2]) + 2000 && span(crz) > total * 0.85) crz -= 1000;
  crz = Math.max(crz, Math.ceil((Math.max(O[2], D[2]) + 1500) / 500) * 500);
  const toc = Math.min(total * 0.45, ((crz - O[2]) / 1000) * A.nm), tod = Math.max(total * 0.55, total - ((crz - D[2]) / 1000) * A.nm);
  const altAt = (d: number) => (d <= toc ? O[2] + ((crz - O[2]) * d) / toc : d >= tod ? D[2] + ((crz - D[2]) * (total - d)) / (total - tod) : crz);
  const posAt = (d: number): LngLat => {
    let i = 1;
    while (i < pts.length - 1 && cumAt[i] < d) i++;
    const t = (d - cumAt[i - 1]) / (cumAt[i] - cumAt[i - 1] || 1);
    return destination(pts[i - 1].ll, bearing(pts[i - 1].ll, pts[i].ll), t * (cumAt[i] - cumAt[i - 1]));
  };
  type P = { ident: string; name: string; ll: LngLat; d: number; type: string };
  const seq: P[] = [
    ...pts.slice(1).map((p, i) => ({ ...p, d: cumAt[i + 1], type: i === pts.length - 2 ? "apt" : "vor" })),
    { ident: "TOC", name: "TOP OF CLIMB", ll: posAt(toc), d: toc, type: "ltlg" },
    { ident: "TOD", name: "TOP OF DESCENT", ll: posAt(tod), d: tod, type: "ltlg" },
  ].sort((a, b) => a.d - b.d);
  const burnRate = A.burn / 3600, taxi = A.burn * 0.08, reserve = A.burn * 0.5, contingency = Math.max(50, A.burn * 0.05);
  const block = Math.round(taxi + reserve + contingency + (total / A.tas) * A.burn * 1.08);
  let prev: LngLat = ll(e.orig), prevD = 0;
  const fixes: OfpFix[] = seq.map((p) => {
    const leg = p.d - prevD, trk = Math.round(bearing(prev, p.ll));
    prev = p.ll; prevD = p.d;
    const ete = Math.round((p.d / A.tas) * 3600 + 900 * (p.d / total)); // + 15 min de montée, descente et approche
    const stage = p.d <= toc + 0.01 ? "CLB" : p.d < tod - 0.01 ? "CRZ" : "DSC";
    return { ident: p.ident, name: p.name, type: p.type, lat: p.ll[1], lon: p.ll[0], stage, via: "DCT", sidstar: false,
      leg: Math.round(leg), cum: Math.round(p.d), trk: trk === 0 ? 360 : trk, alt: Math.round(altAt(p.d) / 100) * 100,
      tas: Math.round(stage === "CRZ" ? A.tas : A.tas * 0.8), wind: "", oat: Math.round(15 - (altAt(p.d) / 1000) * 2),
      ete, fuelRem: Math.round(block - taxi - ete * burnRate), freq: "" };
  });
  const burn = Math.round((total / A.tas) * A.burn * 1.08);
  const ete = fixes.at(-1)?.ete ?? null;
  return {
    user: `démo:${id}`, fetched: new Date().toISOString(), generated: String(Math.floor(Date.parse(`${e.date}T${e.dep}:00Z`) / 1000) - 3600),
    airac: "", units: "kgs", callsign: `NLX${flightNo(id)}`, flight: flightNo(id), aircraft: e.ac, acName: A.name, reg: e.reg,
    orig: apt(e.orig), dest: apt(e.dest), altn: [],
    route: pts.slice(1, -1).map((p) => p.ident).join(" DCT ") || "DCT", cruise: String(crz), ci: A.tas > 400 ? "30" : "",
    distance: Math.round(total), airDist: Math.round(total), ete,
    fuel: { ramp: block, takeoff: Math.round(block - taxi), landing: Math.round(block - taxi - burn), burn,
      reserve: Math.round(reserve), contingency: Math.round(contingency), alternate: null, extra: null },
    weights: { zfw: null, tow: null, law: null, pax: A.pax },
    fixes,
  };
}
