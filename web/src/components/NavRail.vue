<script setup lang="ts">
import { BookOpen, FileText, Layers, List, Map as MapIcon, Moon, PlaneLanding, Sun, type LucideIcon } from "@lucide/vue";
import { setSidebar, setTab } from "../map/mapView";
import { state, type Tab } from "../store";

// Barre de navigation verticale : une icône par grande section du panneau.
// Cliquer la section déjà ouverte referme le panneau.
const logo = import.meta.env.BASE_URL + "img/nelixair-logo.svg";
const emit = defineEmits<{ about: [] }>();
const SECTIONS: [Tab, string, LucideIcon][] = [
  ["detail", "Fiche", FileText], ["airports", "Aéroports", PlaneLanding], ["list", "Liste", List], ["filters", "Calques", Layers],
];
function go(t: Tab) {
  if (state.sidebarOpen && state.tab === t) return setSidebar(false);
  setTab(t);
  if (!state.sidebarOpen) setSidebar(true);
}
const active = (t: Tab) => state.sidebarOpen && state.tab === t;
</script>

<template>
  <nav class="rail" aria-label="Sections">
    <div class="rail-logo"><img :src="logo" alt="Nelixair" width="26" height="26"></div>
    <button v-for="[id, label, icon] in SECTIONS" :key="id" type="button" class="rail-btn" :data-tab="id"
      :aria-pressed="active(id)" aria-controls="sidebar" :aria-label="label" @click="go(id)">
      <component :is="icon" :size="20" :stroke-width="1.8" aria-hidden="true" /><span class="rail-tip">{{ label }}</span>
    </button>
    <div class="rail-sp"></div>
    <button type="button" class="rail-btn" :aria-pressed="state.viewMenu" aria-label="Affichage de la carte"
      @click.stop="state.viewMenu = !state.viewMenu">
      <MapIcon :size="20" :stroke-width="1.8" aria-hidden="true" /><span class="rail-tip">Affichage</span>
    </button>
    <button id="theme-btn" type="button" class="rail-btn" :aria-label="state.theme === 'night' ? 'Mode jour' : 'Mode nuit'"
      @click="state.theme = state.theme === 'night' ? 'day' : 'night'">
      <component :is="state.theme === 'night' ? Sun : Moon" :size="20" :stroke-width="1.8" aria-hidden="true" />
      <span class="rail-tip">{{ state.theme === "night" ? "Mode jour" : "Mode nuit" }}</span>
    </button>
    <button id="about-btn" type="button" class="rail-btn" aria-label="Sources et licences" @click="emit('about')">
      <BookOpen :size="20" :stroke-width="1.8" aria-hidden="true" /><span class="rail-tip">Sources et licences</span>
    </button>
  </nav>
</template>
