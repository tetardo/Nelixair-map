<script setup lang="ts">
// Briefing météo de la route : METAR / TAF du départ, de l'arrivée et des dégagements,
// puis SIGMET / AIRMET en vigueur traversés par la route (avec recoupement des niveaux quand ils sont connus).
import { computed, ref, watch } from "vue";
import { CFG } from "../config";
import { HZ_COLORS, HZ_LBL, SEV_LBL, alt } from "../lib/format";
import { along, inPolygon, routeVertices, samples } from "../lib/routeGeom";
import { flyTo, selectPoint } from "../map/mapView";
import type { Ofp } from "../services/simbrief";
import { WX_COLORS, flightCat, loadJson, metar, taf, wind, wxAge, type Metar } from "../services/weather";
import Section from "./Section.vue";

const props = defineProps<{ ofp: Ofp }>();
interface AptWx { role: string; icao: string; m: Metar | null; t: string | null }
interface Hit { p: Record<string, any>; from: number; to: number; at: [number, number]; lvl: boolean | null }
const apts = ref<AptWx[]>([]);
const hits = ref<Hit[]>([]);
const age = ref<number | null>(null);
const err = ref("");
const busy = ref(false);

async function load() {
  busy.value = true; err.value = "";
  const o = props.ofp;
  const list: [string, string][] = [["Départ", o.orig.icao], ["Arrivée", o.dest.icao], ...o.altn.map((a) => ["Dégagement", a.icao] as [string, string])];
  try {
    apts.value = await Promise.all(list.map(async ([role, icao]) => ({
      role, icao, m: await metar(icao).catch(() => null), t: (await taf(icao).catch(() => null))?.rawTAF ?? null,
    })));
    age.value = await wxAge().catch(() => null);
  } catch { err.value = "Météo indisponible."; }
  try {
    const j = await loadJson(CFG.wxHazards);
    const now = Date.now(), v = routeVertices(o), s = samples(v, 500);
    const out: Hit[] = [];
    for (const f of j.features as GeoJSON.Feature[]) {
      const p = f.properties || {};
      if (p.to && Date.parse(p.to) <= now) continue;
      const g = f.geometry;
      const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
      const inside = s.filter((x) => polys.some((r) => inPolygon(x.ll, r as number[][][])));
      if (!inside.length) continue;
      // niveaux : la route est-elle dans la tranche base–sommet de l'avis ?
      let lvl: boolean | null = null;
      if (p.base != null || p.top != null) {
        lvl = inside.some((x) => x.alt >= (p.base ?? 0) - 500 && x.alt <= (p.top ?? 99999) + 500);
      }
      out.push({ p, from: inside[0].d, to: inside.at(-1)!.d, at: along(v, inside[0].d).ll, lvl });
    }
    hits.value = out.sort((a, b) => a.from - b.from);
  } catch { hits.value = []; err.value ||= "SIGMET indisponibles."; }
  busy.value = false;
}
watch(() => props.ofp, load, { immediate: true });

const concerned = computed(() => hits.value.filter((h) => h.lvl !== false));
const lvlTxt = (p: Record<string, any>) =>
  p.base == null && p.top == null ? "niveaux non précisés" : `${p.base != null ? (p.base ? alt(p.base) : "SFC") : "?"} – ${p.top != null ? alt(p.top) : "?"}`;
const until = (p: Record<string, any>) => (p.to ? "jusqu'à " + new Date(p.to).toISOString().slice(11, 16) + "Z" : "");
const nm = (v: number) => Math.round(v).toLocaleString("fr-FR");
</script>

<template>
  <Section id="ofp-wx" title="Météo de la route" :badge="concerned.length ? `${concerned.length} SIGMET` : undefined">
    <p v-if="busy" class="muted small">Chargement…</p>
    <div v-for="a in apts" :key="a.role + a.icao" class="rwx">
      <div class="rwx-h">
        <small>{{ a.role }}</small><b>{{ a.icao }}</b>
        <span v-if="a.m && flightCat(a.m)" class="cat" :style="{ background: WX_COLORS[flightCat(a.m)!] || '#888' }">{{ flightCat(a.m) }}</span>
        <span v-if="a.m && wind(a.m)" class="muted small">{{ wind(a.m) }}</span>
      </div>
      <div v-if="a.m" class="wx-raw">{{ a.m.rawOb }}</div>
      <p v-else class="muted small">Pas de METAR.</p>
      <details v-if="a.t" class="taf" open><summary>TAF</summary><div class="wx-raw">{{ a.t }}</div></details>
    </div>

    <h4 class="rwx-sub">SIGMET / AIRMET sur la route</h4>
    <p v-if="!busy && !hits.length" class="muted small">Aucun avis en vigueur ne croise la route.</p>
    <button v-for="(h, i) in hits" :key="i" type="button" class="rwx-hz" :class="{ off: h.lvl === false }"
      @mouseenter="selectPoint(h.at)" @mouseleave="selectPoint(null)" @click="flyTo(h.at, 6)">
      <i :style="{ background: HZ_COLORS[h.p.fam] || '#888' }"></i>
      <span><b>{{ h.p.kind }} {{ HZ_LBL[h.p.fam] || h.p.hazard }}</b><template v-if="h.p.sev"> {{ SEV_LBL[h.p.sev] || h.p.sev }}</template>
        <small>NM {{ nm(h.from) }}–{{ nm(h.to) }} · {{ lvlTxt(h.p) }}<template v-if="h.lvl === false"> · hors de vos niveaux</template>
          <template v-if="until(h.p)"> · {{ until(h.p) }}</template><template v-if="h.p.fir"> · {{ h.p.fir }}</template></small></span>
    </button>
    <p class="muted small">Relais NOAA AWC<template v-if="age != null">, METAR d'il y a {{ age }} min</template>. Couverture SIGMET : celle de la NOAA (internationale, inégale hors États-Unis).
      <template v-if="err"> {{ err }}</template></p>
  </Section>
</template>
