<script setup lang="ts">
import { ref } from "vue";
import { CLS } from "../lib/format";
import { Search } from "@lucide/vue";
import { choose } from "../map/mapView";
import { hitIdent, indexLoaded, loadIndex, search, type Hit } from "../services/data";

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
    <div class="brand">TROPO<small>par Nelixair</small></div>
    <form id="search" class="search" autocomplete="off" role="search" @submit.prevent="submit">
      <Search :size="16" aria-hidden="true" />
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
