// Déclinaison magnétique (modèle mondial WMM de la NOAA, via le paquet geomagnetism).
// Valeur > 0 = Est. Route magnétique = route vraie − déclinaison.
import * as geomagnetism from "geomagnetism";

let model: ReturnType<typeof geomagnetism.model> | null = null;
export function magVar(lat: number, lon: number): number {
  model ??= geomagnetism.model(new Date());
  return model.point([lat, lon]).decl;
}
export const deg3 = (v: number): string => String(Math.round(((v % 360) + 360) % 360) || 360).padStart(3, "0");
