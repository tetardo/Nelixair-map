// Tracés d'approche et de piste calculés dans le navigateur à partir de l'eAIP SIA (seuils, caps vrais, ILS, distances).
// Axe prolongé gradué, plume ILS, seuil décalé, départs d'intersection, cercles 5 / 10 NM autour du terrain.
import type { Map as MlMap } from "maplibre-gl";
import { destination } from "../lib/geo";
import type { LngLat } from "../lib/format";
import type { EaipApt } from "../store";
import type { Theme } from "./themes";

type F = GeoJSON.Feature;
const line = (c: LngLat[], p: Record<string, unknown>): F => ({ type: "Feature", properties: p, geometry: { type: "LineString", coordinates: c } });
const pt = (c: LngLat, p: Record<string, unknown>): F => ({ type: "Feature", properties: p, geometry: { type: "Point", coordinates: c } });
const deg = (v: number) => String(Math.round(((v % 360) + 360) % 360) || 360).padStart(3, "0") + "°";

const CL_NM = 10; // longueur de l'axe prolongé
const ILS_HALF = 2; // demi-ouverture de la plume (°), dessin seulement

export function aptDrawData(eaip: Record<string, EaipApt>): GeoJSON.FeatureCollection {
  const fs: F[] = [];
  for (const [icao, a] of Object.entries(eaip)) {
    if (a.arp) for (const nm of [5, 10]) {
      const ring: LngLat[] = [];
      for (let b = 0; b <= 360; b += 5) ring.push(destination(a.arp, b, nm));
      fs.push(line(ring, { t: "ring", apt: icao, lbl: `${nm} NM` }));
    }
    for (const [q, r] of Object.entries(a.rwys)) {
      if (!r.thr || r.true == null) continue;
      const back = (r.true + 180) % 360;
      const mag = r.mag != null ? deg(r.mag) : deg(r.true - (a.magvar || 0));
      // Axe prolongé gradué tous les NM, côté approche
      fs.push(line([r.thr, destination(r.thr, back, CL_NM)], { t: "cl", apt: icao, qfu: q }));
      for (let n = 1; n <= CL_NM; n++) {
        const c = destination(r.thr, back, n), w = n % 5 === 0 ? 0.18 : 0.09;
        fs.push(line([destination(c, back + 90, w), destination(c, back - 90, w)], { t: "tick", apt: icao }));
      }
      const ils = r.ils?.freq ? r.ils : null;
      fs.push(pt(destination(r.thr, back, ils ? 7.5 : 5.5), { t: "cl-lbl", apt: icao, rot: r.true - 90,
        lbl: ils ? `ILS ${q} ${ils.id || ""} ${ils.freq!.toFixed(2)} · ${mag}${ils.gs ? " · " + ils.gs + "°" : ""}` : `${q} · ${mag}` }));
      // Plume ILS (deux moitiés, une pleine, une vide, à la manière des cartes d'approche)
      if (ils) {
        const far = (d: number) => destination(r.thr!, back + d, CL_NM * 0.8);
        fs.push({ type: "Feature", properties: { t: "ils", apt: icao, half: 0 }, geometry: { type: "Polygon", coordinates: [[r.thr, far(-ILS_HALF), far(0), r.thr]] } });
        fs.push({ type: "Feature", properties: { t: "ils", apt: icao, half: 1 }, geometry: { type: "Polygon", coordinates: [[r.thr, far(0), far(ILS_HALF), r.thr]] } });
      }
      // Seuil décalé : partie de piste interdite à l'atterrissage + barre au seuil décalé
      if (r.dthr) {
        fs.push(line([r.thr, r.dthr], { t: "dthr-zone", apt: icao, w: r.wid || 45 }));
        const half = (r.wid || 45) / 2 / 1852;
        fs.push(line([destination(r.dthr, r.true + 90, half), destination(r.dthr, r.true - 90, half)], { t: "dthr-bar", apt: icao }));
        fs.push(pt(r.dthr, { t: "dthr-lbl", apt: icao, rot: r.true, lbl: `DTHR ${q}${r.lda ? " · LDA " + r.lda + " m" : ""}` }));
      }
      // Départs d'intersection : TORA restante au point de l'axe où le taxiway rejoint la piste
      for (const it of r.intersections || []) {
        if (it.pos) fs.push(pt(it.pos, { t: "int", apt: icao, lbl: `${q} via ${it.twy} · TORA ${it.tora} m` }));
      }
    }
  }
  return { type: "FeatureCollection", features: fs };
}

