<script setup lang="ts">
import { computed } from "vue";
import { state } from "../store";

// Cartouche « carte d'aéroport » quand le plan au sol d'un terrain pilote est à l'écran
const g = computed(() => (state.groundInView ? state.ground[state.groundInView] : null));
</script>

<template>
  <div v-if="g" class="chart-badge" role="status">
    <b>{{ state.groundInView }}</b>
    <span>{{ g.name }}</span>
    <small>Plan au sol OSM {{ g.osm.slice(0, 10) }} · non certifié</small>
  </div>
</template>
