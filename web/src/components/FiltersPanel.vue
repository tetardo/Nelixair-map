<script setup lang="ts">
import { state } from "../store";
import Section from "./Section.vue";

// [clé du filtre, libellé, classe de la pastille]
type Item = [string, string, string?];
// Ordre de lecture d'un pilote : terrain et météo d'abord, puis navigation, espaces, fonds
const SECTIONS: { id: string; title: string; grid?: boolean; open?: boolean; items: Item[] }[] = [
  { id: "f-apt", title: "Aéroports", grid: true, items: [["apt_large", "Grands"], ["apt_medium", "Moyens"], ["apt_small", "Petits"], ["apt_heli", "Héli / hydro"],
    ["ground", "Plan au sol (OSM)", "sw-ground"], ["approach", "Axes, ILS, seuils (eAIP)", "sw-appr"]] },
  { id: "f-wx", title: "Météo", items: [["wx", "METAR (catégorie de vol)", "sw-wx"], ["hazards", "SIGMET / AIRMET", "sw-hz"],
    ["pireps", "PIREP (comptes rendus pilotes)", "sw-pirep"], ["sat", "Satellite infrarouge", "sw-sat"]] },
  { id: "f-nav", title: "Navigation", items: [["H", "Voies hautes", "sw-h"], ["L", "Voies basses", "sw-l"], ["rnav", "RNAV (Q, T…)", "sw-rnav"],
    ["conv", "Conventionnelles (J, V…)", "sw-conv"], ["waypoint", "Waypoints", "sw-wpt"]] },
  { id: "f-navaid", title: "Navaids", grid: true, items: [["vor", "VOR"], ["vordme", "VOR/DME"], ["vortac", "VORTAC"], ["tacan", "TACAN"], ["dme", "DME"], ["ndb", "NDB"]] },
  { id: "f-asp", title: "Espaces aériens", items: [["asp_controlled", "Contrôlés (CTR, TMA, CTA…)", "sw-ctl"], ["asp_special", "Zones R, P, D, TRA, TSA…", "sw-spc"],
    ["asp_fir", "FIR / UIR", "sw-fir"], ["asp_other", "Autres (TMZ, RMZ, vol à voile…)", "sw-oth"]] },
  { id: "f-misc", title: "Relief et repères", items: [["night", "Zone de nuit", "sw-night"], ["mora", "Grid MORA (US)", "sw-mora"]] },
];
const on = (it: Item[]) => `${it.filter(([k]) => state.filters[k]).length}/${it.length}`;
const setAll = (it: Item[], v: boolean) => it.forEach(([k]) => (state.filters[k] = v));
</script>

<template>
  <section id="tab-filters" class="tabpanel" role="tabpanel">
    <Section v-for="s in SECTIONS" :id="s.id" :key="s.id" :title="s.title" :badge="on(s.items)">
      <div class="f-all">
        <button type="button" @click="setAll(s.items, true)">Tout</button><button type="button" @click="setAll(s.items, false)">Aucun</button>
      </div>
      <div :class="{ grid2: s.grid }">
        <label v-for="[k, label, sw] in s.items" :key="k">
          <input v-model="state.filters[k]" type="checkbox" :data-f="k"><i v-if="sw" class="sw" :class="sw"></i>{{ label }}
        </label>
      </div>
    </Section>
    <p v-if="state.wxStatus" id="wx-status" class="muted small">{{ state.wxStatus }}</p>
    <p class="muted small">Raccourcis : <kbd>/</kbd> chercher un ident · <kbd>F</kbd> afficher / masquer le panneau · <kbd>Échap</kbd> effacer la sélection.
      Cliquer un objet ouvre sa fiche ; l'adresse de la page permet de la partager.</p>
  </section>
</template>
