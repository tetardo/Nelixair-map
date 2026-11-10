<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import AboutDialog from "./components/AboutDialog.vue";
import AirportChartBadge from "./components/AirportChartBadge.vue";
import NavRail from "./components/NavRail.vue";
import RouteProfile from "./components/RouteProfile.vue";
import SplashScreen from "./components/SplashScreen.vue";
import MapOptions from "./components/MapOptions.vue";
import SideBar from "./components/SideBar.vue";
import StatusBar from "./components/StatusBar.vue";
import TopBar from "./components/TopBar.vue";
import { CFG } from "./config";
import { applySharedAfterMap, applySharedState } from "./lib/share";
import { applyFilters, applyTheme, applyView, clearSelection, initMap, setEaip, setOfp, setSidebar, setTab, updateAutoTheme } from "./map/mapView";
import { demoOfp } from "./services/simbrief";
import { isMobile, state } from "./store";

const mapEl = ref<HTMLElement | null>(null);
const about = ref<InstanceType<typeof AboutDialog> | null>(null);
const search = ref<InstanceType<typeof TopBar> | null>(null);

const shared = applySharedState(); // lien partagé : ses réglages priment sur ceux mémorisés
applyTheme(state.theme);
watch(() => state.theme, applyTheme);
watch(() => state.anim, (on) => { try { localStorage.setItem("tropo-anim", on ? "1" : "0"); } catch { /* stockage indisponible */ } });
watch(() => state.themeMode, (m) => {
  try { localStorage.setItem("tropo-theme-mode", m); } catch { /* stockage indisponible */ }
  updateAutoTheme();
}, { immediate: true }); // mémorisé dès le départ : sinon le dernier thème affiché passerait pour un choix explicite
watch(() => state.filters, applyFilters, { deep: true });
watch(() => state.view, applyView, { deep: true });

// Métadonnées : sources, cycles, cartes FAA
fetch(CFG.meta).then((r) => r.json()).then((meta) => {
  state.sources = meta.sources || [];
  state.built = meta.built || "";
  state.counts = meta.counts || null;
  state.chartsMeta = meta.charts || null;
  state.cycleText = state.sources.filter((s) => s.cycle).map((s) => `${s.name} ${s.cycle}`).join(" · ");
}).catch(() => { state.metaError = true; });

onMounted(async () => {
  // Données de piste officielles France (eAIP SIA) : facultatives
  fetch(CFG.eaip).then((r) => (r.ok ? r.json() : null)).then((j) => {
    if (!j?.airports) return;
    state.eaipCycle = j.cycle || "";
    setEaip(j.airports);
  }).catch(() => { /* pas de données eAIP */ });
  let saved: string | null = null;
  try { saved = localStorage.getItem("nelixair-side"); } catch { /* stockage indisponible */ }
  await initMap(mapEl.value!);
  setSidebar(!isMobile() && saved !== "0", false);
  if (shared) applySharedAfterMap((tab) => {
    if (tab) setTab(tab);
    setSidebar(!!tab, false);
  }, (o) => setOfp(o, { fit: false }), demoOfp);
});

// Raccourcis : / chercher, F panneau, Échap effacer la sélection
document.addEventListener("keydown", (e) => {
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || "");
  if (e.key === "/" && !typing) { e.preventDefault(); search.value?.focus(); }
  else if (e.key === "Escape" && !typing) clearSelection();
  else if ((e.key === "f" || e.key === "F") && !typing && !e.metaKey && !e.ctrlKey) setSidebar(!state.sidebarOpen);
});
</script>

<template>
  <div id="map" ref="mapEl" aria-label="Carte aéronautique"></div>
  <NavRail @about="about?.open()" />
  <TopBar ref="search" />
  <SideBar />
  <StatusBar />
  <AirportChartBadge />
  <MapOptions />
  <RouteProfile />
  <div class="nfn">NE PAS UTILISER POUR LA NAVIGATION</div>
  <AboutDialog ref="about" />
  <SplashScreen />
</template>
