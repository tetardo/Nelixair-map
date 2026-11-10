// Lien de partage : reproduit la vue exacte (position, fond, calques, thème, panneau, sélection, plan de vol).
// Position et zoom sont déjà dans le hash (#map=zoom/lat/lon, géré par MapLibre) et la sélection dans ?sel=.
// Ce module ajoute le reste en paramètres courts, relatifs aux réglages par défaut :
//   th=night  b=sat  v=relief,roads  f=+sat,-wx  p=airports  ofp=<plan compressé>|demo  pf=1 (profil vertical)
import { DEFAULT_FILTERS, DEFAULT_VIEW, state, type MapView, type Tab } from "../store";
import { THEMES, type ThemeName } from "../map/themes";
import type { Ofp } from "../services/simbrief";

const TOGGLES: (keyof MapView)[] = ["relief", "roads", "buildings", "landuse", "places"];
const TABS: Tab[] = ["detail", "flight", "airports", "list", "filters"];
const KEYS = ["th", "b", "v", "f", "p", "ofp", "pf"];
/** Au-delà, le plan de vol est retiré du lien (certaines messageries tronquent les URL longues). */
const MAX_URL = 8000;

// ---------- Compression du plan de vol (deflate + base64url) ----------
async function pack(o: unknown): Promise<string> {
  const s = new Blob([JSON.stringify(o)]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const b = new Uint8Array(await new Response(s).arrayBuffer());
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function unpack<T>(s: string): Promise<T> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const b = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const st = new Blob([b]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return JSON.parse(await new Response(st).text()) as T;
}

/** Construit le lien de la vue actuelle. `ofpDropped` : plan de vol trop long, non inclus. */
export async function shareUrl(): Promise<{ url: string; ofpDropped: boolean }> {
  const u = new URL(location.href);
  for (const k of KEYS) u.searchParams.delete(k);
  const q = u.searchParams;
  q.set("th", state.theme);
  if (state.view.base !== DEFAULT_VIEW.base) q.set("b", state.view.base);
  const v = TOGGLES.filter((k) => state.view[k]);
  q.set("v", v.join(",")); // toujours présent (même vide) : le destinataire a peut-être d'autres réglages
  const f = Object.keys(DEFAULT_FILTERS).filter((k) => !!state.filters[k] !== DEFAULT_FILTERS[k])
    .map((k) => (state.filters[k] ? "+" : "-") + k);
  q.set("f", f.join(","));
  if (state.sidebarOpen) q.set("p", state.tab);
  if (state.ofp && state.profileOpen) q.set("pf", "1");
  let ofpDropped = false;
  if (state.ofp) {
    if (state.ofp.user === "démo") q.set("ofp", "demo");
    else {
      q.set("ofp", await pack({ ...state.ofp, user: "" })); // le nom SimBrief du pilote ne part pas dans le lien
      if (u.href.length > MAX_URL) { q.delete("ofp"); ofpDropped = true; }
    }
  }
  return { url: u.href, ofpDropped };
}

/** Lien partagé ouvert : applique ses réglages avant l'affichage de la carte. */
export function applySharedState(): boolean {
  const q = new URLSearchParams(location.search);
  if (!KEYS.some((k) => q.has(k))) return false;
  const th = q.get("th");
  if (th && th in THEMES) { state.themeMode = th as ThemeName; state.theme = th as ThemeName; } // le lien fige le thème vu par l'expéditeur
  if (q.has("b") || q.has("v")) {
    const on = new Set((q.get("v") || "").split(",").filter(Boolean));
    state.view = { ...state.view, base: q.get("b") === "sat" ? "sat" : "plan",
      ...Object.fromEntries(TOGGLES.map((k) => [k, on.has(k)])) } as MapView;
  }
  if (q.has("f")) {
    const f = { ...DEFAULT_FILTERS };
    for (const t of (q.get("f") || "").split(",")) {
      const k = t.slice(1);
      if (k in f && (t[0] === "+" || t[0] === "-")) f[k] = t[0] === "+";
    }
    state.filters = f;
  }
  // Sans plan de vol dans le lien, on masque celui du destinataire (sans l'effacer : il revient au rechargement)
  if (!q.has("ofp")) state.ofp = null;
  return true;
}

/** Après chargement de la carte : panneau, plan de vol, puis nettoyage de l'URL (garde position et sélection). */
export async function applySharedAfterMap(open: (tab: Tab | null) => void, setOfp: (o: Ofp) => void, demo: () => Promise<Ofp>) {
  const q = new URLSearchParams(location.search);
  if (!KEYS.some((k) => q.has(k))) return;
  const p = q.get("p") as Tab | null;
  open(p && TABS.includes(p) ? p : null);
  if (q.get("pf") === "1") state.profileOpen = true;
  const o = q.get("ofp");
  try {
    if (o === "demo") setOfp(await demo());
    else if (o) setOfp(await unpack<Ofp>(o));
  } catch (e) { console.warn("Plan de vol du lien illisible", e); }
  const u = new URL(location.href);
  for (const k of KEYS) u.searchParams.delete(k);
  history.replaceState(history.state, "", u);
}
