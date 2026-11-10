// Contenu HTML des popups MapLibre (panneau latéral fermé). Le panneau ouvert utilise les composants Vue.
import type { Props } from "../store";
import { runwayWinds, splitDesignator } from "../lib/wind";
import { wind, type Metar } from "../services/weather";
import {
  APT_KIND, ASP_GROUP, CLS, HZ_COLORS, HZ_LBL, LVL, SEV_LBL, SRC, SURF, alt, ddm, dms, esc, freq, ft, pairs, zt, type LngLat,
} from "../lib/format";

function rows(list: [string, unknown][]): string {
  return "<dl>" + pairs(list).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("") + "</dl>";
}

function aptRows(p: Props, ll: LngLat): string {
  return rows([["Nom", p.name], ["IATA", p.iata], ["Type", (APT_KIND[p.kind] || "") + (p.mil === true || p.mil === "true" ? " · militaire" : "")],
    ["Altitude", ft(p.elev_ft)], ["Piste la + longue", p.rwy_ft ? `${ft(p.rwy_ft)}${p.rwy_surface ? " · " + SURF[p.rwy_surface] : ""}` : null],
    ["IFR", p.ifr === true || p.ifr === "true" ? "Oui" : null],
    ["Latitude", dms(ll[1], true)], ["Longitude", dms(ll[0], false)], ["Pays", p.country || p.region]]);
}

export function aspHtml(p: Props): string {
  return `<div class="pop"><h3>${esc(p.name)} <small>${esc(p.type)}</small></h3>` +
    rows([["Classe", p.icao_class], ["Plancher", p.lower], ["Plafond", p.upper], ["Catégorie", ASP_GROUP[p.group]], ["Pays", p.country]]) + "</div>";
}

export function fixHtml(p: Props, ll: LngLat): string {
  if (p.cls === "airport")
    return `<div class="pop"><h3>${esc(p.ident)} <small>${esc(APT_KIND[p.kind] || "Aéroport")}</small></h3>` + aptRows(p, ll) +
      (p.src ? `<div class="src">${esc(SRC[p.src] || p.src)}</div>` : "") + "</div>";
  return `<div class="pop"><h3>${esc(p.ident)} <small>${esc(CLS[p.cls] || p.cls)}</small></h3>` +
    rows([["Nom", p.name && p.name !== p.ident ? p.name : null], ["Fréquence", freq(p)], ["Canal", p.channel],
      ["Lat", dms(ll[1], true)], ["Lon", dms(ll[0], false)], ["Région", p.region || p.country]]) +
    (p.src ? `<div class="src">${esc(SRC[p.src] || p.src)}${p.cycle ? " · cycle " + esc(p.cycle) : ""}</div>` : "") + "</div>";
}

export function legHtml(p: Props): string {
  const dir = p.dir === "F" ? `sens unique ${p.from} → ${p.to}` : p.dir === "B" ? `sens unique ${p.to} → ${p.from}` : null;
  return `<div class="pop"><h3>${esc(p.ident)} <small>${p.level === "H" ? "Haute" : p.level === "L" ? "Basse" : "H+B"}</small></h3>` +
    rows([["Tronçon", `${p.from} → ${p.to}`], ["Distance", `${p.dist_nm} NM`], ["Route vraie", `${String(p.trk_true).padStart(3, "0")}°`],
      ["MEA", p.mea ? alt(p.mea) : null], ["Alt. maxi", p.max_alt ? alt(p.max_alt) : null], ["Sens", dir], ["Niveau", LVL[p.level]]]) +
    `<div class="src">${esc(SRC[p.src] || p.src)}</div></div>`;
}

export function hazardHtml(p: Props): string {
  const lvl = p.base != null || p.top != null ? `${p.base != null ? alt(p.base) : "SFC"} → ${p.top != null ? alt(p.top) : "?"}` : null;
  return `<div class="pop"><h3>${esc(p.kind)} <small style="background:${HZ_COLORS[p.fam] || HZ_COLORS.other}">${esc(HZ_LBL[p.fam] || p.hazard)}</small></h3>` +
    rows([["Danger", p.hazard], ["Intensité", p.sev && p.sev !== "NONE" ? p.sev : null], ["Niveaux", lvl],
      ["Validité", p.from || p.to ? `${zt(p.from)} → ${zt(p.to)}` : null], ["FIR", p.fir]]) +
    (p.raw ? `<div class="wx-raw">${esc(p.raw)}</div>` : "") + "</div>";
}

export function pirepHtml(p: Props): string {
  return `<div class="pop"><h3>${esc(p.type || "PIREP")} <small>${p.alt != null ? esc(alt(p.alt)) : "PIREP"}</small></h3>` +
    rows([["Turbulence", p.tb ? `${p.tb} (${SEV_LBL[p.tb] || ""})` : null], ["Givrage", p.ic ? `${p.ic} (${SEV_LBL[p.ic] || ""})` : null],
      ["Avion", p.ac], ["Heure", zt(p.t)]]) +
    (p.raw ? `<div class="wx-raw">${esc(p.raw)}</div>` : "") + "</div>";
}

