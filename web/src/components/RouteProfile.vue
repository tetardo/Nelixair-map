<script setup lang="ts">
// Profil vertical du plan de vol : altitude prévue (magenta) au-dessus du relief le long de la route.
import { Pause, Play, X } from "@lucide/vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { elevationsFt } from "../lib/elevation";
import { alt } from "../lib/format";
import { along, routeVertices, samples } from "../lib/routeGeom";
import { ASP_COLORS, ZONE_TYPES, fmtFt, routeAsp, useRouteAsp } from "../lib/routeAsp";
import { flyTo, selectPoint } from "../map/mapView";
import { pauseReplay, playReplay, replayInfo, seekReplayD, stopReplay } from "../map/replay";
import { hhmm } from "../services/simbrief";
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

// Altitude de transition au départ et à l'arrivée (eAIP France ; 18 000 ft aux États-Unis) : trait jusqu'au passage du plan
function taOf(icao: string): number | null {
  return state.eaip[icao]?.ta_ft ?? (/^(K|P[AHGF])/.test(icao) ? 18000 : null);
}
function crossing(ta: number, fromEnd: boolean): number {
  const v = fromEnd ? [...verts.value].reverse() : verts.value;
  for (let i = 1; i < v.length; i++) if (v[i].alt >= ta && v[i - 1].alt < ta) {
    const a = v[i - 1], b = v[i];
    return a.d + ((ta - a.alt) / (b.alt - a.alt || 1)) * (b.d - a.d);
  }
  return fromEnd ? 0 : total.value;
}
const taLines = computed(() => {
  const o = state.ofp;
  if (!o) return [];
  const out: { x1: number; x2: number; y: number; label: string; end: boolean }[] = [];
  const dep = taOf(o.orig.icao), arr = taOf(o.dest.icao);
  if (dep != null && dep < maxAlt.value) out.push({ x1: x(0), x2: x(Math.min(total.value / 2, crossing(dep, false) + total.value * 0.04)), y: y(dep), label: `TA ${fmt(dep)}`, end: false });
  if (arr != null && arr < maxAlt.value) out.push({ x1: x(Math.max(total.value / 2, crossing(arr, true) - total.value * 0.04)), x2: x(total.value), y: y(arr), label: `TA ${fmt(arr)}`, end: true });
  return out;
});

// Coupe des espaces aériens traversés (bandes plancher → plafond sur la distance où la route est dedans)
useRouteAsp();
const showAsp = ref(true);
const bands = computed(() => (showAsp.value ? routeAsp.value || [] : []).filter((c) => c.lowerFt < maxAlt.value).map((c) => {
  const x0 = x(c.from), x1 = Math.max(x(c.to), x0 + 2), yTop = y(Math.min(c.upperFt, maxAlt.value)), yBot = y(c.lowerFt);
  return { c, x: x0, w: x1 - x0, y: yTop, h: Math.max(2, yBot - yTop), color: ASP_COLORS[c.group] || ASP_COLORS.other,
    label: x1 - x0 > 70 && c.inside ? c.name : "" };
}).sort((a, b) => b.h - a.h)); // les plus hautes d'abord : les petites restent visibles par-dessus

