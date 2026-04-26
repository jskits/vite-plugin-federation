<script setup>
import { defineAsyncComponent } from 'vue';

const RemoteBadge = defineAsyncComponent(() => import('vueRemote/RemoteBadge'));
</script>

<template>
  <main class="vue-host-shell">
    <section class="hero">
      <p class="eyebrow">Vue host</p>
      <h1>Vue host consuming a manifest remote</h1>
      <p>
        This example validates that Vue SFC output, shared Vue singleton metadata, and manifest
        remote loading work together in production builds.
      </p>
    </section>
    <Suspense>
      <RemoteBadge label="Loaded from vueRemote/RemoteBadge" />
      <template #fallback>
        <p>Loading Vue remote...</p>
      </template>
    </Suspense>
  </main>
</template>

<style>
body {
  margin: 0;
  background:
    radial-gradient(circle at top left, #c5e7ae 0, transparent 32rem),
    linear-gradient(135deg, #fbfff7, #eef7e8);
  color: #17220e;
  font-family: Avenir, Montserrat, sans-serif;
}

.vue-host-shell {
  min-height: 100vh;
  padding: 4rem;
}

.hero {
  margin-bottom: 2rem;
  max-width: 44rem;
}

.eyebrow {
  color: #4a7c2c;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

h1 {
  font-size: clamp(2.25rem, 5vw, 4.5rem);
  line-height: 0.95;
  margin: 0 0 1rem;
}

p {
  color: #526243;
  line-height: 1.6;
}
</style>
