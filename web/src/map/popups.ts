// Contenu HTML des popups MapLibre (panneau latéral fermé). Le panneau ouvert utilise les composants Vue.
import type { Props } from "../store";
import {
  APT_KIND, ASP_GROUP, CLS, HZ_COLORS, HZ_LBL, LVL, SEV_LBL, SRC, SURF, alt, dms, esc, freq, ft, pairs, zt, type LngLat,
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

/** Objet de la carte d'aéroport (poste, taxiway, piste…). */
export function groundHtml(p: Props): string {
  const KIND: Record<string, string> = { stand: "Poste de stationnement", gate: "Porte", taxiway: "Taxiway", taxilane: "Voie de desserte",
    runway: "Piste", holding: "Point d'attente", apron: "Aire de trafic", building: "Bâtiment", helipad: "Hélisurface" };
  return `<div class="pop"><h3>${esc(p.ref || p.name || "—")} <small>${esc(KIND[p.kind] || p.kind)}</small></h3>` +
    rows([["Aérodrome", p.apt], ["Longueur", p.len ? `${Number(p.len).toLocaleString("fr-FR")} m` : null],
      ["Largeur", p.kind === "runway" && p.width ? `${p.width} m` : null], ["Revêtement", p.surface]]) +
    `<div class="src">OpenStreetMap (ODbL) · non certifié</div></div>`;
}
