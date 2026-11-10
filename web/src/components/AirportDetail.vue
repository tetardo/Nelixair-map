<script setup lang="ts">
import { computed, ref } from "vue";
import { airacAt, fmtDate, siaAd2Url } from "../lib/airac";
import { APT_KIND, SRC, ddm, deg3, dms, ft, pairs, yes, type LngLat } from "../lib/format";
import { eaipEnds, groundFocus, groundPreview, openAirportChart } from "../map/mapView";
import { aptDetails, type AptDetails } from "../services/data";
import { sunTimes, type SunTime } from "../services/sun";
import { runwayWinds, splitDesignator, type RwyWind } from "../lib/wind";
import { WX_COLORS, ceilingFt, flightCat, metar, taf, visSm, wind, type Metar } from "../services/weather";
import { state, type EaipRwy, type Props } from "../store";
import KeyValues from "./KeyValues.vue";
import Section from "./Section.vue";

const props = defineProps<{ p: Props; ll: LngLat }>();

const FREQ_LBL: Record<string, string> = { TWR: "Tour", GND: "Sol", APP: "Approche", ATIS: "ATIS", DEL: "Prévol", DEP: "Départ", ARR: "Arrivée",
  AFIS: "AFIS", INFO: "Info", CTAF: "CTAF", UNICOM: "Unicom", MULTICOM: "Multicom", RADAR: "Radar", CTR: "Centre",
  FIS: "SIV", APRON: "Trafic", RADIO: "Radio", AWOS: "AWOS", VOLMET: "VOLMET", GLIDING: "Vol à voile", LIGHTS: "Balisage", OTHER: "Autre" };
const FREQ_ORDER = ["ATIS", "AWOS", "DEL", "GND", "TWR", "AFIS", "CTAF", "UNICOM", "INFO", "RADIO", "APP", "DEP", "ARR", "RADAR"];
const CHART_GROUPS: [string, string][] = [["APD", "Diagramme d'aéroport"], ["IAP", "Approches"], ["DP", "Départs (SID)"], ["ODP", "Départs (SID)"],
  ["STAR", "Arrivées (STAR)"], ["MIN", "Minima"], ["HOT", "Points chauds"], ["LAH", "LAHSO"], ["DAU", "Autres"]];

const facts = computed(() => {
  const ta = state.eaip[props.p.ident]?.ta_ft;
  return pairs([["Altitude", ft(props.p.elev_ft)], ["Piste max", props.p.rwy_ft ? ft(props.p.rwy_ft) : null],
    ["TA", ta ? `${ta} ft` : null], ["IATA", ta ? null : props.p.iata], ["Pays", ta ? null : props.p.country || props.p.region]]).slice(0, 3);
});

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
// Composantes de vent par QFU (caps vrais du plan au sol si dispo, sinon OpenAIP / numéro de piste)
const rwyWinds = computed(() => {
  const mt = wx.value?.m;
  if (!mt) return [];
  const rw = (details.value?.rwy || []).map((r) => [r[0], r[4], r[5]] as [string, number | null, string]);
  return runwayWinds(mt.wdir, mt.wspd, mt.wgst, { ...ground.value?.ends, ...eaipEnds(props.p.ident) }, rw);
});
const kt = (v: number) => `${Math.abs(v)} kt`;

