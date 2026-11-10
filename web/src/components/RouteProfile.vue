<script setup lang="ts">
// Profil vertical du plan de vol : altitude prévue (magenta) au-dessus du relief le long de la route.
import { X } from "@lucide/vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { elevationsFt } from "../lib/elevation";
import { alt } from "../lib/format";
import { along, routeVertices, samples } from "../lib/routeGeom";
import { flyTo, selectPoint } from "../map/mapView";
import { ROUTE_COLOR } from "../map/flightRoute";
import { state } from "../store";

const box = ref<HTMLElement | null>(null);
const W = ref(800);
const H = 150, PAD = { l: 52, r: 12, t: 22, b: 20 };
const terrain = ref<{ d: number; ft: number | null }[]>([]);
const loading = ref(false);
const hover = ref<number | null>(null); // distance survolée (NM)

const verts = computed(() => (state.ofp ? routeVertices(state.ofp) : []));
const total = computed(() => verts.value.at(-1)?.d || 1);

async function loadTerrain() {
  terrain.value = [];
  if (!verts.value.length) return;
  loading.value = true;
  const s = samples(verts.value, 400);
  const z = total.value < 800 ? 9 : total.value < 2500 ? 8 : 7;
  const ft = await elevationsFt(s.map((x) => x.ll), z);
  // garde le maximum de chaque paire d'échantillons voisins : on ne rate pas un sommet entre deux points
  terrain.value = s.map((x, i) => ({ d: x.d, ft: Math.max(ft[i] ?? -1, ft[i - 1] ?? -1, ft[i + 1] ?? -1) < 0 ? null : Math.max(ft[i] ?? 0, ft[i - 1] ?? 0, ft[i + 1] ?? 0) }));
  loading.value = false;
}
watch(() => [state.ofp, state.profileOpen], () => { if (state.profileOpen) loadTerrain(); }, { immediate: true });

const maxAlt = computed(() => {
  const a = Math.max(...verts.value.map((v) => v.alt), ...terrain.value.map((t) => t.ft ?? 0), 1000);
  const stepFt = a > 20000 ? 10000 : a > 8000 ? 5000 : 2000;
  return Math.ceil((a * 1.08) / stepFt) * stepFt;
});
const gridStep = computed(() => (maxAlt.value > 20000 ? 10000 : maxAlt.value > 8000 ? 5000 : 2000));
const x = (d: number) => PAD.l + (d / total.value) * (W.value - PAD.l - PAD.r);
const y = (ft: number) => PAD.t + (1 - ft / maxAlt.value) * (H - PAD.t - PAD.b);
const grid = computed(() => { const g = []; for (let a = 0; a <= maxAlt.value; a += gridStep.value) g.push(a); return g; });

const planPath = computed(() => verts.value.map((v, i) => `${i ? "L" : "M"}${x(v.d).toFixed(1)},${y(v.alt).toFixed(1)}`).join(""));
const terrPath = computed(() => {
  const t = terrain.value.filter((p) => p.ft != null);
  if (!t.length) return "";
  return `M${x(t[0].d)},${y(0)}` + t.map((p) => `L${x(p.d).toFixed(1)},${y(p.ft!).toFixed(1)}`).join("") + `L${x(t.at(-1)!.d)},${y(0)}Z`;
});
// étiquettes des points : on saute celles qui chevaucheraient la précédente
const labels = computed(() => {
  let last = -99;
  return verts.value.filter((v, i) => {
    const px = x(v.d), keep = i === 0 || i === verts.value.length - 1 || px - last > 46 || v.ident === "TOC" || v.ident === "TOD";
    if (keep) last = px;
    return keep;
  });
});
const peak = computed(() => terrain.value.reduce<{ d: number; ft: number } | null>((m, p) => (p.ft != null && (!m || p.ft > m.ft) ? { d: p.d, ft: p.ft } : m), null));
// marge minimale entre altitude prévue et relief, hors 15 NM autour des terrains (montée initiale / finale)
const minMargin = computed(() => {
  let m: { d: number; ft: number } | null = null;
  for (const p of terrain.value) {
    if (p.ft == null || p.d < 15 || p.d > total.value - 15) continue;
    const g = along(verts.value, p.d).alt - p.ft;
    if (!m || g < m.ft) m = { d: p.d, ft: g };
  }
  return m;
});

