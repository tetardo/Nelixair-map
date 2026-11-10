<script setup lang="ts">
// « Mes vols » : carnet du pilote (fictif pour l'instant), ouverture d'un vol, tous les trajets sur la carte.
import { ArrowRight, Map as MapIcon, Plane } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { PILOT, logbook } from "../lib/demoFlights";
import { useMapHotScroll } from "../lib/mapHot";
import { highlightLogbook, showLogbook } from "../map/logbookLayer";
import { openLogFlight } from "../map/mapView";
import { hhmm } from "../services/simbrief";
import { state } from "../store";

const flights = logbook();
const totalH = computed(() => hhmm(flights.reduce((s, f) => s + f.ete, 0)));
const totalNm = flights.reduce((s, f) => s + f.nm, 0).toLocaleString("fr-FR");
const airports = new Set(flights.flatMap((f) => [f.orig, f.dest])).size;
const fmtDate = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const current = computed(() => (state.ofp?.user.startsWith("démo:") ? Number(state.ofp.user.slice(5)) : -1));

function toggleMap() {
  state.logbookMap = !state.logbookMap;
  showLogbook(state.logbookMap);
}
watch(() => state.logbookMap, (on) => showLogbook(on, false));
function hover(id: number) { if (state.logbookMap) highlightLogbook(id); }

const root = ref<HTMLElement | null>(null);
useMapHotScroll(() => root.value);
</script>

<template>
  <section id="tab-flights" ref="root" class="tabpanel" role="tabpanel">
    <div class="lb-pilot">
      <div class="lb-avatar" aria-hidden="true"><Plane :size="18" :stroke-width="1.8" /></div>
      <div class="lb-who"><b>{{ PILOT.name }}</b><small>{{ PILOT.id }} · base {{ PILOT.base }}</small></div>
      <span class="badge b-demo">Démo fictive</span>
    </div>
    <div class="lb-stats">
      <div><small>Vols</small><b>{{ flights.length }}</b></div>
      <div><small>Heures</small><b>{{ totalH }}</b></div>
      <div><small>Distance</small><b>{{ totalNm }} NM</b></div>
      <div><small>Terrains</small><b>{{ airports }}</b></div>
    </div>
    <div class="apt-actions lb-actions"><button type="button" class="primary" :aria-pressed="state.logbookMap" @click="toggleMap">
      <MapIcon :size="16" aria-hidden="true" />{{ state.logbookMap ? "Masquer mes vols sur la carte" : "Voir tous mes vols sur la carte" }}
    </button></div>
    <ul class="lb-list" @mouseleave="hover(-1)">
      <li v-for="f in flights" :key="f.id">
        <button type="button" class="lb-row" :class="{ 'map-hot': state.mapHover === 'flt:' + f.id, cur: current === f.id }"
          @mouseenter="hover(f.id)" @focus="hover(f.id)" @click="openLogFlight(f.id)">
          <span class="lb-route"><b>{{ f.orig }}</b><ArrowRight :size="13" aria-hidden="true" /><b>{{ f.dest }}</b></span>
          <span class="lb-date">{{ fmtDate(f.date) }}</span>
          <span class="lb-sub">{{ f.origName }} → {{ f.destName }}</span>
          <span class="lb-meta">{{ f.ac }} · {{ f.reg }} · {{ f.nm }} NM · {{ hhmm(f.ete) }}</span>
        </button>
      </li>
    </ul>
    <p class="muted small">Vols fictifs pour tester l'appli : itinéraires par des VOR proches de la route directe, temps et carburant estimés.
      Plus tard, ce carnet affichera les vols réels de chaque membre.</p>
  </section>
</template>
