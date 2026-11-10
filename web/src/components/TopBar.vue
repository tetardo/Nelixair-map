<script setup lang="ts">
import { ref } from "vue";
import { CLS } from "../lib/format";
import { choose, setSidebar } from "../map/mapView";
import { hitIdent, indexLoaded, loadIndex, search, type Hit } from "../services/data";
import { state } from "../store";

const logo = import.meta.env.BASE_URL + "img/nelixair-logo.svg";
const emit = defineEmits<{ about: [] }>();
const input = ref<HTMLInputElement | null>(null);
const q = ref("");
const hits = ref<Hit[]>([]);
const active = ref(-1);
const open = ref(false);
const loaded = ref(false);

async function onInput() {
  open.value = !!q.value.trim();
  await loadIndex();
  loaded.value = indexLoaded();
  hits.value = search(q.value);
  active.value = hits.value.length ? 0 : -1;
}
function pick(h: Hit) {
  q.value = hitIdent(h);
  open.value = false;
  input.value?.blur();
  choose(h);
}
function onKey(e: KeyboardEvent) {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!hits.value.length) return;
    active.value = (active.value + (e.key === "ArrowDown" ? 1 : hits.value.length - 1)) % hits.value.length;
  } else if (e.key === "Escape") { open.value = false; input.value?.blur(); }
}
function submit() { if (hits.value[active.value]) pick(hits.value[active.value]); }
function blur() { setTimeout(() => (open.value = false), 100); }
const sub = (h: Hit) => (h.t === "fix" ? [h.r[4], h.r[5]].filter(Boolean).join(" · ") : "");

defineExpose({ focus: () => input.value?.focus() });
</script>

<template>
  <header class="toolbar">
    <button id="side-btn" class="tbtn icon" type="button" :aria-pressed="state.sidebarOpen" aria-controls="sidebar"
      title="Panneau latéral" @click="setSidebar(!state.sidebarOpen)">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>
    </button>
    <div class="brand"><img :src="logo" alt="" width="22" height="22">NELIXAIR<span>MAP</span></div>
    <div class="tools">
      <button id="theme-btn" class="tbtn icon" type="button" :aria-pressed="state.theme === 'night'"
        :title="state.theme === 'night' ? 'Passer en mode jour' : 'Passer en mode nuit'"
        @click="state.theme = state.theme === 'night' ? 'day' : 'night'">
        <svg class="moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/></svg>
        <svg class="sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
      </button>
      <button id="about-btn" class="tbtn icon" type="button" title="Sources &amp; licences" @click="emit('about')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.01"/></svg>
      </button>
    </div>
    <form id="search" class="search" autocomplete="off" role="search" @submit.prevent="submit">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="q" ref="input" v-model="q" type="search" placeholder="Ident ou voie" aria-label="Rechercher un ident" spellcheck="false"
        @focus="loadIndex" @input="onInput" @keydown="onKey" @blur="blur">
      <ul v-show="open" id="results" class="results" role="listbox">
        <li v-if="!loaded" class="empty">Chargement de l'index…</li>
        <li v-else-if="!hits.length" class="empty">Aucun résultat</li>
        <li v-for="(h, i) in hits" v-else :key="i" role="option" :aria-selected="i === active" @mousedown.prevent="pick(h)">
          <span class="id">{{ hitIdent(h) }}</span>
          <span class="cls">{{ h.t === "awy" ? "Voie" : CLS[h.r[1]] || h.r[1] }}</span>
          <span class="nm">{{ sub(h) }}</span>
        </li>
      </ul>
    </form>
  </header>
</template>
