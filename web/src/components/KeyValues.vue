<script setup lang="ts">
defineProps<{ rows: [string, string][] }>();
</script>

<template>
  <dl><template v-for="[k, v] in rows" :key="k"><dt>{{ k }}</dt><dd>{{ v }}</dd></template></dl>
</template>
