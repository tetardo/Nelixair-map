<script setup lang="ts">
import { computed, ref } from "vue";
import { CLS, LVL_SHORT, alt, deg3, pairs, type LngLat } from "../lib/format";
import { bearing, distNm } from "../lib/geo";
import { fitAirway, flyTo, selectPoint } from "../map/mapView";
import { getRoute, loadRoutes, type Route } from "../services/data";
import KeyValues from "./KeyValues.vue";

const props = defineProps<{ ident: string }>();
const route = ref<Route | null | undefined>(undefined); // undefined = chargement
loadRoutes().then(() => (route.value = getRoute(props.ident)));

interface Row { id: string; cls: string; ll: LngLat; mea: string; trk: string; d: string; cum: string; dir: string | null; last: boolean }

// Log de voie : route et distance du tronçon arrivant sur chaque point, cumul par portion
const parts = computed(() => (route.value?.parts || []).map((part) => {
  let cum = 0;
  const rows: Row[] = part.pts.map((pt, i) => {
    const [id, cls, lon, lat, , dir] = pt;
    let trk = "", d = "", mea = "";
    if (i > 0) {
      const prev = part.pts[i - 1];
      const dd = distNm([prev[2], prev[3]], [lon, lat]);
      cum += dd;
      trk = deg3(bearing([prev[2], prev[3]], [lon, lat]));
      d = dd.toFixed(0);
      mea = prev[4] ? alt(prev[4]) : "";
    }
    return { id, cls, ll: [lon, lat], mea, trk, d, cum: i ? cum.toFixed(0) : "", dir, last: i === part.pts.length - 1 };
  });
  return { lv: part.lv, rows, total: cum };
}));
const summary = computed(() => {
  const r = route.value;
  if (!r) return [];
  const levels = [...new Set(r.parts.map((p) => p.lv))].map((l) => LVL_SHORT[l]).join(", ");
  const total = parts.value.reduce((s, p) => s + p.total, 0);
  const n = parts.value.reduce((s, p) => s + p.rows.length, 0);
  return pairs([["Niveau", levels], ["Longueur", `${total.toFixed(0)} NM`], ["Points", n], ["Portions", r.parts.length]]);
});
function go(row: Row) {
  selectPoint(row.ll);
  flyTo(row.ll);
}
</script>

<template>
  <div class="d-head"><h2>{{ ident }}</h2><span v-if="route" class="badge">{{ route.rnav ? "RNAV" : "Conv." }}</span></div>
  <p v-if="route === undefined" class="muted">Chargement…</p>
  <p v-else-if="route === null" class="muted">Voie introuvable dans l'index.</p>
  <template v-else>
    <KeyValues :rows="summary" />
    <button id="d-fit" class="ghost" @click="fitAirway(ident)">Afficher toute la voie</button>
    <template v-for="(part, pi) in parts" :key="pi">
      <h3 v-if="parts.length > 1">Portion {{ pi + 1 }} · {{ LVL_SHORT[part.lv] }}</h3>
      <table class="log">
        <thead><tr><th>Point</th><th>MEA</th><th>Rte</th><th>NM</th><th>Cumul</th></tr></thead>
        <tbody>
          <template v-for="(r, i) in part.rows" :key="i">
            <tr :data-lon="r.ll[0]" :data-lat="r.ll[1]" @click="go(r)">
              <td><b>{{ r.id }}</b><small>{{ r.cls === "waypoint" ? "" : CLS[r.cls] || r.cls }}</small></td>
              <td>{{ r.mea }}</td><td>{{ r.trk }}</td><td>{{ r.d }}</td><td>{{ r.cum }}</td>
            </tr>
            <tr v-if="r.dir && !r.last" class="note"><td colspan="5">Sens unique {{ r.dir === "F" ? "→" : "←" }}</td></tr>
          </template>
        </tbody>
      </table>
    </template>
    <p class="muted small">MEA et route vraie du tronçon arrivant sur le point.</p>
  </template>
</template>
