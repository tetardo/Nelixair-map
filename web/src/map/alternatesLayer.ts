// Dégagements le long de la route : un cercle par terrain (couleur = catégorie météo), le survolé plus gros.
import type * as maplibregl from "maplibre-gl";
import type { Map as MlMap } from "maplibre-gl";
import type { LngLat } from "../lib/format";
import { WX_COLORS } from "../services/weather";

let map: MlMap;
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export function initAlternates(m: MlMap) {
  map = m;
  map.addSource("alt-apt", { type: "geojson", data: EMPTY });
  const color: any = ["match", ["get", "cat"], "VFR", WX_COLORS.VFR, "MVFR", WX_COLORS.MVFR, "IFR", WX_COLORS.IFR, "LIFR", WX_COLORS.LIFR, "#8cbcff"];
  map.addLayer({ id: "alt-apt", type: "circle", source: "alt-apt",
    paint: { "circle-radius": ["case", ["get", "hot"], 18, 11], "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": color, "circle-stroke-width": ["case", ["get", "hot"], 3.5, 2], "circle-stroke-opacity": 0.95 } });
  map.addLayer({ id: "alt-apt-lbl", type: "symbol", source: "alt-apt", minzoom: 5,
    layout: { "text-field": ["get", "ident"], "text-font": ["Noto Sans Bold"], "text-size": 11, "text-offset": [0, 1.6], "text-anchor": "top" },
    paint: { "text-color": color, "text-halo-color": "rgba(0,0,0,.7)", "text-halo-width": 1.5 } });
}

export function setAlternates(list: { ident: string; ll: LngLat; cat: string | null }[], hot: string | null = null) {
  (map?.getSource("alt-apt") as maplibregl.GeoJSONSource | undefined)?.setData({ type: "FeatureCollection",
    features: list.map((a) => ({ type: "Feature", properties: { ident: a.ident, cat: a.cat || "", hot: a.ident === hot }, geometry: { type: "Point", coordinates: a.ll } })) });
}
