<script>
  import RemotePanel from './RemotePanel.svelte';
</script>

<main class="svelte-remote-shell">
  <p class="eyebrow">Svelte remote</p>
  <h1>Manifest-first Svelte expose</h1>
  <RemotePanel title="Previewed inside svelte-remote" />
</main>

<style>
  :global(body) {
    margin: 0;
    background: #fff6ea;
    color: #2f1708;
    font-family: Charter, Georgia, serif;
  }

  .svelte-remote-shell {
    min-height: 100vh;
    padding: 4rem;
  }

  .eyebrow {
    color: #b1441b;
    font-family: Optima, Avenir, sans-serif;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
</style>
