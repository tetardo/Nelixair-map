// Carte MapLibre : sources, couches, thèmes, filtres, interactions. Pilote l'état partagé (store) ;
// les composants Vue appellent les actions exportées (openFix, openAirway, setSidebar…).
import { initRuler, rulerControl } from "./ruler";
import * as maplibregl from "maplibre-gl";
import { type Map as MlMap, type MapGeoJSONFeature, type PointLike, type StyleSpecification } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { Protocol } from "pmtiles";
import { CFG } from "../config";
import { CLS, dms, esc, type LngLat } from "../lib/format";
import { distNm } from "../lib/geo";
import { loadTaxi, nearestStand, routeToRunway } from "../lib/taxiRoute";
import { airwaysThrough, exists, getRoute, loadIndex, loadRoutes, search, hitIdent, type Hit } from "../services/data";
import { nightPolygon } from "../services/sun";
import { WX_COLORS, flightCat, loadJson, metar, metarsInBbox, wxAge, type Metar } from "../services/weather";
import { isMobile, state, type EaipApt, type GroundAirport, type MapView, type PickItem, type Props, type Tab } from "../store";
import type { Ofp } from "../services/simbrief";
import { APT_DRAW_LAYERS, addAptDrawLayers, aptDrawData, themeAptDraw } from "./aptDraw";
import { addRouteLayers, routeBounds, routeData } from "./flightRoute";
import { GROUND_CLICKABLE, GROUND_LAYERS, addGroundLayers, groundHighlight, themeGround } from "./ground";
import { aspHtml, fixHtml, groundHtml, groundTip, routeHtml, hazardHtml, legHtml, pirepHtml, type GndCtx } from "./popups";
import { registerSymbols } from "./symbols";
import { THEMES, type ThemeName } from "./themes";

