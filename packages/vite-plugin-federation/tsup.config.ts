import { defineConfig } from 'tsup';

export default defineConfig({
  clean: true,
  dts: true,
  entry: ['src/index.ts', 'src/runtime/index.ts'],
  external: ['vite', 'rollup', '@playwright/test'],
  format: ['esm', 'cjs'],
  sourcemap: true,
  splitting: false,
  target: 'es2022',
  treeshake: true,
});