// curseur : survol du profil, sinon point choisi en cliquant la route sur la carte
const cur = computed(() => hover.value ?? (state.profileAt != null ? Math.min(total.value, state.profileAt) : null));
const hv = computed(() => {
  const d = cur.value;
  if (d == null) return null;
  const a = along(verts.value, d);
  const t = terrain.value.length ? terrain.value.reduce((b, p) => (Math.abs(p.d - d) < Math.abs(b.d - d) ? p : b)) : null;
  const asp = (routeAsp.value || []).filter((c) => d >= c.from && d <= c.to && a.alt >= c.lowerFt && a.alt <= c.upperFt).map((c) => c.name);
  return { d, alt: a.alt, ll: a.ll, terr: t?.ft ?? null, asp };
});
watch(() => state.profileAt, (d) => { if (d != null && hover.value == null) selectPoint(hv.value?.ll ?? null); });
watch(() => [state.ofp, state.profileOpen], () => { if (!state.profileOpen) { state.profileAt = null; stopReplay(); } });
const rp = computed(() => (state.replay.on ? replayInfo() : null));
const SPEEDS = [30, 120, 300];
function move(e: PointerEvent) {
  const r = (e.currentTarget as SVGElement).getBoundingClientRect();
  const px = ((e.clientX - r.left) * W.value) / r.width;
  const d = ((px - PAD.l) / (W.value - PAD.l - PAD.r)) * total.value;
  hover.value = Math.max(0, Math.min(total.value, d));
  selectPoint(hv.value!.ll);
}
function leave() { hover.value = null; selectPoint(hv.value?.ll ?? null); }
function click() { if (!hv.value) return; if (state.replay.on) seekReplayD(hv.value.d); else flyTo(hv.value.ll, 8); }

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
      <span class="pf-replay">
        <button type="button" class="btn-ghost" :aria-label="state.replay.playing ? 'Mettre en pause' : 'Rejouer le vol'" :title="state.replay.playing ? 'Pause' : 'Rejouer le vol'"
          @click="state.replay.playing ? pauseReplay() : playReplay()"><Pause v-if="state.replay.playing" :size="15" aria-hidden="true" /><Play v-else :size="15" aria-hidden="true" /></button>
        <template v-if="state.replay.on">
          <select v-model.number="state.replay.speed" aria-label="Vitesse de relecture"><option v-for="s in SPEEDS" :key="s" :value="s">×{{ s }}</option></select>
          <label class="pf-follow"><input v-model="state.replay.follow" type="checkbox">Suivre</label>
          <span v-if="rp" class="profile-read">{{ hhmm(state.replay.t) }} / {{ hhmm(state.replay.total) }} · {{ alt(Math.round(rp.alt / 100) * 100) }} · {{ rp.gs }} kt</span>
          <button type="button" class="btn-ghost" aria-label="Arrêter la relecture" title="Arrêter la relecture" @click="stopReplay()"><X :size="14" aria-hidden="true" /></button>
        </template>
      </span>
      <span class="sp"></span>
      <span v-if="hv" class="profile-read">{{ fmt(hv.d) }} NM · prévu {{ alt(Math.round(hv.alt / 100) * 100) }}<template v-if="hv.terr != null"> · relief {{ fmt(hv.terr) }} ft</template><template v-if="hv.asp.length"> · {{ hv.asp.join(", ") }}</template></span>
      <button type="button" class="btn-ghost pf-asp-tg" :aria-pressed="showAsp" title="Afficher les espaces aériens traversés" @click="showAsp = !showAsp">Espaces</button>
      <button type="button" class="btn-ghost" aria-label="Fermer le profil" @click="state.profileOpen = false"><X :size="16" aria-hidden="true" /></button>
    </div>
    <svg class="pf-svg" :width="W" :height="H" :viewBox="`0 0 ${W} ${H}`" @pointermove="move" @pointerleave="leave" @click="click">
      <g class="pf-grid">
        <template v-for="g in grid" :key="g">
          <line :x1="PAD.l" :x2="W - PAD.r" :y1="y(g)" :y2="y(g)" />
          <text :x="PAD.l - 6" :y="y(g) + 3" text-anchor="end">{{ g >= 18000 ? "FL" + g / 100 : fmt(g) }}</text>
        </template>
      </g>
      <defs><pattern id="pf-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#e5484d" stroke-width="2" /></pattern></defs>
      <g class="pf-asp">
        <g v-for="b in bands" :key="b.c.key">
          <rect :x="b.x" :y="b.y" :width="b.w" :height="b.h" :fill="ZONE_TYPES.has(b.c.type) ? 'url(#pf-hatch)' : b.color" :stroke="b.color" :class="{ in: b.c.inside, zone: ZONE_TYPES.has(b.c.type) }"><title>{{ b.c.name }} · {{ fmtFt(b.c.lowerFt) }} – {{ fmtFt(b.c.upperFt) }}</title></rect>
          <text v-if="b.label" :x="b.x + 4" :y="b.y + 10" :fill="b.color">{{ b.label }}</text>
        </g>
      </g>
      <path v-if="terrPath" :d="terrPath" class="pf-terrain" />
      <g class="pf-ta">
        <g v-for="t in taLines" :key="t.label + t.end">
          <line :x1="t.x1" :x2="t.x2" :y1="t.y" :y2="t.y"><title>Altitude de transition : au-dessus, calage standard 1013 hPa</title></line>
          <text :x="t.end ? t.x2 - 2 : t.x1 + 2" :y="t.y - 3" :text-anchor="t.end ? 'end' : 'start'">{{ t.label }}</text>
        </g>
      </g>
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
