<script setup lang="ts">
// Bloc « En ligne maintenant » en tête de fiche : contrôleurs VATSIM / IVAO du terrain, ATIS, arrivées dans 30 min.
import { computed, ref } from "vue";
import type { LngLat } from "../lib/format";
import { NET_COLOR, NET_NAME, airportOnline } from "../map/trafficLayer";
import type { Atc } from "../services/traffic";

const props = defineProps<{ icao: string; ll: LngLat }>();
const online = computed(() => airportOnline(props.icao, props.ll));
const KIND: Record<string, string> = { DEL: "Prévol", GND: "Sol", TWR: "Tour", APP: "Approche", CTR: "Centre", FSS: "Information" };
const copied = ref("");
function copy(a: Atc) {
  navigator.clipboard?.writeText(a.freq).then(() => { copied.value = a.callsign; setTimeout(() => (copied.value = ""), 900); }).catch(() => {});
}
const showArr = ref(false);
</script>

<template>
  <div v-for="o in online" :key="o.net" class="online" :style="{ '--net': NET_COLOR[o.net] }">
    <div class="online-h">
      <i aria-hidden="true"></i><b>En ligne maintenant</b><span class="online-net">{{ NET_NAME[o.net] }}</span>
      <span class="grow"></span><small>il y a {{ o.age }} s</small>
    </div>
    <div v-if="o.atc.length" class="online-grid">
      <template v-for="a in o.atc" :key="a.callsign">
        <span>{{ KIND[a.kind] || a.kind }} <small>{{ a.callsign }}</small></span>
        <b>{{ a.freq }}</b>
        <button type="button" :aria-label="'Copier ' + a.freq" @click="copy(a)">{{ copied === a.callsign ? "✓" : "Copier" }}</button>
      </template>
    </div>
    <div v-for="t in o.atis" :key="t.callsign" class="online-atis"><b>ATIS</b> · {{ t.freq }}<template v-if="t.atis"> · {{ t.atis }}</template></div>
    <div class="online-foot">
      <span><b>{{ o.arrivals.length }}</b> arrivée{{ o.arrivals.length > 1 ? "s" : "" }} dans 30 min</span>
      <span><b>{{ o.onGround }}</b> au sol, plan déposé</span>
      <button v-if="o.arrivals.length" type="button" class="link" :aria-expanded="showArr" @click="showArr = !showArr">{{ showArr ? "Masquer" : "Voir la liste" }}</button>
    </div>
    <ul v-if="showArr" class="online-arr">
      <li v-for="x in o.arrivals" :key="x.p.callsign"><b>{{ x.p.callsign }}</b><span>{{ x.p.ac }} · de {{ x.p.dep || "?" }}</span><span>{{ x.min }} min</span></li>
    </ul>
  </div>
</template>
