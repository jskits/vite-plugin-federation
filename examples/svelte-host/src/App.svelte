<script>
  import { onMount } from 'svelte';

  let RemotePanel = null;

  onMount(async () => {
    const mod = await import('svelteRemote/RemotePanel');
    RemotePanel = mod.default ?? mod;
  });
</script>

<main class="svelte-host-shell">
  <section class="hero">
    <p class="eyebrow">Svelte host</p>
    <h1>Svelte host consuming a manifest remote</h1>
    <p>
      This example validates Svelte component compilation, manifest remote loading, and shared
      Svelte singleton metadata in production builds.
    </p>
  </section>

  {#if RemotePanel}
    <svelte:component this={RemotePanel} title="Loaded from svelteRemote/RemotePanel" />
  {:else}
    <p>Loading Svelte remote...</p>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    background:
      radial-gradient(circle at 20% 10%, #ffc58f 0, transparent 26rem),
      linear-gradient(135deg, #fffaf1, #ffe6cc);
    color: #2f1708;
    font-family: Charter, Georgia, serif;
  }

  .svelte-host-shell {
    min-height: 100vh;
    padding: 4rem;
  }

  .hero {
    margin-bottom: 2rem;
    max-width: 46rem;
  }

  .eyebrow {
    color: #b1441b;
    font-family: Optima, Avenir, sans-serif;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  h1 {
    font-size: clamp(2.25rem, 5vw, 4.5rem);
    line-height: 0.95;
    margin: 0 0 1rem;
  }

  p {
    color: #7a4c31;
    line-height: 1.6;
  }
</style>
