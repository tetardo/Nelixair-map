<script setup lang="ts">
import { X } from "@lucide/vue";
import { onBeforeUnmount, onMounted, ref } from "vue";
import { DEFAULT_VIEW, state, type MapView } from "../store";

// Menu « Affichage » ancré au-dessus des boutons de zoom : thème, relief, détails du fond autour des aéroports.
type Opt = [keyof MapView, string, string];
const DETAILS: Opt[] = [
  ["roads", "Routes et voies ferrées", "Repères visuels en VFR et au roulage"],
  ["buildings", "Bâtiments", "Visibles à partir du zoom 13"],
  ["landuse", "Zones urbaines et parcs", "Occupation du sol"],
  ["places", "Noms de lieux", "Villes, mers, régions"],
];
const el = ref<HTMLElement | null>(null);
const allDetails = () => DETAILS.every(([k]) => state.view[k]);
const setDetails = (v: boolean) => DETAILS.forEach(([k]) => ((state.view[k] as boolean) = v));
const reset = () => Object.assign(state.view, DEFAULT_VIEW);

// Fermeture au clic hors du menu ou sur Échap
const outside = (e: MouseEvent) => { if (state.viewMenu && el.value && !el.value.contains(e.target as Node) && (e.target as HTMLElement).closest?.("#view-btn, .rail") == null) state.viewMenu = false; };
const esc = (e: KeyboardEvent) => { if (e.key === "Escape") state.viewMenu = false; };
onMounted(() => { document.addEventListener("click", outside); document.addEventListener("keydown", esc); });
onBeforeUnmount(() => { document.removeEventListener("click", outside); document.removeEventListener("keydown", esc); });
</script>

<template>
  <Transition name="pop-in">
    <div v-if="state.viewMenu" ref="el" class="view-menu" role="dialog" aria-label="Affichage de la carte">
      <div class="vm-h"><b>Affichage</b><button type="button" class="vm-x" title="Fermer" @click="state.viewMenu = false"><X :size="16" aria-hidden="true" /></button></div>

      <div class="vm-l">Vue</div>
      <div class="vm-seg">
        <button type="button" :aria-pressed="state.view.base === 'plan'" @click="state.view.base = 'plan'">Plan</button>
        <button type="button" :aria-pressed="state.view.base === 'sat'" @click="state.view.base = 'sat'">Satellite</button>
        <button type="button" :aria-pressed="state.view.relief" :disabled="state.view.base === 'sat'" @click="state.view.relief = !state.view.relief">Relief</button>
      </div>
      <div class="vm-l">Thème</div>
      <div class="vm-seg" role="group" aria-label="Thème de l'application">
        <button type="button" :aria-pressed="state.themeMode === 'day'" @click="state.themeMode = 'day'">Jour</button>
        <button type="button" :aria-pressed="state.themeMode === 'night'" @click="state.themeMode = 'night'">Nuit</button>
        <button type="button" :aria-pressed="state.themeMode === 'auto'" title="Selon le soleil à la position affichée" @click="state.themeMode = 'auto'">Auto</button>
      </div>

      <div class="vm-l">Détails du fond <button type="button" class="vm-link" @click="setDetails(!allDetails())">{{ allDetails() ? "Aucun" : "Tout" }}</button></div>
      <label v-for="[k, label, hint] in DETAILS" :key="k" class="vm-opt">
        <input v-model="state.view[k]" type="checkbox"><span>{{ label }}<small>{{ hint }}</small></span>
      </label>

      <div class="vm-l">Effets</div>
      <label class="vm-opt"><input v-model="state.anim" type="checkbox"><span>Animations<small>Flux sur la route, halos, trafic fluide, météo IFR qui respire</small></span></label>

      <div class="vm-l">Carte d'aéroport</div>
      <label class="vm-opt"><input v-model="state.filters.ground" type="checkbox"><span>Plan au sol (OSM)<small>Pistes, taxiways, postes, points d'attente</small></span></label>

      <button type="button" class="vm-reset" @click="reset">Revenir à la vue épurée</button>
    </div>
  </Transition>
</template>
