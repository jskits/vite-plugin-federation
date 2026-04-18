import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
    },
    env: {
      MFE_VITE_NO_TEST_ENV_CHECK: 'true',
    },
    environment: 'node',
    exclude: ['**/e2e/**', '**/node_modules/**'],
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    name: 'vite-plugin-federation',
  },
});
