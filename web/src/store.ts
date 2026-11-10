// État partagé de l'interface (réactif). La carte MapLibre n'y est pas : elle vit dans map/mapView.ts.
import { reactive } from "vue";
import type { LngLat } from "./lib/format";
import type { Ofp } from "./services/simbrief";
import type { Atc, Pilot } from "./services/traffic";
import type { ThemeName } from "./map/themes";
import { THEMES } from "./map/themes";

export type Props = Record<string, any>;

export interface PickItem { label: string; sub: string; cls: string; go: () => void }

export type Detail =
  | { kind: "empty" }
  | { kind: "airport"; p: Props; ll: LngLat }
  | { kind: "fix"; p: Props; ll: LngLat }
  | { kind: "airway"; ident: string }
  | { kind: "airspaces"; list: Props[] }
  | { kind: "hazard"; p: Props }
  | { kind: "pirep"; p: Props }
  | { kind: "traffic"; p: Pilot }
  | { kind: "atc"; icao: string; list: Atc[] }
  | { kind: "picker"; items: PickItem[] };

export type Tab = "detail" | "flight" | "flights" | "airports" | "list" | "filters";

export interface GroundAirport {
  name: string; bbox: [number, number, number, number]; osm: string;
  counts: Record<string, number>; runways: string[]; taxiways: string[];
  ends?: Record<string, number>; // QFU -> cap vrai
  taxi?: { nodes: number; stands: number; rwys: string[] }; // graphe de roulage disponible
}

// Données officielles eAIP SIA (France), voir pipeline/eaip.py
export interface EaipRwy {
  true?: number; mag?: number; len?: number; wid?: number; pcn?: string; surface?: string;
  thr?: [number, number]; dthr?: [number, number]; thr_elev?: number; dthr_elev?: number;
  tora?: number; toda?: number; asda?: number; lda?: number;
  intersections?: { twy: string; tora: number; pos?: [number, number] }[];
  apch_lgt?: string; papi?: number; meht_ft?: number;
  ils?: { id?: string | null; freq?: number | null; cat?: string; gs?: number; rdh_ft?: number; dme?: boolean };
}
export interface EaipApt {
  arp?: [number, number]; elev_ft?: number; magvar?: number; magvar_year?: number; ta_ft?: number;
  rwys: Record<string, EaipRwy>; navaids?: { type: string; id: string; freq: string; pos?: [number, number] }[];
}

export interface SourceMeta { id: string; name: string; license?: string; url: string; coverage?: string; cycle?: string }

function storage<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch { return fallback; }
}

export type ThemeMode = ThemeName | "auto";

/** Réglage choisi : Jour, Nuit ou Auto (soleil à la position affichée). Auto par défaut. */
function initialThemeMode(): ThemeMode {
  try {
    const m = localStorage.getItem("tropo-theme-mode");
    if (m === "auto" || (m && m in THEMES)) return m as ThemeMode;
    const old = localStorage.getItem("nelixair-theme"); // réglage de l'ancienne version
    if (old && old in THEMES) return old as ThemeName;
  } catch { /* stockage indisponible */ }
  return "auto";
}

/** Thème au démarrage, avant que la carte ne sache où elle est : réglage explicite, sinon dernier thème vu, sinon le système. */
function initialTheme(mode: ThemeMode): ThemeName {
  if (mode !== "auto") return mode;
  try { const t = localStorage.getItem("nelixair-theme"); if (t && t in THEMES) return t as ThemeName; } catch { /* stockage indisponible */ }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "day";
}
const MODE0 = initialThemeMode();

/** Animations de la carte : actives sauf si l'utilisateur les a coupées ou si le système demande moins de mouvement. */
function initialAnim(): boolean {
  try { const v = localStorage.getItem("tropo-anim"); if (v != null) return v === "1"; } catch { /* stockage indisponible */ }
  return !matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Filtres par défaut (cochés / décochés comme dans la version précédente)
export const DEFAULT_FILTERS: Record<string, boolean> = {
  H: true, L: true, rnav: true, conv: true,
  vor: true, vordme: true, vortac: true, tacan: true, dme: true, ndb: true, waypoint: true,
  apt_large: true, apt_medium: true, apt_small: true, apt_heli: false,
  asp_controlled: true, asp_special: true, asp_fir: true, asp_other: false,
  wx: true, hazards: true, pireps: false, sat: false, night: false, mora: true,
  ground: true, approach: true,
  vatsim: false, ivao: false,
};

// Affichage du fond de carte (menu près du zoom). Par défaut : épuré façon carte en route.
export interface MapView { base: "plan" | "sat"; relief: boolean; roads: boolean; buildings: boolean; landuse: boolean; places: boolean }
export const DEFAULT_VIEW: MapView = { base: "plan", relief: false, roads: false, buildings: false, landuse: false, places: true };

export const state = reactive({
  view: { ...DEFAULT_VIEW, ...storage<Partial<MapView>>("nelixair-view", {}) } as MapView,
  themeMode: MODE0,
  anim: initialAnim(),
  /** Élément survolé sur la carte, pour allumer sa ligne dans le panneau : "apt:LFML", "fix:MTL", "awy:UN852", "ofp:3" */
  mapHover: "" as string,
  /** Thème effectivement affiché (résolu depuis themeMode) */
  theme: initialTheme(MODE0),
  sidebarOpen: false,
  tab: "filters" as Tab,
  ofp: storage<Ofp | null>("nelixair-ofp", null),
  filters: { ...DEFAULT_FILTERS, ...storage<Record<string, boolean>>("nelixair-filters", {}) },
  detail: { kind: "empty" } as Detail,
  wxStatus: "" as string,
  trafficStatus: "" as string,
  cursor: "—",
  cycleText: "",
  sources: [] as SourceMeta[],
  built: "",
  counts: null as null | { fixes: number; airways: number },
  metaError: false,
  chartsMeta: null as null | { name: string; cycle: string; base: string },
  ground: {} as Record<string, GroundAirport>,
  groundBuilt: "",
  eaip: {} as Record<string, EaipApt>,
  eaipCycle: "",
  // Carte d'aéroport affichée (terrain pilote au centre de la vue, zoom ≥ 12)
  groundInView: "" as string,
  mapReady: false,
  viewMenu: false,
  profileAt: null as number | null, // curseur du profil placé par un clic sur la route (NM)
  logbookMap: false, // « Mes vols » : tous les trajets affichés sur la carte
  aptPane: null as { p: Props; ll: LngLat } | null, // fiche ouverte dans l'onglet Aéroports (liste gardée)
  profileOpen: false, // profil vertical du plan de vol (bandeau bas)
  ruler: false, // outil règle actif
  listTick: 0,
});

export const isMobile = (): boolean => matchMedia("(max-width: 760px)").matches;