// Une ligne par QFU : caractéristiques de la piste + composantes de vent du METAR
interface QfuRow { qfu: string; hdg: string; len: string; surf: string; w?: RwyWind; e?: EaipRwy }
const eaip = computed(() => state.eaip[props.p.ident] || null);
const qfuRows = computed<QfuRow[]>(() => {
  const wmap = new Map(rwyWinds.value.map((r) => [r.qfu, r]));
  const out: QfuRow[] = [];
  const seen = new Set<string>();
  for (const [des, len, wid, surf, hdg, ref] of details.value?.rwy || []) {
    const qs = splitDesignator(des || "");
    const dim = len ? `${Number(len).toLocaleString("fr-FR")}${wid ? " × " + wid : ""} ft` : "—";
    (qs.length ? qs : [des || "—"]).forEach((q, i) => {
      if (seen.has(q)) return;
      seen.add(q);
      const h = hdg != null ? (i === 0 ? hdg : (Number(hdg) + 180) % 360) : null;
      out.push({ qfu: q, hdg: h != null ? deg3(h) + (ref === "M" ? "M" : ref === "T" ? "V" : "") : "", len: dim, surf: surf || "", w: wmap.get(q) });
    });
  }
  // QFU connus seulement par le plan au sol
  for (const [q, h] of Object.entries(ground.value?.ends || {})) {
    if (!seen.has(q)) { seen.add(q); out.push({ qfu: q, hdg: deg3(h) + "V", len: "—", surf: "", w: wmap.get(q) }); }
  }
  // Données officielles eAIP : remplacent cap et dimensions, ajoutent distances / ILS / PAPI
  for (const [q, e] of Object.entries(eaip.value?.rwys || {})) {
    let r = out.find((x) => x.qfu === q);
    if (!r) { r = { qfu: q, hdg: "", len: "—", surf: "", w: wmap.get(q) }; out.push(r); }
    r.e = e;
    if (e.mag != null) r.hdg = String(e.mag).padStart(3, "0") + "°M";
    if (e.len) r.len = `${e.len.toLocaleString("fr-FR")}${e.wid ? " × " + e.wid : ""} m`;
    if (e.surface) r.surf = e.surface + (e.pcn ? " · PCN " + e.pcn : "");
  }
  return out.sort((a, b) => a.qfu.localeCompare(b.qfu, "fr", { numeric: true }));
});
const m = (v?: number) => (v != null ? v.toLocaleString("fr-FR") : "—");
const bestQfu = computed(() => rwyWinds.value[0]?.qfu || "");
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
const isNight = dayState === "Nuit aéronautique";
const siteRows = computed(() => pairs([["Altitude de transition", eaip.value?.ta_ft ? `${eaip.value.ta_ft.toLocaleString("fr-FR")} ft` : null],
  ["Déclinaison", eaip.value?.magvar != null ? `${Math.abs(eaip.value.magvar)}° ${eaip.value.magvar >= 0 ? "E" : "W"}${eaip.value.magvar_year ? " (" + eaip.value.magvar_year + ")" : ""}` : null],
  ["Altitude de référence", eaip.value?.elev_ft != null ? `${eaip.value.elev_ft} ft` : null]]));
const sunRows = pairs([["Lever", hm(sun.rise)], ["Coucher", hm(sun.set)], ["Début nuit (EASA)", hm(sun.dusk)], ["Fin nuit (EASA)", hm(sun.dawn)],
  ["Maintenant", dayState]]);
const today = `${now.toISOString().slice(8, 10)}/${now.toISOString().slice(5, 7)}`;
</script>