// Icône Lucide « map » (ISC), en HTML brut car le contrôle MapLibre n'est pas un composant Vue
const LUCIDE_MAP = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/></svg>`;

type L = any; // spécifications de couche MapLibre
const EMPTY = { type: "FeatureCollection" as const, features: [] };
const F = CFG.font, FB = CFG.fontBold;

let map: MlMap;
let useGeojson = false;
let popup: maplibregl.Popup | null = null;
let baseLayers: { id: string; type: string }[] = [];
const params = new URLSearchParams(location.search);

const src = (layer: string) => (useGeojson ? { source: layer } : { source: "nav", "source-layer": layer });
let aspSrc: { source: string; "source-layer"?: string } = { source: "asp" };
let groundSrc: { source: string; "source-layer"?: string } | null = null;

// ---------- Fond de carte : style libre, épuré façon carte en route ----------
// Retirés définitivement (bruit pour un pilote, ou doublon du plan au sol OSM)
const DROP = /poi|aeroway|housenumber/i;
// Groupes affichables depuis le menu « Affichage »
const BASE_GROUPS: [keyof MapView, RegExp][] = [
  ["roads", /road|highway|bridge|tunnel|rail|transit|ferry|aerialway|motorway|path|pier/i],
  ["buildings", /building/i],
  ["landuse", /landuse|park/i],
];
const baseGroup = (l: { id: string; type: string }): keyof MapView | null =>
  BASE_GROUPS.find(([, re]) => re.test(l.id))?.[0] ?? (l.type === "symbol" ? "places" : null);
async function basemap(): Promise<StyleSpecification> {
  try {
    const r = await fetch(CFG.basemapStyle);
    if (!r.ok) throw new Error(String(r.status));
    const st = await r.json();
    st.layers = st.layers.filter((l: { id: string }) => !DROP.test(l.id));
    st.glyphs = st.glyphs || CFG.glyphs;
    return st;
  } catch (e) {
    console.warn("Fond de carte indisponible, fond uni utilisé", e);
    return { version: 8, glyphs: CFG.glyphs, sources: {},
      layers: [{ id: "background", type: "background", paint: { "background-color": THEMES.day.bg } }] };
  }
}
function paintBasemap(T: (typeof THEMES)[ThemeName]) {
  for (const l of baseLayers) {
    const set = (k: string, v: unknown) => { try { map.setPaintProperty(l.id, k as never, v as never); } catch { /* propriété absente */ } };
    if (l.type === "background") set("background-color", T.bg);
    else if (l.type === "fill" && /water/i.test(l.id)) set("fill-color", T.water);
    else if (l.type === "fill" && /building/i.test(l.id)) { set("fill-color", T.bldg); set("fill-outline-color", T.roadCase); }
    else if (l.type === "fill" && /landuse|park/i.test(l.id)) { set("fill-color", T.landuse); set("fill-opacity", 0.6); }
    else if (l.type === "line" && BASE_GROUPS[0][1].test(l.id)) set("line-color", /casing|outline/i.test(l.id) ? T.roadCase : T.road);
    else if (l.type === "fill") set("fill-opacity", T.land);
    else if (l.type === "line" && /water|river/i.test(l.id)) set("line-color", T.waterLine);
    else if (l.type === "line" && /boundary|admin/i.test(l.id)) set("line-color", T.border);
    else if (l.type === "symbol") {
      set("text-color", /water|ocean|sea|lake/i.test(l.id) ? T.waterLabel : T.label);
      set("text-halo-color", T.halo);
    }
  }
}

// Relief ombré (Terrarium, données ouvertes AWS / Mapzen) et imagerie : ajoutés à la demande sous les couches aéronautiques
const firstAero = () => map.getStyle().layers[baseLayers.length]?.id;
export function applyView() {
  try { localStorage.setItem("nelixair-view", JSON.stringify(state.view)); } catch { /* stockage indisponible */ }
  if (!state.mapReady) return;
  const v = state.view;
  for (const l of baseLayers) {
    const g = baseGroup(l);
    if (g) map.setLayoutProperty(l.id, "visibility", v[g] ? "visible" : "none");
  }
  if (v.relief && !map.getSource("relief")) {
    map.addSource("relief", { type: "raster-dem", encoding: "terrarium", tileSize: 256, maxzoom: 14,
      tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
      attribution: 'Relief <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Mapzen / AWS Terrain Tiles</a>' });
    map.addLayer({ id: "relief", type: "hillshade", source: "relief",
      paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "rgba(0,0,0,.45)", "hillshade-highlight-color": "rgba(255,255,255,.25)" } }, firstAero());
  }
  if (map.getLayer("relief")) map.setLayoutProperty("relief", "visibility", v.relief ? "visible" : "none");
  // Imagerie Esri (choix de l'association : usage non commercial). Insérée sous les routes, bâtiments et noms du fond.
  const sat = v.base === "sat";
  if (sat && !map.getSource("imagery")) {
    map.addSource("imagery", { type: "raster", tileSize: 256, maxzoom: 19,
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      attribution: 'Imagerie <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>, Maxar, Earthstar Geographics' });
    const above = baseLayers.find((l) => baseGroup(l) && baseGroup(l) !== "landuse")?.id || firstAero();
    map.addLayer({ id: "imagery", type: "raster", source: "imagery", paint: { "raster-fade-duration": 150 } }, above);
  }
  if (map.getLayer("imagery")) map.setLayoutProperty("imagery", "visibility", sat ? "visible" : "none");
  // Sur l'imagerie, les fonds du plan au sol deviennent transparents : on voit la scène réelle sous les taxiways
  if (map.getLayer("g-boundary")) {
    map.setPaintProperty("g-boundary", "fill-opacity", sat ? 0 : ["interpolate", ["linear"], ["zoom"], 11, 0, 12.5, 0.85]);
    map.setPaintProperty("g-apron", "fill-opacity", sat ? 0.25 : 1);
    map.setPaintProperty("g-building", "fill-opacity", sat ? 0.3 : ["interpolate", ["linear"], ["zoom"], 13, 0.5, 15, 1]);
  }
}

// ---------- Couches aéronautiques ----------
const freqText = ["case", ["has", "freq"],
  ["case", ["==", ["get", "cls"], "ndb"],
    ["number-format", ["get", "freq"], { "max-fraction-digits": 0 }],
    ["number-format", ["get", "freq"], { "min-fraction-digits": 2, "max-fraction-digits": 2 }]],
  ""];
const lineWidth = ["interpolate", ["linear"], ["zoom"], 2, 0.6, 6, 1.2, 10, 2.2];
// MEA : niveau de vol au-dessus de 18 000 ft (altitude de transition US), pieds sinon
const meaText = ["case", [">=", ["get", "mea"], 18000],
  ["concat", "FL", ["to-string", ["round", ["/", ["get", "mea"], 100]]]],
  ["to-string", ["get", "mea"]]];
const isNdb = ["==", ["get", "cls"], "ndb"];

const ASP_LINES: [string, number[] | null, number][] = [["asp-line", null, 1.1], ["asp-line-spc", [3, 2], 1.4], ["asp-line-fir", [6, 3, 1, 3], 1.6]];
const ASP_LINE_BASE: Record<string, unknown> = {
  "asp-line": ["match", ["get", "group"], ["special", "fir"], false, true],
  "asp-line-spc": ["==", ["get", "group"], "special"],
  "asp-line-fir": ["==", ["get", "group"], "fir"],
};
const ASP_LINE_IDS = ASP_LINES.map((l) => l[0]);
const HZ_COLOR_EXPR = ["match", ["get", "fam"], "conv", "#e0342f", "turb", "#f08a24", "ice", "#2bb3e6", "ifr", "#9b5de5", "ash", "#8d6e63",
  "tc", "#c2185b", "#7d8aa5"];

function addLayers(sources: Record<string, unknown>) {
  const add = (l: L) => map.addLayer(l);
  for (const [id, s] of Object.entries(sources)) if (!map.getSource(id)) map.addSource(id, s as never);
  map.addSource("sel", { type: "geojson", data: EMPTY });

  // Satellite infrarouge et zone de nuit, sous toutes les couches aéronautiques
  add({ id: "sat", type: "raster", source: "sat", layout: { visibility: "none" }, paint: { "raster-opacity": 0.6, "raster-fade-duration": 300 } });
  add({ id: "night", type: "fill", source: "night", layout: { visibility: "none" }, paint: { "fill-color": "#0a1020", "fill-opacity": 0.22 } });

  // Carte d'aéroport (plan au sol), sous les espaces et la navigation
  if (groundSrc) addGroundLayers(map, groundSrc, F, FB);
  // Tracés eAIP (axe prolongé, ILS, seuils décalés, intersections) au-dessus du plan au sol
  map.addSource("apt-draw", { type: "geojson", data: aptDrawData(state.eaip) });
  addAptDrawLayers(map, F, FB);
  // Plan de vol SimBrief
  map.addSource("ofp", { type: "geojson", data: routeData(state.ofp) });
  addRouteLayers(map, F, FB);
  // Itinéraire de roulage (calculé à la demande depuis la popup d'un poste)
  map.addSource("taxi-route", { type: "geojson", data: EMPTY });
  add({ id: "tr-casing", type: "line", source: "taxi-route", filter: ["==", ["geometry-type"], "LineString"],
    layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 13, 5, 17, 12] } });
  add({ id: "tr-line", type: "line", source: "taxi-route", filter: ["==", ["geometry-type"], "LineString"],
    layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#d6336c", "line-width": ["interpolate", ["linear"], ["zoom"], 13, 3, 17, 7] } });
  add({ id: "tr-hold", type: "circle", source: "taxi-route", filter: ["==", ["get", "t"], "hold"],
    paint: { "circle-radius": 6, "circle-color": "#e0342f", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
  add({ id: "tr-lbl", type: "symbol", source: "taxi-route", filter: ["has", "lbl"],
    layout: { "text-field": ["get", "lbl"], "text-font": FB, "text-size": 12, "text-offset": [0, -1.3], "text-allow-overlap": true },
    paint: { "text-color": "#d6336c", "text-halo-color": "#fff", "text-halo-width": 2 } });

  // Espaces aériens (sous les voies) : remplissage léger, contour, nom + limites le long du contour
  add({ id: "asp-fill", type: "fill", ...aspSrc, minzoom: 4, filter: ["!=", ["get", "group"], "fir"], paint: { "fill-opacity": 0.05 } });
  // contours : un calque par style de trait (line-dasharray n'accepte pas d'expression par entité)
  for (const [id, dash, width] of ASP_LINES) {
    add({ id, type: "line", ...aspSrc, filter: ASP_LINE_BASE[id], layout: { "line-join": "round" },
      paint: { "line-width": width, "line-opacity": 0.75, ...(dash ? { "line-dasharray": dash } : {}) } });
  }
  add({ id: "asp-lbl", type: "symbol", ...aspSrc, minzoom: 6,
    layout: {
      "symbol-placement": "line", "symbol-spacing": 500, "text-max-angle": 30,
      "text-field": ["concat", ["get", "name"],
        ["case", ["has", "icao_class"], ["concat", " (", ["get", "icao_class"], ")"], ""],
        ["case", ["has", "lower"], ["concat", "  ", ["get", "lower"], " / ", ["coalesce", ["get", "upper"], ""]], ""]],
      "text-font": F, "text-size": 10, "text-offset": [0, -0.7],
    },
    paint: { "text-halo-width": 1.2 } });

  // SIGMET / AIRMET : zones colorées par type de danger (SIGMET trait plein, AIRMET pointillé)
  add({ id: "hz-fill", type: "fill", source: "hz", paint: { "fill-color": HZ_COLOR_EXPR, "fill-opacity": 0.1 } });
  add({ id: "hz-line", type: "line", source: "hz", filter: ["!=", ["get", "kind"], "AIRMET"],
    paint: { "line-color": HZ_COLOR_EXPR, "line-width": 1.8, "line-opacity": 0.9 } });
  add({ id: "hz-line-airmet", type: "line", source: "hz", filter: ["==", ["get", "kind"], "AIRMET"],
    paint: { "line-color": HZ_COLOR_EXPR, "line-width": 1.2, "line-opacity": 0.8, "line-dasharray": [4, 3] } });
  add({ id: "hz-lbl", type: "symbol", source: "hz", minzoom: 3,
    layout: { "text-field": ["concat", ["get", "kind"], " ", ["get", "hazard"],
      ["case", ["all", ["has", "sev"], ["!=", ["get", "sev"], ""], ["!=", ["get", "sev"], "NONE"]], ["concat", " ", ["get", "sev"]], ""]],
      "text-font": FB, "text-size": 10.5, "symbol-placement": "point", "text-allow-overlap": false },
    paint: { "text-color": HZ_COLOR_EXPR, "text-halo-width": 1.4 } });

  // Grid MORA : quadrillage 1° + valeur en milliers (centaines en exposant)
  add({ id: "mora-line", type: "line", source: "mora", minzoom: 4, maxzoom: 11,
    filter: ["==", ["geometry-type"], "Polygon"], paint: { "line-width": 0.6 } });
  add({ id: "mora-lbl", type: "symbol", source: "mora", minzoom: 5, maxzoom: 11,
    filter: ["==", ["geometry-type"], "Point"],
    layout: { "text-field": ["format", ["get", "th"], {}, ["get", "hu"], { "font-scale": 0.62 }], "text-font": FB,
      "text-size": ["interpolate", ["linear"], ["zoom"], 5, 13, 9, 22], "text-allow-overlap": true, "text-ignore-placement": true },
    paint: { "text-opacity": 0.55 } });

  for (const [lv, minzoom] of [["L", 4], ["B", 3], ["H", 2]] as const) {
    add({ id: `awy-${lv}`, type: "line", ...src("airways"), minzoom, filter: ["==", ["get", "level"], lv],
      layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-width": lineWidth, "line-opacity": 0.9 } });
  }
  add({ id: "awy-sel", type: "line", ...src("airways"), filter: ["==", ["get", "ident"], ""],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-width": ["interpolate", ["linear"], ["zoom"], 2, 2.5, 10, 5], "line-opacity": 0.95 } });

  // Idents de voies en cartouche + MEA au-dessous aux zooms élevés
  for (const lv of ["L", "B", "H"]) {
    add({ id: `awy-lbl-${lv}`, type: "symbol", ...src("airways"), minzoom: lv === "H" ? 5 : 6, filter: ["==", ["get", "level"], lv],
      layout: {
        "symbol-placement": "line-center",
        "text-field": ["step", ["zoom"], ["get", "ident"],
          8, ["format", ["get", "ident"], {}, ["case", ["has", "mea"], ["concat", "\n", meaText], ""], { "font-scale": 0.8 }]],
        "text-font": FB, "text-size": 10.5, "text-rotation-alignment": "viewport", "text-keep-upright": true,
        "icon-text-fit": "both", "icon-text-fit-padding": [1, 3, 1, 3],
        "icon-rotation-alignment": "viewport", "symbol-sort-key": lv === "H" ? 0 : 1,
      } });
  }

  // METAR : anneau coloré par catégorie de vol autour de l'aéroport
  add({ id: "wx", type: "circle", source: "wx", minzoom: 5,
    paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 6, 10, 13], "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 5, 2, 10, 3.5],
      "circle-stroke-color": ["match", ["get", "cat"], "VFR", WX_COLORS.VFR, "MVFR", WX_COLORS.MVFR,
        "IFR", WX_COLORS.IFR, "LIFR", WX_COLORS.LIFR, "#888"] } });

  // PIREP : remplissage = turbulence, contour = givrage
  const sevColor = (k: string) => ["match", ["get", k], "SEV", "#e0342f", "EXTM", "#a01818", "MOD", "#f08a24", "LGT", "#e8c547", "SMTH", "#e8c547", "rgba(0,0,0,0)"];
  add({ id: "pirep", type: "circle", source: "pirep", minzoom: 3, layout: { visibility: "none" },
    paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 3.5, 8, 6],
      "circle-color": ["case", ["==", ["get", "tb"], ""], "#8a94a8", sevColor("tb")],
      "circle-stroke-color": ["case", ["==", ["get", "ic"], ""], "#ffffff", "#2bb3e6"],
      "circle-stroke-width": ["case", ["==", ["get", "ic"], ""], 1, 2.5] } });

  // Aéroports
  add({ id: "apt", type: "symbol", ...src("airports"), minzoom: 3,
    layout: {
      "icon-size": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 9, 1],
      "icon-allow-overlap": ["step", ["zoom"], false, 6, true],
      "symbol-sort-key": ["get", "rank"],
      "text-field": ["step", ["zoom"], ["case", ["==", ["get", "kind"], "large"], ["get", "ident"], ""],
        7, ["get", "ident"],
        10, ["format", ["get", "ident"], { "text-font": ["literal", FB] }, "\n", {}, ["coalesce", ["get", "name"], ""], { "font-scale": 0.8 }]],
      "text-font": FB, "text-size": 10.5, "text-anchor": "top", "text-offset": [0, 0.9], "text-optional": true,
      "text-max-width": 10,
    },
    paint: { "text-halo-width": 1.3 } });

  // Waypoints : petit cercle ouvert, ident aux zooms moyens
  add({ id: "wpt", type: "symbol", ...src("fixes"), minzoom: 6, filter: ["==", ["get", "cls"], "waypoint"],
    layout: {
      "icon-size": ["interpolate", ["linear"], ["zoom"], 6, 0.6, 10, 1], "icon-allow-overlap": true,
      "text-field": ["step", ["zoom"], "", 7, ["get", "ident"]],
      "text-font": F, "text-size": 10, "text-offset": [0, 0.8], "text-anchor": "top", "text-optional": true,
    },
    paint: { "text-halo-width": 1.2 } });

  // Navaids : symbole + cartouche ident/fréquence
  add({ id: "nav", type: "symbol", ...src("fixes"), minzoom: 3, filter: ["!=", ["get", "cls"], "waypoint"],
    layout: {
      "icon-size": ["interpolate", ["linear"], ["zoom"], 3, 0.55, 8, 1], "icon-allow-overlap": true,
      "symbol-sort-key": ["match", ["get", "cls"], ["vortac", "vordme", "vor"], 0, 1],
    } });
  add({ id: "nav-lbl", type: "symbol", ...src("fixes"), minzoom: 5, filter: ["!=", ["get", "cls"], "waypoint"],
    layout: {
      "text-field": ["step", ["zoom"], ["get", "ident"],
        7, ["format", ["get", "ident"], { "text-font": ["literal", FB] }, "\n", {}, freqText, { "font-scale": 0.85 }]],
      "text-font": F, "text-size": 10.5, "text-anchor": "left", "text-offset": [1.3, 0], "text-justify": "left",
      "icon-text-fit": "both", "icon-text-fit-padding": [2, 4, 2, 4], "text-optional": false,
    } });

  add({ id: "sel-pt", type: "circle", source: "sel",
    paint: { "circle-radius": 14, "circle-color": "rgba(0,0,0,0)", "circle-stroke-width": 2.5 } });
}

// ---------- Thème ----------
export function applyTheme(name: ThemeName) {
  const T = THEMES[name];
  document.documentElement.dataset.theme = name;
  try { localStorage.setItem("nelixair-theme", name); } catch { /* stockage indisponible */ }
  if (!state.mapReady) return;
  paintBasemap(T);
  registerSymbols(map, name, T);
  const P = (id: string, k: string, v: unknown) => map.setPaintProperty(id, k as never, v as never);
  const Lp = (id: string, k: string, v: unknown) => map.setLayoutProperty(id, k as never, v as never);
  P("awy-H", "line-color", T.high); P("awy-L", "line-color", T.low); P("awy-B", "line-color", T.both);
  P("awy-sel", "line-color", T.sel); P("sel-pt", "circle-stroke-color", T.sel);
  for (const lv of ["L", "B", "H"]) {
    Lp(`awy-lbl-${lv}`, "icon-image", `${name}-box-${lv}`);
    P(`awy-lbl-${lv}`, "text-color", lv === "L" ? T.low : lv === "H" ? T.high : T.both);
  }
  Lp("wpt", "icon-image", `${name}-sym-waypoint`);
  P("wpt", "text-color", T.wpt); P("wpt", "text-halo-color", T.textHalo);
  Lp("nav", "icon-image", ["concat", `${name}-sym-`, ["get", "cls"]]);
  Lp("apt", "icon-image", ["concat", `${name}-apt-`, ["get", "kind"], ["case", ["==", ["get", "ifr"], true], "-ifr", "-vfr"]]);
  P("apt", "text-color", ["case", ["==", ["get", "ifr"], true], T.aptIfr, T.aptVfr]);
  P("apt", "text-halo-color", T.textHalo);
  const aspColor = ["match", ["get", "group"], "controlled", T.aspCtl, "special", T.aspSpecial, "fir", T.aspFir, T.aspOther];
  P("asp-fill", "fill-color", aspColor);
  for (const id of ASP_LINE_IDS) P(id, "line-color", aspColor);
  P("asp-lbl", "text-color", aspColor); P("asp-lbl", "text-halo-color", T.textHalo);
  P("mora-line", "line-color", T.moraLine); P("mora-lbl", "text-color", T.mora);
  Lp("nav-lbl", "icon-image", ["case", isNdb, `${name}-box-ndb`, `${name}-box-nav`]);
  P("nav-lbl", "text-color", ["case", isNdb, T.ndb, T.navaid]);
  if (map.getLayer("g-runway")) themeGround(map, name, T);
  themeAptDraw(map, T);
}

// Le symbole d'un aéroport s'efface quand son plan au sol est affiché (zoom ≥ 13)
function fadeAirportsWithGround() {
  const idents = Object.keys(state.ground);
  if (!idents.length || !state.filters.ground) {
    map.setPaintProperty("apt", "icon-opacity", 1); map.setPaintProperty("apt", "text-opacity", 1);
    return;
  }
  const has = ["in", ["get", "ident"], ["literal", idents]];
  const op: any = ["interpolate", ["linear"], ["zoom"], 12, 1, 13, ["case", has, 0, 1]];
  map.setPaintProperty("apt", "icon-opacity", op); map.setPaintProperty("apt", "text-opacity", op);
}

// ---------- Filtres ----------
const NAV_CLASSES = ["vor", "vordme", "vortac", "tacan", "dme", "ndb"];
let overlayKey = "";
export function applyFilters() {
  if (!state.mapReady) return;
  const on = state.filters;
  const rnav = ["coalesce", ["get", "rnav"], false];
  const typeF = on.rnav && on.conv ? true : on.rnav ? ["==", rnav, true] : on.conv ? ["==", rnav, false] : false;
  const vis: Record<string, boolean> = { H: on.H, L: on.L, B: on.H || on.L };
  const V = (id: string, v: boolean) => map.setLayoutProperty(id, "visibility", v ? "visible" : "none");
  for (const lv of ["H", "L", "B"]) {
    const f = ["all", ["==", ["get", "level"], lv], typeF];
    for (const id of [`awy-${lv}`, `awy-lbl-${lv}`]) { map.setFilter(id, f as never); V(id, vis[lv]); }
  }
  const navF = ["in", ["get", "cls"], ["literal", NAV_CLASSES.filter((c) => on[c])]];
  map.setFilter("nav", navF as never);
  map.setFilter("nav-lbl", navF as never);
  V("wpt", on.waypoint);
  const kinds = ["large", "medium", "small"].filter((k) => on[`apt_${k}`]).concat(on.apt_heli ? ["heliport", "seaplane"] : []);
  map.setFilter("apt", ["in", ["get", "kind"], ["literal", kinds]] as never);
  V("apt", kinds.length > 0);
  const groups = ["controlled", "special", "fir", "other"].filter((g) => on[`asp_${g}`]);
  const gF = ["in", ["get", "group"], ["literal", groups]];
  map.setFilter("asp-fill", ["all", ["!=", ["get", "group"], "fir"], gF] as never);
  for (const id of ASP_LINE_IDS) map.setFilter(id, ["all", ASP_LINE_BASE[id], gF] as never);
  map.setFilter("asp-lbl", gF as never);
  for (const id of ["asp-fill", "asp-lbl", ...ASP_LINE_IDS]) V(id, groups.length > 0);
  for (const id of ["mora-line", "mora-lbl"]) V(id, on.mora);
  V("wx", on.wx);
  for (const id of ["hz-fill", "hz-line", "hz-line-airmet", "hz-lbl"]) V(id, on.hazards);
  V("pirep", on.pireps);
  V("sat", on.sat);
  V("night", on.night);
  if (map.getLayer("g-runway")) for (const id of GROUND_LAYERS) V(id, on.ground);
  for (const id of APT_DRAW_LAYERS) if (map.getLayer(id)) V(id, on.approach);
  fadeAirportsWithGround();
  const key = ["hazards", "pireps", "sat"].map((k) => +!!on[k]).join("");
  const changed = key !== overlayKey;
  overlayKey = key;
  refreshOverlays(changed);
  if (on.wx) scheduleWx(); else state.wxStatus = "";
  try { localStorage.setItem("nelixair-filters", JSON.stringify(on)); } catch { /* stockage indisponible */ }
  scheduleList();
}

// ---------- METAR dans la vue ----------
let wxTimer: ReturnType<typeof setTimeout> | undefined, wxSeq = 0;
function scheduleWx() {
  clearTimeout(wxTimer);
  wxTimer = setTimeout(loadWx, 400);
}
async function loadWx() {
  const source = map.getSource("wx") as maplibregl.GeoJSONSource | undefined;
  if (!state.filters.wx || !source) return;
  if (map.getZoom() < 5) {
    source.setData(EMPTY);
    state.wxStatus = "METAR affichés à partir du zoom 5.";
    return;
  }
  const b = map.getBounds();
  const w = Math.max(-180, b.getWest()), e = Math.min(180, b.getEast());
  const seq = ++wxSeq;
  try {
    const list = await metarsInBbox(w, Math.max(-90, b.getSouth()), e, Math.min(90, b.getNorth()));
    if (seq !== wxSeq) return;
    const feats = list.filter((m) => m.lat != null && m.lon != null).map((m) => ({
      type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [m.lon, m.lat] },
      properties: { id: m.icaoId, cat: flightCat(m) || "", raw: m.rawOb || "" },
    }));
    source.setData({ type: "FeatureCollection", features: feats });
    const age = await wxAge().catch(() => null);
    state.wxStatus = `${feats.length} METAR dans la vue · NOAA${age != null ? ` · relevé il y a ${age} min` : ""}`;
  } catch (err) {
    if (seq !== wxSeq) return;
    console.warn("METAR indisponibles", err);
    state.wxStatus = "METAR indisponibles pour le moment (relais météo injoignable).";
  }
}

// ---------- SIGMET / AIRMET, PIREP, satellite, nuit : rafraîchis toutes les 5 min ----------
let lastOverlay = 0;
async function refreshOverlays(force = false) {
  if (!map?.getSource("hz")) return;
  const on = state.filters;
  if (on.night) (map.getSource("night") as maplibregl.GeoJSONSource).setData(nightPolygon(new Date()));
  if (!force && Date.now() - lastOverlay <= 5 * 60 * 1000) return;
  lastOverlay = Date.now();
  const jobs: Promise<unknown>[] = [];
  if (on.hazards && CFG.wxHazards) jobs.push(loadJson(CFG.wxHazards).then((j) => {
    const now = Date.now();
    // garde les avis en vigueur (ou sans heure de fin connue)
    j.features = j.features.filter((f: { properties: Props }) => !f.properties.to || Date.parse(f.properties.to) > now);
    (map.getSource("hz") as maplibregl.GeoJSONSource).setData(j);
  }));
  if (on.pireps && CFG.wxPireps) jobs.push(loadJson(CFG.wxPireps).then((j) => (map.getSource("pirep") as maplibregl.GeoJSONSource).setData(j)));
  if (on.sat) {
    const s = map.getSource("sat") as maplibregl.RasterTileSource | undefined;
    if (s?.setTiles) s.setTiles(CFG.satellite.map((u) => `${u}?t=${Math.floor(Date.now() / 600000)}`));
  }
  const res = await Promise.allSettled(jobs);
  if (res.some((r) => r.status === "rejected")) { lastOverlay = 0; console.warn("Couches météo indisponibles", res); }
}

// ---------- Panneau latéral ----------
export function setSidebar(open: boolean, persist = true) {
  state.sidebarOpen = open;
  document.body.classList.toggle("side-open", open);
  if (persist && !isMobile()) { try { localStorage.setItem("nelixair-side", open ? "1" : "0"); } catch { /* stockage indisponible */ } }
  setTimeout(() => map?.resize(), 220);
  scheduleList();
}
export function setTab(name: Tab) {
  state.tab = name;
  if (name === "list") scheduleList();
}
function showDetail(d: typeof state.detail) {
  state.detail = d;
  setTab("detail");
}

// ---------- Sélection / popups ----------
function selectAirway(ident: string | null) {
  map.setFilter("awy-sel", ["==", ["get", "ident"], ident || ""]);
}
export function selectPoint(ll: LngLat | null) {
  (map.getSource("sel") as maplibregl.GeoJSONSource)?.setData({ type: "FeatureCollection",
    features: ll ? [{ type: "Feature", geometry: { type: "Point", coordinates: ll }, properties: {} }] : [] });
}
function showPopup(ll: LngLat | maplibregl.LngLat, html: string) {
  popup?.remove();
  popup = new maplibregl.Popup({ maxWidth: "300px", focusAfterOpen: false }).setLngLat(ll).setHTML(html).addTo(map);
  popup.on("close", () => selectPoint(null));
}
export function closePopup() { popup?.remove(); popup = null; }

/** Objet sélectionné dans l'URL (?sel=KABQ) : lien partageable vers une fiche. */
function setSel(id: string | null) {
  const u = new URL(location.href);
  if (id) u.searchParams.set("sel", id); else u.searchParams.delete("sel");
  history.replaceState(history.state, "", u);
}
export function clearSelection() {
  closePopup(); selectAirway(null); selectPoint(null); setSel(null);
}

export function flyTo(ll: LngLat, zoom?: number) {
  map.flyTo({ center: ll, zoom: zoom ?? Math.max(map.getZoom(), 8), duration: 700 });
}

// Point d'entrée commun (clic carte, recherche, liste)
export function openFix(p: Props, ll: LngLat, { fly = false } = {}) {
  setSel(p.ident);
  selectAirway(null);
  selectPoint(ll);
  if (fly) map.flyTo({ center: ll, zoom: Math.max(map.getZoom(), p.cls === "waypoint" ? 8.5 : 7.5), duration: 800 });
  if (state.sidebarOpen) { closePopup(); showFixDetail(p, ll); }
  else showPopup(ll, fixHtml(p, ll));
  if (isMobile() && state.sidebarOpen && fly) setSidebar(false);
}
function showFixDetail(p: Props, ll: LngLat) {
  showDetail(p.cls === "airport" ? { kind: "airport", p, ll } : { kind: "fix", p, ll });
}
export function openAirway(ident: string, { fit = false } = {}) {
  setSel(ident);
  selectPoint(null);
  selectAirway(ident);
  closePopup();
  if (!state.sidebarOpen && !isMobile()) setSidebar(true);
  if (state.sidebarOpen) showDetail({ kind: "airway", ident });
  if (fit) loadRoutes().then(() => fitAirway(ident));
}
export function fitAirway(ident: string) {
  const r = getRoute(ident);
  if (!r) return;
  const pts = r.parts.flatMap((p) => p.pts);
  let w = 180, s = 90, e = -180, n = -90;
  for (const p of pts) { w = Math.min(w, p[2]); e = Math.max(e, p[2]); s = Math.min(s, p[3]); n = Math.max(n, p[3]); }
  map.fitBounds([[w, s], [e, n]], { padding: 60, maxZoom: 8, duration: 800 });
}
export { airwaysThrough };

/** Cadre la carte d'aéroport d'un terrain pilote. */
export function openAirportChart(ident: string) {
  const g = state.ground[ident];
  if (!g?.bbox) return;
  if (!state.filters.ground) state.filters.ground = true;
  if (isMobile() && state.sidebarOpen) setSidebar(false);
  const [w, s, e, n] = g.bbox;
  map.fitBounds([[w, s], [e, n]], { padding: isMobile() ? 20 : 50, maxZoom: 16, duration: 1000 });
}

// Manche à air au point de référence du terrain affiché, orientée selon le METAR (la manche pointe sous le vent)
let sock: maplibregl.Marker | null = null;
export function setWindsock(apt: string, wdir: unknown, wspd: number | null | undefined) {
  sock?.remove(); sock = null;
  const g = state.ground[apt];
  const at = state.eaip[apt]?.arp || (g ? [(g.bbox[0] + g.bbox[2]) / 2, (g.bbox[1] + g.bbox[3]) / 2] as LngLat : null);
  if (!apt || !at || !state.mapReady || wspd == null) return;
  const el = document.createElement("div");
  el.className = "windsock";
  const calm = !wspd, vrb = typeof wdir !== "number";
  el.title = calm ? "Vent calme" : vrb ? `Vent variable ${wspd} kt` : `Vent ${String(wdir).padStart(3, "0")}° ${wspd} kt (vrai)`;
  // 5 bandes = 15 kt ou plus (convention OACI : une bande par tranche de 3 kt)
  const bands = Math.min(5, Math.max(1, Math.round(wspd / 3)));
  el.innerHTML = calm || vrb ? `<span class="ws-calm">${calm ? "CALME" : "VRB"}</span>` :
    `<svg viewBox="-4 -14 48 28" style="transform: rotate(${(Number(wdir) + 90) % 360}deg)"><line x1="-3" y1="0" x2="0" y2="0"/>` +
    Array.from({ length: 5 }, (_, i) => `<path class="${i < bands ? (i % 2 ? "w" : "r") : "off"}" d="M${i * 8} ${-9 + i * 1.2} L${i * 8 + 8} ${-9 + (i + 1) * 1.2} L${i * 8 + 8} ${9 - (i + 1) * 1.2} L${i * 8} ${9 - i * 1.2}Z"/>`).join("") +
    `</svg><span class="ws-lbl">${wspd} kt</span>`;
  sock = new maplibregl.Marker({ element: el }).setLngLat(at).addTo(map);
}

// ---------- Itinéraire de roulage ----------
// ---------- Plan de vol SimBrief ----------
export function setOfp(ofp: Ofp | null, { fit = true } = {}) {
  state.ofp = ofp;
  try {
    if (ofp) localStorage.setItem("nelixair-ofp", JSON.stringify(ofp)); else localStorage.removeItem("nelixair-ofp");
  } catch { /* stockage indisponible */ }
  (map?.getSource("ofp") as maplibregl.GeoJSONSource | undefined)?.setData(routeData(ofp));
  if (ofp && fit && map) fitOfp();
}
export function fitOfp() {
  if (!state.ofp || !map) return;
  const left = state.sidebarOpen && !isMobile() ? 60 : 40;
  map.fitBounds(routeBounds(state.ofp), { padding: { top: 100, bottom: 60, left, right: 70 }, maxZoom: 9, duration: 900 });
}
/** Met en évidence le tronçon arrivant sur le point i du nav log (-1 : aucun). */
export function highlightLeg(i: number) {
  if (map?.getLayer("ofp-hl")) map.setFilter("ofp-hl", ["all", ["==", ["get", "t"], "leg"], ["==", ["get", "i"], i]]);
}
/** Ouvre la fiche d'un aéroport à partir de son ident (index de recherche). */
export async function openAirportByIdent(ident: string) {
  await loadIndex();
  const h = search(ident).find((x) => x.t === "fix" && x.r[0] === ident && x.r[1] === "airport");
  if (h) choose(h);
}

export function clearTaxiRoute() {
  (map.getSource("taxi-route") as maplibregl.GeoJSONSource | undefined)?.setData(EMPTY);
}
export async function showTaxiRoute(apt: string, at: LngLat, qfu: string) {
  const g = await loadTaxi(CFG.taxiBase, apt);
  if (!g) return;
  const si = nearestStand(g, at);
  const stand = si >= 0 ? g.stands[si][0] || "Poste" : "Poste";
  const r = si >= 0 ? routeToRunway(g, si, qfu) : null;
  const feats: GeoJSON.Feature[] = [];
  if (r) {
    feats.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: r.coords } });
    for (const h of r.holds) feats.push({ type: "Feature", properties: { t: "hold", lbl: h.ref || "STOP" }, geometry: { type: "Point", coordinates: h.at } });
    feats.push({ type: "Feature", properties: { lbl: qfu }, geometry: { type: "Point", coordinates: r.coords[r.coords.length - 1] } });
  }
  (map.getSource("taxi-route") as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features: feats });
  const anchor = r ? r.coords[0] : at;
  showPopup(anchor, routeHtml(stand, qfu, r));
  if (r) {
    const xs = r.coords.map((c) => c[0]), ys = r.coords.map((c) => c[1]);
    const side = state.sidebarOpen && !isMobile() ? 380 : 40;
    map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]],
      { padding: { top: 260, bottom: 60, left: side, right: 60 }, maxZoom: 16.5, duration: 800 });
  }
}

/** Données eAIP chargées : tracés et caps vrais officiels. */
export function setEaip(airports: Record<string, EaipApt>) {
  state.eaip = airports;
  (map?.getSource("apt-draw") as maplibregl.GeoJSONSource | undefined)?.setData(aptDrawData(airports));
}

// ---------- Objets du plan au sol pilotés depuis la fiche (puces pistes / taxiways) ----------
type GKind = "runway" | "taxiway";
let hoverPop: maplibregl.Popup | null = null;
let focused: { apt: string; kind: GKind; ref: string } | null = null; // objet ouvert au clic (surbrillance gardée)
function groundFeatures(apt: string, kind: GKind, ref: string) {
  if (!groundSrc || !map.getSource(groundSrc.source)) return [];
  const kinds = kind === "runway" ? ["runway"] : ["taxiway", "taxilane"];
  return map.querySourceFeatures(groundSrc.source, { sourceLayer: groundSrc["source-layer"],
    filter: ["all", ["==", ["get", "apt"], apt], ["==", ["get", "ref"], ref], ["in", ["get", "kind"], ["literal", kinds]]] as never });
}
/** Étendue et point d'ancrage (sommet le plus proche du centre) des tronçons chargés. */
function groundExtent(apt: string, kind: GKind, ref: string) {
  const fs = groundFeatures(apt, kind, ref);
  const pts: LngLat[] = [];
  const walk = (c: unknown): void => { if (typeof (c as number[])[0] === "number") pts.push(c as LngLat); else (c as unknown[]).forEach(walk); };
  for (const f of fs) walk((f.geometry as GeoJSON.LineString | GeoJSON.Polygon).coordinates);
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const b: [number, number, number, number] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
  const anchor = pts.reduce((a, p) => (Math.hypot(p[0] - cx, p[1] - cy) < Math.hypot(a[0] - cx, a[1] - cy) ? p : a));
  return { bbox: b, anchor, props: fs[0].properties };
}
/** Survol d'une puce : surbrillance et bulle éphémère ; null = fin du survol. */
export function groundPreview(apt: string, kind: GKind | null, ref = "") {
  hoverPop?.remove(); hoverPop = null;
  if (!state.mapReady) return;
  if (!kind) { groundHighlight(map, focused); return; }
  groundHighlight(map, { apt, kind, ref });
  const ex = groundExtent(apt, kind, ref);
  if (!ex) return;
  hoverPop = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: "hover-pop", focusAfterOpen: false, offset: 8 })
    .setLngLat(ex.anchor).setHTML(groundTip(ex.props, undefined, gndCtx(apt))).addTo(map);
}
/** Clic sur une puce : cadre l'objet et ouvre sa bulle détaillée (reste ouverte). */
export function groundFocus(apt: string, kind: GKind, ref: string) {
  hoverPop?.remove(); hoverPop = null;
  const open = () => {
    const ex = groundExtent(apt, kind, ref);
    if (!ex) return false;
    const side = state.sidebarOpen && !isMobile() ? 380 : 40;
    map.fitBounds([[ex.bbox[0], ex.bbox[1]], [ex.bbox[2], ex.bbox[3]]],
      { padding: { top: 90, bottom: 60, left: side, right: 60 }, maxZoom: 16.5, duration: 700 });
    map.once("moveend", () => {
      showPopup(ex.anchor, groundHtml(ex.props, undefined, gndCtx(apt)));
      focused = { apt, kind, ref };
      groundHighlight(map, focused);
      popup?.on("close", () => { focused = null; groundHighlight(map, null); });
    });
    return true;
  };
  // Plan pas encore chargé à l'écran : on l'affiche d'abord, puis on réessaie une fois les tuiles prêtes
  if (!open()) { openAirportChart(apt); map.once("idle", () => open()); }
}

// ---------- Liste des éléments visibles ----------
export interface ListItem { p: Props; ll: LngLat; d: number }
export interface AwyItem { ident: string; lv: Set<string>; rnav: boolean; n: number }
const TYPE_ORDER: Record<string, number> = { airport: -1, vortac: 0, vordme: 1, vor: 2, tacan: 3, dme: 4, ndb: 5, waypoint: 6 };
let listTimer: ReturnType<typeof setTimeout> | undefined;
export function scheduleList() {
  clearTimeout(listTimer);
  listTimer = setTimeout(() => state.listTick++, 150);
}
const visible = (l: string) => map.getLayer(l) && map.getLayoutProperty(l, "visibility") !== "none";
export function visiblePoints(q: string, sort: string): ListItem[] {
  if (!state.mapReady) return [];
  const c = map.getCenter().toArray() as LngLat;
  const items: ListItem[] = [];
  const seen = new Set<string>();
  for (const f of map.queryRenderedFeatures({ layers: ["apt", "nav", "wpt"].filter(visible) })) {
    const p = f.properties, ll = (f.geometry as GeoJSON.Point).coordinates as LngLat;
    const k = `${p.ident}|${p.cls}|${ll[0].toFixed(3)}|${ll[1].toFixed(3)}`;
    if (seen.has(k) || (q && !String(p.ident).startsWith(q))) continue;
    seen.add(k);
    items.push({ p, ll, d: distNm(c, ll) });
  }
  items.sort((a, b) => sort === "dist" ? a.d - b.d
    : sort === "type" ? (TYPE_ORDER[a.p.cls] - TYPE_ORDER[b.p.cls]) || a.p.ident.localeCompare(b.p.ident)
      : a.p.ident.localeCompare(b.p.ident));
  return items;
}
export function visibleAirways(q: string, sort: string): AwyItem[] {
  if (!state.mapReady) return [];
  const by = new Map<string, AwyItem>();
  for (const f of map.queryRenderedFeatures({ layers: ["awy-H", "awy-L", "awy-B"].filter(visible) })) {
    const p = f.properties;
    if (q && !String(p.ident).startsWith(q)) continue;
    const it = by.get(p.ident) || { ident: p.ident, lv: new Set<string>(), rnav: p.rnav === true || p.rnav === "true", n: 0 };
    it.lv.add(p.level); it.n++;
    by.set(p.ident, it);
  }
  const items = [...by.values()];
  items.sort((a, b) => sort === "dist" ? b.n - a.n
    : sort === "type" ? ([...a.lv].join() + a.ident).localeCompare([...b.lv].join() + b.ident, "fr", { numeric: true })
      : a.ident.localeCompare(b.ident, "fr", { numeric: true }));
  return items;
}

// ---------- Clic sur la carte ----------
const CLICKABLE = ["apt", "nav", "nav-lbl", "wpt", "awy-H", "awy-L", "awy-B", "awy-lbl-H", "awy-lbl-L", "awy-lbl-B"];
const box = (pt: maplibregl.Point, b: number): [PointLike, PointLike] => [[pt.x - b, pt.y - b], [pt.x + b, pt.y + b]];
function propsAt(point: maplibregl.Point, layers: string[], b: number, keyOf: (p: Props) => string): Props[] {
  layers = layers.filter(visible);
  if (!layers.length) return [];
  const seen = new Set<string>(), out: Props[] = [];
  for (const f of map.queryRenderedFeatures(box(point, b), { layers })) {
    const k = keyOf(f.properties);
    if (!seen.has(k)) { seen.add(k); out.push(f.properties); }
  }
  return out;
}
const airspacesAt = (pt: maplibregl.Point) => propsAt(pt, ["asp-fill", ...ASP_LINE_IDS], 3, (p) => `${p.name}|${p.type}|${p.lower}|${p.upper}`);
const overlayAt = (pt: maplibregl.Point, layers: string[], b = 4) => propsAt(pt, layers, b, (p) => p.raw || JSON.stringify(p));

/** Caps vrais officiels (eAIP) par QFU. */
export const eaipEnds = (apt: string): Record<string, number> =>
  Object.fromEntries(Object.entries(state.eaip[apt]?.rwys || {}).filter(([, r]) => r.true != null).map(([q, r]) => [q, r.true!]));

// METAR des aérodromes à plan au sol, pour les composantes de vent dans les bulles (rafraîchi toutes les 10 min)
const gndWx = new Map<string, { m: Metar | null; t: number }>();
function gndCtx(apt: string): GndCtx {
  const c = gndWx.get(apt);
  if (!c || Date.now() - c.t > 600_000) {
    gndWx.set(apt, { m: c?.m ?? null, t: Date.now() });
    metar(apt).then((m) => gndWx.set(apt, { m, t: Date.now() })).catch(() => {});
  }
  return { ends: { ...state.ground[apt]?.ends, ...eaipEnds(apt) }, m: gndWx.get(apt)?.m, eaip: state.eaip[apt], rwys: state.ground[apt]?.taxi?.rwys };
}

function onClick(e: maplibregl.MapMouseEvent) {
  if (state.ruler) return; // la règle capte les clics
  const tipEl = document.getElementById("hover-tip"); if (tipEl) tipEl.hidden = true;
  const feats = map.queryRenderedFeatures(box(e.point, 6), { layers: CLICKABLE.filter((l) => map.getLayer(l)) });
  const pts: MapGeoJSONFeature[] = [], legs: MapGeoJSONFeature[] = [], seen = new Set<string>();
  for (const f of feats) {
    const p = f.properties;
    const isPt = f.geometry.type === "Point";
    const key = isPt ? `p|${p.ident}|${p.cls}|${(f.geometry as GeoJSON.Point).coordinates}` : `l|${p.ident}|${p.from}|${p.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    (isPt ? pts : legs).push(f);
  }
  const awys = [...new Set(legs.map((l) => l.properties.ident as string))];
  const asp = airspacesAt(e.point);
  const hz = overlayAt(e.point, ["hz-fill"], 2);
  const pr = overlayAt(e.point, ["pirep"], 6);
  // Carte d'aéroport : objet au sol (seulement si rien d'autre n'est sous le clic)
  const gnd = map.getLayer("g-stand") ? map.queryRenderedFeatures(box(e.point, 5), { layers: GROUND_CLICKABLE.filter(visible) }) : [];
  const ptLL = (f: MapGeoJSONFeature) => (f.geometry as GeoJSON.Point).coordinates as LngLat;
  closePopup();
  if (!pts.length && !awys.length && gnd.length) {
    selectAirway(null); selectPoint(null);
    const g0 = gnd[0];
    return showPopup(e.lngLat, groundHtml(g0.properties, g0.geometry.type === "Point" ? ptLL(g0) : undefined, gndCtx(g0.properties.apt)));
  }
  if (state.sidebarOpen) {
    const n = pts.length + awys.length + (asp.length ? 1 : 0) + hz.length + pr.length;
    if (!n) { selectAirway(null); selectPoint(null); return; }
    if (n === 1) {
      if (pts.length) return openFix(pts[0].properties, ptLL(pts[0]));
      if (awys.length) return openAirway(awys[0]);
      selectAirway(null); selectPoint(null);
      if (asp.length) return showDetail({ kind: "airspaces", list: asp });
      if (hz.length) return showDetail({ kind: "hazard", p: hz[0] });
      return showDetail({ kind: "pirep", p: pr[0] });
    }
    return showPicker(pts, awys, asp, hz, pr);
  }
  if (pts.length) {
    selectPoint(ptLL(pts[0]));
    showPopup(ptLL(pts[0]), pts.slice(0, 3).map((x) => fixHtml(x.properties, ptLL(x))).join(""));
    selectAirway(null);
  } else if (legs.length) {
    selectPoint(null);
    selectAirway(legs[0].properties.ident);
    showPopup(e.lngLat, legs.slice(0, 3).map((x) => legHtml(x.properties)).join(""));
  } else {
    selectAirway(null); selectPoint(null);
    const html = pr.slice(0, 2).map(pirepHtml).concat(hz.slice(0, 2).map(hazardHtml), asp.slice(0, 3).map(aspHtml)).join("");
    if (html) showPopup(e.lngLat, html);
  }
}

