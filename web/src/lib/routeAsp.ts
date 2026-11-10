// Espaces traversés par le plan de vol courant : calculés une fois par plan, partagés par le profil et le panneau.
import { ref, watch } from "vue";
import { airspacesAlong, type AspCrossing } from "../services/airspaceRoute";
import { markRouteZones } from "../map/mapView";
import { state } from "../store";
import { routeVertices, samples } from "./routeGeom";

export const routeAsp = ref<AspCrossing[] | null>(null);
export const routeAspBusy = ref(false);
let started = false;

/** Lance (une fois) le suivi du plan de vol : recalcul à chaque nouveau plan. */
export function useRouteAsp() {
  if (started) return;
  started = true;
  watch(() => [state.ofp, state.mapReady] as const, async ([o, ready]) => {
    routeAsp.value = null;
    markRouteZones([]);
    if (!o || !ready) return;
    routeAspBusy.value = true;
    const v = routeVertices(o), total = v.at(-1)?.d || 0;
    const pts = samples(v, Math.min(600, Math.max(80, Math.round(total / 1.5)))); // un point tous les ~1,5 NM
    const r = await airspacesAlong(pts);
    if (state.ofp === o) {
      routeAsp.value = r; routeAspBusy.value = false;
      markRouteZones([...new Set(r.filter((c) => c.inside && ZONE_TYPES.has(c.type)).map((c) => c.name))]);
    }
  }, { immediate: true });
}

export const ASP_COLORS: Record<string, string> = { controlled: "#3d8bfd", special: "#e5484d", other: "#9aa4b2" };
export const fmtFt = (ft: number) => (ft >= 99999 ? "UNL" : ft >= 18000 ? "FL" + Math.round(ft / 100) : Math.round(ft).toLocaleString("fr-FR") + " ft");
/** Zones réglementées, dangereuses, interdites, temporaires : hachurées sur la carte et le profil. */
export const ZONE_TYPES = new Set(["P", "R", "D", "TRA", "TSA"]);
