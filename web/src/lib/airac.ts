// Cycles AIRAC (OACI) : 28 jours, dates fixes calculables sans source externe.
// Référence : le cycle 2601 entre en vigueur le 22 janvier 2026.

const DAY = 86400000;
const REF = Date.UTC(2026, 0, 22); // AIRAC 2601
const PERIOD = 28 * DAY;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export interface Airac {
  ident: string; // "2612"
  start: Date;   // date d'entrée en vigueur (00:00 UTC)
  end: Date;     // veille du cycle suivant
}

/** Cycle en vigueur à la date donnée. */
export function airacAt(date = new Date()): Airac {
  const t = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const k = Math.floor((t - REF) / PERIOD);
  const start = new Date(REF + k * PERIOD);
  // numéro = rang du cycle dans l'année de sa date d'effet
  const y = start.getUTCFullYear();
  const firstOfYear = REF + Math.ceil((Date.UTC(y, 0, 1) - REF) / PERIOD) * PERIOD;
  const n = Math.round((start.getTime() - firstOfYear) / PERIOD) + 1;
  return { ident: `${String(y).slice(2)}${String(n).padStart(2, "0")}`, start, end: new Date(start.getTime() + PERIOD - DAY) };
}

export const fmtDate = (d: Date): string =>
  `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

/**
 * Page AD 2 d'un aérodrome français dans l'eAIP du SIA (Licence Ouverte), pour le cycle donné.
 * Format observé : media/dvd/eAIP_19_MAR_2026/FRANCE/AIRAC-2026-03-19/html/eAIP/FR-AD-2.LFML-fr-FR.html
 * Le SIA peut changer ce format : lien de consultation, sans garantie.
 */
export function siaAd2Url(icao: string, cyc: Airac = airacAt()): string {
  const d = cyc.start;
  const dd = String(d.getUTCDate()).padStart(2, "0"), mm = String(d.getUTCMonth() + 1).padStart(2, "0"), y = d.getUTCFullYear();
  return `https://www.sia.aviation-civile.gouv.fr/media/dvd/eAIP_${dd}_${MONTHS[d.getUTCMonth()]}_${y}/FRANCE/AIRAC-${y}-${mm}-${dd}` +
    `/html/eAIP/FR-AD-2.${icao}-fr-FR.html`;
}
