import { computed, ref } from 'vue';

export const vueSharedCoreCounter = ref(0);

export function useVueCoreLabel(consumer) {
  const label = computed(() => `vue-core:${consumer}:${vueSharedCoreCounter.value}`);
  const increment = () => {
    vueSharedCoreCounter.value += 1;
  };

  return {
    increment,
    label,
  };
}
