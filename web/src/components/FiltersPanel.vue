<script setup lang="ts">
import { state } from "../store";

// [clé du filtre, libellé, classe de la pastille]
type Item = [string, string, string?];
const SECTIONS: { title: string; grid?: boolean; items: Item[] }[] = [
  { title: "Voies aériennes", items: [["H", "Hautes", "sw-h"], ["L", "Basses", "sw-l"], ["rnav", "RNAV (Q, T…)", "sw-rnav"], ["conv", "Conventionnelles (J, V…)", "sw-conv"]] },
  { title: "Navaids", grid: true, items: [["vor", "VOR"], ["vordme", "VOR/DME"], ["vortac", "VORTAC"], ["tacan", "TACAN"], ["dme", "DME"], ["ndb", "NDB"]] },
  { title: "Points", items: [["waypoint", "Waypoints", "sw-wpt"]] },
  { title: "Aéroports", grid: true, items: [["apt_large", "Grands"], ["apt_medium", "Moyens"], ["apt_small", "Petits"], ["apt_heli", "Héli / hydro"]] },
  { title: "Cartes d'aéroport", items: [["ground", "Plan au sol (terrains pilotes, OSM)", "sw-ground"]] },
  { title: "Espaces aériens", items: [["asp_controlled", "Contrôlés (CTR, TMA, CTA…)", "sw-ctl"], ["asp_special", "Zones R, P, D, TRA, TSA…", "sw-spc"],
    ["asp_fir", "FIR / UIR", "sw-fir"], ["asp_other", "Autres (TMZ, RMZ, vol à voile…)", "sw-oth"]] },
  { title: "Météo et relief", items: [["wx", "METAR (catégorie de vol)", "sw-wx"], ["hazards", "SIGMET / AIRMET", "sw-hz"],
    ["pireps", "PIREP (comptes rendus pilotes)", "sw-pirep"], ["sat", "Satellite infrarouge", "sw-sat"], ["night", "Zone de nuit", "sw-night"],
    ["mora", "Grid MORA (US)", "sw-mora"]] },
];
</script>

<template>
  <section id="tab-filters" class="tabpanel" role="tabpanel">
    <template v-for="s in SECTIONS" :key="s.title">
      <h3>{{ s.title }}</h3>
      <div :class="{ grid2: s.grid }">
        <label v-for="[k, label, sw] in s.items" :key="k">
          <input v-model="state.filters[k]" type="checkbox" :data-f="k"><i v-if="sw" class="sw" :class="sw"></i>{{ label }}
        </label>
      </div>
    </template>
    <p v-if="state.wxStatus" id="wx-status" class="muted small">{{ state.wxStatus }}</p>
    <p class="muted small">Raccourcis : <kbd>/</kbd> chercher un ident · <kbd>F</kbd> afficher / masquer le panneau · <kbd>Échap</kbd> effacer la sélection.
      Cliquer un objet ouvre sa fiche ; l'adresse de la page permet de la partager.</p>
  </section>
</template>
