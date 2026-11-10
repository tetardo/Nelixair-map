<script setup lang="ts">
// Espaces aériens traversés par la route, dans l'ordre : ceux où l'altitude prévue entre sont mis en avant.
import { computed, onBeforeUnmount } from "vue";
import { ASP_COLORS, fmtFt, routeAsp, routeAspBusy, useRouteAsp } from "../lib/routeAsp";
import { highlightAirspace } from "../map/mapView";
import { state } from "../store";
import Section from "./Section.vue";

useRouteAsp();
onBeforeUnmount(() => highlightAirspace(null));
const inside = computed(() => (routeAsp.value || []).filter((c) => c.inside));
const others = computed(() => (routeAsp.value || []).filter((c) => !c.inside));
const lim = (raw: string, ft: number) => (raw ? raw.replace(/ MSL$/, "") : fmtFt(ft));
const n = (v: number) => Math.round(v).toLocaleString("fr-FR");
function show(name: string | null, d?: number) {
  highlightAirspace(name);
  state.profileAt = d ?? null;
}
</script>

<template>
  <Section id="ofp-asp" title="Espaces traversés" :badge="routeAsp ? String(inside.length) : ''">
    <p v-if="routeAspBusy && !routeAsp" class="muted small">Recherche des espaces le long de la route…</p>
    <template v-else-if="routeAsp">
      <p v-if="!routeAsp.length" class="muted small">Aucun espace publié sur la route.</p>
      <ul class="asp-list">
        <li v-for="c in inside" :key="c.key">
          <button type="button" @mouseenter="show(c.name, (c.from + c.to) / 2)" @mouseleave="show(null)" @focus="show(c.name, (c.from + c.to) / 2)" @blur="show(null)">
            <i class="asp-sw" :style="{ background: ASP_COLORS[c.group] || ASP_COLORS.other }"></i>
            <span class="asp-n"><b>{{ c.name }}</b><small>{{ c.type }}{{ c.cls ? " · classe " + c.cls : "" }}</small></span>
            <span class="asp-v">{{ lim(c.lower, c.lowerFt) }} – {{ lim(c.upper, c.upperFt) }}<small>{{ n(c.from) }}–{{ n(c.to) }} NM</small></span>
          </button>
        </li>
      </ul>
      <details v-if="others.length" class="asp-more">
        <summary class="muted small">{{ others.length }} espace{{ others.length > 1 ? "s" : "" }} survolé{{ others.length > 1 ? "s" : "" }} ou passé{{ others.length > 1 ? "s" : "" }} dessous</summary>
        <ul class="asp-list dim">
          <li v-for="c in others" :key="c.key">
            <button type="button" @mouseenter="show(c.name, (c.from + c.to) / 2)" @mouseleave="show(null)">
              <i class="asp-sw" :style="{ background: ASP_COLORS[c.group] || ASP_COLORS.other }"></i>
              <span class="asp-n"><b>{{ c.name }}</b><small>{{ c.type }}{{ c.cls ? " · classe " + c.cls : "" }}</small></span>
              <span class="asp-v">{{ lim(c.lower, c.lowerFt) }} – {{ lim(c.upper, c.upperFt) }}<small>{{ n(c.from) }}–{{ n(c.to) }} NM</small></span>
            </button>
          </li>
        </ul>
      </details>
      <p class="muted small">Limites OpenAIP, à l'altitude prévue du plan. Pas d'activation NOTAM : vérifier les zones R / D avant le vol.</p>
    </template>
  </Section>
</template>
