<script setup lang="ts">
import { ref } from "vue";
import { airacAt, fmtDate } from "../lib/airac";
import { state } from "../store";

const dlg = ref<HTMLDialogElement | null>(null);
const cyc = airacAt();
defineExpose({ open: () => dlg.value?.showModal() });
</script>

<template>
  <dialog id="about" ref="dlg">
    <h2>Sources &amp; licences</h2>
    <ul id="sources">
      <li v-if="state.metaError">Métadonnées indisponibles.</li>
      <li v-for="s in state.sources" :key="s.id">
        <b>{{ s.name }}</b> — {{ s.coverage || "" }}<br>
        <small>Licence : {{ s.license || "?" }}{{ s.cycle ? " · cycle " + s.cycle : "" }} ·
          <a :href="s.url" target="_blank" rel="noopener">{{ s.url }}</a></small>
      </li>
      <li v-if="Object.keys(state.ground).length">
        <b>Cartes d'aéroport</b> — plans au sol de {{ Object.keys(state.ground).join(", ") }}<br>
        <small>© contributeurs OpenStreetMap, licence ODbL 1.0 · non certifié ·
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">openstreetmap.org/copyright</a></small>
      </li>
      <li v-if="state.counts"><small>Génération : {{ state.built }} · {{ state.counts.fixes.toLocaleString("fr-FR") }} points,
        {{ state.counts.airways.toLocaleString("fr-FR") }} voies · AIRAC en vigueur {{ cyc.ident }} ({{ fmtDate(cyc.start) }} → {{ fmtDate(cyc.end) }})</small></li>
    </ul>
    <p>Fond de carte : © <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>
      © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a>
      Données © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">contributeurs OpenStreetMap</a>.</p>
    <p class="warn">Carte d'illustration. Données incomplètes hors États-Unis (navaids seulement),
      sans garantie d'exactitude ni de mise à jour. Ne pas utiliser pour la préparation ou la conduite d'un vol.</p>
    <form method="dialog"><button>Fermer</button></form>
  </dialog>
</template>
