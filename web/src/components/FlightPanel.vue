<script setup lang="ts">
import { Download, FlaskConical } from "@lucide/vue";
import { ref } from "vue";
import { setOfp } from "../map/mapView";
import OfpDetail from "./OfpDetail.vue";
import { demoOfp, fetchOfp } from "../services/simbrief";
import { state } from "../store";

const KEY = "nelixair-simbrief-user";
let saved = "";
try { saved = localStorage.getItem(KEY) || ""; } catch { /* stockage indisponible */ }
const user = ref(saved);
const busy = ref(false);
const err = ref("");

async function load() {
  if (!user.value.trim()) return;
  busy.value = true; err.value = "";
  try {
    setOfp(await fetchOfp(user.value));
    try { localStorage.setItem(KEY, user.value.trim()); } catch { /* stockage indisponible */ }
  } catch (e) { err.value = (e as Error).message; }
  busy.value = false;
}
async function demo() {
  busy.value = true; err.value = "";
  try {
    setOfp(await demoOfp());
  } catch { err.value = "Vol de démonstration indisponible."; }
  busy.value = false;
}

</script>

<template>
  <section id="tab-flight" class="tabpanel" role="tabpanel">
    <form class="sb-form" @submit.prevent="load">
      <label for="sb-user" class="muted small">Pseudo ou Pilot ID SimBrief</label>
      <div class="list-ctl">
        <input id="sb-user" v-model="user" type="text" autocomplete="username" spellcheck="false" placeholder="ex. nelixair_pilote">
        <button class="tbtn" type="submit" :disabled="busy || !user.trim()"><Download :size="16" aria-hidden="true" />Importer</button>
      </div>
      <p v-if="err" class="sb-err small">{{ err }}</p>
      <p class="muted small">Récupère le dernier plan de vol généré sur SimBrief (compte Navigraph gratuit).</p>
      <button type="button" class="sb-demo" :disabled="busy" @click="demo">
        <FlaskConical :size="16" aria-hidden="true" /><span><b>Vol de démo</b><small>LFML → LFPG, sans compte SimBrief</small></span>
      </button>
    </form>

    <OfpDetail />
    <p v-if="!state.ofp && !err" class="muted">Aucun plan de vol chargé.</p>
  </section>
</template>
