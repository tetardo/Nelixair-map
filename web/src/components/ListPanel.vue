<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import { APT_KIND, CLS, LVL_SHORT, freq, ft } from "../lib/format";
import { openAirway, openFix, visibleAirways, visiblePoints, type AwyItem, type ListItem } from "../map/mapView";
import { state } from "../store";

const MAX = 400;
const mode = ref<"pts" | "awy">("pts");
const filter = ref("");
const sort = ref("ident");
const pts = shallowRef<ListItem[]>([]);
const awys = shallowRef<AwyItem[]>([]);

function refresh() {
  if (!state.sidebarOpen || state.tab !== "list") return;
  const q = filter.value.trim().toUpperCase();
  if (mode.value === "pts") pts.value = visiblePoints(q, sort.value);
  else awys.value = visibleAirways(q, sort.value);
}
watch(() => [state.listTick, state.tab, state.sidebarOpen, mode.value, sort.value, filter.value], refresh);

const count = computed(() => (mode.value === "pts" ? pts.value.length : awys.value.length));
const ptRight = (it: ListItem) => (it.p.freq != null ? freq(it.p) : it.p.cls === "airport" && it.p.rwy_ft ? ft(it.p.rwy_ft) : "");
</script>

<template>
  <section id="tab-list" class="tabpanel" role="tabpanel">
    <div class="seg" role="group" aria-label="Type d'éléments">
      <button :aria-pressed="mode === 'pts'" @click="mode = 'pts'">Points</button>
      <button :aria-pressed="mode === 'awy'" @click="mode = 'awy'">Voies</button>
    </div>
    <div class="list-ctl">
      <input id="vis-filter" v-model="filter" type="search" placeholder="Filtrer…" spellcheck="false" aria-label="Filtrer la liste">
      <select id="vis-sort" v-model="sort" aria-label="Trier par">
        <option value="ident">Ident A→Z</option>
        <option value="type">Type</option>
        <option value="dist">{{ mode === "pts" ? "Distance au centre" : "Tronçons visibles" }}</option>
      </select>
    </div>
    <p id="vis-count" class="muted small">{{ count.toLocaleString("fr-FR") }} {{ mode === "pts" ? "point(s)" : "voie(s)" }} à l'écran</p>
    <ul id="vis-list" class="vis-list">
      <template v-if="mode === 'pts'">
        <li v-for="(it, i) in pts.slice(0, MAX)" :key="i" @click="openFix(it.p, it.ll, { fly: true })">
          <b>{{ it.p.ident }}</b>
          <span class="t">{{ it.p.cls === "airport" ? APT_KIND[it.p.kind] || "Aéroport" : CLS[it.p.cls] || "" }}</span>
          <span class="r">{{ ptRight(it) }}</span>
          <span class="d">{{ it.d.toFixed(0) }} NM</span>
        </li>
      </template>
      <template v-else>
        <li v-for="(it, i) in awys.slice(0, MAX)" :key="i" @click="openAirway(it.ident, { fit: true })">
          <b>{{ it.ident }}</b>
          <span class="t">{{ [...it.lv].map((l) => LVL_SHORT[l]).join(", ") }}</span>
          <span class="r">{{ it.rnav ? "RNAV" : "" }}</span>
          <span class="d">{{ it.n }} tr.</span>
        </li>
      </template>
      <li v-if="count > MAX" class="more">… et {{ (count - MAX).toLocaleString("fr-FR") }} autres, zoomer pour affiner</li>
    </ul>
  </section>
</template>
