<script setup lang="ts">
import { ChevronRight, Route, Signpost, SquareParking, TowerControl } from "@lucide/vue";
import { computed, ref } from "vue";
import { openAirportChart } from "../map/mapView";
import { state } from "../store";

// Aéroports qui ont une carte au sol (OSM), avec ce qu'elle contient
const q = ref("");
const rows = computed(() => Object.entries(state.ground)
  .filter(([id, g]) => !q.value || (id + " " + (g.name || "")).toLowerCase().includes(q.value.toLowerCase()))
  .sort(([a], [b]) => a.localeCompare(b)));
const n = (g: { counts: Record<string, number> }, k: string) => g.counts?.[k] ?? 0;
</script>

<template>
  <section id="tab-airports" class="tabpanel" role="tabpanel">
    <div class="list-ctl"><input v-model="q" type="search" placeholder="Filtrer (ident ou nom)" aria-label="Filtrer les aéroports"></div>
    <p v-if="!rows.length" class="muted small">{{ Object.keys(state.ground).length ? "Aucun aéroport ne correspond." : "Chargement des cartes d'aéroport…" }}</p>
    <ul class="apt-cards">
      <li v-for="[id, g] in rows" :key="id">
        <button type="button" :title="'Ouvrir la carte de ' + id" @click="openAirportChart(String(id))">
          <span class="ac-h"><b>{{ id }}</b><small>{{ g.name }}</small><ChevronRight :size="16" aria-hidden="true" /></span>
          <span class="ac-m">
            <span title="Pistes"><TowerControl :size="13" aria-hidden="true" />{{ g.runways.length }} pistes</span>
            <span title="Taxiways"><Signpost :size="13" aria-hidden="true" />{{ g.taxiways.length || n(g, "taxiway") }} taxiways</span>
            <span title="Postes de stationnement"><SquareParking :size="13" aria-hidden="true" />{{ n(g, "stand") }} postes</span>
          </span>
          <span class="ac-tags">
            <i v-if="g.taxi" title="Itinéraire de roulage calculable"><Route :size="12" aria-hidden="true" />Roulage</i>
            <i v-if="state.eaip[id]" title="Données officielles eAIP SIA">eAIP {{ state.eaipCycle }}</i>
          </span>
        </button>
      </li>
    </ul>
    <p class="muted small">Plans au sol : OpenStreetMap (ODbL). Pistes France : eAIP SIA (Licence Ouverte).</p>
  </section>
</template>
