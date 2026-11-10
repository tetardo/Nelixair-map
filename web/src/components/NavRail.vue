<script setup lang="ts">
import { BookOpen, NotebookTabs, Check, ChevronsLeft, ChevronsRight, FileText, Link2, Route, Layers, List, Map as MapIcon, Moon, PlaneLanding, Sun, SunMoon, type LucideIcon } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { shareUrl } from "../lib/share";
import { resizeMap, setSidebar, setTab } from "../map/mapView";
import { state, type Tab, type ThemeMode } from "../store";

// Thème : Auto → Jour → Nuit → Auto
const MODES: ThemeMode[] = ["auto", "day", "night"];
const NAME: Record<ThemeMode, string> = { auto: "Auto", day: "Jour", night: "Nuit" };
const themeTip = computed(() => {
  const now = state.themeMode === "auto" ? `Auto (${state.theme === "night" ? "nuit" : "jour"})` : NAME[state.themeMode];
  const next = MODES[(MODES.indexOf(state.themeMode) + 1) % MODES.length];
  return `Thème : ${now} · passer en ${NAME[next]}`;
});
const themeShort = computed(() => `Thème : ${NAME[state.themeMode]}`);
function nextTheme() { state.themeMode = MODES[(MODES.indexOf(state.themeMode) + 1) % MODES.length]; }

// Barre de navigation verticale : une icône par grande section du panneau.
// Cliquer la section déjà ouverte referme le panneau.
const logo = import.meta.env.BASE_URL + "img/nelixair-logo.svg";
const emit = defineEmits<{ about: [] }>();
const SECTIONS: [Tab, string, LucideIcon][] = [
  ["detail", "Fiche", FileText], ["flight", "Plan de vol", Route], ["flights", "Mes vols", NotebookTabs], ["airports", "Aéroports", PlaneLanding], ["list", "Liste", List], ["filters", "Calques", Layers],
];
function go(t: Tab) {
  if (state.sidebarOpen && state.tab === t) return setSidebar(false);
  setTab(t);
  if (!state.sidebarOpen) setSidebar(true);
}
const active = (t: Tab) => state.sidebarOpen && state.tab === t;

// Rail compact (icônes seules) ou large (icône + texte), choix mémorisé
const wide = ref(false);
function applyWide(on: boolean, save = true) {
  wide.value = on;
  document.body.classList.toggle("rail-wide", on);
  if (save) { try { localStorage.setItem("tropo-rail-wide", on ? "1" : "0"); } catch { /* stockage indisponible */ } }
  setTimeout(resizeMap, 220);
}
onMounted(() => {
  let on = false;
  try { on = localStorage.getItem("tropo-rail-wide") === "1"; } catch { /* stockage indisponible */ }
  if (on) applyWide(true, false);
});

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
    try { await navigator.share({ title: "TROPO", url }); say("Lien partagé" + note); }
    catch { history.replaceState(history.state, "", url); say("Copie impossible : le lien est dans la barre d'adresse"); }
  }
}
</script>

<template>
  <nav class="rail" aria-label="Sections">
    <div class="rail-logo"><img :src="logo" alt="Nelixair" width="26" height="26"></div>
    <button v-for="[id, label, icon] in SECTIONS" :key="id" type="button" class="rail-btn" :data-tab="id"
      :aria-pressed="active(id)" aria-controls="sidebar" :aria-label="label" @click="go(id)">
      <component :is="icon" :size="20" :stroke-width="1.8" aria-hidden="true" /><span class="rail-lbl">{{ label }}</span><span class="rail-tip">{{ label }}</span>
    </button>
    <div class="rail-sp"></div>
    <button type="button" class="rail-btn" :aria-pressed="state.viewMenu" aria-label="Affichage de la carte"
      @click.stop="state.viewMenu = !state.viewMenu">
      <MapIcon :size="20" :stroke-width="1.8" aria-hidden="true" /><span class="rail-lbl">Affichage</span><span class="rail-tip">Affichage</span>
    </button>
    <button id="share-btn" type="button" class="rail-btn" aria-label="Partager la vue" @click="share">
      <component :is="toast ? Check : Link2" :size="20" :stroke-width="1.8" aria-hidden="true" /><span class="rail-lbl">Partager</span><span class="rail-tip">Partager la vue</span>
    </button>
    <button id="theme-btn" type="button" class="rail-btn" :aria-label="themeTip" @click="nextTheme">
      <component :is="state.themeMode === 'auto' ? SunMoon : state.themeMode === 'night' ? Moon : Sun" :size="20" :stroke-width="1.8" aria-hidden="true" />
      <span class="rail-lbl">{{ themeShort }}</span><span class="rail-tip">{{ themeTip }}</span>
    </button>
    <button id="about-btn" type="button" class="rail-btn" aria-label="Sources et licences" @click="emit('about')">
      <BookOpen :size="20" :stroke-width="1.8" aria-hidden="true" /><span class="rail-lbl">Sources</span><span class="rail-tip">Sources et licences</span>
    </button>
    <button id="rail-size" type="button" class="rail-btn rail-size" :aria-pressed="wide" :aria-label="wide ? 'Barre compacte (icônes seules)' : 'Barre large (icônes et texte)'"
      @click="applyWide(!wide)">
      <component :is="wide ? ChevronsLeft : ChevronsRight" :size="20" :stroke-width="1.8" aria-hidden="true" />
      <span class="rail-lbl">Réduire</span><span class="rail-tip">Afficher les libellés</span>
    </button>
  </nav>
  <div v-if="toast" class="toast" role="status">{{ toast }}</div>
</template>
