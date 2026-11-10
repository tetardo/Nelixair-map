// Contrôles rapides du plan de vol : niveau semi-circulaire, relief / MORA, carburant réglementaire, nuit aéronautique.
// Aide à la préparation en simulation : règles simplifiées (OACI / EASA), pas un contrôle réglementaire.
import type { AspCrossing } from "../services/airspaceRoute";
import { CFG } from "../config";
import type { Ofp } from "../services/simbrief";
import { sunTimes } from "../services/sun";
import { elevationsFt } from "./elevation";
import type { LngLat } from "./format";
import { bearing } from "./geo";
import { magVar } from "./magvar";
import { inPolygon, routeVertices, samples } from "./routeGeom";

export type CheckStatus = "ok" | "warn" | "info";
export interface Check { id: string; title: string; status: CheckStatus; text: string; at?: number }

const n = (v: number) => Math.round(v).toLocaleString("fr-FR");
const flTxt = (ft: number) => (ft >= 18000 ? "FL" + Math.round(ft / 100) : n(ft) + " ft");
export const PISTON = /^(C1[5-8]\d|C20\d|C210|PA(18|28|32|34|44|46)|DR\d+|DR40|TB\d+|SR2[02]|DA(20|40|42|62)|BE(33|35|36|55|58)|M20P|M20T|P28[AB]|PC6|J3|RV\d+|CAP\d+|ROBN|R(22|44))$/i;

/** Niveau correct pour une route magnétique (OACI, IFR) : impair vers l'est (000–179°), pair vers l'ouest. */
function levelOk(ft: number, magTrk: number): boolean | null {
  const fl = Math.round(ft / 100);
  if (fl < 30 || fl % 10 !== 0) return null; // basse altitude ou niveau VFR : pas de règle IFR à vérifier
  const east = magTrk < 180;
  if (fl <= 400) return east ? (fl / 10) % 2 === 1 : (fl / 10) % 2 === 0;
  return east ? (fl - 410) % 40 === 0 : (fl - 430) % 40 === 0;
}
export function semicircular(o: Ofp): Check {
  const bad: string[] = [];
  let checked = 0, first = "";
  let prev: LngLat = [o.orig.lon, o.orig.lat], prevStage = "CLB";
  const crz = Number(o.cruise) || null;
  for (const f of o.fixes) {
    const ll: LngLat = [f.lon, f.lat];
    const trk = (bearing(prev, ll) - magVar(f.lat, f.lon) + 360) % 360;
    prev = ll;
    // tronçon en croisière : point en croisière, ou tronçon qui passe de la montée à la descente (TOC et TOD dessus)
    const across = prevStage === "CLB" && f.stage === "DSC";
    prevStage = f.stage;
    const lvl = f.stage === "CRZ" ? f.alt : across ? crz : null;
    if (lvl == null) continue;
    const ok = levelOk(lvl, trk);
    if (ok == null) continue;
    checked++;
    if (!first) first = `${flTxt(lvl)} au cap ${String(Math.round(trk)).padStart(3, "0")}°M`;
    if (!ok) bad.push(`${f.ident} : ${flTxt(lvl)} au cap ${String(Math.round(trk)).padStart(3, "0")}°M (${trk < 180 ? "impair" : "pair"} attendu)`);
  }
  if (!checked) return { id: "semi", title: "Niveau semi-circulaire", status: "info", text: "Pas de croisière IFR à vérifier (vol bas ou niveau VFR)." };
  return bad.length
    ? { id: "semi", title: "Niveau semi-circulaire", status: "warn", text: bad.slice(0, 3).join(" · ") + (bad.length > 3 ? ` · +${bad.length - 3}` : "") }
    : { id: "semi", title: "Niveau semi-circulaire", status: "ok", text: `${first} : conforme (impair vers l'est, pair vers l'ouest).` };
}