<template>
  <!-- En-tête : identité + état du terrain en un coup d'œil -->
  <div class="apt-head">
    <div class="d-head">
      <h2>{{ p.ident }}</h2>
      <span class="badge">{{ APT_KIND[p.kind] || "Aéroport" }}</span>
      <span v-if="yes(p.ifr)" class="badge b-ifr" title="Procédures aux instruments">IFR</span>
      <span v-if="yes(p.mil)" class="badge b-mil">MIL</span>
      <span v-if="cat" class="cat head-cat" :style="{ background: WX_COLORS[cat] || '#888' }" title="Catégorie de vol (METAR)">{{ cat }}</span>
    </div>
    <p v-if="p.name" class="d-sub">{{ p.name }}</p>
    <div class="facts">
      <div v-for="[k, v] in facts" :key="k"><small>{{ k }}</small><b>{{ v }}</b></div>
      <div v-if="dayState" :class="isNight ? 'f-night' : 'f-day'"><small>Maintenant</small><b>{{ isNight ? "Nuit" : "Jour" }}</b></div>
    </div>
    <div v-if="ground || isFrench" class="apt-actions">
      <button v-if="ground" class="primary" type="button" @click="openAirportChart(p.ident)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20 20 4M7 4h13v13"/></svg>Plan au sol
      </button>
      <a v-if="isFrench" class="btn-ghost" :href="siaAd2Url(p.ident, cyc)" target="_blank" rel="noopener" :title="`AIRAC ${cyc.ident} (${fmtDate(cyc.start)} → ${fmtDate(cyc.end)})`">eAIP AD 2 ↗</a>
    </div>
  </div>

  <!-- 1. Météo -->
  <Section id="wx" title="Météo" :note="wx?.m ? 'METAR ' + metarTime : ''">
    <span v-if="!hasIcao" class="muted">Pas de code OACI : météo non disponible.</span>
    <span v-else-if="!wx" class="muted">Chargement…</span>
    <span v-else-if="wx.err" class="muted">Météo indisponible pour le moment (relais météo injoignable).</span>
    <template v-else>
      <template v-if="wx.m">
        <div class="facts wx-facts">
          <div v-for="[k, v] in wxFacts" :key="k" :class="{ wide: v.length > 11 }"><small>{{ k }}</small><b>{{ v }}</b></div>
        </div>
        <div class="wx-raw">{{ wx.m.rawOb }}</div>
      </template>
      <p v-else class="muted small">Pas de METAR récent.</p>
      <details v-if="wx.t" class="taf"><summary>TAF</summary><div class="wx-raw">{{ wx.t.rawTAF }}</div></details>
      <p v-else class="muted small">Pas de TAF.</p>
    </template>
  </Section>

  <!-- 2. Pistes et vent : une ligne par QFU -->
  <Section id="rwy" title="Pistes et vent" :badge="qfuRows.length ? String(qfuRows.length) : ''">
    <span v-if="details === undefined" class="muted">Chargement…</span>
    <template v-else-if="qfuRows.length">
      <table class="tbl qfu-tbl">
        <thead><tr><th>QFU</th><th>Dimensions</th><th v-if="rwyWinds.length">Face</th><th v-if="rwyWinds.length">Travers</th></tr></thead>
        <tbody>
          <template v-for="r in qfuRows" :key="r.qfu">
          <tr :class="{ best: r.qfu === bestQfu }">
            <td><b>{{ r.qfu }}</b><small v-if="r.hdg">{{ r.hdg }}</small></td>
            <td>{{ r.len }}<small v-if="r.surf">{{ r.surf }}</small></td>
            <template v-if="rwyWinds.length">
              <td v-if="r.w" :class="r.w.head < 0 ? 'tail' : 'head'">{{ r.w.head < 0 ? "↓" : "↑" }} {{ kt(r.w.head) }}<small v-if="r.w.gustHead != null">G {{ kt(r.w.gustHead) }}</small></td>
              <td v-else>—</td>
              <td v-if="r.w">{{ r.w.cross ? (r.w.side === "G" ? "← " : "→ ") : "" }}{{ kt(r.w.cross) }}<small v-if="r.w.gustCross != null">G {{ kt(r.w.gustCross) }}</small></td>
              <td v-else>—</td>
            </template>
          </tr>
          <tr v-if="r.e" class="qfu-sub" :class="{ best: r.qfu === bestQfu }">
            <td :colspan="rwyWinds.length ? 4 : 2">
              <span title="Distance de roulement utilisable au décollage">TORA <b>{{ m(r.e.tora) }}</b></span>
              <span title="Distance utilisable à l'atterrissage">LDA <b>{{ m(r.e.lda) }}</b></span>
              <span v-if="r.e.ils?.freq" class="ils" title="ILS / LOC">ILS <b>{{ r.e.ils.id }} {{ r.e.ils.freq.toFixed(2) }}</b>{{ r.e.ils.gs ? "\u00a0" + r.e.ils.gs + "°" : "" }}</span>
              <span v-if="r.e.papi">PAPI <b>{{ r.e.papi }}°</b></span>
              <span v-if="r.e.dthr" title="Seuil décalé">DTHR</span>
              <span v-if="r.e.thr_elev != null">THR <b>{{ r.e.thr_elev }} ft</b></span>
              <span v-for="it in r.e.intersections || []" :key="it.twy" class="int" title="Départ d'intersection : TORA">{{ it.twy }} <b>{{ m(it.tora) }}</b></span>
            </td>
          </tr>
          </template>
        </tbody>
      </table>
      <p v-if="eaip" class="muted small">Distances en mètres, données eAIP SIA{{ state.eaipCycle ? " AIRAC du " + state.eaipCycle.split("-").reverse().join("/") : "" }} (Licence Ouverte).</p>
      <p v-if="rwyWinds.length" class="muted small">Vent du METAR, rafales en « G ». ↑ face, ↓ arrière, ← de gauche, → de droite. Indicatif : la piste en service est celle de l'ATIS.</p>
    </template>
    <span v-else class="muted">Non publiées par les sources.</span>
  </Section>

  <!-- 3. Fréquences -->
  <Section id="frq" title="Fréquences" :badge="freqs.length ? String(freqs.length) : ''">
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
  </Section>

  <!-- 4. Carte d'aéroport (plan au sol) -->
  <Section id="ground" title="Carte d'aéroport" :open="!!ground" :note="ground ? 'OSM ' + ground.osm.slice(0, 10) : ''">
    <template v-if="ground">
      <div class="facts gfacts">
        <div><small>Postes</small><b>{{ (ground.counts.stand || 0) + (ground.counts.gate || 0) }}</b></div>
        <div><small>Points d'attente</small><b>{{ ground.counts.holding || 0 }}</b></div>
      </div>
      <div v-if="ground.runways.length" class="g-lbl">Pistes</div>
      <div v-if="ground.runways.length" class="chips twy-chips">
        <button v-for="r in ground.runways" :key="r" type="button" class="rwy" @mouseenter="groundPreview(p.ident, 'runway', r)"
          @mouseleave="groundPreview(p.ident, null)" @focus="groundPreview(p.ident, 'runway', r)" @blur="groundPreview(p.ident, null)"
          @click="groundFocus(p.ident, 'runway', r)">{{ r }}</button>
      </div>
      <div v-if="ground.taxiways.length" class="g-lbl">Taxiways</div>
      <div v-if="ground.taxiways.length" class="chips twy-chips">
        <button v-for="t in ground.taxiways" :key="t" type="button" class="twy" @mouseenter="groundPreview(p.ident, 'taxiway', t)"
          @mouseleave="groundPreview(p.ident, null)" @focus="groundPreview(p.ident, 'taxiway', t)" @blur="groundPreview(p.ident, null)"
          @click="groundFocus(p.ident, 'taxiway', t)">{{ t }}</button>
      </div>
      <p class="muted small">Survol d'une puce : repérage sur la carte · clic : cadrage et fiche. Données OpenStreetMap (ODbL), non certifiées.</p>
    </template>
    <p v-else class="muted small">Pas encore de plan au sol pour ce terrain (phase pilote : {{ Object.keys(state.ground).join(", ") || "aucun terrain chargé" }}).</p>
  </Section>

  <!-- 5. Cartes officielles et documentation -->
  <Section v-if="chartGroups.length || isFrench" id="docs" title="Cartes officielles" :open="false"
    :note="state.chartsMeta && chartGroups.length ? 'FAA ' + state.chartsMeta.cycle : isFrench ? 'AIRAC ' + cyc.ident : ''">
    <p v-if="isFrench" class="small">
      <a class="ext" :href="siaAd2Url(p.ident, cyc)" target="_blank" rel="noopener">eAIP SIA · AD 2 {{ p.ident }}</a>
      <span class="muted"> · AIRAC {{ cyc.ident }} ({{ fmtDate(cyc.start) }} → {{ fmtDate(cyc.end) }})</span>
    </p>
    <div v-if="chartGroups.length && state.chartsMeta" id="d-chr">
      <details v-for="g in chartGroups" :key="g.name" :open="g.name === `Diagramme d'aéroport` || g.name === 'Approches'">
        <summary>{{ g.name }} <small>{{ g.items.length }}</small></summary>
        <ul class="charts">
          <li v-for="[n, pdf] in g.items" :key="pdf"><a :href="state.chartsMeta.base + pdf" target="_blank" rel="noopener">{{ n }}</a></li>
        </ul>
      </details>
      <p class="muted small">PDF officiels FAA (domaine public). Ne pas utiliser pour la navigation.</p>
    </div>
  </Section>

  <!-- 6. Terrain : position, soleil -->
  <Section id="site" title="Terrain et soleil" :open="false" :note="today + ' UTC'">
    <KeyValues :rows="pairs([['Position', `${ddm(ll[1], true)} ${ddm(ll[0], false)}`], ['', `${dms(ll[1], true)} ${dms(ll[0], false)}`]])" />
    <KeyValues v-if="siteRows.length" :rows="siteRows" />
    <KeyValues :rows="sunRows" />
    <p class="muted small">Nuit = fin du crépuscule civil du soir → début du crépuscule civil du matin (EASA). Calcul approché (± 2 min).
      Source : {{ SRC[p.src] || p.src || "" }}{{ p.cycle ? " · " + p.cycle : "" }}</p>
  </Section>
</template>
