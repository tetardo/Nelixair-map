<script setup lang="ts">
// « Ce qu'il faut ici » : à un point de la carte et à une altitude choisie, l'espace dans lequel on est
// et ce qu'il exige (clairance, radio, transpondeur), plus ce qu'il y a juste au-dessus et en dessous.
import { computed, ref, watch } from "vue";
import { needsFor } from "../lib/airspaceRules";
import { ddm, type LngLat } from "../lib/format";
import { airspacesAtPoint, type AspLayer } from "../services/airspaceRoute";

const props = defineProps<{ ll: LngLat }>();
const ALTS = [1000, 1500, 2000, 2500, 3000, 3500, 4500, 5500, 6500, 8500, 10000, 12000, 15000, 19500, 24500, 30000, 36000, 41000];
const altFt = ref(3000);
const rules = ref<"VFR" | "IFR">("VFR");
const layers = ref<AspLayer[] | null>(null);
watch(() => props.ll, async (ll) => { layers.value = null; layers.value = await airspacesAtPoint(ll).catch(() => []); }, { immediate: true });

const lbl = (v: number) => (v >= 99999 ? "illimité" : v <= 0 ? "SFC" : v >= 19500 ? `FL${Math.round(v / 100)}` : `${v.toLocaleString("fr-FR")} ft`);
const firs = computed(() => (layers.value || []).filter((l) => l.group === "fir"));
const stack = computed(() => (layers.value || []).filter((l) => l.group !== "fir"));
const here = computed(() => stack.value.filter((l) => altFt.value >= l.lowerFt && altFt.value <= l.upperFt));
const above = computed(() => stack.value.filter((l) => l.lowerFt > altFt.value).sort((a, b) => a.lowerFt - b.lowerFt)[0] || null);
const below = computed(() => stack.value.filter((l) => l.upperFt < altFt.value).sort((a, b) => b.upperFt - a.upperFt)[0] || null);
const cards = computed(() => here.value.map((l) => ({ l, ...needsFor(l.cls, l.type, rules.value === "VFR", altFt.value) })));
const gNeeds = computed(() => needsFor("G", "", rules.value === "VFR", altFt.value));
const lo = (l: AspLayer) => l.lower || lbl(l.lowerFt), hi = (l: AspLayer) => l.upper || lbl(l.upperFt);
const top = computed(() => (here.value.length ? Math.max(...here.value.map((l) => l.upperFt)) : null));
const bottom = computed(() => (here.value.length ? Math.min(...here.value.map((l) => l.lowerFt)) : null));
const short = (l: AspLayer) => `${l.type}${l.cls ? " classe " + l.cls : ""}`;
</script>

<template>
  <div class="here">
    <div class="d-head"><h2>Ce qu'il faut ici</h2></div>
    <p class="muted small mono">{{ ddm(ll[1], true) }} {{ ddm(ll[0], false) }}</p>
    <div class="here-ctl">
      <label>Altitude <select v-model.number="altFt" aria-label="Altitude"><option v-for="a in ALTS" :key="a" :value="a">{{ lbl(a) }}</option></select></label>
      <div class="seg" role="group" aria-label="Règles de vol">
        <button v-for="r in ['VFR', 'IFR'] as const" :key="r" type="button" :aria-pressed="rules === r" @click="rules = r">{{ r }}</button>
      </div>
    </div>
    <p v-if="!layers" class="muted small">Lecture des espaces…</p>
    <template v-else>
      <div v-for="c in cards" :key="c.l.name + c.l.type + c.l.lowerFt" class="here-card">
        <span class="here-cls" :class="'t-' + (c.l.type === 'P' || c.l.type === 'R' ? 'r' : c.l.cls || c.l.type)">{{ c.l.cls || c.l.type }}</span>
        <div>
          <b>{{ c.l.name }} · {{ lo(c.l) }} – {{ hi(c.l) }}</b>
          <span>{{ c.note }}</span>
          <div class="here-needs"><span v-for="nd in c.needs" :key="nd.label" :class="'nd-' + nd.tone">{{ nd.label }}</span></div>
        </div>
      </div>
      <div v-if="!cards.length" class="here-card">
        <span class="here-cls t-G">G</span>
        <div>
          <b>Aucun espace publié à {{ lbl(altFt) }}</b>
          <span>Espace non contrôlé (classe G en général) : pas de clairance, information de vol disponible.</span>
          <div class="here-needs"><span v-for="nd in gNeeds.needs" :key="nd.label" :class="'nd-' + nd.tone">{{ nd.label }}</span></div>
        </div>
      </div>
      <h3>Au-dessus / en dessous</h3>
      <p class="here-row"><span>Au-dessus</span><b v-if="above">{{ lo(above) }} : {{ above.name }} ({{ short(above) }})</b><b v-else-if="top != null && top < 99999">au-dessus de {{ lbl(top) }} : rien de publié</b><b v-else>rien de publié</b></p>
      <p class="here-row"><span>En dessous</span><b v-if="below">{{ hi(below) }} et moins : {{ below.name }} ({{ short(below) }})</b><b v-else-if="bottom">sous {{ lbl(bottom) }} : non contrôlé (classe G en général)</b><b v-else>rien de publié jusqu'au sol</b></p>
      <p v-for="f in firs" :key="f.name" class="here-row"><span>Région</span><b>{{ f.name }}</b></p>
    </template>
    <p class="muted small">OpenAIP · exigences simplifiées par classe (SERA), aide-mémoire seulement · horaires et activations (NOTAM, AZBA) non connus · fréquences non fournies par la source.</p>
  </div>
</template>
