<script setup lang="ts">
import { PanelLeftClose } from "@lucide/vue";
import { computed, onMounted } from "vue";
import { resizeMap, setSidebar } from "../map/mapView";
import { state, type Tab } from "../store";
import AirportsPanel from "./AirportsPanel.vue";
import FlightPanel from "./FlightPanel.vue";
import DetailPanel from "./DetailPanel.vue";
import FiltersPanel from "./FiltersPanel.vue";
import ListPanel from "./ListPanel.vue";

const TITLES: Record<Tab, [string, string]> = {
  detail: ["Fiche", "Objet sélectionné sur la carte"],
  flight: ["Plan de vol", "Import SimBrief et nav log"],
  airports: ["Aéroports", "Cartes d'aéroport disponibles"],
  list: ["Liste", "Objets visibles à l'écran"],
  filters: ["Calques", "Ce qui est dessiné sur la carte"],
};
const title = computed(() => TITLES[state.tab]);

// Largeur du panneau réglable : on tire la poignée du bord droit, double-clic = largeur par défaut.
const W_DEF = 340, W_MIN = 300, KEY = "tropo-side-w";
const wMax = () => Math.max(W_MIN, Math.min(820, window.innerWidth * 0.6));
let raf = 0;
function setWidth(w: number, save = false) {
  const v = Math.round(Math.min(wMax(), Math.max(W_MIN, w)));
  document.documentElement.style.setProperty("--side", `${v}px`);
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(resizeMap);
  if (save) { try { localStorage.setItem(KEY, String(v)); } catch { /* stockage indisponible */ } }
  return v;
}
function startDrag(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement;
  const left = el.parentElement!.getBoundingClientRect().left;
  el.setPointerCapture(e.pointerId);
  document.body.classList.add("side-resizing");
  let w = 0;
  const move = (ev: PointerEvent) => { w = setWidth(ev.clientX - left); };
  const up = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    document.body.classList.remove("side-resizing");
    if (w) setWidth(w, true);
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
}
function resetWidth() { setWidth(W_DEF, true); }
function keyResize(e: KeyboardEvent) {
  const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--side")) || W_DEF;
  if (e.key === "ArrowRight") { setWidth(cur + 40, true); e.preventDefault(); }
  else if (e.key === "ArrowLeft") { setWidth(cur - 40, true); e.preventDefault(); }
}
onMounted(() => {
  let saved = 0;
  try { saved = Number(localStorage.getItem(KEY)) || 0; } catch { /* stockage indisponible */ }
  if (saved) setWidth(saved);
});
</script>

<template>
  <aside id="sidebar" class="sidebar" aria-label="Panneau d'informations" :aria-hidden="!state.sidebarOpen">
    <div class="side-head">
      <div class="side-t"><b>{{ title[0] }}</b><small>{{ title[1] }}</small></div>
      <button id="side-close" class="tbtn icon" type="button" title="Fermer le panneau (F)" @click="setSidebar(false)">
        <PanelLeftClose :size="18" :stroke-width="1.8" aria-hidden="true" />
      </button>
    </div>
    <DetailPanel v-show="state.tab === 'detail'" />
    <FlightPanel v-show="state.tab === 'flight'" />
    <AirportsPanel v-show="state.tab === 'airports'" />
    <ListPanel v-show="state.tab === 'list'" />
    <FiltersPanel v-show="state.tab === 'filters'" />
    <div class="side-grip" role="separator" aria-orientation="vertical" aria-label="Largeur du panneau" tabindex="0"
      title="Tirer pour élargir · double-clic : largeur par défaut" @pointerdown.prevent="startDrag" @dblclick="resetWidth" @keydown="keyResize"></div>
  </aside>
</template>
