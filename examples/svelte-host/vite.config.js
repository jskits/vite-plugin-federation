import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import federation from 'vite-plugin-federation';

export default defineConfig({
  server: {
    port: 4193,
  },
  preview: {
    port: 4193,
  },
  plugins: [
    svelte(),
    federation({
      name: 'svelteHost',
      dts: false,
      remotes: {
        svelteRemote: 'http://localhost:4192/mf-manifest.json',
      },
      shared: {
        svelte: {
          singleton: true,
          requiredVersion: '^5.0.0',
        },
      },
    }),
  ],
});
