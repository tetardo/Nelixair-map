<script setup lang="ts">
import { state } from "../store";
</script>

<template>
  <div id="status" class="status">
    <span id="cursor">{{ state.cursor }}</span><span id="cycle">{{ state.cycleText }}</span>
  </div>
</template>
