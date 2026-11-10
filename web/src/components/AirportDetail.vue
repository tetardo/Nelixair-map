<script setup lang="ts">
import { computed, ref } from "vue";
import { airacAt, fmtDate, siaAd2Url } from "../lib/airac";
import { APT_KIND, SRC, deg3, dms, ft, pairs, yes, type LngLat } from "../lib/format";
import { openAirportChart } from "../map/mapView";
import { aptDetails, type AptDetails } from "../services/data";
import { sunTimes, type SunTime } from "../services/sun";
import { WX_COLORS, ceilingFt, flightCat, metar, taf, visSm, wind, type Metar } from "../services/weather";
import { state, type Props } from "../store";
import KeyValues from "./KeyValues.vue";

const props = defineProps<{ p: Props; ll: LngLat }>();

const FREQ_LBL: Record<string, string> = { TWR: "Tour", GND: "Sol", APP: "Approche", ATIS: "ATIS", DEL: "Prévol", DEP: "Départ", ARR: "Arrivée",
  AFIS: "AFIS", INFO: "Info", CTAF: "CTAF", UNICOM: "Unicom", MULTICOM: "Multicom", RADAR: "Radar", CTR: "Centre",
  FIS: "SIV", APRON: "Trafic", RADIO: "Radio", AWOS: "AWOS", VOLMET: "VOLMET", GLIDING: "Vol à voile", LIGHTS: "Balisage", OTHER: "Autre" };
const FREQ_ORDER = ["ATIS", "AWOS", "DEL", "GND", "TWR", "AFIS", "CTAF", "UNICOM", "INFO", "RADIO", "APP", "DEP", "ARR", "RADAR"];
const CHART_GROUPS: [string, string][] = [["APD", "Diagramme d'aéroport"], ["IAP", "Approches"], ["DP", "Départs (SID)"], ["ODP", "Départs (SID)"],
  ["STAR", "Arrivées (STAR)"], ["MIN", "Minima"], ["HOT", "Points chauds"], ["LAH", "LAHSO"], ["DAU", "Autres"]];

const facts = computed(() => pairs([["Altitude", ft(props.p.elev_ft)], ["Piste max", props.p.rwy_ft ? ft(props.p.rwy_ft) : null],
  ["IATA", props.p.iata], ["Pays", props.p.country || props.p.region]]));

// ---------- Pistes, fréquences, cartes FAA ----------
const details = ref<AptDetails | null | undefined>(undefined);
aptDetails(props.p.ident).then((d) => (details.value = d || {}));
const freqs = computed(() => {
  const rank = (t: string) => { const i = FREQ_ORDER.indexOf(t); return i < 0 ? 99 : i; };
  return (details.value?.frq || []).slice().sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]);
});
const chartGroups = computed(() => {
  const d = details.value;
  if (!d?.chr?.length || !state.chartsMeta) return [];
  const groups = new Map<string, [string, string][]>();
  for (const [code, name, pdf] of d.chr) {
    const g = (CHART_GROUPS.find(([c]) => c === code) || ["", "Autres"])[1];
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push([name, pdf]);
  }
  const order = [...new Set(CHART_GROUPS.map(([, g]) => g)), "Autres"];
  return order.filter((g) => groups.has(g)).map((g) => ({ name: g, items: groups.get(g)! }));
});
const copied = ref("");
function copy(v: string) {
  navigator.clipboard?.writeText(v).then(() => { copied.value = v; setTimeout(() => (copied.value = ""), 900); }).catch(() => {});
}

// ---------- Carte d'aéroport (plan au sol OSM) ----------
const ground = computed(() => state.ground[props.p.ident] || null);
const isFrench = computed(() => /^LF[A-Z]{2}$/.test(props.p.ident));
const cyc = airacAt();

// ---------- Météo ----------
const wx = ref<{ m: Metar | null; t: { rawTAF: string } | null; err: boolean } | null>(null);
const hasIcao = /^[A-Z0-9]{4}$/.test(props.p.ident);
if (hasIcao) Promise.allSettled([metar(props.p.ident), taf(props.p.ident)]).then(([m, t]) => {
  wx.value = { m: m.status === "fulfilled" ? m.value : null, t: t.status === "fulfilled" ? t.value : null,
    err: m.status === "rejected" && t.status === "rejected" };
});
const cat = computed(() => (wx.value?.m ? flightCat(wx.value.m) : null));
const wxFacts = computed(() => {
  const mt = wx.value?.m;
  if (!mt) return [];
  const v = visSm(mt.visib), c = ceilingFt(mt);
  return pairs([["Vent", wind(mt)], ["Visibilité", v != null ? `${v >= 10 ? "≥ 10" : v} SM` : null], ["Plafond", c != null ? ft(c) : "Aucun"],
    ["Temp. / rosée", mt.temp != null ? `${mt.temp} / ${mt.dewp ?? "?"} °C` : null], ["QNH", mt.altim != null ? `${Math.round(mt.altim)} hPa` : null]]);
});
const metarTime = computed(() => String(wx.value?.m?.reportTime || "").replace(/^\d{4}-(\d\d)-(\d\d)[T ](\d\d:\d\d).*$/, "$2/$1 $3Z"));

