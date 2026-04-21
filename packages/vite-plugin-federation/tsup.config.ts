import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

export default defineConfig({
  clean: true,
  define: {
    __VITE_PLUGIN_FEDERATION_VERSION__: JSON.stringify(packageJson.version),
  },
  dts: true,
  entry: ['src/index.ts', 'src/runtime/index.ts'],
  external: ['vite', 'rollup', '@playwright/test'],
  format: ['esm', 'cjs'],
  sourcemap: true,
  splitting: false,
  target: 'es2022',
  treeshake: true,
});