// Plusieurs objets sous le clic : on laisse choisir plutôt que de deviner
function showPicker(pts: MapGeoJSONFeature[], awys: string[], asp: Props[], hz: Props[], pr: Props[]) {
  closePopup();
  selectAirway(null); selectPoint(null);
  const items: PickItem[] = [];
  const APT_KIND: Record<string, string> = { large: "Grand aéroport", medium: "Aéroport", small: "Petit terrain", heliport: "Héliport", seaplane: "Hydrobase" };
  const HZ: Record<string, string> = { conv: "Orages / convection", turb: "Turbulence", ice: "Givrage", ifr: "IFR / relief masqué",
    ash: "Cendres volcaniques", tc: "Cyclone tropical", other: "Autre" };
  for (const f of pts) {
    const p = f.properties, ll = (f.geometry as GeoJSON.Point).coordinates as LngLat;
    const sub = p.cls === "airport" ? (APT_KIND[p.kind] || "Aéroport") : (CLS[p.cls] || p.cls);
    items.push({ label: p.ident, sub: `${sub}${p.name && p.name !== p.ident ? " · " + p.name : ""}`, cls: p.cls === "airport" ? "airport" : p.cls,
      go: () => openFix(p, ll) });
  }
  for (const a of awys) items.push({ label: a, sub: "Voie aérienne", cls: "airway", go: () => openAirway(a) });
  if (asp.length) items.push({ label: `${asp.length} espace${asp.length > 1 ? "s" : ""} aérien${asp.length > 1 ? "s" : ""}`,
    sub: asp.slice(0, 3).map((x) => x.name).join(" · "), cls: "airspace", go: () => showDetail({ kind: "airspaces", list: asp }) });
  for (const h of hz) items.push({ label: `${h.kind} ${h.hazard}`, sub: `${HZ[h.fam] || ""}${h.fir ? " · " + h.fir : ""}`,
    cls: `hz-${h.fam}`, go: () => showDetail({ kind: "hazard", p: h }) });
  for (const p of pr) items.push({ label: p.alt != null ? `PIREP ${p.alt >= 18000 ? "FL" + Math.round(p.alt / 100) : p.alt + " ft"}` : "PIREP",
    sub: [p.tb && `turbulence ${p.tb}`, p.ic && `givrage ${p.ic}`, p.ac].filter(Boolean).join(" · "), cls: "pirep",
    go: () => showDetail({ kind: "pirep", p }) });
  showDetail({ kind: "picker", items });
}

