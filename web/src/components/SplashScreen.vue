<script setup lang="ts">
// Écran d'accueil : illustration de carte animée et code d'accès de test.
// ATTENTION : le code est en clair dans le code de la page. C'est un rideau pour la phase de test, pas une protection.
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { state } from "../store";

const TEST_CODE = "caca";
const KEY = "tropo-access";
const logo = import.meta.env.BASE_URL + "img/nelixair-logo.svg";

// L'accès expire après 10 min sans activité : l'écran d'accueil revient (heure de la dernière activité mémorisée)
const IDLE_MS = 10 * 60 * 1000;
const lastSeen = () => { try { return Number(localStorage.getItem(KEY)) || 0; } catch { return 0; } };
const touch = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* stockage indisponible */ } };
const expired = () => Date.now() - lastSeen() >= IDLE_MS;
const open = ref(expired());
const leaving = ref(false);
const code = ref("");
const res = ref<"" | "bad" | "ok">("");
const svg = ref<SVGSVGElement | null>(null);
const input = ref<HTMLInputElement | null>(null);

function submit() {
  if (code.value.trim().toLowerCase() !== TEST_CODE) { res.value = "bad"; input.value?.select(); return; }
  res.value = "ok";
  touch();
  setTimeout(() => { leaving.value = true; }, 500);
  setTimeout(() => { open.value = false; }, 1200);
}
async function show() {
  code.value = ""; res.value = ""; leaving.value = false; open.value = true;
  await nextTick();
  input.value?.focus();
  if (!state.anim) svg.value?.pauseAnimations(); // « réduire les animations » ou bouton Animations coupé
}
// Activité (souris, clic, touche, molette) : repousse l'expiration, au plus une écriture toutes les 20 s
let lastTouch = 0;
function onActivity() {
  if (open.value || Date.now() - lastTouch < 20000) return;
  if (expired()) { show(); return; }
  lastTouch = Date.now(); touch();
}
function check() { if (!open.value && expired()) show(); }
const EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
let timer = 0;
onMounted(() => {
  if (open.value) show(); else touch();
  EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true, capture: true }));
  document.addEventListener("visibilitychange", check);
  timer = window.setInterval(check, 30000);
});
onBeforeUnmount(() => {
  EVENTS.forEach((e) => window.removeEventListener(e, onActivity, { capture: true }));
  document.removeEventListener("visibilitychange", check);
  clearInterval(timer);
});
const ROUTE = "M930 640 L900 560 L880 420 L860 330 L800 220 L760 172";
const PLANE = "M0 -12 Q2 -10 2 -5 L2 -3 L11 2 L11 4 L2 1.5 L1.8 6.5 L5 9 L5 10.5 L0 9.5 L-5 10.5 L-5 9 L-1.8 6.5 L-2 1.5 L-11 4 L-11 2 L-2 -3 L-2 -5 Q-2 -10 0 -12 Z";
const TICK = "METAR LFML 100650Z 08008KT 9999 BKN033 17/13 Q1014 · METAR LFPG 100700Z 07009KT 6000 -RA SCT005 BKN073 07/07 Q1011 · METAR LFLL 100700Z 36006KT CAVOK 09/04 Q1016 · METAR LFMN 100700Z 31005KT 9999 FEW030 15/09 Q1013 · METAR LFBO 100700Z 16005KT 7000 NSC 12/12 Q1011 · ";
</script>

