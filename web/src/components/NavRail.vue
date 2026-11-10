<script setup lang="ts">
import { BookOpen, Check, FileText, Link2, Route, Layers, List, Map as MapIcon, Moon, PlaneLanding, Sun, type LucideIcon } from "@lucide/vue";
import { ref } from "vue";
import { shareUrl } from "../lib/share";
import { setSidebar, setTab } from "../map/mapView";
import { state, type Tab } from "../store";

// Barre de navigation verticale : une icône par grande section du panneau.
// Cliquer la section déjà ouverte referme le panneau.
const logo = import.meta.env.BASE_URL + "img/nelixair-logo.svg";
const emit = defineEmits<{ about: [] }>();
const SECTIONS: [Tab, string, LucideIcon][] = [
  ["detail", "Fiche", FileText], ["flight", "Plan de vol", Route], ["airports", "Aéroports", PlaneLanding], ["list", "Liste", List], ["filters", "Calques", Layers],
];
function go(t: Tab) {
  if (state.sidebarOpen && state.tab === t) return setSidebar(false);
  setTab(t);
  if (!state.sidebarOpen) setSidebar(true);
}
const active = (t: Tab) => state.sidebarOpen && state.tab === t;

// Partage : copie le lien de la vue exacte (position, fond, calques, thème, panneau, sélection, plan de vol)
const toast = ref("");
let toastTimer = 0;
function say(msg: string) {
  toast.value = msg;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.value = ""), 3500);
}
async function share() {
  const { url, ofpDropped } = await shareUrl();
  const note = ofpDropped ? " (plan de vol trop long, non inclus)" : "";
  try {
    await navigator.clipboard.writeText(url);
    say("Lien de la vue copié" + note);
  } catch {
    // Presse-papiers refusé (navigateur, contexte non sécurisé) : feuille de partage du système si elle existe
    try { await navigator.share({ title: "Nelixair", url }); say("Lien partagé" + note); }
    catch { history.replaceState(history.state, "", url); say("Copie impossible : le lien est dans la barre d'adresse"); }
  }
}
</script>

<template>
  <nav class="rail" aria-label="Sections">
    <div class="rail-logo"><img :src="logo" alt="Nelixair" width="26" height="26"></div>
    <button v-for="[id, label, icon] in SECTIONS" :key="id" type="button" class="rail-btn" :data-tab="id"
      :aria-pressed="active(id)" aria-controls="sidebar" :aria-label="label" @click="go(id)">
      <component :is="icon" :size="20" :stroke-width="1.8" aria-hidden="true" /><span class="rail-tip">{{ label }}</span>
    </button>
    <div class="rail-sp"></div>
    <button type="button" class="rail-btn" :aria-pressed="state.viewMenu" aria-label="Affichage de la carte"
      @click.stop="state.viewMenu = !state.viewMenu">
      <MapIcon :size="20" :stroke-width="1.8" aria-hidden="true" /><span class="rail-tip">Affichage</span>
    </button>
    <button id="share-btn" type="button" class="rail-btn" aria-label="Partager la vue" @click="share">
      <component :is="toast ? Check : Link2" :size="20" :stroke-width="1.8" aria-hidden="true" /><span class="rail-tip">Partager la vue</span>
    </button>
    <button id="theme-btn" type="button" class="rail-btn" :aria-label="state.theme === 'night' ? 'Mode jour' : 'Mode nuit'"
      @click="state.theme = state.theme === 'night' ? 'day' : 'night'">
      <component :is="state.theme === 'night' ? Sun : Moon" :size="20" :stroke-width="1.8" aria-hidden="true" />
      <span class="rail-tip">{{ state.theme === "night" ? "Mode jour" : "Mode nuit" }}</span>
    </button>
    <button id="about-btn" type="button" class="rail-btn" aria-label="Sources et licences" @click="emit('about')">
      <BookOpen :size="20" :stroke-width="1.8" aria-hidden="true" /><span class="rail-tip">Sources et licences</span>
    </button>
  </nav>
  <div v-if="toast" class="toast" role="status">{{ toast }}</div>
</template>