/** Contexte d'un objet au sol : caps vrais des QFU (plan OSM) et METAR de l'aérodrome. */
export interface GndCtx { ends?: Record<string, number>; m?: Metar | null }

const GKIND: Record<string, string> = { stand: "Poste de stationnement", gate: "Porte", taxiway: "Taxiway", taxilane: "Voie de desserte",
  runway: "Piste", holding: "Point d'attente", apron: "Aire de trafic", building: "Bâtiment", helipad: "Hélisurface" };
const GKIND_SHORT: Record<string, string> = { stand: "Poste", gate: "Porte", taxiway: "Taxiway", taxilane: "Desserte",
  runway: "Piste", holding: "Point d'attente", building: "Bâtiment" };

/** Composantes de vent des QFU d'une piste, meilleure en premier. */
function rwyWinds(p: Props, ctx?: GndCtx) {
  const m = ctx?.m;
  if (p.kind !== "runway" || !m) return [];
  const qs = splitDesignator(p.ref || "");
  const ends = Object.fromEntries(Object.entries(ctx?.ends || {}).filter(([q]) => qs.includes(q)));
  return runwayWinds(m.wdir, m.wspd, m.wgst, ends, [[p.ref || "", null, ""]]).filter((w) => qs.includes(w.qfu));
}
const sideTxt = (w: { cross: number; side: string }) => `${w.cross}${w.side ? " " + w.side : ""}`;
const headTxt = (h: number) => (h >= 0 ? `face ${h}` : `arrière ${-h}`);
const dim = (p: Props) => (p.len ? `${Number(p.len).toLocaleString("fr-FR")}${p.width ? " × " + p.width : ""} m` : null);

/** Bulle de survol, deux lignes max : nom + nature, puis l'info utile au pilote. */
export function groundTip(p: Props, pt?: LngLat, ctx?: GndCtx): string {
  const head = `<b>${esc(p.ref || p.name || "")}</b>${esc(GKIND_SHORT[p.kind] || "")} <span class="tip-apt">${esc(p.apt || "")}</span>`;
  let sub = "";
  if (p.kind === "runway") {
    const w = rwyWinds(p, ctx);
    sub = [dim(p), w[0] ? `${w[0].qfu} ${headTxt(w[0].head)} / trav. ${sideTxt(w[0])} kt` : null].filter(Boolean).join(" · ");
  } else if ((p.kind === "stand" || p.kind === "gate") && pt) sub = `${ddm(pt[1], true)} ${ddm(pt[0], false)}`;
  else if (p.kind === "holding") sub = "Ne pas franchir sans clairance";
  return head + (sub ? `<div class="tip-sub">${esc(sub)}</div>` : "");
}

const copyBtn = (v: string) => `<button class="pop-copy" data-copy="${esc(v)}" title="Copier">⧉</button>`;

/** Objet de la carte d'aéroport (poste, taxiway, piste…). */
export function groundHtml(p: Props, pt?: LngLat, ctx?: GndCtx): string {
  const pos = pt && (p.kind === "stand" || p.kind === "gate") ? `${ddm(pt[1], true)} ${ddm(pt[0], false)}` : null;
  const w = rwyWinds(p, ctx);
  const wx = w.length && ctx?.m ? `<table class="pop-wind"><thead><tr><th>QFU</th><th>Face</th><th>Travers</th></tr></thead><tbody>` +
    w.map((r, i) => `<tr${i === 0 && r.head > 0 ? ' class="best"' : ""}><td>${esc(r.qfu)}${r.approx ? "~" : ""}</td>` +
      `<td class="${r.head < 0 ? "neg" : ""}">${r.head}${r.gustHead != null ? `<small>/${r.gustHead}</small>` : ""}</td>` +
      `<td>${r.cross}${r.side ? " " + r.side : ""}${r.gustCross != null ? `<small>/${r.gustCross}</small>` : ""}</td></tr>`).join("") +
    `</tbody></table><div class="src">Vent ${esc(wind(ctx.m) || "")} · composantes en kt (rafales après /)</div>` : "";
  return `<div class="pop"><h3>${esc(p.ref || p.name || "—")} <small>${esc(GKIND[p.kind] || p.kind)}</small></h3>` +
    rows([["Aérodrome", p.apt], ["Dimensions", p.kind === "runway" ? dim(p) : null],
      ["Longueur", p.kind !== "runway" && p.len ? `${Number(p.len).toLocaleString("fr-FR")} m` : null], ["Revêtement", p.surface]]) +
    (pos ? `<div class="pop-pos"><span>${esc(pos)}</span>${copyBtn(pos)}</div>` : "") +
    (p.kind === "holding" ? `<div class="pop-note">Point d'attente : arrêt obligatoire sauf clairance d'entrer ou de traverser.</div>` : "") +
    wx + `<div class="src">OpenStreetMap (ODbL) · non certifié</div></div>`;
}
