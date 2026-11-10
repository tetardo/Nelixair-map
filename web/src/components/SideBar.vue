<script setup lang="ts">
import { setSidebar, setTab } from "../map/mapView";
import { state, type Tab } from "../store";
import DetailPanel from "./DetailPanel.vue";
import FiltersPanel from "./FiltersPanel.vue";
import ListPanel from "./ListPanel.vue";

const TABS: [Tab, string][] = [["filters", "Filtres"], ["list", "Liste"], ["detail", "Détail"]];
</script>

<template>
  <aside id="sidebar" class="sidebar" aria-label="Filtres et informations" :aria-hidden="!state.sidebarOpen">
    <div class="side-head">
      <nav class="tabs" role="tablist">
        <button v-for="[id, label] in TABS" :key="id" role="tab" :aria-selected="state.tab === id" @click="setTab(id)">{{ label }}</button>
      </nav>
      <button id="side-close" class="tbtn icon" type="button" title="Fermer" @click="setSidebar(false)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </button>
    </div>
    <FiltersPanel v-show="state.tab === 'filters'" />
    <ListPanel v-show="state.tab === 'list'" />
    <DetailPanel v-show="state.tab === 'detail'" />
  </aside>
</template>
