<script setup lang="ts">
// Dégagements en route : terrains à portée de la route, filtrés (piste, distance, IFR, météo), trous de couverture.
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { PISTON } from "../lib/flightChecks";
import { distNm } from "../lib/geo";
import { routeVertices, samples } from "../lib/routeGeom";
import { setAlternates } from "../map/alternatesLayer";
import { openAirportByIdent } from "../map/mapView";
import { airportsAlong, type Alternate } from "../services/airportsAlong";
import { WX_COLORS, flightCat, metar } from "../services/weather";
import { state } from "../store";
import Section from "./Section.vue";

const RWY = [800, 1200, 1800, 2500]; // m
const CORR = [15, 30, 50]; // NM
const minRwy = ref(1800), corridor = ref(30), ifrOnly = ref(false), vfrOnly = ref(false);
const all = ref<Alternate[] | null>(null);
const cats = ref<Record<string, string | null>>({});
const hot = ref<string | null>(null);
const busy = ref(false);

watch(() => state.ofp, (o) => { if (o) minRwy.value = PISTON.test(o.aircraft) ? 800 : 1800; }, { immediate: true });
const pts = computed(() => (state.ofp ? samples(routeVertices(state.ofp), 200) : []));
watch(() => [state.ofp, state.mapReady] as const, async ([o, ready]) => {
  all.value = null; cats.value = {};
  if (!o || !ready) return;
  busy.value = true;
  const r = await airportsAlong(pts.value, 50).catch(() => []);
  if (state.ofp !== o) return;
  const ex = new Set([o.orig.icao, o.dest.icao]);
  all.value = r.filter((a) => !ex.has(a.ident));
  busy.value = false;
  const c: Record<string, string | null> = {};
  await Promise.all(all.value.map(async (a) => { const m = await metar(a.ident).catch(() => null); c[a.ident] = m ? flightCat(m) : null; }));
  if (state.ofp === o) cats.value = c;
}, { immediate: true });

const list = computed(() => (all.value || []).filter((a) => a.off <= corridor.value && a.rwyFt * 0.3048 >= minRwy.value
  && (!ifrOnly.value || a.ifr) && (!vfrOnly.value || ["VFR", "MVFR"].includes(cats.value[a.ident] || ""))));
// tronçons de route sans terrain retenu à moins de `corridor` NM (départ et arrivée comptent)
const gaps = computed(() => {
  const o = state.ofp;
  if (!o || !all.value) return [];
  const ok = [...list.value.map((a) => a.ll), [o.orig.lon, o.orig.lat] as [number, number], [o.dest.lon, o.dest.lat] as [number, number]];
  const out: { from: number; to: number }[] = [];
  let cur: { from: number; to: number } | null = null;
  for (const p of pts.value) {
    const covered = ok.some((ll) => distNm(ll, p.ll) <= corridor.value);
    if (!covered) { if (cur) cur.to = p.d; else cur = { from: p.d, to: p.d }; }
    else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out.filter((g) => g.to - g.from >= 10);
});
watch([list, cats, hot], () => setAlternates(list.value.map((a) => ({ ident: a.ident, ll: a.ll, cat: cats.value[a.ident] ?? null })), hot.value));
onBeforeUnmount(() => setAlternates([]));
const n = (v: number) => Math.round(v).toLocaleString("fr-FR");
function over(a: Alternate | null) { hot.value = a?.ident ?? null; state.profileAt = a ? a.d : null; }
</script>

<template>
  <Section id="ofp-altn" title="Dégagements en route" :badge="all ? String(list.length) : ''" :open="false">
    <div class="altn-filters">
      <label>Piste ≥ <select v-model.number="minRwy" aria-label="Longueur de piste minimale"><option v-for="r in RWY" :key="r" :value="r">{{ n(r) }} m</option></select></label>
      <label>≤ <select v-model.number="corridor" aria-label="Distance maximale de la route"><option v-for="c in CORR" :key="c" :value="c">{{ c }} NM</option></select> de la route</label>
      <button type="button" class="chip" :aria-pressed="ifrOnly" @click="ifrOnly = !ifrOnly">Procédures IFR</button>
      <button type="button" class="chip" :aria-pressed="vfrOnly" @click="vfrOnly = !vfrOnly">Météo VFR / MVFR</button>
    </div>
    <p v-if="busy && !all" class="muted small">Recherche des terrains le long de la route…</p>
    <template v-else-if="all">
      <p v-if="!list.length" class="muted small">Aucun terrain ne correspond aux filtres.</p>
      <ul class="altn-list" @mouseleave="over(null)">
        <li v-for="a in list" :key="a.ident">
          <button type="button" :class="{ 'map-hot': hot === a.ident }" :title="'Fiche ' + a.ident" @mouseenter="over(a)" @focus="over(a)" @click="openAirportByIdent(a.ident)">
            <b>{{ a.ident }}</b>
            <span class="altn-n">{{ a.name }}<small>{{ n(a.rwyFt * 0.3048) }} m{{ a.ifr ? " · IFR" : "" }} · à {{ n(a.off) }} NM de la route</small></span>
            <span class="altn-d">{{ n(a.d) }} NM</span>
            <span class="cat" :style="{ background: WX_COLORS[cats[a.ident] || ''] || 'var(--chrome-line)' }">{{ cats[a.ident] || "—" }}</span>
          </button>
        </li>
      </ul>
      <p v-for="g in gaps" :key="g.from" class="altn-gap"><b>Trou de couverture {{ n(g.from) }}–{{ n(g.to) }} NM</b> : aucun terrain conforme à moins de {{ corridor }} NM.</p>
      <p class="muted small">Distance comptée depuis le départ, le long de la route. Piste la plus longue publiée, catégorie du dernier METAR. Grands et moyens terrains seulement.</p>
    </template>
  </Section>
</template>
