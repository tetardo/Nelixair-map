// Effets animés de la carte : halo sur l'élément survolé ou atteint, flux le long de la route,
// terrains IFR / LIFR qui « respirent », trafic en ligne qui avance entre deux mises à jour.
// Une seule boucle requestAnimationFrame, limitée à ~30 images/s, qui ne touche la carte que si
// quelque chose bouge. Tout s'arrête quand state.anim est faux (bouton « Animations » ou réglage
// « réduire les animations » du système).
import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import type { LngLat } from "../lib/format";
import { state } from "../store";
import { WX_COLORS } from "../services/weather";
import { tickTraffic } from "./trafficLayer";

let map: MlMap | null = null;
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const HALO = "#ffb020";

// Pointillés qui avancent : suite de motifs décalés (méthode classique MapLibre / Mapbox)
const DASH: number[][] = [[0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
  [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5]];

let halo: LngLat | null = null;
let haloUntil = 0;
let dashStep = 0, lastDash = 0, lastFrame = 0, lastTraffic = 0;
let flowShown = false, pulseShown = false;

export function initFx(m: MlMap) {
  map = m;
  m.addSource("fx-halo", { type: "geojson", data: EMPTY });
  m.addLayer({ id: "fx-halo-ring", type: "circle", source: "fx-halo",
    paint: { "circle-radius": 16, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": HALO, "circle-stroke-width": 2.5, "circle-stroke-opacity": 0.9 } });
  m.addLayer({ id: "fx-halo-core", type: "circle", source: "fx-halo",
    paint: { "circle-radius": 9, "circle-color": HALO, "circle-opacity": 0.22, "circle-stroke-color": HALO, "circle-stroke-width": 2 } });
  if (m.getLayer("ofp-line")) {
    m.addLayer({ id: "ofp-flow", type: "line", source: "ofp", filter: ["==", ["get", "t"], "leg"],
      layout: { "line-join": "round", visibility: "none" },
      paint: { "line-color": "#ffffff", "line-opacity": 0.9, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 1.1, 9, 2.2], "line-dasharray": DASH[0] } },
      m.getLayer("ofp-altn") ? "ofp-altn" : undefined);
  }
  if (m.getLayer("wx")) {
    m.addLayer({ id: "wx-pulse", type: "circle", source: "wx", minzoom: 5, filter: ["in", ["get", "cat"], ["literal", ["IFR", "LIFR"]]],
      layout: { visibility: "none" },
      paint: { "circle-radius": 8, "circle-color": "rgba(0,0,0,0)", "circle-stroke-width": 2,
        "circle-stroke-color": ["match", ["get", "cat"], "LIFR", WX_COLORS.LIFR, WX_COLORS.IFR], "circle-stroke-opacity": 0 } }, "wx");
  }
  requestAnimationFrame(frame);
}

/** Halo sur un point (survol d'une ligne du panneau). `hold` : s'efface seul après ce délai (ms). */
export function setHalo(ll: LngLat | null, hold = 0) {
  halo = ll;
  haloUntil = ll && hold ? performance.now() + hold : 0;
  (map?.getSource("fx-halo") as GeoJSONSource | undefined)?.setData(ll
    ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: ll } }] } : EMPTY);
  if (ll && !state.anim) { map?.setPaintProperty("fx-halo-ring", "circle-radius", 16); map?.setPaintProperty("fx-halo-ring", "circle-stroke-opacity", 0.9); }
}

/** Vol vers un point : courbe de zoom douce, puis halo bref à l'arrivée. Sans animations : saut direct. */
export function flyToFx(ll: LngLat, zoom: number) {
  if (!map) return;
  if (!state.anim) { map.jumpTo({ center: ll, zoom }); setHalo(ll, 2500); return; }
  map.flyTo({ center: ll, zoom, curve: 1.42, speed: 1.4, essential: true });
  map.once("moveend", () => setHalo(ll, 2600));
}

function vis(id: string, on: boolean) {
  if (map?.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
}

function frame(t: number) {
  requestAnimationFrame(frame);
  if (!map || t - lastFrame < 33) return; // ~30 images/s suffisent et ménagent la batterie
  lastFrame = t;
  const anim = state.anim;

  if (halo) {
    if (haloUntil && t > haloUntil) setHalo(null);
    else if (anim) {
      const ph = (t % 1400) / 1400;
      map.setPaintProperty("fx-halo-ring", "circle-radius", 10 + 22 * ph);
      map.setPaintProperty("fx-halo-ring", "circle-stroke-opacity", 0.9 * (1 - ph));
    }
  }

  const flow = anim && !!state.ofp;
  if (flow !== flowShown) { flowShown = flow; vis("ofp-flow", flow); }
  if (flow && t - lastDash > 70) {
    lastDash = t;
    dashStep = (dashStep + 1) % DASH.length;
    map.setPaintProperty("ofp-flow", "line-dasharray", DASH[dashStep]);
  }

  const pulse = anim && !!state.filters.wx && map.getZoom() >= 5;
  if (pulse !== pulseShown) { pulseShown = pulse; vis("wx-pulse", pulse); }
  if (pulse) {
    const ph = (t % 2400) / 2400, s = 1 + 0.9 * ph;
    map.setPaintProperty("wx-pulse", "circle-radius", ["interpolate", ["linear"], ["zoom"], 5, 6 * s, 10, 13 * s]);
    map.setPaintProperty("wx-pulse", "circle-stroke-opacity", 0.7 * (1 - ph));
  }

  if (anim && t - lastTraffic > 1000) { lastTraffic = t; tickTraffic(); }
}
