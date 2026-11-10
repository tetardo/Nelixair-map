<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { runwayWinds } from "../lib/wind";
import { aptDetails, type AptDetails } from "../services/data";
import { metar, wind, type Metar } from "../services/weather";
import { setWindsock } from "../map/mapView";
import { state } from "../store";

// Cartouche « carte d'aéroport » quand le plan au sol d'un terrain pilote est à l'écran :
// fréquences sol utiles au roulage + vent METAR et QFU le plus face au vent.
const g = computed(() => (state.groundInView ? state.ground[state.groundInView] : null));
const det = ref<AptDetails | null>(null);
const mt = ref<Metar | null>(null);
watch(() => state.groundInView, (id) => {
  det.value = null; mt.value = null;
  if (!id) return;
  aptDetails(id).then((d) => { if (state.groundInView === id) det.value = d; }).catch(() => {});
  metar(id).then((m) => { if (state.groundInView === id) mt.value = m; }).catch(() => {});
}, { immediate: true });
// Manche à air sur la carte, mise à jour avec le METAR du terrain affiché
watch(mt, (m) => setWindsock(state.groundInView, m?.wdir, m ? m.wspd : null));

const ORDER = ["ATIS", "DEL", "GND", "APRON", "TWR"];
const LBL: Record<string, string> = { ATIS: "ATIS", DEL: "PRÉVOL", GND: "SOL", APRON: "TRAFIC", TWR: "TOUR" };
const freqs = computed(() => {
  const seen = new Set<string>();
  return (det.value?.frq || []).filter(([t]) => ORDER.includes(t))
    .sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]) || a[1] - b[1])
    .filter(([t, f]) => !seen.has(t + f) && seen.add(t + f)).slice(0, 6);
});
const best = computed(() => {
  const m = mt.value;
  if (!m) return null;
  const rw = (det.value?.rwy || []).map((r) => [r[0], r[4], r[5]] as [string, number | null, string]);
  return runwayWinds(m.wdir, m.wspd, m.wgst, g.value?.ends || null, rw)[0] || null;
});
</script>

<template>
  <div v-if="g" class="chart-badge" role="status">
    <div class="cb-row">
      <b>{{ state.groundInView }}</b>
      <span>{{ g.name }}</span>
      <small>Plan au sol OSM {{ g.osm.slice(0, 10) }} · non certifié</small>
    </div>
    <div v-if="freqs.length || mt" class="cb-row cb-info">
      <span v-for="([t, f], i) in freqs" :key="i" class="cb-frq"><i>{{ LBL[t] || t }}</i>{{ Number(f).toFixed(3) }}</span>
      <span v-if="mt && wind(mt)" class="cb-wind"><i>VENT</i>{{ wind(mt) }}<template v-if="best"> · {{ best.qfu }} {{ best.head >= 0 ? "face" : "arrière" }} {{ Math.abs(best.head) }} kt, travers {{ best.cross }} kt{{ best.side ? " " + (best.side === "G" ? "gauche" : "droite") : "" }}</template></span>
    </div>
  </div>
</template>
