<script setup lang="ts">
import { ref, watch } from "vue";

// Section repliable de la fiche. L'état ouvert / fermé est mémorisé par section (préférence du lecteur).
const props = withDefaults(defineProps<{ id: string; title: string; open?: boolean; badge?: string; note?: string }>(), { open: true });
const KEY = "nelixair-sec-" + props.id;
let saved: string | null = null;
try { saved = localStorage.getItem(KEY); } catch { /* stockage indisponible */ }
const isOpen = ref(saved == null ? props.open : saved === "1");
watch(isOpen, (v) => { try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* stockage indisponible */ } });
</script>

<template>
  <section class="d-sec fold" :class="{ open: isOpen }">
    <button class="fold-h" type="button" :aria-expanded="isOpen" @click="isOpen = !isOpen">
      <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
      <span class="fold-t">{{ title }}</span>
      <slot name="badge"><span v-if="badge" class="fold-b">{{ badge }}</span></slot>
      <small v-if="note" class="fold-n">{{ note }}</small>
    </button>
    <div class="fold-body"><div class="fold-in"><slot /></div></div>
  </section>
</template>