// ---------- Soleil : nuit aéronautique (fin / début du crépuscule civil, EASA) ----------
const now = new Date();
const sun = sunTimes(props.ll[1], props.ll[0]);
const hm = (d: SunTime) => d === "day" ? "soleil toujours levé" : d === "night" ? "soleil toujours couché"
  : `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}Z`;
let dayState = "";
if (sun.dawn instanceof Date && sun.dusk instanceof Date) dayState = now >= sun.dawn && now <= sun.dusk ? "Jour aéronautique" : "Nuit aéronautique";
else if (sun.dusk === "day" || sun.dawn === "day") dayState = "Jour aéronautique";
else if (sun.dusk === "night") dayState = "Nuit aéronautique";
const sunRows = pairs([["Lever", hm(sun.rise)], ["Coucher", hm(sun.set)], ["Début nuit (EASA)", hm(sun.dusk)], ["Fin nuit (EASA)", hm(sun.dawn)],
  ["Maintenant", dayState]]);
const today = `${now.toISOString().slice(8, 10)}/${now.toISOString().slice(5, 7)}`;
</script>

<template>
  <div class="apt-head">
    <div class="d-head">
      <h2>{{ p.ident }}</h2>
      <span class="badge">{{ APT_KIND[p.kind] || "Aéroport" }}</span>
      <span v-if="yes(p.ifr)" class="badge b-ifr" title="Procédures aux instruments">IFR</span>
      <span v-if="yes(p.mil)" class="badge b-mil">MIL</span>
    </div>
    <p v-if="p.name" class="d-sub">{{ p.name }}</p>
    <div class="facts"><div v-for="[k, v] in facts" :key="k"><small>{{ k }}</small><b>{{ v }}</b></div></div>
  </div>

  <!-- Carte d'aéroport : plan au sol vectoriel (terrains pilotes) -->
  <section v-if="ground" class="d-sec chart-sec">
    <h3>Carte d'aéroport <small>OSM {{ ground.osm.slice(0, 10) }}</small></h3>
    <button class="primary" type="button" @click="openAirportChart(p.ident)">Afficher le plan au sol</button>
    <div class="facts gfacts">
      <div><small>Pistes</small><b>{{ ground.runways.join(" · ") || "—" }}</b></div>
      <div><small>Postes</small><b>{{ (ground.counts.stand || 0) + (ground.counts.gate || 0) }}</b></div>
      <div><small>Taxiways</small><b>{{ ground.taxiways.length }}</b></div>
    </div>
    <div v-if="ground.taxiways.length" class="chips twy-chips"><span v-for="t in ground.taxiways" :key="t" class="twy">{{ t }}</span></div>
    <p class="muted small">Données OpenStreetMap (ODbL), non certifiées : la complétude dépend des contributeurs.</p>
    <p v-if="isFrench" class="small">
      <a class="ext" :href="siaAd2Url(p.ident, cyc)" target="_blank" rel="noopener">eAIP SIA · AD 2 {{ p.ident }}</a>
      <span class="muted"> · AIRAC {{ cyc.ident }} ({{ fmtDate(cyc.start) }} → {{ fmtDate(cyc.end) }})</span>
    </p>
  </section>

  <section class="d-sec">
    <h3>Météo <span v-if="cat" id="d-cat"><span class="cat" :style="{ background: WX_COLORS[cat] || '#888' }">{{ cat }}</span></span></h3>
    <div id="d-wx">
      <span v-if="!hasIcao" class="muted">Pas de code OACI : météo non disponible.</span>
      <span v-else-if="!wx" class="muted">Chargement…</span>
      <span v-else-if="wx.err" class="muted">Météo indisponible pour le moment (relais météo injoignable).</span>
      <template v-else>
        <template v-if="wx.m">
          <div class="facts wx-facts">
            <div v-for="[k, v] in wxFacts" :key="k" :class="{ wide: v.length > 11 }"><small>{{ k }}</small><b>{{ v }}</b></div>
          </div>
          <div class="wx-raw"><small>METAR {{ metarTime }}</small>{{ wx.m.rawOb }}</div>
        </template>
        <p v-else class="muted small">Pas de METAR récent.</p>
        <div v-if="wx.t" class="wx-raw"><small>TAF</small>{{ wx.t.rawTAF }}</div>
        <p v-else class="muted small">Pas de TAF.</p>
      </template>
    </div>
  </section>

  <section class="d-sec">
    <h3>Pistes</h3>
    <div id="d-rwy">
      <span v-if="details === undefined" class="muted">Chargement…</span>
      <table v-else-if="details?.rwy?.length" class="tbl">
        <thead><tr><th>Piste</th><th>Longueur</th><th>Largeur</th><th>Revêtement</th></tr></thead>
        <tbody>
          <tr v-for="([des, len, wid, surf, hdg, ref], i) in details.rwy" :key="i">
            <td><b>{{ des || "—" }}</b><small v-if="hdg != null">{{ deg3(hdg) }}{{ ref === "M" ? " M" : "" }}</small></td>
            <td>{{ len ? Number(len).toLocaleString("fr-FR") + " ft" : "—" }}</td>
            <td>{{ wid ? wid + " ft" : "—" }}</td>
            <td>{{ surf || "—" }}</td>
          </tr>
        </tbody>
      </table>
      <span v-else class="muted">Non publiées par les sources.</span>
    </div>
  </section>

  <section class="d-sec">
    <h3>Fréquences</h3>
    <div id="d-frq">
      <span v-if="details === undefined" class="muted">Chargement…</span>
      <table v-else-if="freqs.length" class="tbl freqs">
        <tbody>
          <tr v-for="([t, mhz, name], i) in freqs" :key="i">
            <td><span class="ftype">{{ FREQ_LBL[t] || t }}</span></td>
            <td><button class="copy" :class="{ ok: copied === Number(mhz).toFixed(3) }" title="Copier" @click="copy(Number(mhz).toFixed(3))">{{ Number(mhz).toFixed(3) }}</button></td>
            <td class="muted">{{ name }}</td>
          </tr>
        </tbody>
      </table>
      <span v-else class="muted">Non publiées par les sources.</span>
    </div>
  </section>

  <section v-if="chartGroups.length && state.chartsMeta" id="d-chr-sec" class="d-sec">
    <h3>Cartes FAA <small>cycle {{ state.chartsMeta.cycle }}</small></h3>
    <div id="d-chr">
      <details v-for="g in chartGroups" :key="g.name" :open="g.name === `Diagramme d'aéroport` || g.name === 'Approches'">
        <summary>{{ g.name }} <small>{{ g.items.length }}</small></summary>
        <ul class="charts">
          <li v-for="[n, pdf] in g.items" :key="pdf"><a :href="state.chartsMeta.base + pdf" target="_blank" rel="noopener">{{ n }}</a></li>
        </ul>
      </details>
      <p class="muted small">PDF officiels FAA (domaine public). Ne pas utiliser pour la navigation.</p>
    </div>
  </section>

  <section v-if="!ground" class="d-sec">
    <h3>Carte d'aéroport</h3>
    <p class="muted small">Pas encore de plan au sol pour ce terrain (phase pilote : {{ Object.keys(state.ground).join(", ") || "aucun terrain chargé" }}).</p>
    <p v-if="isFrench" class="small">
      <a class="ext" :href="siaAd2Url(p.ident, cyc)" target="_blank" rel="noopener">eAIP SIA · AD 2 {{ p.ident }}</a>
      <span class="muted"> · AIRAC {{ cyc.ident }} ({{ fmtDate(cyc.start) }} → {{ fmtDate(cyc.end) }})</span>
    </p>
  </section>

  <section class="d-sec">
    <h3>Soleil <small>{{ today }} · UTC</small></h3>
    <KeyValues :rows="sunRows" />
    <p class="muted small">Nuit = fin du crépuscule civil du soir → début du crépuscule civil du matin. Calcul approché (± 2 min).</p>
  </section>

  <section class="d-sec">
    <h3>Position</h3>
    <KeyValues :rows="pairs([['Latitude', dms(ll[1], true)], ['Longitude', dms(ll[0], false)]])" />
    <p class="muted small">Source : {{ SRC[p.src] || p.src || "" }}{{ p.cycle ? " · " + p.cycle : "" }}</p>
  </section>
</template>