// Grille MORA (FAA, Amérique du Nord) : chargée une fois
let moraP: Promise<{ v: number; rings: number[][][]; bb: number[] }[]> | null = null;
function mora() {
  moraP = moraP || fetch(CFG.mora).then((r) => r.json()).then((j: GeoJSON.FeatureCollection) => j.features
    .filter((f) => f.geometry.type === "Polygon")
    .map((f) => {
      const rings = (f.geometry as GeoJSON.Polygon).coordinates, xs = rings[0].map((p) => p[0]), ys = rings[0].map((p) => p[1]);
      return { v: Number(f.properties?.mora) || 0, rings, bb: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
    })).catch(() => []);
  return moraP;
}
/** Altitude prévue contre la MORA (si la grille couvre la route), sinon contre le relief + 1 000 ft (2 000 ft en montagne). */
export async function terrainCheck(o: Ofp): Promise<Check> {
  const v = routeVertices(o), total = v.at(-1)?.d || 0;
  const pts = samples(v, 300).filter((p) => p.d > 15 && p.d < total - 15); // hors montée initiale et approche
  if (!pts.length) return { id: "terr", title: "Relief / MORA", status: "info", text: "Vol trop court pour vérifier l'en-route." };
  const cells = await mora();
  const withMora = pts.map((p) => {
    const c = cells.find((c) => p.ll[0] >= c.bb[0] && p.ll[0] <= c.bb[2] && p.ll[1] >= c.bb[1] && p.ll[1] <= c.bb[3] && inPolygon(p.ll, c.rings));
    return { ...p, mora: c?.v ?? null };
  });
  if (withMora.some((p) => p.mora != null)) {
    const low = withMora.filter((p) => p.mora != null && p.alt < p.mora);
    return low.length
      ? { id: "terr", title: "MORA", status: "warn", at: low[0].d, text: `Sous la MORA sur ${n(low.at(-1)!.d - low[0].d)} NM à partir de ${n(low[0].d)} NM (${flTxt(low[0].alt)} pour MORA ${n(low[0].mora!)} ft).` }
      : { id: "terr", title: "MORA", status: "ok", text: "Altitude prévue au-dessus de la Grid MORA sur toute la route." };
  }
  const total2 = total < 800 ? 9 : total < 2500 ? 8 : 7;
  const elev = await elevationsFt(pts.map((p) => p.ll), total2);
  let worst: { d: number; m: number; need: number } | null = null;
  pts.forEach((p, i) => {
    const e = elev[i];
    if (e == null) return;
    const need = e > 5000 ? 2000 : 1000; // marge OACI simplifiée : 2 000 ft en relief montagneux
    const m = p.alt - e - need;
    if (!worst || m < worst.m) worst = { d: p.d, m, need };
  });
  if (!worst) return { id: "terr", title: "Relief", status: "info", text: "Relief indisponible (tuiles d'altitude non chargées)." };
  const w = worst as { d: number; m: number; need: number };
  return w.m < 0
    ? { id: "terr", title: "Relief", status: "warn", at: w.d, text: `Marge sous ${n(w.need)} ft au-dessus du relief à ${n(w.d)} NM (manque ${n(-w.m)} ft). Pas de MORA publiée ici : relief indicatif.` }
    : { id: "terr", title: "Relief", status: "ok", text: `Au moins ${n(w.need)} ft au-dessus du relief sur toute la route (relief indicatif, pas de MORA publiée ici).` };
}

/** Réserve finale (30 min turbine, 45 min piston), carburant de route imprévu (≥ 5 % du délestage), dégagement. */
export function fuelCheck(o: Ofp): Check {
  const { burn, reserve, contingency, alternate } = o.fuel;
  const u = o.units === "lbs" ? "lb" : "kg";
  if (!burn || !o.ete || reserve == null) return { id: "fuel", title: "Carburant", status: "info", text: "Données carburant incomplètes dans le plan." };
  const perMin = burn / (o.ete / 60);
  const piston = PISTON.test(o.aircraft), needMin = piston ? 45 : 30;
  const resMin = reserve / perMin, contPct = contingency != null ? (contingency / burn) * 100 : null;
  const issues: string[] = [];
  if (resMin < needMin * 0.95) issues.push(`réserve finale ≈ ${Math.round(resMin)} min (mini ${needMin} min)`);
  if (contPct != null && contPct < 4.95 && !piston) issues.push(`imprévus ${contPct.toFixed(1).replace(".", ",")} % (mini 5 %)`);
  if (!o.altn.length && !piston) issues.push("pas de terrain de dégagement");
  const base = `Réserve ${n(reserve)} ${u} ≈ ${Math.round(resMin)} min`
    + (contPct != null ? ` · imprévus ${contPct.toFixed(1).replace(".", ",")} %` : "")
    + (o.altn.length ? ` · dégagement ${o.altn.map((a) => a.icao).join(" ")}${alternate ? ` (${n(alternate)} ${u})` : ""}` : "");
  return issues.length
    ? { id: "fuel", title: "Carburant réglementaire", status: "warn", text: issues.join(" · ") + "." }
    : { id: "fuel", title: "Carburant réglementaire", status: "ok", text: base + "." };
}

const hm = (d: Date) => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
/** Nuit aéronautique (EASA) : entre la fin et le début du crépuscule civil, au départ et à l'arrivée. */
export function nightCheck(o: Ofp): Check {
  const out = o.out ? new Date(o.out * 1000) : new Date();
  const arr = new Date(out.getTime() + ((o.ete ?? 0) + 15 * 60) * 1000); // + roulage
  const isNight = (lat: number, lon: number, t: Date) => {
    const s = sunTimes(lat, lon, t);
    if (s.dawn === "night" || s.dusk === "night") return true;
    if (s.dawn === "day" || s.dusk === "day") return false;
    return t < (s.dawn as Date) || t > (s.dusk as Date);
  };
  const dn = isNight(o.orig.lat, o.orig.lon, out), an = isNight(o.dest.lat, o.dest.lon, arr);
  const when = `départ ${hm(out)}, arrivée ≈ ${hm(arr)} (heure de Paris${o.out ? "" : ", départ supposé maintenant"})`;
  if (!dn && !an) return { id: "night", title: "Jour / nuit", status: "ok", text: `Vol de jour : ${when}.` };
  const s = sunTimes(o.dest.lat, o.dest.lon, arr);
  const dusk = s.dusk instanceof Date ? ` Fin du crépuscule à ${o.dest.icao} : ${hm(s.dusk)}.` : "";
  return { id: "night", title: "Jour / nuit", status: PISTON.test(o.aircraft) ? "warn" : "info",
    text: `${dn && an ? "Vol de nuit" : dn ? "Départ de nuit" : "Arrivée de nuit"} : ${when}.${dusk}${PISTON.test(o.aircraft) ? " Qualification vol de nuit nécessaire en VFR." : ""}` };
}

// Zones réglementées, dangereuses, interdites et zones à exigences (radio, transpondeur) que l'altitude prévue traverse
const ZONE_LABEL: Record<string, string> = { P: "interdite", R: "réglementée", D: "dangereuse", TRA: "TRA", TSA: "TSA", RMZ: "RMZ (radio obligatoire)", TMZ: "TMZ (transpondeur obligatoire)" };
export function zonesCheck(asp: AspCrossing[] | null): Check {
  const base = { id: "zones", title: "Zones R / D / P" };
  if (!asp) return { ...base, status: "info", text: "Recherche des espaces le long de la route…" };
  const hits = asp.filter((c) => c.inside && c.type in ZONE_LABEL);
  if (!hits.length) return { ...base, status: "ok", text: "Aucune zone interdite, réglementée ou dangereuse à l'altitude prévue (données OpenAIP, activations NOTAM non connues)." };
  const strong = hits.filter((c) => !["RMZ", "TMZ"].includes(c.type));
  const txt = hits.slice(0, 4).map((c) => `${c.name} (${ZONE_LABEL[c.type]}, ${Math.round(c.from)}–${Math.round(c.to)} NM)`).join(" · ")
    + (hits.length > 4 ? ` · +${hits.length - 4}` : "");
  return { ...base, status: strong.length ? "warn" : "info", at: (hits[0].from + hits[0].to) / 2,
    text: txt + (strong.length ? ". Vérifier l'activité (NOTAM, AZBA) ou contourner." : ".") };
}