<template>
  <div v-if="open" class="splash" :class="{ leaving, still: !state.anim }" role="dialog" aria-modal="true" aria-labelledby="splash-title">
    <svg ref="svg" class="splash-art" viewBox="0 0 1280 800" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="sp-glow" cx="72%" cy="48%" r="60%"><stop offset="0" stop-color="#14254a" /><stop offset="1" stop-color="#070d1a" /></radialGradient>
        <filter id="sp-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="32" /></filter>
        <path id="sp-route" :d="ROUTE" />
        <path id="sp-t1" d="M1400 120 L520 340" /><path id="sp-t2" d="M560 880 L1220 20" /><path id="sp-t3" d="M1400 530 L560 460" />
      </defs>
      <rect width="1280" height="800" fill="url(#sp-glow)" />
      <g stroke="#1d2c4c" fill="none">
        <path d="M-200 120 Q640 90 1480 120 M-200 280 Q640 250 1480 280 M-200 440 Q640 410 1480 440 M-200 600 Q640 570 1480 600 M-200 760 Q640 730 1480 760" />
        <path d="M260 -50 L230 850 M480 -50 L465 850 M700 -50 L700 850 M920 -50 L935 850 M1140 -50 L1170 850" />
      </g>
      <g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="10" fill="#33456b">
        <text x="1196" y="114">N49°</text><text x="1196" y="274">N47°</text><text x="1196" y="434">N45°</text><text x="1196" y="594">N43°</text>
      </g>
      <g fill="none" stroke="#24375c">
        <path d="M1040 360 C1080 330 1150 340 1170 390 C1190 440 1140 480 1090 470 C1040 460 1010 400 1040 360 Z" />
        <path d="M1060 375 C1090 355 1135 365 1148 395 C1160 430 1125 452 1095 447 C1062 440 1045 400 1060 375 Z" />
        <path d="M1080 390 C1100 380 1122 388 1128 405 C1133 422 1112 432 1097 428 C1082 424 1072 402 1080 390 Z" />
      </g>
      <g fill="#c7d6f2" opacity=".07" filter="url(#sp-blur)">
        <ellipse cx="1080" cy="160" rx="180" ry="80"><animateTransform attributeName="transform" type="translate" values="0 0;-120 30;0 0" dur="90s" repeatCount="indefinite" /></ellipse>
        <ellipse cx="1170" cy="550" rx="150" ry="70"><animateTransform attributeName="transform" type="translate" values="0 0;-100 25;0 0" dur="110s" repeatCount="indefinite" /></ellipse>
        <ellipse cx="780" cy="660" rx="140" ry="60"><animateTransform attributeName="transform" type="translate" values="0 0;-90 -20;0 0" dur="100s" repeatCount="indefinite" /></ellipse>
      </g>
      <g stroke="#2f5fae" stroke-width="1.2" stroke-opacity=".7" fill="none">
        <path d="M620 200 L760 172 L1010 140" /><path d="M600 300 L860 330 L1110 300" /><path d="M700 470 L880 420 L1060 520" />
        <path d="M560 560 L900 560 L1150 600" /><path d="M860 330 L1000 250" />
      </g>
      <g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="9" fill="#4d78c4">
        <text x="960" y="545">UM976</text><text x="700" y="318">UL612</text>
      </g>
      <path d="M705 128 L815 128 L840 190 L815 230 L705 230 L680 190 Z" fill="#3d8bfd" fill-opacity=".05" stroke="#3d8bfd" stroke-opacity=".45" stroke-dasharray="6 4" />
      <circle cx="930" cy="640" r="44" fill="#3d8bfd" fill-opacity=".05" stroke="#3d8bfd" stroke-opacity=".45" stroke-dasharray="6 4" />
      <circle cx="880" cy="420" r="58" fill="none" stroke="#5b7fb8" stroke-opacity=".5" />
      <path d="M880 420 L880 362 A58 58 0 0 1 921 379 Z" fill="#82b4ff" fill-opacity=".22">
        <animateTransform attributeName="transform" type="rotate" from="0 880 420" to="360 880 420" dur="5s" repeatCount="indefinite" />
      </path>
      <use href="#sp-route" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />
      <use href="#sp-route" fill="none" stroke="#e0218a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
      <use href="#sp-route" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="1.6" stroke-dasharray="6 10">
        <animate attributeName="stroke-dashoffset" from="16" to="0" dur="1.1s" repeatCount="indefinite" />
      </use>
      <g fill="#fff" stroke="#e0218a" stroke-width="2"><circle cx="900" cy="560" r="4" /><circle cx="880" cy="420" r="4" /><circle cx="860" cy="330" r="4" /></g>
      <g fill="#e0218a" stroke="#fff" stroke-width="2"><circle cx="915" cy="600" r="4.5" /><circle cx="800" cy="220" r="4.5" /></g>
      <g fill="#e0218a" stroke="#fff" stroke-width="2.5"><circle cx="930" cy="640" r="7" /><circle cx="760" cy="172" r="7" /></g>
      <g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-weight="700" font-size="11" fill="#ff5fb0">
        <text x="912" y="565">MTL</text><text x="892" y="425">LSE</text><text x="872" y="335">DJL</text><text x="926" y="605">TOC</text><text x="812" y="225">TOD</text>
      </g>
      <g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-weight="700" font-size="12" fill="#fff"><text x="944" y="645">LFML</text><text x="700" y="160">LFPG</text></g>
      <g fill="none" stroke-width="2">
        <circle cx="1010" cy="140" r="5" stroke="#2fbf71" /><circle cx="1110" cy="300" r="5" stroke="#2fbf71" /><circle cx="600" cy="300" r="5" stroke="#2fbf71" />
        <circle cx="1060" cy="520" r="5" stroke="#3d8bfd" /><circle cx="620" cy="200" r="5" stroke="#3d8bfd" />
        <circle cx="1150" cy="600" r="5" stroke="#e5484d" /><circle cx="560" cy="560" r="5" stroke="#e5484d" />
      </g>
      <g fill="none" stroke="#e5484d" stroke-width="2">
        <circle cx="1150" cy="600" r="5"><animate attributeName="r" values="5;21" dur="2.4s" repeatCount="indefinite" /><animate attributeName="opacity" values=".9;0" dur="2.4s" repeatCount="indefinite" /></circle>
        <circle cx="560" cy="560" r="5"><animate attributeName="r" values="5;21" dur="2.4s" begin="-1.2s" repeatCount="indefinite" /><animate attributeName="opacity" values=".9;0" dur="2.4s" begin="-1.2s" repeatCount="indefinite" /></circle>
      </g>
      <circle cx="760" cy="172" r="7" fill="none" stroke="#ffb020" stroke-width="2"><animate attributeName="r" values="7;26" dur="1.8s" repeatCount="indefinite" /><animate attributeName="opacity" values=".9;0" dur="1.8s" repeatCount="indefinite" /></circle>
      <g><path :d="PLANE" fill="#2fbf71" transform="rotate(90) scale(.7)" /><animateMotion dur="60s" repeatCount="indefinite" rotate="auto"><mpath href="#sp-t1" /></animateMotion></g>
      <g><path :d="PLANE" fill="#3d8bfd" transform="rotate(90) scale(.7)" /><animateMotion dur="75s" begin="-28s" repeatCount="indefinite" rotate="auto"><mpath href="#sp-t2" /></animateMotion></g>
      <g><path :d="PLANE" fill="#2fbf71" transform="rotate(90) scale(.7)" /><animateMotion dur="68s" begin="-40s" repeatCount="indefinite" rotate="auto"><mpath href="#sp-t3" /></animateMotion></g>
      <g><path :d="PLANE" fill="#ffd21f" stroke="#1a1300" stroke-width=".8" transform="rotate(90)" /><animateMotion dur="22s" repeatCount="indefinite" rotate="auto"><mpath href="#sp-route" /></animateMotion></g>
    </svg>
    <div class="splash-fade" aria-hidden="true"></div>
    <div class="splash-ticker" aria-hidden="true"><div>{{ TICK }}{{ TICK }}</div></div>

    <form class="splash-card" @submit.prevent="submit">
      <div class="splash-brand sp-in">
        <img :src="logo" alt="Nelixair" width="56" height="56">
        <div><h1 id="splash-title">TROPO</h1><span>par Nelixair</span></div>
      </div>
      <p class="splash-lead sp-in2">Carte et préparation de vol pour la simulation : voies aériennes, aéroports, météo, trafic en ligne.</p>
      <div class="splash-box sp-in3">
        <label for="splash-code">Code d'accès</label>
        <div class="splash-row">
          <input id="splash-code" ref="input" v-model="code" type="password" autocomplete="off" placeholder="Code fourni par Nelixair"
            :class="res" :aria-invalid="res === 'bad'" @input="res = ''">
          <button type="submit">Entrer</button>
        </div>
        <span v-if="res === 'bad'" role="alert" class="splash-msg bad">Code incorrect. Demandez-le à un responsable Nelixair.</span>
        <span v-else-if="res === 'ok'" role="status" class="splash-msg ok">Accès accordé, ouverture de la carte…</span>
        <span v-else class="splash-msg">Version de test réservée aux membres.</span>
      </div>
    </form>
    <div class="splash-foot" aria-hidden="true"><span>NE PAS UTILISER POUR LA NAVIGATION RÉELLE</span><span>{{ state.cycleText }}</span></div>
  </div>
</template>
