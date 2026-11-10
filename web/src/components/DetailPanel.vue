<script setup lang="ts">
import { ref, watch } from "vue";
import { ASP_GROUP, pairs } from "../lib/format";
import { openAirportChart } from "../map/mapView";
import { hazardHtml, pirepHtml } from "../map/popups";
import { state } from "../store";
import AirportDetail from "./AirportDetail.vue";
import AirwayDetail from "./AirwayDetail.vue";
import FixDetail from "./FixDetail.vue";
import KeyValues from "./KeyValues.vue";

const el = ref<HTMLElement | null>(null);
// Nouvelle fiche : retour en haut du panneau
watch(() => state.detail, () => { if (el.value) el.value.scrollTop = 0; });

const sortedAsp = (list: Record<string, any>[]) => list.slice().sort((a, b) => (a.lower_ft ?? 0) - (b.lower_ft ?? 0));
</script>

<template>
  <section id="tab-detail" ref="el" class="tabpanel" role="tabpanel">
    <template v-if="state.detail.kind === 'empty'">
      <p class="muted">Clique un aéroport, un point ou une voie sur la carte, ou tape un ident dans la recherche (<kbd>/</kbd>).</p>
      <template v-if="Object.keys(state.ground).length">
        <h3>Cartes d'aéroport disponibles</h3>
        <div class="quick-apt">
          <button v-for="(g, id) in state.ground" :key="id" type="button" :title="'Ouvrir le plan au sol de ' + id" @click="openAirportChart(String(id))">
            <b>{{ id }}</b><small>{{ g.name || "" }}</small>
          </button>
        </div>
      </template>
    </template>

    <AirportDetail v-else-if="state.detail.kind === 'airport'" :key="'a' + state.detail.p.ident" :p="state.detail.p" :ll="state.detail.ll" />
    <FixDetail v-else-if="state.detail.kind === 'fix'" :key="'f' + state.detail.p.ident + state.detail.ll" :p="state.detail.p" :ll="state.detail.ll" />
    <AirwayDetail v-else-if="state.detail.kind === 'airway'" :key="'w' + state.detail.ident" :ident="state.detail.ident" />

    <template v-else-if="state.detail.kind === 'airspaces'">
      <div class="d-head"><h2>Espaces</h2><span class="badge">{{ state.detail.list.length }}</span></div>
      <p class="muted small">Espaces aériens à cet endroit, du plus bas au plus haut.</p>
      <template v-for="(p, i) in sortedAsp(state.detail.list)" :key="i">
        <h3>{{ p.name }} · {{ p.type }}{{ p.icao_class ? " · classe " + p.icao_class : "" }}</h3>
        <KeyValues :rows="pairs([['Plancher', p.lower], ['Plafond', p.upper], ['Catégorie', ASP_GROUP[p.group]], ['Pays', p.country]])" />
      </template>
    </template>

    <!-- Avis météo : même rendu que les popups (contenu échappé dans popups.ts) -->
    <div v-else-if="state.detail.kind === 'hazard'" class="ov-detail" v-html="hazardHtml(state.detail.p)"></div>
    <div v-else-if="state.detail.kind === 'pirep'" class="ov-detail" v-html="pirepHtml(state.detail.p)"></div>

    <template v-else-if="state.detail.kind === 'picker'">
      <div class="d-head"><h2>À cet endroit</h2><span class="badge">{{ state.detail.items.length }}</span></div>
      <ul class="picker">
        <li v-for="(it, i) in state.detail.items" :key="i">
          <button @click="it.go()"><i class="dot" :class="'c-' + it.cls"></i><b>{{ it.label }}</b><small>{{ it.sub }}</small></button>
        </li>
      </ul>
    </template>
  </section>
</template>
