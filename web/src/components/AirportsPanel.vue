<script setup lang="ts">
import { ArrowLeft, ChevronLeft, ChevronRight, Route, Signpost, SquareParking, TowerControl, X } from "@lucide/vue";
import { computed, nextTick, ref } from "vue";
import { airportLL, closeAirportPane, openAirportInList } from "../map/mapView";
import { useSplitPane } from "../lib/splitPane";
import AirportDetail from "./AirportDetail.vue";
import { setHalo } from "../map/fx";
import { useMapHotScroll } from "../lib/mapHot";
import { state } from "../store";

// Aéroports qui ont une carte au sol (OSM), avec ce qu'elle contient
const q = ref("");
const rows = computed(() => Object.entries(state.ground)
  .filter(([id, g]) => !q.value || (id + " " + (g.name || "")).toLowerCase().includes(q.value.toLowerCase()))
  .sort(([a], [b]) => a.localeCompare(b)));
const n = (g: { counts: Record<string, number> }, k: string) => g.counts?.[k] ?? 0;
const root = ref<HTMLElement | null>(null);
const list = ref<HTMLElement | null>(null);
useMapHotScroll(() => list.value);

// Liste et fiche côte à côte quand le panneau est large ; il s'élargit tout seul à l'ouverture d'une fiche
const { wide } = useSplitPane(root, () => !!state.aptPane && state.tab === "airports" && state.sidebarOpen);

const cur = computed(() => state.aptPane?.p.ident as string | undefined);
let listTop = 0;
function open(id: string) {
  if (!wide.value && list.value) listTop = list.value.scrollTop;
  openAirportInList(id);
}
async function back() {
  closeAirportPane();
  await nextTick();
  if (list.value) list.value.scrollTop = listTop;
}
const pos = computed(() => rows.value.findIndex(([id]) => id === cur.value));
function step(d: number) {
  const r = rows.value[pos.value + d];
  if (r) open(r[0]);
}
</script>

<template>
  <section id="tab-airports" ref="root" class="tabpanel apt-split" :class="{ wide, open: !!state.aptPane }" role="tabpanel">
    <div v-show="wide || !state.aptPane" ref="list" class="apt-list">
      <div class="list-ctl"><input v-model="q" type="search" placeholder="Filtrer (ident ou nom)" aria-label="Filtrer les aéroports"></div>
      <p v-if="!rows.length" class="muted small">{{ Object.keys(state.ground).length ? "Aucun aéroport ne correspond." : "Chargement des cartes d'aéroport…" }}</p>
      <ul class="apt-cards">
        <li v-for="[id, g] in rows" :key="id">
          <button type="button" :title="'Ouvrir la fiche et la carte de ' + id" :aria-current="cur === id ? 'true' : undefined"
            :class="{ 'map-hot': state.mapHover === 'apt:' + id, cur: cur === id }"
            @click="open(String(id))" @mouseenter="setHalo(airportLL(String(id)))" @mouseleave="setHalo(null)">
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
    </div>
    <div v-if="state.aptPane" class="apt-pane">
      <div class="pane-nav">
        <button v-if="!wide" type="button" class="pane-back" @click="back"><ArrowLeft :size="16" aria-hidden="true" />Aéroports</button>
        <span v-else class="muted small">{{ pos + 1 }} / {{ rows.length }}</span>
        <span class="pane-step">
          <button type="button" :disabled="pos <= 0" title="Aéroport précédent" aria-label="Aéroport précédent" @click="step(-1)"><ChevronLeft :size="16" aria-hidden="true" /></button>
          <button type="button" :disabled="pos < 0 || pos >= rows.length - 1" title="Aéroport suivant" aria-label="Aéroport suivant" @click="step(1)"><ChevronRight :size="16" aria-hidden="true" /></button>
          <button v-if="wide" type="button" title="Fermer la fiche" aria-label="Fermer la fiche" @click="back"><X :size="16" aria-hidden="true" /></button>
        </span>
      </div>
      <AirportDetail :key="'p' + state.aptPane.p.ident" :p="state.aptPane.p" :ll="state.aptPane.ll" />
    </div>
  </section>
</template>
