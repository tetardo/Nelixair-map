// État partagé de l'interface (réactif). La carte MapLibre n'y est pas : elle vit dans map/mapView.ts.
import { reactive } from "vue";
import type { LngLat } from "./lib/format";
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
  | { kind: "picker"; items: PickItem[] };

export type Tab = "detail" | "airports" | "list" | "filters";

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

function initialTheme(): ThemeName {
  try { const t = localStorage.getItem("nelixair-theme"); if (t && t in THEMES) return t as ThemeName; } catch { /* stockage indisponible */ }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "day";
}

// Filtres par défaut (cochés / décochés comme dans la version précédente)
export const DEFAULT_FILTERS: Record<string, boolean> = {
  H: true, L: true, rnav: true, conv: true,
  vor: true, vordme: true, vortac: true, tacan: true, dme: true, ndb: true, waypoint: true,
  apt_large: true, apt_medium: true, apt_small: true, apt_heli: false,
  asp_controlled: true, asp_special: true, asp_fir: true, asp_other: false,
  wx: true, hazards: true, pireps: false, sat: false, night: false, mora: true,
  ground: true, approach: true,
};

// Affichage du fond de carte (menu près du zoom). Par défaut : épuré façon carte en route.
export interface MapView { base: "plan" | "sat"; relief: boolean; roads: boolean; buildings: boolean; landuse: boolean; places: boolean }
export const DEFAULT_VIEW: MapView = { base: "plan", relief: false, roads: false, buildings: false, landuse: false, places: true };

export const state = reactive({
  view: { ...DEFAULT_VIEW, ...storage<Partial<MapView>>("nelixair-view", {}) } as MapView,
  theme: initialTheme(),
  sidebarOpen: false,
  tab: "filters" as Tab,
  filters: { ...DEFAULT_FILTERS, ...storage<Record<string, boolean>>("nelixair-filters", {}) },
  detail: { kind: "empty" } as Detail,
  wxStatus: "" as string,
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
  listTick: 0,
});

export const isMobile = (): boolean => matchMedia("(max-width: 760px)").matches;
