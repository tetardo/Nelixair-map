// Soleil : heures de lever / coucher / crépuscule civil et zone de nuit, calculées dans le navigateur.
// Algorithme NOAA simplifié (précision de l'ordre de la minute aux latitudes habituelles).
import type { FeatureCollection, Polygon } from "geojson";

const RAD = Math.PI / 180;
export type SunTime = Date | "day" | "night";

// Déclinaison (degrés) et équation du temps (minutes) pour une date UTC
function solar(date: Date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const doy = (date.getTime() - start) / 86400000;
  const g = (2 * Math.PI / 365) * (doy - 1 + (date.getUTCHours() - 12) / 24);
  const eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = (0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g)) / RAD;
  return { decl, eot };
}

// Heure UTC où le soleil passe à la distance zénithale `zenith`, ou "day" / "night" (pas de passage)
function crossing(lat: number, lon: number, day: Date, zenith: number, rising: boolean): SunTime {
  const noonGuess = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 12));
  const { decl, eot } = solar(noonGuess);
  const cosH = (Math.cos(zenith * RAD) - Math.sin(lat * RAD) * Math.sin(decl * RAD)) /
    (Math.cos(lat * RAD) * Math.cos(decl * RAD));
  if (cosH > 1) return "night";
  if (cosH < -1) return "day";
  const H = Math.acos(cosH) / RAD;
  const minutes = 720 - 4 * lon - eot + (rising ? -4 * H : 4 * H);
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) + minutes * 60000);
}

export function sunTimes(lat: number, lon: number, day = new Date()) {
  return {
    rise: crossing(lat, lon, day, 90.833, true),
    set: crossing(lat, lon, day, 90.833, false),
    dawn: crossing(lat, lon, day, 96, true),  // début du crépuscule civil du matin
    dusk: crossing(lat, lon, day, 96, false), // fin du crépuscule civil du soir
  };
}

/** Polygone de la zone de nuit (soleil sous l'horizon) pour la carte. */
export function nightPolygon(date = new Date()): FeatureCollection<Polygon> {
  const { decl, eot } = solar(date);
  const utcMin = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const subLon = (720 - utcMin - eot) / 4; // longitude du point subsolaire
  const d = Math.abs(decl) < 0.05 ? 0.05 * Math.sign(decl || 1) : decl;
  const ring: [number, number][] = [];
  for (let lon = -180; lon <= 180; lon += 2) {
    const lat = Math.atan(-Math.cos((lon - subLon) * RAD) / Math.tan(d * RAD)) / RAD;
    ring.push([lon, Math.max(-85, Math.min(85, lat))]);
  }
  const pole = d > 0 ? -85 : 85; // la nuit contient le pôle opposé au soleil
  ring.push([180, pole], [-180, pole], ring[0]);
  return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }] };
}

/** Hauteur du soleil (degrés) au-dessus de l'horizon en un point, à une date donnée. */
export function sunElevation(lat: number, lon: number, date = new Date()): number {
  const { decl, eot } = solar(date);
  const utcMin = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const ha = ((utcMin + eot + 4 * lon) / 4 - 180) * RAD;
  const s = Math.sin(lat * RAD) * Math.sin(decl * RAD) + Math.cos(lat * RAD) * Math.cos(decl * RAD) * Math.cos(ha);
  return Math.asin(Math.max(-1, Math.min(1, s))) / RAD;
}
