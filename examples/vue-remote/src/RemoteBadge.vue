<script setup>
defineProps({
  label: {
    type: String,
    default: 'Loaded from vueRemote/RemoteBadge',
  },
});
</script>

<template>
  <article class="remote-badge">
    <span class="remote-badge__mark">Vue</span>
    <div>
      <h2>{{ label }}</h2>
      <p>Shared Vue singleton resolution is exercised through this federated component.</p>
    </div>
  </article>
</template>

<style scoped>
.remote-badge {
  align-items: center;
  background: linear-gradient(135deg, #f7ffef, #dff2ca);
  border: 1px solid #b8d99e;
  border-radius: 24px;
  box-shadow: 0 24px 80px rgb(71 117 42 / 18%);
  display: flex;
  gap: 1.25rem;
  max-width: 36rem;
  padding: 1.5rem;
}

.remote-badge__mark {
  background: #2f7d32;
  border-radius: 999px;
  color: white;
  font-weight: 800;
  padding: 0.75rem 1rem;
}

h2 {
  margin: 0 0 0.5rem;
}

p {
  color: #526243;
  line-height: 1.6;
  margin: 0;
}
</style>
