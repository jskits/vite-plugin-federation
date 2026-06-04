<script setup>
import { defineAsyncComponent } from 'vue';
import { useVueCoreLabel } from '@mf-examples/vue-shared-core';
import {
  connectRuntimeRemoteHmr,
  loadRemoteFromManifest,
} from 'vite-plugin-federation/runtime';

const RemoteBadge = defineAsyncComponent(() => import('vueRemote/RemoteBadge'));
const runtimeRemoteManifestUrl =
  import.meta.env.VITE_VUE_REMOTE_MANIFEST_URL || 'http://localhost:4210/mf-manifest.json';
const RuntimeRemoteBadge = defineAsyncComponent(async () => {
  const mod = await loadRemoteFromManifest(
    'vueRuntimeRemote/RemoteBadge',
    runtimeRemoteManifestUrl,
    {
      remoteName: 'vueRuntimeRemote',
    },
  );

  return mod.default ?? mod;
});
const { label: hostCoreLabel } = useVueCoreLabel('host');
const hostEyebrow = 'Vue host';
const hostTitle = 'Vue host consuming a manifest remote';
const hostDescription =
  'This example validates that Vue SFC output, shared Vue singleton metadata, and manifest remote loading work together in production builds.';

if (import.meta.hot) {
  const runtimeHmr = connectRuntimeRemoteHmr('vueRuntimeRemote', runtimeRemoteManifestUrl, {
    refresh: false,
  });
  import.meta.hot.dispose(() => runtimeHmr.close());
}
</script>

<template>
  <main class="vue-host-shell" data-testid="vue-host-ready">
    <section class="hero">
      <p class="eyebrow">{{ hostEyebrow }}</p>
      <h1>{{ hostTitle }}</h1>
      <p>{{ hostDescription }}</p>
      <p data-testid="vue-core-host">{{ hostCoreLabel }}</p>
    </section>
    <Suspense>
      <RemoteBadge label="Loaded from vueRemote/RemoteBadge" />
    </Suspense>
    <Suspense>
      <RuntimeRemoteBadge label="Runtime loaded from vueRuntimeRemote/RemoteBadge" />
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
