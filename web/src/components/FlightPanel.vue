<script setup lang="ts">
import { ArrowRight, ChartArea, Crosshair, Download, FlaskConical, Plane, Trash2 } from "@lucide/vue";
import RouteWeather from "./RouteWeather.vue";
import { computed, ref } from "vue";
import { alt } from "../lib/format";
import { fitOfp, flyTo, highlightLeg, openAirportByIdent, selectPoint, setOfp } from "../map/mapView";
import { demoOfp, fetchOfp, hhmm } from "../services/simbrief";
import { state } from "../store";
import Section from "./Section.vue";

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

const o = computed(() => state.ofp);
const isDemo = computed(() => o.value?.user === "démo");
const u = computed(() => (o.value?.units === "lbs" ? "lb" : "kg"));
const n = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toLocaleString("fr-FR"));
const fl = (v: string) => { const x = Number(v); return x ? alt(x) : v; };
const gen = computed(() => {
  const t = Number(o.value?.generated);
  return t ? new Date(t * 1000).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "";
});
const FUEL: [string, string][] = [["ramp", "Bloc"], ["takeoff", "Décollage"], ["burn", "Délestage"], ["landing", "Atterrissage"],
  ["contingency", "Contingence"], ["alternate", "Dégagement"], ["reserve", "Réserve finale"], ["extra", "Supplément"]];
const STAGE: Record<string, string> = { CLB: "Montée", CRZ: "Croisière", DSC: "Descente" };

function go(i: number) {
  const f = o.value!.fixes[i];
  selectPoint([f.lon, f.lat]);
  flyTo([f.lon, f.lat], 8);
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

    <template v-if="o">
      <div class="ofp-head">
        <div class="ofp-route">
          <button type="button" :title="'Fiche ' + o.orig.icao" @click="openAirportByIdent(o.orig.icao)"><b>{{ o.orig.icao }}</b><small>{{ o.orig.rwy && "RWY " + o.orig.rwy }}</small></button>
          <span class="ofp-arrow"><Plane :size="16" aria-hidden="true" /><small>{{ n(o.distance) }} NM · {{ hhmm(o.ete) }}</small></span>
          <button type="button" :title="'Fiche ' + o.dest.icao" @click="openAirportByIdent(o.dest.icao)"><b>{{ o.dest.icao }}</b><small>{{ o.dest.rwy && "RWY " + o.dest.rwy }}</small></button>
        </div>
        <p class="ofp-sub">{{ [o.callsign, o.aircraft, o.reg].filter(Boolean).join(" · ") }}<span v-if="isDemo" class="badge b-demo">Démo fictive</span></p>
        <div class="facts">
          <div><small>Croisière</small><b>{{ fl(o.cruise) }}</b></div>
          <div><small>Cost index</small><b>{{ o.ci || "—" }}</b></div>
          <div><small>Dégagement</small><b>{{ o.altn.map((a) => a.icao).join(" ") || "—" }}</b></div>
        </div>
        <div class="apt-actions">
          <button class="primary" type="button" @click="fitOfp"><Crosshair :size="14" aria-hidden="true" />Voir toute la route</button>
          <button class="btn-ghost" type="button" :aria-pressed="state.profileOpen" @click="state.profileOpen = !state.profileOpen"><ChartArea :size="14" aria-hidden="true" />Profil vertical</button>
          <button class="btn-ghost" type="button" title="Retirer le plan de vol" @click="setOfp(null)"><Trash2 :size="14" aria-hidden="true" /></button>
        </div>
      </div>

      <RouteWeather :ofp="o" />

      <Section id="ofp-route" title="Route" :open="false">
        <p class="wx-raw">{{ o.route || "—" }}</p>
      </Section>

      <Section id="ofp-fuel" title="Carburant et masses" :badge="u">
        <dl class="ofp-dl">
          <template v-for="[k, label] in FUEL" :key="k"><dt>{{ label }}</dt><dd>{{ n(o.fuel[k as keyof typeof o.fuel]) }}</dd></template>
          <dt>ZFW</dt><dd>{{ n(o.weights.zfw) }}</dd><dt>TOW</dt><dd>{{ n(o.weights.tow) }}</dd>
          <dt>LW</dt><dd>{{ n(o.weights.law) }}</dd><dt>Passagers</dt><dd>{{ n(o.weights.pax) }}</dd>
        </dl>
      </Section>

      <Section id="ofp-log" title="Nav log" :badge="String(o.fixes.length)">
        <table class="log ofp-log" @mouseleave="highlightLeg(-1)">
          <thead><tr><th>Point</th><th>Alt</th><th>Rm</th><th>NM</th><th>Cumul</th><th>Temps</th><th>{{ u }}</th></tr></thead>
          <tbody>
            <template v-for="(f, i) in o.fixes" :key="i">
              <tr v-if="i === 0 || f.via !== o.fixes[i - 1].via" class="note"><td colspan="7"><ArrowRight :size="11" aria-hidden="true" /> {{ f.via || "DCT" }}</td></tr>
              <tr :data-lon="f.lon" :data-lat="f.lat" :class="'st-' + f.stage" @click="go(i)" @mouseenter="highlightLeg(i)">
                <td><b>{{ f.ident }}</b><small :title="STAGE[f.stage]">{{ f.stage }}</small></td>
                <td>{{ f.alt != null ? alt(f.alt) : "" }}</td>
                <td>{{ f.trk != null ? String(Math.round(f.trk) % 360).padStart(3, "0") : "" }}</td>
                <td>{{ Math.round(f.leg) }}</td><td>{{ Math.round(f.cum) }}</td>
                <td>{{ hhmm(f.ete) }}</td><td>{{ n(f.fuelRem) }}</td>
              </tr>
            </template>
          </tbody>
        </table>
        <p class="muted small">Rm : route magnétique du tronçon arrivant sur le point. Carburant : quantité prévue à bord.</p>
      </Section>
      <p class="muted small">AIRAC {{ o.airac || "?" }}<template v-if="gen"> · généré le {{ gen }}</template> · source SimBrief.
        <template v-if="isDemo"> Vol fictif, positions approximatives.</template></p>
    </template>
    <p v-else-if="!err" class="muted">Aucun plan de vol chargé.</p>
  </section>
</template>
