<script setup lang="ts">
import { computed, ref } from "vue";
import { CLS, SRC, dms, freq, pairs, type LngLat } from "../lib/format";
import { airwaysThrough, openAirway } from "../map/mapView";
import { loadRoutes } from "../services/data";
import type { Props } from "../store";
import KeyValues from "./KeyValues.vue";

const props = defineProps<{ p: Props; ll: LngLat }>();
const awys = ref<string[] | null>(null);
loadRoutes().then((r) => (awys.value = r ? airwaysThrough(props.p.ident, props.ll) : []));

const rows = computed(() => pairs([["Fréquence", freq(props.p)], ["Canal", props.p.channel], ["Latitude", dms(props.ll[1], true)],
  ["Longitude", dms(props.ll[0], false)], ["Région", props.p.region || props.p.country],
  ["Source", (SRC[props.p.src] || props.p.src || "") + (props.p.cycle ? " · " + props.p.cycle : "")]]));
</script>

<template>
  <div class="d-head"><h2>{{ p.ident }}</h2><span class="badge">{{ CLS[p.cls] || p.cls }}</span></div>
  <p v-if="p.name && p.name !== p.ident" class="d-sub">{{ p.name }}</p>
  <KeyValues :rows="rows" />
  <h3>Voies passant par ce point</h3>
  <div id="d-awys" class="chips">
    <span v-if="awys === null" class="muted">Chargement…</span>
    <span v-else-if="!awys.length" class="muted">Aucune</span>
    <button v-for="a in awys || []" :key="a" class="chip" @click="openAirway(a, { fit: true })">{{ a }}</button>
  </div>
</template>