// ---------- Recherche ----------
export function choose(h: Hit) {
  setSel(hitIdent(h));
  if (h.t === "awy") {
    if (state.sidebarOpen) showDetail({ kind: "airway", ident: h.ident });
    selectPoint(null);
    selectAirway(h.ident);
    closePopup();
    const [w, s, e, n] = h.bb;
    // voie traversant l'antiméridien : on centre simplement sur sa partie la plus large
    map.fitBounds([[w, s], [e, n]], { padding: 80, maxZoom: 8, duration: 900 });
    return;
  }
  const [ident, cls, lon, lat, name, region] = h.r;
  selectAirway(null);
  selectPoint([lon, lat]);
  map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), cls === "waypoint" ? 8.5 : 7.5), duration: 900 });
  const basic: Props = { ident, cls, name, region, src: "", freq: null };
  if (state.sidebarOpen) showFixDetail(basic, [lon, lat]);
  else showPopup([lon, lat], fixHtml(basic, [lon, lat]));
  // complète (fréquence, source…) une fois la tuile chargée
  map.once("idle", () => {
    // recherche dans la source (et pas seulement dans ce qui est dessiné : l'étiquette peut être masquée)
    const layer = cls === "airport" ? "airports" : "fixes";
    const f = map.querySourceFeatures(useGeojson ? layer : "nav", {
      ...(useGeojson ? {} : { sourceLayer: layer }), filter: ["==", ["get", "ident"], ident],
    }).find((x) => {
      const c = (x.geometry as GeoJSON.Point).coordinates;
      return Math.abs(c[0] - lon) < 0.01 && Math.abs(c[1] - lat) < 0.01;
    });
    if (!f) return;
    if (state.sidebarOpen) showFixDetail(f.properties, [lon, lat]);
    else showPopup([lon, lat], fixHtml(f.properties, [lon, lat]));
  });
}

