<script setup lang="ts">
// Fiche d'un vol en ligne (VATSIM / IVAO) ou des contrôleurs d'un terrain.
import { computed } from "vue";
import { alt } from "../lib/format";
import { NET_COLOR } from "../map/trafficLayer";
import { openAirportByIdent } from "../map/mapView";
import type { Atc, Pilot } from "../services/traffic";
import KeyValues from "./KeyValues.vue";

const props = defineProps<{ p?: Pilot; icao?: string; list?: Atc[] }>();
const NET: Record<string, string> = { vatsim: "VATSIM", ivao: "IVAO" };
const KIND: Record<string, string> = { DEL: "Délivrance", GND: "Sol", TWR: "Tour", APP: "Approche", CTR: "Centre (en route)", FSS: "Information de vol", ATIS: "ATIS" };
const ORDER = ["ATIS", "DEL", "GND", "TWR", "APP", "CTR", "FSS"];
const sorted = computed(() => (props.list || []).slice().sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)));
/** Niveau de croisière déposé : « 36000 », « FL360 », « F360 » ou « A045 » selon le réseau. */
function cruise(v: string): string {
  if (!v) return "—";
  const m = /^(?:FL?|A)?(\d+)$/.exec(v.toUpperCase());
  if (!m) return v;
  let ft = Number(m[1]);
  if (ft < 1000) ft *= 100;
  return alt(ft);
}
const rows = computed(() => {
  const p = props.p!;
  return [
    ["Appareil", p.ac || "—"], ["Altitude", p.alt ? alt(Math.round(p.alt / 100) * 100) : "au sol"], ["Vitesse sol", `${Math.round(p.gs)} kt`],
    ["Cap", String(Math.round(p.hdg) % 360).padStart(3, "0") + "°"], ["Croisière prévue", cruise(p.cruise)],
    ["Règles", p.rules === "I" || p.rules === "IFR" ? "IFR" : p.rules === "V" || p.rules === "VFR" ? "VFR" : p.rules || "—"],
    ["Transpondeur", p.squawk || "—"], ["Dégagement", p.altn || "—"],
  ] as [string, string][];
});
</script>

<template>
  <template v-if="p">
    <div class="d-head">
      <h2>{{ p.callsign }}</h2>
      <span class="badge" :style="{ background: NET_COLOR[p.net] }">{{ NET[p.net] }}</span>
    </div>
    <div v-if="p.dep || p.arr" class="ofp-route trf-route">
      <button type="button" :disabled="!p.dep" @click="openAirportByIdent(p.dep)"><b>{{ p.dep || "—" }}</b></button>
      <span class="ofp-arrow">✈</span>
      <button type="button" :disabled="!p.arr" @click="openAirportByIdent(p.arr)"><b>{{ p.arr || "—" }}</b></button>
    </div>
    <KeyValues :rows="rows" />
    <template v-if="p.route">
      <h3>Route déposée</h3>
      <p class="wx-raw">{{ p.route }}</p>
    </template>
    <p class="muted small">Position mise à jour toutes les 30 s. Pointillés : départ → position → arrivée.</p>
  </template>

  <template v-else>
    <div class="d-head"><h2>{{ icao }}</h2><span class="badge">ATC en ligne</span></div>
    <div v-for="a in sorted" :key="a.net + a.callsign" class="trf-atc">
      <i :style="{ background: NET_COLOR[a.net] }"></i>
      <span><b>{{ a.callsign }}</b> <small>{{ KIND[a.kind] || a.kind }} · {{ NET[a.net] }}</small></span>
      <code>{{ a.freq }}</code>
      <p v-if="a.atis" class="wx-raw">{{ a.atis }}</p>
    </div>
  </template>
</template>
