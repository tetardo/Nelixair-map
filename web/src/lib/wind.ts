// Composantes de vent par piste à partir du METAR (vent en degrés vrais) et du cap vrai de chaque QFU.
export interface RwyWind {
  qfu: string;
  hdg: number; // cap vrai utilisé
  approx: boolean; // cap déduit du numéro de piste (± 5° + déclinaison inconnue)
  head: number; // > 0 vent de face, < 0 vent arrière (kt)
  cross: number; // valeur absolue (kt)
  side: "G" | "D" | ""; // vent venant de la gauche / droite
  gustHead?: number;
  gustCross?: number;
}

const rad = (d: number) => (d * Math.PI) / 180;

/** Sépare « 09L/27R » en QFU. */
export function splitDesignator(des: string): string[] {
  return des.split("/").map((s) => s.trim().toUpperCase()).filter((s) => /^\d{1,2}[LCR]?$/.test(s));
}

/** Cap approché d'un QFU d'après son numéro (magnétique, ±5°). */
export const hdgFromQfu = (qfu: string): number => (parseInt(qfu, 10) % 36) * 10 || 360;

export function components(windDir: number, speed: number, hdg: number) {
  const a = rad(windDir - hdg);
  return { head: Math.round(speed * Math.cos(a)) || 0, cross: Math.round(speed * Math.sin(a)) || 0 };
}

/**
 * Composantes pour chaque QFU. `ends` = caps vrais connus (plan au sol OSM) ; sinon `rwys` = [désignation, cap, référence T/M].
 * Vent variable ou calme : pas de calcul (retourne []).
 */
export function runwayWinds(wdir: number | string | null | undefined, wspd: number | null | undefined, wgst: number | null | undefined,
  ends: Record<string, number> | null, rwys: [string, number | null, string][]): RwyWind[] {
  if (typeof wdir !== "number" || !wspd) return [];
  const list = new Map<string, { hdg: number; approx: boolean }>();
  if (ends) for (const [q, h] of Object.entries(ends)) list.set(q, { hdg: h, approx: false });
  for (const [des, hdg, ref] of rwys) {
    const qs = splitDesignator(des || "");
    qs.forEach((q, i) => {
      if (list.has(q)) return;
      // cap source donné pour la première extrémité ; vrai si référence T
      const known = hdg != null && ref === "T" ? (i === 0 ? hdg : (hdg + 180) % 360) : null;
      list.set(q, known != null ? { hdg: known, approx: false } : { hdg: hdgFromQfu(q), approx: true });
    });
  }
  const out: RwyWind[] = [];
  for (const [qfu, { hdg, approx }] of list) {
    const c = components(wdir, wspd, hdg);
    const r: RwyWind = { qfu, hdg, approx, head: c.head, cross: Math.abs(c.cross), side: c.cross > 0 ? "D" : c.cross < 0 ? "G" : "" };
    if (wgst) { const g = components(wdir, wgst, hdg); r.gustHead = g.head; r.gustCross = Math.abs(g.cross); }
    out.push(r);
  }
  return out.sort((a, b) => b.head - a.head || a.qfu.localeCompare(b.qfu));
}
