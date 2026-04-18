import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
    },
    environment: 'node',
    include: ['src/**/*.test.ts'],
    name: 'vite-plugin-federation',
  },
});
