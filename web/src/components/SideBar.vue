<script setup lang="ts">
import { PanelLeftClose } from "@lucide/vue";
import { computed } from "vue";
import { setSidebar } from "../map/mapView";
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
  </aside>
</template>