const hv = computed(() => {
  if (hover.value == null) return null;
  const a = along(verts.value, hover.value);
  const t = terrain.value.length ? terrain.value.reduce((b, p) => (Math.abs(p.d - hover.value!) < Math.abs(b.d - hover.value!) ? p : b)) : null;
  return { d: hover.value, alt: a.alt, ll: a.ll, terr: t?.ft ?? null };
});
function move(e: PointerEvent) {
  const r = (e.currentTarget as SVGElement).getBoundingClientRect();
  const px = ((e.clientX - r.left) * W.value) / r.width;
  const d = ((px - PAD.l) / (W.value - PAD.l - PAD.r)) * total.value;
  hover.value = Math.max(0, Math.min(total.value, d));
  selectPoint(hv.value!.ll);
}
function leave() { hover.value = null; selectPoint(null); }
function click() { if (hv.value) flyTo(hv.value.ll, 8); }

// le bandeau n'existe qu'une fois ouvert : on observe sa largeur dès qu'il apparaît
const ro = new ResizeObserver(([e]) => (W.value = Math.max(300, Math.round(e.contentRect.width))));
watch(box, (el, old) => { if (old) ro.unobserve(old); if (el) ro.observe(el); });
onBeforeUnmount(() => ro.disconnect());
const fmt = (v: number) => Math.round(v).toLocaleString("fr-FR");
</script>

<template>
  <div v-if="state.profileOpen && state.ofp" ref="box" class="profile" role="region" aria-label="Profil vertical du plan de vol">
    <div class="profile-head">
      <b>Profil vertical</b>
      <span class="muted">{{ state.ofp.orig.icao }} → {{ state.ofp.dest.icao }} · {{ fmt(total) }} NM</span>
      <span v-if="loading" class="muted">relief en cours…</span>
      <span v-else-if="peak" class="muted">relief max {{ fmt(peak.ft) }} ft à {{ fmt(peak.d) }} NM</span>
      <span v-if="minMargin" :class="minMargin.ft < 2000 ? 'warn' : 'muted'">marge mini en route {{ fmt(minMargin.ft) }} ft</span>
      <span class="sp"></span>
      <span v-if="hv" class="profile-read">{{ fmt(hv.d) }} NM · prévu {{ alt(Math.round(hv.alt / 100) * 100) }}<template v-if="hv.terr != null"> · relief {{ fmt(hv.terr) }} ft</template></span>
      <button type="button" class="btn-ghost" aria-label="Fermer le profil" @click="state.profileOpen = false"><X :size="16" aria-hidden="true" /></button>
    </div>
    <svg class="pf-svg" :width="W" :height="H" :viewBox="`0 0 ${W} ${H}`" @pointermove="move" @pointerleave="leave" @click="click">
      <g class="pf-grid">
        <template v-for="g in grid" :key="g">
          <line :x1="PAD.l" :x2="W - PAD.r" :y1="y(g)" :y2="y(g)" />
          <text :x="PAD.l - 6" :y="y(g) + 3" text-anchor="end">{{ g >= 18000 ? "FL" + g / 100 : fmt(g) }}</text>
        </template>
      </g>
      <path v-if="terrPath" :d="terrPath" class="pf-terrain" />
      <path :d="planPath" class="pf-plan" :stroke="ROUTE_COLOR" />
      <g class="pf-fix">
        <template v-for="v in labels" :key="v.ident + v.d">
          <line :x1="x(v.d)" :x2="x(v.d)" :y1="PAD.t - 4" :y2="y(v.alt)" />
          <circle :cx="x(v.d)" :cy="y(v.alt)" r="2.5" :fill="ROUTE_COLOR" />
          <text :x="x(v.d)" :y="PAD.t - 8" text-anchor="middle" :class="{ toc: v.ident === 'TOC' || v.ident === 'TOD' }">{{ v.ident }}</text>
        </template>
      </g>
      <text v-for="d in [0, total / 4, total / 2, (3 * total) / 4, total]" :key="d" class="pf-dist" :x="x(d)" :y="H - 5"
        :text-anchor="d === 0 ? 'start' : d === total ? 'end' : 'middle'">{{ fmt(d) }} NM</text>
      <line v-if="hv" class="pf-cursor" :x1="x(hv.d)" :x2="x(hv.d)" :y1="PAD.t" :y2="H - PAD.b" />
    </svg>
    <p class="profile-note">Relief AWS Terrain Tiles, résolution de quelques centaines de mètres : indicatif, ne remplace pas les altitudes minimales publiées.</p>
  </div>
</template>
