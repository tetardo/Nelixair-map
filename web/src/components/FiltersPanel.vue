<script setup lang="ts">
import { computed } from "vue";
import { enrouteAtc, hasAtcSector, highlightAtcSector } from "../map/trafficLayer";
import { flyToAtc } from "../map/mapView";
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
  { id: "f-traffic", title: "Trafic en ligne", items: [["vatsim", "VATSIM (avions et contrôleurs)", "sw-vatsim"], ["ivao", "IVAO (avions et contrôleurs)", "sw-ivao"]] },
  { id: "f-nav", title: "Navigation", items: [["H", "Voies hautes", "sw-h"], ["L", "Voies basses", "sw-l"], ["rnav", "RNAV (Q, T…)", "sw-rnav"],
    ["conv", "Conventionnelles (J, V…)", "sw-conv"], ["waypoint", "Waypoints", "sw-wpt"]] },
  { id: "f-navaid", title: "Navaids", grid: true, items: [["vor", "VOR"], ["vordme", "VOR/DME"], ["vortac", "VORTAC"], ["tacan", "TACAN"], ["dme", "DME"], ["ndb", "NDB"]] },
  { id: "f-asp", title: "Espaces aériens", items: [["asp_controlled", "Contrôlés (CTR, TMA, CTA…)", "sw-ctl"], ["asp_special", "Zones R, P, D, TRA, TSA…", "sw-spc"],
    ["asp_fir", "FIR / UIR", "sw-fir"], ["asp_other", "Autres (TMZ, RMZ, vol à voile…)", "sw-oth"]] },
  { id: "f-misc", title: "Relief et repères", items: [["night", "Zone de nuit", "sw-night"], ["mora", "Grid MORA (US)", "sw-mora"]] },
];
// contrôleurs en route, recalculés à chaque rafraîchissement (trafficStatus change)
const ctr = computed(() => (state.trafficStatus, enrouteAtc()).slice().sort((a, b) => a.callsign.localeCompare(b.callsign)));
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
    <p v-if="state.trafficStatus" class="muted small">{{ state.trafficStatus }} · rafraîchi toutes les 30 s</p>
    <details v-if="ctr.length" class="taf"><summary>Contrôleurs en route en ligne ({{ ctr.length }})</summary>
      <div class="trf-ctr" @mouseleave="highlightAtcSector(null)">
        <button v-for="a in ctr" :key="a.net + a.callsign" type="button" :class="{ nosec: !hasAtcSector(a) }"
          :title="hasAtcSector(a) ? 'Survol : secteur sur la carte · clic : y aller' : 'Secteur inconnu'"
          @mouseenter="highlightAtcSector(a)" @focus="highlightAtcSector(a)" @click="flyToAtc(a)"><b>{{ a.callsign }}</b> {{ a.freq }}</button>
      </div>
    </details>
    <p class="muted small">Raccourcis : <kbd>/</kbd> chercher un ident · <kbd>F</kbd> afficher / masquer le panneau · <kbd>Échap</kbd> effacer la sélection.
      Cliquer un objet ouvre sa fiche ; l'adresse de la page permet de la partager.</p>
  </section>
</template>
