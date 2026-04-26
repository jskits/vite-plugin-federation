<script setup>
import RemoteBadge from './RemoteBadge.vue';
</script>

<template>
  <main class="vue-remote-shell">
    <p class="eyebrow">Vue remote</p>
    <h1>Manifest-first Vue expose</h1>
    <RemoteBadge label="Previewed inside vue-remote" />
  </main>
</template>

<style>
body {
  margin: 0;
  background: #f3f8ee;
  color: #17220e;
  font-family: Avenir, Montserrat, sans-serif;
}

.vue-remote-shell {
  min-height: 100vh;
  padding: 4rem;
}

.eyebrow {
  color: #4a7c2c;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
</style>