// ---------- Carte d'aéroport affichée : terrain pilote au centre de la vue ----------
function updateGroundInView() {
  let found = "";
  if (state.filters.ground && map.getZoom() >= 12) {
    const [x, y] = map.getCenter().toArray();
    for (const [id, g] of Object.entries(state.ground)) {
      const [w, s, e, n] = g.bbox;
      if (x >= w && x <= e && y >= s && y <= n) { found = id; break; }
    }
  }
  state.groundInView = found;
}

// ---------- Initialisation ----------
export async function initMap(container: HTMLElement): Promise<void> {
  maplibregl.setWorkerUrl(workerUrl); // MapLibre 6 (ESM) : le bundler doit fournir l'URL du worker
  const protocol = new Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);
  const abs = (u: string) => new URL(u, location.href).href;

  const [hasNavPm, hasAspPm, hasGroundPm, hasGroundGj] = params.has("geojson")
    ? [false, false, false, await exists(CFG.groundGeojson)]
    : await Promise.all([exists(CFG.pmtiles), exists(CFG.airspacesPmtiles), exists(CFG.groundPmtiles), exists(CFG.groundGeojson)]);
  useGeojson = !hasNavPm;
  const attribution = CFG.attribution;
  const sources: Record<string, unknown> = useGeojson
    ? {
        fixes: { type: "geojson", data: CFG.geojson.fixes, attribution },
        airways: { type: "geojson", data: CFG.geojson.airways },
        airports: { type: "geojson", data: CFG.geojson.airports },
      }
    : { nav: { type: "vector", url: "pmtiles://" + abs(CFG.pmtiles), attribution } };
  sources.asp = hasAspPm ? { type: "vector", url: "pmtiles://" + abs(CFG.airspacesPmtiles) } : { type: "geojson", data: CFG.geojson.airspaces };
  aspSrc = hasAspPm ? { source: "asp", "source-layer": "airspaces" } : { source: "asp" };
  if (hasGroundPm) {
    sources.ground = { type: "vector", url: "pmtiles://" + abs(CFG.groundPmtiles), attribution: CFG.groundAttribution };
    groundSrc = { source: "ground", "source-layer": "ground" };
  } else if (hasGroundGj) {
    sources.ground = { type: "geojson", data: CFG.groundGeojson, attribution: CFG.groundAttribution };
    groundSrc = { source: "ground" };
  }
  sources.mora = { type: "geojson", data: CFG.mora };
  sources.wx = { type: "geojson", data: EMPTY };
  sources.hz = { type: "geojson", data: EMPTY };
  sources.pirep = { type: "geojson", data: EMPTY };
  sources.night = { type: "geojson", data: EMPTY };
  sources.sat = { type: "raster", tiles: CFG.satellite, tileSize: 256, maxzoom: 6 };

  map = new maplibregl.Map({
    container,
    style: await basemap(),
    center: CFG.center,
    zoom: CFG.zoom,
    minZoom: 1.5,
    maxZoom: CFG.maxZoom,
    hash: "map",
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
  // Bouton « Affichage » juste au-dessus du zoom : ouvre le menu MapOptions.vue
  map.addControl({
    onAdd() {
      const d = document.createElement("div");
      d.className = "maplibregl-ctrl maplibregl-ctrl-group";
      d.innerHTML = `<button type="button" id="view-btn" title="Affichage de la carte" aria-label="Affichage de la carte">` +
        LUCIDE_MAP + `</button>`;
      d.querySelector("button")!.addEventListener("click", (e) => { e.stopPropagation(); state.viewMenu = !state.viewMenu; });
      return d;
    },
    onRemove() { /* jamais retiré */ },
  }, "bottom-right");
  map.addControl(rulerControl(), "bottom-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "nautical" }), "bottom-right");
  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
  (window as unknown as { nelixairMap: MlMap }).nelixairMap = map; // débogage et captures d'écran

  // Index des cartes d'aéroport (terrains pilotes)
  if (groundSrc) fetch(CFG.groundIndex).then((r) => (r.ok ? r.json() : null)).then((j: null | { built: string; airports: Record<string, GroundAirport> }) => {
    if (!j) return;
    state.ground = j.airports || {};
    state.groundBuilt = j.built || "";
    if (state.mapReady) { fadeAirportsWithGround(); updateGroundInView(); }
  }).catch(() => { /* cartes d'aéroport indisponibles */ });

  map.on("moveend", () => { if (state.filters.wx) scheduleWx(); scheduleList(); updateGroundInView(); });
  map.on("idle", () => { if (state.tab === "list") scheduleList(); });
  map.on("click", onClick);

  // Survol : pointeur + nom de l'objet sous le curseur (souris uniquement)
  let hlKey = "";
  const tip = document.createElement("div");
  tip.id = "hover-tip"; tip.hidden = true;
  map.getContainer().appendChild(tip);
  map.on("mousemove", (e) => {
    state.cursor = `${dms(e.lngLat.lat, true)} ${dms(e.lngLat.wrap().lng, false)}`;
    const layers = CLICKABLE.concat(map.getLayer("g-stand") ? GROUND_CLICKABLE : []).filter((l) => map.getLayer(l));
    const fs = map.queryRenderedFeatures(box(e.point, 4), { layers });
    map.getCanvas().style.cursor = fs.length ? "pointer" : "";
    if (matchMedia("(hover: none)").matches) return;
    const f = fs[0];
    const gp = f?.layer.id.startsWith("g-") ? f.properties : null;
    const key = gp ? `${gp.apt}|${gp.kind}|${gp.ref}` : "";
    if (key !== hlKey) { hlKey = key; groundHighlight(map, gp || focused); }
    if (!f) { tip.hidden = true; return; }
    const p = f.properties;
    if (gp) tip.innerHTML = groundTip(gp, f.geometry.type === "Point" ? (f.geometry as GeoJSON.Point).coordinates as LngLat : undefined, gndCtx(gp.apt));
    else {
      const what = p.cls === "airport" ? (p.name || "Aéroport") : f.geometry.type === "Point" ? (CLS[p.cls] || "") : `${p.from} → ${p.to}`;
      tip.innerHTML = `<b>${esc(p.ident)}</b> ${esc(what)}`;
    }
    tip.style.transform = `translate(${e.point.x + 14}px, ${e.point.y + 14}px)`;
    tip.hidden = false;
  });
  map.getCanvas().addEventListener("mouseleave", () => { tip.hidden = true; hlKey = ""; groundHighlight(map, focused); });
  // Itinéraire de roulage depuis la popup d'un poste
  map.getContainer().addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    if (t.closest?.("[data-route-clear]")) { clearTaxiRoute(); closePopup(); return; }
    const b = t.closest?.("[data-route]") as HTMLElement | null;
    if (!b) return;
    const [apt, x, y, qfu] = (b.dataset.route || "").split("|");
    showTaxiRoute(apt, [Number(x), Number(y)], qfu);
  });
  // Boutons « copier » des popups (coordonnées d'un poste pour l'IRS/FMS)
  map.getContainer().addEventListener("click", (ev) => {
    const b = (ev.target as HTMLElement).closest?.("[data-copy]") as HTMLElement | null;
    if (!b) return;
    navigator.clipboard?.writeText(b.dataset.copy || "").then(() => { b.textContent = "✓"; setTimeout(() => (b.textContent = "⧉"), 900); }).catch(() => {});
  });

  setInterval(() => refreshOverlays(), 60 * 1000);

  await new Promise<void>((resolve) => map.on("load", () => {
    baseLayers = map.getStyle().layers.slice();
    addLayers(sources);
    initRuler(map);
    state.mapReady = true;
    applyTheme(state.theme);
    applyView();
    applyFilters();
    updateGroundInView();
    if (useGeojson) console.info("Mode GeoJSON (pas de PMTiles trouvées)");
    const sel = params.get("sel");
    if (sel) loadIndex().then(() => {
      const q = sel.toUpperCase();
      const ex = search(q).filter((h) => hitIdent(h) === q);
      const h = ex.find((x) => x.t === "fix" && x.r[1] === "airport") || ex[0];
      if (h) choose(h);
    });
    resolve();
  }));
}