export const APT_DRAW_LAYERS = ["ad-ring", "ad-ring-lbl", "ad-ils", "ad-cl", "ad-tick", "ad-cl-lbl", "ad-dthr-zone", "ad-dthr-bar", "ad-dthr-lbl", "ad-int", "ad-int-lbl"];
const T = (t: string | string[]) => (Array.isArray(t) ? ["in", ["get", "t"], ["literal", t]] : ["==", ["get", "t"], t]);

export function addAptDrawLayers(map: MlMap, font: string[], fontBold: string[], before?: string) {
  const add = (l: any) => map.addLayer({ source: "apt-draw", ...l }, before);
  add({ id: "ad-ring", type: "line", minzoom: 8, maxzoom: 13, filter: T("ring"), paint: { "line-width": 1, "line-dasharray": [4, 4], "line-opacity": 0.7 } });
  add({ id: "ad-ring-lbl", type: "symbol", minzoom: 8, maxzoom: 13, filter: T("ring"),
    layout: { "symbol-placement": "line", "symbol-spacing": 400, "text-field": ["get", "lbl"], "text-font": font, "text-size": 10 }, paint: { "text-halo-width": 1.2 } });
  add({ id: "ad-ils", type: "fill", minzoom: 8, filter: T("ils"),
    paint: { "fill-opacity": ["case", ["==", ["get", "half"], 0], 0.35, 0.06] } });
  add({ id: "ad-cl", type: "line", minzoom: 8, filter: T("cl"), paint: { "line-width": 1.2, "line-dasharray": [6, 3] } });
  add({ id: "ad-tick", type: "line", minzoom: 10, filter: T("tick"), paint: { "line-width": 1 } });
  add({ id: "ad-cl-lbl", type: "symbol", minzoom: 9, filter: T("cl-lbl"),
    layout: { "text-field": ["get", "lbl"], "text-font": fontBold, "text-size": ["interpolate", ["linear"], ["zoom"], 9, 9.5, 13, 12],
      "text-rotate": ["get", "rot"], "text-rotation-alignment": "map", "text-keep-upright": true, "text-offset": [0, -0.9], "text-optional": true },
    paint: { "text-halo-width": 1.5 } });
  add({ id: "ad-dthr-zone", type: "line", minzoom: 13, filter: T("dthr-zone"),
    paint: { "line-width": ["interpolate", ["exponential", 2], ["zoom"], 13, 2, 18, 60], "line-dasharray": [0.4, 0.6], "line-opacity": 0.55 } });
  add({ id: "ad-dthr-bar", type: "line", minzoom: 13, filter: T("dthr-bar"), paint: { "line-width": ["interpolate", ["linear"], ["zoom"], 13, 1.5, 17, 5] } });
  add({ id: "ad-dthr-lbl", type: "symbol", minzoom: 14.5, filter: T("dthr-lbl"),
    layout: { "text-field": ["get", "lbl"], "text-font": fontBold, "text-size": 10.5, "text-offset": [0, 1.4], "text-optional": true }, paint: { "text-halo-width": 1.4 } });
  add({ id: "ad-int", type: "circle", minzoom: 13.5, filter: T("int"), paint: { "circle-radius": 3.5, "circle-stroke-width": 1.5 } });
  add({ id: "ad-int-lbl", type: "symbol", minzoom: 14, filter: T("int"),
    layout: { "text-field": ["get", "lbl"], "text-font": fontBold, "text-size": 10.5, "text-anchor": "left", "text-offset": [0.8, 0], "text-optional": true },
    paint: { "text-halo-width": 1.4 } });
}

export function themeAptDraw(map: MlMap, Th: Theme) {
  if (!map.getLayer("ad-cl")) return;
  const P = (id: string, k: string, v: unknown) => map.setPaintProperty(id, k as never, v as never);
  P("ad-ring", "line-color", Th.border); P("ad-ring-lbl", "text-color", Th.label); P("ad-ring-lbl", "text-halo-color", Th.halo);
  P("ad-ils", "fill-color", Th.navaid);
  P("ad-cl", "line-color", Th.wpt); P("ad-tick", "line-color", Th.wpt);
  P("ad-cl-lbl", "text-color", Th.navaid); P("ad-cl-lbl", "text-halo-color", Th.textHalo);
  P("ad-dthr-zone", "line-color", Th.g.rwyAxis); P("ad-dthr-bar", "line-color", Th.g.rwyAxis);
  P("ad-dthr-lbl", "text-color", Th.g.text); P("ad-dthr-lbl", "text-halo-color", Th.g.halo);
  P("ad-int", "circle-color", Th.sel); P("ad-int", "circle-stroke-color", Th.g.halo);
  P("ad-int-lbl", "text-color", Th.sel); P("ad-int-lbl", "text-halo-color", Th.g.halo);
}
