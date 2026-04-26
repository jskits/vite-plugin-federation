<script>
  export let title = 'Loaded from svelteRemote/RemotePanel';
</script>

<article class="remote-panel">
  <span class="remote-panel__spark">Svelte</span>
  <div>
    <h2>{title}</h2>
    <p>Shared Svelte runtime metadata is resolved through this federated component.</p>
  </div>
</article>

<style>
  .remote-panel {
    background: linear-gradient(145deg, #fffdf7, #ffe0c2);
    border: 1px solid #f0b077;
    border-radius: 28px;
    box-shadow: 0 24px 80px rgb(177 68 27 / 18%);
    display: grid;
    gap: 1rem;
    max-width: 38rem;
    padding: 1.5rem;
  }

  .remote-panel__spark {
    background: #ff5a1f;
    border-radius: 999px;
    color: white;
    display: inline-block;
    font-family: Optima, Avenir, sans-serif;
    font-weight: 800;
    justify-self: start;
    padding: 0.65rem 0.9rem;
  }

  h2 {
    margin: 0 0 0.5rem;
  }

  p {
    color: #7a4c31;
    line-height: 1.6;
    margin: 0;
  }
</style>
