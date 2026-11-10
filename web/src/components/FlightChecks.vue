<script setup lang="ts">
// Contrôles du plan de vol : un voyant par règle, détail au survol / en dessous.
import { CircleAlert, CircleCheck, Info } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { routeAsp, useRouteAsp } from "../lib/routeAsp";
import { fuelCheck, nightCheck, semicircular, terrainCheck, zonesCheck, type Check } from "../lib/flightChecks";
import { state } from "../store";
import Section from "./Section.vue";

const base = ref<Check[]>([]);
useRouteAsp();
const checks = computed(() => (base.value.length ? [...base.value.slice(0, 2), zonesCheck(routeAsp.value), ...base.value.slice(2)] : []));
watch(() => state.ofp, async (o) => {
  if (!o) { base.value = []; return; }
  const sync = [semicircular(o), fuelCheck(o), nightCheck(o)];
  base.value = [sync[0], { id: "terr", title: "Relief / MORA", status: "info", text: "Vérification du relief…" }, ...sync.slice(1)];
  const t = await terrainCheck(o);
  if (state.ofp === o) base.value = [sync[0], t, ...sync.slice(1)];
}, { immediate: true });
const warns = () => checks.value.filter((c) => c.status === "warn").length;
function show(c: Check) { if (c.at != null) { state.profileOpen = true; state.profileAt = c.at; } }
</script>

<template>
  <Section id="ofp-checks" title="Contrôles" :badge="checks.length ? (warns() ? warns() + ' à voir' : 'OK') : ''">
    <ul class="chk-list">
      <li v-for="c in checks" :key="c.id" :class="c.status">
        <component :is="c.status === 'ok' ? CircleCheck : c.status === 'warn' ? CircleAlert : Info" :size="16" aria-hidden="true" />
        <div><b>{{ c.title }}</b><p>{{ c.text }}</p>
          <button v-if="c.at != null" type="button" class="link-btn" @click="show(c)">Voir sur le profil</button></div>
      </li>
    </ul>
    <p class="muted small">Règles simplifiées (OACI / EASA) pour préparer un vol simulé : pas un contrôle réglementaire.</p>
  </Section>
</template>
